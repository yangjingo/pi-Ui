import type { FileNode, Message } from './types';

/** Self-contained sample session used only by the explicit “load demo” action. */
export const DEMO_MESSAGES: Message[] = [
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
    blocks: [
      { kind: 'text', text: '我先检查 PDF 批次和现有处理脚本。' },
      { kind: 'step', step: 0 },
      { kind: 'step', step: 1 },
      { kind: 'text', text: '解析已完成，接下来读取聚合结果并确认数据完整性。' },
      { kind: 'step', step: 2 },
      { kind: 'step', step: 3 },
      { kind: 'text', text: '数据已确认。我现在生成说明文档、预算表和可跳转看板。' },
      { kind: 'step', step: 4 },
      { kind: 'step', step: 5 },
      { kind: 'step', step: 6 },
      { kind: 'step', step: 7 },
      { kind: 'text', text: '已完成 **26 份 PDF 检测报告** 的解析与结构化：\n\n- 页数：**84**\n- 表格：**91**\n- 图片：**143**\n\n结果汇总成一份可跳转的数据看板。下方「报告」标签可查看纵览，每一步工具调用都能在右侧 Canvas 里展开详情。' },
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

export const DEMO_FILES: FileNode[] = [
  { name: 'README.md', path: 'README.md', type: 'md', size: '1.2 KB' },
  { name: 'budget.csv', path: 'budget.csv', type: 'sheet', size: '0.8 KB' },
  { name: 'report.html', path: 'report.html', type: 'html', size: '2.1 KB' },
  { name: 'run_pipeline.py', path: 'run_pipeline.py', type: 'code', size: '0.9 KB' },
];

export const DEMO_CONTENTS: Record<string, string> = {
  'README.md': [
    '# PDF 检测报告分析', '', '本批次共解析 **26 份** PDF 检测报告。', '',
    '- 页数：84', '- 表格：91', '- 图片：143', '',
    '产物：`budget.csv`（预算汇总）、`report.html`（数据看板）。', '',
    '## 处理流程', '', '```mermaid', 'flowchart LR',
    '  A[26 份 PDF] --> B[解析页面]', '  B --> C[提取表格与图片]',
    '  C --> D[聚合预算]', '  D --> E[(budget.csv)]', '  D --> F[(report.html)]', '```',
  ].join('\n'),
  'budget.csv': [
    '项目,预算(元),实际(元),差额(元)', '检测费用,12000,11800,-200', '人工,8000,8400,+400',
    '设备折旧,5000,5000,0', '材料,3000,3200,+200', '合计,28000,28400,+400',
  ].join('\n'),
  'run_pipeline.py': [
    '#!/usr/bin/env python3', '"""Parse a batch of PDF inspection reports into structured data."""',
    'from pathlib import Path', 'import csv, json', '', 'REPORT_DIR = Path("reports")', '', '',
    'def parse_report(path: Path) -> dict:', '    """Extract tables and images from one PDF report."""',
    '    text = path.read_text(encoding="utf-8")', '    return {', '        "name": path.stem,',
    '        "tables": text.count("<table>"),', '        "images": text.count("<img "),', '    }', '', '',
    'def main() -> None:', '    rows = [parse_report(p) for p in REPORT_DIR.glob("*.pdf")]',
    '    print(f"Found {len(rows)} reports · "', '          f"{sum(r[\'tables\'] for r in rows)} tables, "',
    '          f"{sum(r[\'images\'] for r in rows)} images")',
    '    with open("budget.csv", "w", newline="", encoding="utf-8") as f:',
    '        writer = csv.DictWriter(f, fieldnames=["name", "tables", "images"])',
    '        writer.writeheader()', '        writer.writerows(rows)', '', '',
    'if __name__ == "__main__":', '    main()',
  ].join('\n'),
  'report.html': [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">', '<style>',
    'body{font-family:system-ui,sans-serif;background:#FAF9F6;color:#57534E;margin:0;padding:32px}',
    '.kpi{display:flex;gap:16px;margin-bottom:24px}',
    '.card{flex:1;background:#fff;border:1px solid #E7E5E0;border-radius:8px;padding:18px}',
    '.card b{display:block;font-size:28px;color:#44403C}', '.card span{font-size:12px;color:#A8A29E}',
    'table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E7E5E0;border-radius:8px;overflow:hidden}',
    'th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #E7E5E0;font-size:13px}',
    'th{background:#F5F4F1;color:#78716C;font-weight:500}', '</style></head><body>',
    '<h2>检测报告数据看板</h2>', '<div class="kpi">',
    '<div class="card"><b>26</b><span>检测报告</span></div>',
    '<div class="card"><b>91</b><span>表格</span></div>',
    '<div class="card"><b>143</b><span>图片</span></div>',
    '<div class="card"><b>17</b><span>合格</span></div>', '</div>',
    '<table><tr><th>样品</th><th>检测类型</th><th>状态</th></tr>',
    '<tr><td>阀门部件</td><td>成分证明</td><td>合格</td></tr>',
    '<tr><td>PTFE 垫片</td><td>非金属材质</td><td>部分</td></tr>',
    '<tr><td>不锈钢法兰</td><td>金属材质</td><td>合格</td></tr>', '</table></body></html>',
  ].join(''),
};
