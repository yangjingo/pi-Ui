// UI/UX layer — message-level execution report shown in the Canvas when an agent
// turn is selected. Reads the live message (traj + stats + artifacts) and jumps back
// into per-step detail / files. The left↔right partner of the conversation traj.

import { Icon, trajIcon, fileIcon } from '../icons';
import { esc, renderMd, fmtMs, fmtTok } from '../render';
import { useWorkspace } from '../workspace';

export function TurnReport({ mi }: { mi: number }) {
  const { active, showStep, openInCanvas } = useWorkspace();
  const m = active.messages[mi];
  if (!m || m.role !== 'agent') {
    return <div className="turn-empty">该消息没有执行记录。</div>;
  }
  const traj = m.traj ?? [];
  const tools = traj.filter(s => s.t !== 'think');   // 'think' steps are reasoning, not tool calls
  const stats = m.stats;
  const done = tools.filter(s => s.status === 'done').length;
  const running = tools.filter(s => s.status === 'running').length;
  const arts = m.artifacts ?? [];

  return (
    <div className="turn-report" data-testid="turn-report">
      <section className="tr-section">
        <div className="tr-sec-head"><span className="tree-ico"><Icon name="chart" /></span>执行概览</div>
        <div className="tr-kpis" data-testid="turn-kpis">
          <div className="tr-kpi"><b>{tools.length}</b><span>工具调用</span></div>
          <div className="tr-kpi ok"><b>{done}</b><span>成功</span></div>
          <div className="tr-kpi run"><b>{running}</b><span>进行中</span></div>
          {stats && <>
            <div className="tr-kpi"><b>{fmtTok(stats.input)}</b><span>输入 token</span></div>
            <div className="tr-kpi"><b>{fmtTok(stats.output)}</b><span>输出 token</span></div>
            <div className="tr-kpi"><b>{fmtMs(stats.ttft)}</b><span>TTFT</span></div>
            <div className="tr-kpi"><b>{stats.tpot > 0 ? `${stats.tpot.toFixed(0)}ms` : '—'}</b><span>TPOT</span></div>
            <div className="tr-kpi"><b>{fmtMs(stats.duration)}</b><span>耗时</span></div>
          </>}
        </div>
      </section>

      <section className="tr-section">
        <div className="tr-sec-head"><span className="tree-ico"><Icon name="route" /></span>工具执行时间线</div>
        <div className="tr-timeline">
          {traj.length === 0 && <div className="tr-empty">没有工具调用。</div>}
          {traj.map((s, si) => (
            <button key={si} className={`tr-tl-row ${s.status}`} data-testid="turn-step" onClick={() => showStep(mi, si)}>
              <span className="tr-tl-rail" />
              <span className={`tr-tl-ico ${s.status}`}><Icon name={trajIcon(s.t)} /></span>
              <span className="tr-tl-main"><b>{esc(s.title)}</b><small>{esc(s.det)}</small></span>
              <span className="tr-tl-time">{esc(s.time)}</span>
              <span className="tr-tl-arr">↗</span>
            </button>
          ))}
        </div>
      </section>

      {m.intro && (
        <section className="tr-section">
          <div className="tr-sec-head"><span className="tree-ico"><Icon name="spark" /></span>输出详情</div>
          <div className="tr-out" dangerouslySetInnerHTML={{ __html: renderMd(m.intro) }} />
        </section>
      )}

      {arts.length > 0 && (
        <section className="tr-section">
          <div className="tr-sec-head"><span className="tree-ico"><Icon name="folder" /></span>产物</div>
          <div className="tr-arts">
            {arts.map((a, i) => (
              <button key={i} className="tr-art" data-testid="turn-artifact" onClick={() => openInCanvas(a.name)}>
                <span className={`tree-ico ftype-${a.type}`}><Icon name={fileIcon(a.type)} /></span>
                {esc(a.name)}
                <span className="arr">↗</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
