// UI/UX layer — the browser-side AgentClient. Streams AgentEvent from the Node Core
// over SSE and reduces them into a live session model. Bound to React via
// useSyncExternalStore. This is the only thing in the UI that knows about /api/*.

import { useSyncExternalStore } from 'react';
import type { AgentClient, AgentEvent } from '../core/agent';
import type { CustomModelEntry, FileNode, Message, ModelOption, ModelTestResult, SessionSummary, TrajStep } from '../core/types';

export interface AgentState {
  summary: SessionSummary | null;
  messages: Message[];                         // finalized assistant + user messages
  streaming: { text: string; thinking: string; steps: TrajStep[] } | null;  // current in-flight turn
  fileList: FileNode[];                        // flat list of files the agent wrote
  contents: Record<string, string>;            // path -> file text
  error: string | null;
  loading: boolean;
  model: string | null;                        // resolved model from /api/health (provider/model)
  cwd: string | null;                          // agent working directory from /api/health
}

const initialState: AgentState = {
  summary: null, messages: [], streaming: null, fileList: [], contents: {}, error: null, loading: false,
  model: null, cwd: null,
};

class BrowserAgentClient implements AgentClient {
  private state: AgentState = initialState;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: AgentEvent) => void>();
  private es: EventSource | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.connect();
      this.refreshHealth();
    }
  }

  /** Pull the resolved model + cwd from the Core so the UI shows real config. */
  async refreshHealth() {
    try {
      const h = await (await fetch('/api/health')).json();
      this.set({ model: h.model ?? null, cwd: h.cwd ?? null });
    } catch { /* server not ready yet — retry on next interaction */ }
  }

  private connect() {
    if (this.es) return;
    try {
      this.es = new EventSource('/api/events');
      this.es.onmessage = (msg) => {
        try { this.reduce(JSON.parse(msg.data) as AgentEvent); } catch { /* skip keepalive comments */ }
      };
      // EventSource auto-reconnects on error; nothing to do here.
    } catch { /* SSE unavailable */ }
  }

  // ---- AgentClient contract: deliver raw events to subscribers ----
  subscribe = (fn: (e: AgentEvent) => void): (() => void) => {
    this.eventListeners.add(fn);
    return () => { this.eventListeners.delete(fn); };
  };

  // ---- external store contract (for useSyncExternalStore) ----
  storeSubscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = (): AgentState => this.state;
  private emit() { for (const l of this.listeners) l(); }
  private set(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private reduce(e: AgentEvent) {
    for (const l of this.eventListeners) l(e);
    const s = this.state;
    switch (e.type) {
      case 'session_start':
        this.set({ summary: e.session });
        return;
      case 'thinking_delta': {
        const st = s.streaming ?? { text: '', thinking: '', steps: [] };
        this.set({ streaming: { ...st, thinking: st.thinking + e.delta }, loading: true });
        return;
      }
      case 'text_delta': {
        const st = s.streaming ?? { text: '', thinking: '', steps: [] };
        this.set({ streaming: { ...st, text: st.text + e.delta }, loading: true });
        return;
      }
      case 'tool_start': {
        const st = s.streaming ?? { text: '', thinking: '', steps: [] };
        this.set({ streaming: { ...st, steps: [...st.steps, e.step] }, loading: true });
        return;
      }
      case 'tool_update':
      case 'tool_end': {
        const st = s.streaming;
        if (!st) return;
        const steps = st.steps.slice();
        const idx = steps.length - 1;
        if (idx >= 0) steps[idx] = { ...steps[idx], ...e.step };
        this.set({ streaming: { ...st, steps } });
        return;
      }
      case 'file': {
        const path = e.file.path || e.file.name;
        const list = s.fileList.filter(f => (f.path || f.name) !== path);
        list.push(e.file);
        this.set({ fileList: list, contents: { ...s.contents, [path]: e.content } });
        return;
      }
      case 'agent_end': {
        this.set({ messages: [...s.messages, e.message], streaming: null, loading: false });
        return;
      }
      case 'error':
        this.set({ error: e.message, streaming: null, loading: false });
        return;
    }
  }

  // ---- AgentClient methods (HTTP) ----
  async prompt(text: string): Promise<void> {
    const userMsg: Message = { role: 'user', text, when: '刚刚' };
    this.set({
      messages: [...this.state.messages, userMsg],
      streaming: { text: '', thinking: '', steps: [] },
      loading: true,
      error: null,
    });
    try {
      await fetch('/api/prompt', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e: any) {
      this.set({ error: 'network: ' + (e?.message || e), loading: false });
    }
  }

  async setThinking(on: boolean): Promise<void> {
    try {
      await fetch('/api/thinking', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ on }),
      });
    } catch { /* ignore */ }
  }

  // ---- model configuration (plain HTTP; the drawer refreshes view state after) ----
  async listModels(): Promise<ModelOption[]> {
    try { const r = await (await fetch('/api/models')).json(); return (r.models ?? []) as ModelOption[]; }
    catch { return []; }
  }
  async testCustomModel(entry: CustomModelEntry): Promise<ModelTestResult> {
    try {
      return await (await fetch('/api/models/custom/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      })).json();
    } catch (e: any) { return { ok: false, error: 'network: ' + (e?.message || e) }; }
  }
  async addCustomModel(entry: CustomModelEntry): Promise<{ ok: boolean; error?: string; entry?: CustomModelEntry }> {
    try {
      return await (await fetch('/api/models/custom', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      })).json();
    } catch (e: any) { return { ok: false, error: 'network: ' + (e?.message || e) }; }
  }
  async removeCustomModel(id: string): Promise<{ ok: boolean }> {
    try {
      return await (await fetch('/api/models/custom?id=' + encodeURIComponent(id), { method: 'DELETE' })).json();
    } catch (e: any) { return { ok: false }; }
  }
  async setActiveModel(providerId: string, modelId: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    try {
      const r = await (await fetch('/api/models/active', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, modelId }),
      })).json();
      await this.refreshHealth();   // update the active model shown in the topbar/drawer
      return r;
    } catch (e: any) { return { ok: false, error: 'network: ' + (e?.message || e) }; }
  }

  async saveFile(path: string, content: string): Promise<void> {
    this.set({ contents: { ...this.state.contents, [path]: content } });
    try {
      await fetch('/api/file', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });
    } catch (e: any) {
      this.set({ error: 'save: ' + (e?.message || e) });
    }
  }

  /** Change the agent's working directory. The Core re-binds its session to the new cwd, so the
   *  current conversation/files (which belonged to the old workspace) are reset here too. */
  async setCwd(path: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await (await fetch('/api/cwd', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })).json();
      if (!r.ok) return { ok: false, error: r.error };
      this.set({
        messages: [], streaming: null, fileList: [], contents: {}, error: null, loading: false,
        summary: { id: 'cwd-' + Date.now().toString(36), title: '新对话', group: '今天', time: '刚刚', live: true },
      });
      await this.refreshHealth();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    try { return await (await fetch('/api/sessions')).json(); } catch { return []; }
  }
  async newSession(): Promise<void> {
    try { await fetch('/api/session/new', { method: 'POST' }); } catch { /* ignore */ }
    this.set({
      messages: [], streaming: null, fileList: [], contents: {}, error: null, loading: false,
      summary: { id: 'new', title: '新对话', group: '今天', time: '刚刚', live: true },
    });
  }
  async switchSession(_id: string): Promise<void> { /* single in-memory session */ }

  /** Seed a realistic completed conversation so the Report + Canvas linkage is demoable
   *  and testable end-to-end without a live agent. UI-only — does not round-trip the Core. */
  async loadDemo(): Promise<void> {
    this.set({
      summary: { id: 'demo', title: 'PDF 检测报告分析', group: '今天', time: '刚刚', live: false },
      messages: DEMO_MESSAGES,
      streaming: null,
      fileList: DEMO_FILES,
      contents: DEMO_CONTENTS,
      error: null,
      loading: false,
    });
  }
}

export const agentClient = new BrowserAgentClient();

export function useAgentState(): AgentState {
  return useSyncExternalStore(agentClient.storeSubscribe, agentClient.getSnapshot, agentClient.getSnapshot);
}

/* ────────── demo dataset (mocked, self-consistent) ────────── */

const DEMO_MESSAGES: Message[] = [
  { role: 'user', text: '分析 workspace 里的 PDF 检测报告，提取数据并生成可跳转的数据看板。', when: '刚刚' },
  {
    role: 'agent', status: 'done',
    intro: '已完成 **26 份 PDF 检测报告** 的解析与结构化：\n\n- 页数：**84**\n- 表格：**91**\n- 图片：**143**\n\n结果汇总成一份可跳转的数据看板。下方「报告」标签可查看纵览，每一步工具调用都能在右侧 Canvas 里展开详情。',
    traj: [
      { t: 'think', title: '思考', det: '用户想要端到端的数据看板。计划：先解析 PDF…', text: '用户想要端到端的数据看板。计划：先用 pipeline 解析 PDF，读取聚合结果，分别写出 README、预算表与 HTML 看板，最后做 VLM caption 校验。', status: 'done', time: '14:01' },
      { t: 'code', title: '执行命令', det: 'python run_pipeline.py --vlm skip', in: '{"command":"python run_pipeline.py --vlm skip"}', out: 'Found 26 PDFs · parsing 84 pages, 91 tables, 143 images…', status: 'done', time: '14:02' },
      { t: 'read', title: '读取文件', det: 'uniex-output/result.json', in: '{"path":"uniex-output/result.json"}', out: '84 页 · 91 表格 · 143 图片', status: 'done', time: '14:03' },
      { t: 'think', title: '思考', det: '聚合结果到手，接下来分别产出 README、预算表与看板…', text: '聚合结果到手：84 页 / 91 表格 / 143 图片。接下来分别产出 README（说明）、budget.csv（预算汇总）和 report.html（可跳转看板），最后用 VLM 校验图片 caption。', status: 'done', time: '14:03' },
      { t: 'write', title: '写入文件', det: 'README.md', in: '{"path":"README.md"}', out: '完成 · 1.2 KB', status: 'done', time: '14:04', file: 'README.md' },
      { t: 'write', title: '写入文件', det: 'budget.csv', in: '{"path":"budget.csv"}', out: '完成 · 6 行', status: 'done', time: '14:05', file: 'budget.csv' },
      { t: 'write', title: '写入文件', det: 'report.html', in: '{"path":"report.html"}', out: '完成 · 2.1 KB', status: 'done', time: '14:06', file: 'report.html' },
      { t: 'analyze', title: 'VLM 分析', det: '143 张图片 caption 校验', in: '{"model":"vlm-native"}', out: '143/143 通过 schema 校验', status: 'done', time: '14:07' },
    ],
    artifacts: [
      { name: 'README.md', type: 'md', label: '文档' },
      { name: 'budget.csv', type: 'sheet', label: '表格' },
      { name: 'report.html', type: 'html', label: '看板' },
      { name: 'run_pipeline.py', type: 'code', label: '脚本' },
    ],
    stats: { ttft: 740, tpot: 38, duration: 12600, input: 4280, output: 612 },
  },
];

const DEMO_FILES: FileNode[] = [
  { name: 'README.md', path: 'README.md', type: 'md', size: '1.2 KB' },
  { name: 'budget.csv', path: 'budget.csv', type: 'sheet', size: '0.8 KB' },
  { name: 'report.html', path: 'report.html', type: 'html', size: '2.1 KB' },
  { name: 'run_pipeline.py', path: 'run_pipeline.py', type: 'code', size: '0.9 KB' },
];

const DEMO_CONTENTS: Record<string, string> = {
  'README.md': [
    '# PDF 检测报告分析',
    '',
    '本批次共解析 **26 份** PDF 检测报告。',
    '',
    '- 页数：84',
    '- 表格：91',
    '- 图片：143',
    '',
    '产物：`budget.csv`（预算汇总）、`report.html`（数据看板）。',
    '',
    '## 处理流程',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[26 份 PDF] --> B[解析页面]',
    '  B --> C[提取表格与图片]',
    '  C --> D[聚合预算]',
    '  D --> E[(budget.csv)]',
    '  D --> F[(report.html)]',
    '```',
  ].join('\n'),
  'budget.csv': [
    '项目,预算(元),实际(元),差额(元)',
    '检测费用,12000,11800,-200',
    '人工,8000,8400,+400',
    '设备折旧,5000,5000,0',
    '材料,3000,3200,+200',
    '合计,28000,28400,+400',
  ].join('\n'),
  'run_pipeline.py': [
    '#!/usr/bin/env python3',
    '"""Parse a batch of PDF inspection reports into structured data."""',
    'from pathlib import Path',
    'import csv, json',
    '',
    'REPORT_DIR = Path("reports")',
    '',
    '',
    'def parse_report(path: Path) -> dict:',
    '    """Extract tables and images from one PDF report."""',
    '    text = path.read_text(encoding="utf-8")',
    '    return {',
    '        "name": path.stem,',
    '        "tables": text.count("<table>"),',
    '        "images": text.count("<img "),',
    '    }',
    '',
    '',
    'def main() -> None:',
    '    rows = [parse_report(p) for p in REPORT_DIR.glob("*.pdf")]',
    '    print(f"Found {len(rows)} reports · "',
    '          f"{sum(r[\'tables\'] for r in rows)} tables, "',
    '          f"{sum(r[\'images\'] for r in rows)} images")',
    '    with open("budget.csv", "w", newline="", encoding="utf-8") as f:',
    '        writer = csv.DictWriter(f, fieldnames=["name", "tables", "images"])',
    '        writer.writeheader()',
    '        writer.writerows(rows)',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n'),
  'report.html': [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<style>',
    'body{font-family:system-ui,sans-serif;background:#FAF9F6;color:#57534E;margin:0;padding:32px}',
    '.kpi{display:flex;gap:16px;margin-bottom:24px}',
    '.card{flex:1;background:#fff;border:1px solid #E7E5E0;border-radius:8px;padding:18px}',
    '.card b{display:block;font-size:28px;color:#44403C}',
    '.card span{font-size:12px;color:#A8A29E}',
    'table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E7E5E0;border-radius:8px;overflow:hidden}',
    'th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #E7E5E0;font-size:13px}',
    'th{background:#F5F4F1;color:#78716C;font-weight:500}',
    '</style></head><body>',
    '<h2>检测报告数据看板</h2>',
    '<div class="kpi">',
    '<div class="card"><b>26</b><span>检测报告</span></div>',
    '<div class="card"><b>91</b><span>表格</span></div>',
    '<div class="card"><b>143</b><span>图片</span></div>',
    '<div class="card"><b>17</b><span>合格</span></div>',
    '</div>',
    '<table><tr><th>样品</th><th>检测类型</th><th>状态</th></tr>',
    '<tr><td>阀门部件</td><td>成分证明</td><td>合格</td></tr>',
    '<tr><td>PTFE 垫片</td><td>非金属材质</td><td>部分</td></tr>',
    '<tr><td>不锈钢法兰</td><td>金属材质</td><td>合格</td></tr>',
    '</table></body></html>',
  ].join(''),
};

