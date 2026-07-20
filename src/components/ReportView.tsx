// UI/UX layer — the data-overview Report. A gk-report-style page (section nav +
// KPI cards + data tables) that reads entirely from the current conversation's data
// center (messages / traj / files produced this session) and jumps into the Canvas.

import { useMemo, useState } from 'react';
import type { FileNode } from '../../core/types';
import { Icon, trajIcon, fileIcon } from '../icons';
import { esc, fmtMs, fmtTok } from '../render';
import { useWorkspace } from '../workspace';

type Section = 'overview' | 'tools' | 'files' | 'turns';

interface FlatStep { mi: number; si: number; key: string; t: string; title: string; det: string; in?: string; out?: string; status: string; time: string; file?: string; bucket: string; }

const BUCKETS = [
  { key: 'all', label: '全部' },
  { key: 'read', label: '读取' },
  { key: 'write', label: '写入' },
  { key: 'code', label: '执行' },
  { key: 'other', label: '其它' },
];
function bucketOf(t: string): string {
  if (t === 'read' || t === 'search') return 'read';
  if (t === 'write') return 'write';
  if (t === 'code') return 'code';
  return 'other';
}

function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.type === 'folder') { if (n.children) flattenFiles(n.children, out); }
    else out.push(n);
  }
  return out;
}

export function ReportView() {
  const { active, showStep, openInCanvas, openTurn } = useWorkspace();
  const [section, setSection] = useState<Section>('overview');
  const [toolFilter, setToolFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const turns = useMemo(
    () => active.messages.map((m, mi) => ({ m, mi })).filter(x => x.m.role === 'agent'),
    [active.messages],
  );
  const steps = useMemo<FlatStep[]>(() => {
    const out: FlatStep[] = [];
    for (const { m, mi } of turns) {
      (m.traj || []).forEach((s, si) => out.push({
        mi, si, key: `${mi}-${si}`, t: s.t, title: s.title, det: s.det,
        in: s.in, out: s.out, status: s.status, time: s.time, file: s.file,
        bucket: bucketOf(s.t),
      }));
    }
    return out;
  }, [turns]);
  const files = useMemo(() => flattenFiles(active.files), [active.files]);

  // aggregate KPIs
  const toolTotal = steps.length;
  const toolDone = steps.filter(s => s.status === 'done').length;
  const toolRunning = steps.filter(s => s.status === 'running').length;
  const tokIn = turns.reduce((a, t) => a + (t.m.stats?.input || 0), 0);
  const tokOut = turns.reduce((a, t) => a + (t.m.stats?.output || 0), 0);
  const ttfts = turns.map(t => t.m.stats?.ttft).filter((n): n is number => !!n);
  const tpots = turns.map(t => t.m.stats?.tpot).filter((n): n is number => !!n && n > 0);
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  const shownSteps = toolFilter === 'all' ? steps : steps.filter(s => s.bucket === toolFilter);

  const nav: { key: Section; label: string; icon: string; cnt?: number }[] = [
    { key: 'overview', label: '概览', icon: 'chart' },
    { key: 'tools', label: '工具调用', icon: 'route', cnt: toolTotal },
    { key: 'files', label: '数据产物', icon: 'folder', cnt: files.length },
    { key: 'turns', label: '对话轮次', icon: 'chat', cnt: turns.length },
  ];

  return (
    <div className="report-shell" data-testid="report-view">
      <nav className="report-nav">
        {nav.map(n => (
          <button
            key={n.key}
            className={`report-nav-item${section === n.key ? ' active' : ''}`}
            data-testid="report-nav"
            data-sec={n.key}
            onClick={() => setSection(n.key)}
          >
            <span className="tree-ico"><Icon name={n.icon} /></span>
            <span className="rn-label">{n.label}</span>
            {n.cnt != null && <span className="rn-cnt">{n.cnt}</span>}
          </button>
        ))}
      </nav>

      <div className="report-main scroll">
        {section === 'overview' && (
          <div className="report-overview" data-testid="report-overview">
            <div className="report-hero">
              <b>{esc(active.title)}</b>
              <span>{turns.length} 轮对话 · {toolTotal} 次工具调用 · {files.length} 个数据产物</span>
            </div>
            <div className="report-kpis" data-testid="report-kpis">
              <Kpi icon="chat" value={String(turns.length)} label="对话轮次" />
              <Kpi icon="route" value={String(toolTotal)} label="工具调用" sub={`成功 ${toolDone} · 进行中 ${toolRunning}`} />
              <Kpi icon="folder" value={String(files.length)} label="数据产物" />
              <Kpi icon="cpu" value={fmtTok(tokIn)} label="输入 token" />
              <Kpi icon="spark" value={fmtTok(tokOut)} label="输出 token" />
              <Kpi icon="chart" value={fmtMs(avg(ttfts))} label="平均 TTFT" />
              <Kpi icon="chart" value={tpots.length ? `${avg(tpots).toFixed(0)}ms` : '—'} label="平均 TPOT" />
            </div>
          </div>
        )}

        {section === 'tools' && (
          <div className="report-section" data-testid="report-tools">
            <div className="report-filter">
              {BUCKETS.map(b => (
                <button
                  key={b.key}
                  className={`ft${toolFilter === b.key ? ' on' : ''}`}
                  data-testid="report-filter"
                  data-bucket={b.key}
                  onClick={() => setToolFilter(b.key)}
                >
                  {b.label}<span className="ft-cnt">{b.key === 'all' ? toolTotal : steps.filter(s => s.bucket === b.key).length}</span>
                </button>
              ))}
            </div>
            <table className="report-table" data-testid="report-tools-table">
              <thead><tr><th>#</th><th>类型</th><th>标题</th><th>命令 / 详情</th><th>状态</th><th>时间</th><th>关联文件</th><th></th></tr></thead>
              <tbody>
                {shownSteps.length === 0 && <tr><td colSpan={8} className="report-empty">没有匹配的工具调用。</td></tr>}
                {shownSteps.map((s, i) => (
                  <StepRows key={s.key} s={s} i={i} open={expanded === s.key}
                    onJump={() => showStep(s.mi, s.si)}
                    onToggle={() => setExpanded(cur => cur === s.key ? null : s.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {section === 'files' && (
          <div className="report-section" data-testid="report-files">
            <table className="report-table" data-testid="report-files-table">
              <thead><tr><th>文件</th><th>类型</th><th>大小</th><th></th></tr></thead>
              <tbody>
                {files.length === 0 && <tr><td colSpan={4} className="report-empty">还没有数据产物。</td></tr>}
                {files.map((f, i) => (
                  <tr key={(f.path || f.name) + i} className="rrow" data-testid="report-file-row" onClick={() => openInCanvas(f.name)}>
                    <td><span className={`tree-ico ftype-${f.type}`}><Icon name={fileIcon(f.type)} /></span>{esc(f.name)}</td>
                    <td><span className="rtype">{f.type}</span></td>
                    <td>{esc(f.size || '—')}</td>
                    <td><span className="rarr">打开 ↗</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {section === 'turns' && (
          <div className="report-section" data-testid="report-turns">
            <table className="report-table" data-testid="report-turns-table">
              <thead><tr><th>轮次</th><th>工具调用</th><th>输入</th><th>输出</th><th>TTFT</th><th>TPOT</th><th>耗时</th><th>产物</th></tr></thead>
              <tbody>
                {turns.length === 0 && <tr><td colSpan={8} className="report-empty">还没有对话轮次。</td></tr>}
                {turns.map(({ m, mi }, i) => (
                  <tr key={mi} className="rrow" data-testid="report-turn-row" onClick={() => openTurn(mi)}>
                    <td>第 {i + 1} 轮</td>
                    <td>{(m.traj || []).length}</td>
                    <td>{fmtTok(m.stats?.input)}</td>
                    <td>{fmtTok(m.stats?.output)}</td>
                    <td>{fmtMs(m.stats?.ttft)}</td>
                    <td>{m.stats && m.stats.tpot > 0 ? `${m.stats.tpot.toFixed(0)}ms` : '—'}</td>
                    <td>{fmtMs(m.stats?.duration)}</td>
                    <td>{(m.artifacts || []).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, value, label, sub }: { icon: string; value: string; label: string; sub?: string }) {
  return (
    <div className="report-kpi" data-testid="report-kpi">
      <span className="kpi-ico"><Icon name={icon} /></span>
      <div className="kpi-main"><b>{value}</b><span>{label}</span></div>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function StepRows({
  s, i, open, onJump, onToggle,
}: {
  s: FlatStep; i: number; open: boolean; onJump(): void; onToggle(): void;
}) {
  return (
    <>
      <tr className="rrow main-row" data-testid="report-tool-row" onClick={onJump}>
        <td>{i + 1}</td>
        <td><span className={`tree-ico st-${s.t}`}><Icon name={trajIcon(s.t)} /></span></td>
        <td><b>{esc(s.title)}</b></td>
        <td className="rdet">{esc(s.det || '—')}</td>
        <td><span className={`badge ${s.status === 'running' ? 'live' : 'done'}`}>{s.status === 'running' ? '进行中' : '已完成'}</span></td>
        <td>{esc(s.time || '—')}</td>
        <td>{s.file ? <span className="rfile">{esc(s.file)}</span> : <span className="rmuted">—</span>}</td>
        <td><button className="row-toggle" data-testid="tool-toggle" onClick={(e) => { e.stopPropagation(); onToggle(); }}><Icon name="chevron" className={`chev${open ? ' open' : ''}`} /></button></td>
      </tr>
      <tr className={`detail-row${open ? ' open' : ''}`}>
        <td colSpan={8}>
          <div className="detail-grid">
            <div><span className="lab">输入</span><pre>{esc(s.in || '（无）')}</pre></div>
            <div><span className="lab">输出</span><pre>{esc(s.out || '（无输出）')}</pre></div>
          </div>
        </td>
      </tr>
    </>
  );
}
