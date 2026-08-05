import type { Page } from '@playwright/test';
import type { AgentEvent, AgentEventPayload, FileNode, Message, SessionSummary } from '../../src/core/agent';

export type SessionSnapshot = Extract<AgentEvent, { type: 'session_snapshot' }>;
export const fixtureWorkspaceRoot = 'C:/pi-ui-test/.workspace';

const demoMessages: Message[] = [
  {
    role: 'user',
    text: '分析 workspace 里的 PDF 检测报告，提取数据并生成可跳转的数据看板。',
    when: '刚刚',
  },
  {
    role: 'agent',
    status: 'done',
    intro: '我先检查 PDF 批次和现有处理脚本。',
    traj: [
      { t: 'think', title: '思考', det: '规划解析流程', text: '先解析 PDF，再生成文档、预算表与看板。', status: 'done', time: '14:01' },
      { t: 'code', title: '执行命令', det: 'python run_pipeline.py', in: '{"command":"python run_pipeline.py"}', out: 'Found 26 reports', status: 'done', time: '14:02' },
      { t: 'read', title: '读取文件', det: 'result.json', in: '{"path":"result.json"}', out: '84 页 · 91 表格 · 143 图片', status: 'done', time: '14:03' },
      { t: 'think', title: '思考', det: '准备输出', text: '聚合结果到手，开始生成最终产物。', status: 'done', time: '14:03' },
      { t: 'write', title: '写入文件', det: 'README.md', out: '完成', status: 'done', time: '14:04', file: 'README.md' },
      { t: 'write', title: '写入文件', det: 'budget.csv', out: '完成', status: 'done', time: '14:05', file: 'budget.csv' },
      { t: 'write', title: '写入文件', det: 'report.html', out: '完成', status: 'done', time: '14:06', file: 'report.html' },
      { t: 'analyze', title: 'VLM 分析', det: 'caption 校验', in: '{"model":"vlm"}', out: '143/143 通过', status: 'done', time: '14:07' },
    ],
    blocks: [
      { kind: 'text', text: '我先检查 PDF 批次和现有处理脚本。' },
      { kind: 'step', step: 0 },
      { kind: 'step', step: 1 },
      { kind: 'text', text: '解析完成，读取聚合结果。' },
      { kind: 'step', step: 2 },
      { kind: 'step', step: 3 },
      { kind: 'step', step: 4 },
      { kind: 'step', step: 5 },
      { kind: 'step', step: 6 },
      { kind: 'step', step: 7 },
      {
        kind: 'text',
        text: '已完成 **26 份 PDF 检测报告** 的解析与结构化：\n\n- 页数：**84**\n- 表格：**91**\n- 图片：**143**',
      },
    ],
    artifacts: [
      { name: 'README.md', path: 'README.md', type: 'md', label: '文档', canvasPreview: true },
      { name: 'budget.csv', path: 'budget.csv', type: 'sheet', label: '表格', canvasPreview: true },
      { name: 'report.html', path: 'report.html', type: 'html', label: '看板', canvasPreview: true },
      { name: 'run_pipeline.py', path: 'run_pipeline.py', type: 'code', label: '脚本', canvasPreview: true },
    ],
    stats: {
      ttft: 740,
      tpot: 38,
      duration: 12_600,
      input: 4_280,
      output: 612,
      cacheRead: 17_120,
      cacheWrite: 0,
      cacheWrite1h: 0,
      totalTokens: 22_012,
      cacheHitRate: 0.8,
      contextPrefix: '1a2b3c4d5e6f',
      contextPrefixStable: true,
    },
  },
];

const demoFiles: Array<{ file: FileNode; content: string }> = [
  {
    file: { name: 'README.md', path: 'README.md', type: 'md', size: '1.2 KB' },
    content: [
      '# PDF 检测报告分析',
      '',
      '本批次共解析 **26 份** PDF 检测报告。',
      '',
      '- 页数：84',
      '- 表格：91',
      '- 图片：143',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[26 份 PDF] --> B[解析页面]',
      '  B --> C[(report.html)]',
      '```',
    ].join('\n'),
  },
  {
    file: { name: 'budget.csv', path: 'budget.csv', type: 'sheet', size: '0.8 KB' },
    content: [
      '项目,预算(元),实际(元),差额(元)',
      '检测费用,12000,11800,-200',
      '人工,8000,8400,+400',
      '设备折旧,5000,5000,0',
      '材料,3000,3200,+200',
      '合计,28000,28400,+400',
    ].join('\n'),
  },
  {
    file: { name: 'report.html', path: 'report.html', type: 'html', size: '2.1 KB' },
    content: '<!doctype html><html lang="zh-CN"><body><h1>检测报告数据看板</h1><p>26 reports</p></body></html>',
  },
  {
    file: { name: 'run_pipeline.py', path: 'run_pipeline.py', type: 'code', size: '0.9 KB' },
    content: '#!/usr/bin/env python3\n\ndef parse_report(path):\n    return {"path": path}\n',
  },
];

export const emptySnapshot: SessionSnapshot = {
  type: 'session_snapshot',
  sessionId: 'test',
  session: { id: 'test', title: '新对话', group: '今天', time: '2026-07-28 16:30', live: false, status: 'idle' },
  messages: [],
  steers: [],
  goal: null,
  intent: null,
  thinking: false,
  cwd: `${fixtureWorkspaceRoot}/test`,
  files: [],
  reason: 'initial',
};

export const demoSnapshot: SessionSnapshot = {
  ...emptySnapshot,
  sessionId: 'demo',
  session: { id: 'demo', title: 'PDF 检测报告分析', group: '今天', time: '2026-07-28 16:30', live: false, status: 'completed' },
  messages: demoMessages,
  files: demoFiles,
};

interface MockAgentOptions {
  snapshot?: SessionSnapshot;
  snapshots?: Record<string, SessionSnapshot>;
  skills?: unknown[];
  sessions?: SessionSummary[];
  health?: Record<string, unknown>;
  startAtWelcome?: boolean;
}

export async function installMockAgent(page: Page, options: MockAgentOptions = {}) {
  const snapshot = options.snapshot ?? emptySnapshot;
  let sessions = [...(options.sessions ?? [snapshot.session])];
  await page.addInitScript(({ initialEvent, startAtWelcome }) => {
    if (!startAtWelcome && window.location.pathname === '/') {
      window.history.replaceState({}, '', `/sessions/${encodeURIComponent(initialEvent.sessionId)}`);
    }
    const sources = new Set<MockEventSource>();

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;

      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        sources.add(this);
        queueMicrotask(() => {
          this.readyState = MockEventSource.OPEN;
          const openEvent = new Event('open');
          this.onopen?.(openEvent);
          this.dispatchEvent(openEvent);
          this.emit(initialEvent);
        });
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
        sources.delete(this);
      }

      emit(event: unknown) {
        const message = new MessageEvent('message', { data: JSON.stringify(event) });
        this.onmessage?.(message);
        this.dispatchEvent(message);
      }
    }

    Object.defineProperty(window, 'EventSource', { configurable: true, value: MockEventSource });
    Object.defineProperty(window, '__emitAgentEvent', {
      configurable: true,
      value: (event: unknown) => {
        for (const source of sources) source.emit(event);
      },
    });
  }, { initialEvent: snapshot, startAtWelcome: options.startAtWelcome === true });

  await page.route('**/api/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ready: true,
      model: 'test/model',
      workspaceRoot: fixtureWorkspaceRoot,
      cwd: snapshot.cwd,
      ...options.health,
    }),
  }));
  await page.route('**/api/skills**', route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    const skills = options.skills ?? [];
    const body = id ? skills.find((skill: any) => skill.id === id) : skills;
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(body || { error: 'Skill 不存在' }),
    });
  });
  await page.route('**/api/sessions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(sessions),
  }));
  await page.route(/\/api\/session\?id=/, async route => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      const id = new URL(request.url()).searchParams.get('id') || '';
      const exists = sessions.some(session => session.id === id);
      if (exists) sessions = sessions.filter(session => session.id !== id);
      await route.fulfill({
        status: exists ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(exists ? { ok: true } : { ok: false, error: '会话不存在' }),
      });
      return;
    }
    const id = new URL(request.url()).searchParams.get('id') || '';
    const requestedSnapshot = options.snapshots?.[id] ?? snapshot;
    await route.fulfill({
      status: requestedSnapshot ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(requestedSnapshot || { error: '会话不存在' }),
    });
  });
}

export async function emitAgentEvent(page: Page, event: AgentEventPayload, sessionId?: string) {
  await page.evaluate(({ value, explicitSessionId }) => {
    const emit = (window as typeof window & { __emitAgentEvent?: (event: unknown) => void }).__emitAgentEvent;
    const routeId = window.location.pathname.match(/^\/sessions\/([^/]+)/)?.[1];
    const scoped: AgentEvent = {
      ...value,
      sessionId: explicitSessionId || (routeId ? decodeURIComponent(routeId) : 'test'),
    } as AgentEvent;
    emit?.(scoped);
  }, { value: event, explicitSessionId: sessionId });
}

export function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  return errors;
}
