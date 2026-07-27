// Message-level task detail shown in Canvas. Outcome and artifacts lead; execution evidence and
// performance metadata follow. This keeps it useful without feeling like a separate dashboard.

import { Icon, trajIcon, fileIcon, text, fmtMs, fmtTok, MdText } from '../../ui';
import { useWorkspace } from '../../workspace';

export function TurnReport({ mi }: { mi: number }) {
  const { active, showStep, openInCanvas } = useWorkspace();
  const message = active.messages[mi];
  if (!message || message.role !== 'agent') return <div className="turn-empty">该消息没有执行记录。</div>;

  const trajectory = message.traj ?? [];
  const tools = trajectory.filter(step => step.t !== 'think');
  const thinking = trajectory.filter(step => step.t === 'think');
  const done = tools.filter(step => step.status === 'done').length;
  const artifacts = message.artifacts ?? [];
  const answer = (message.blocks || [])
    .filter(block => block.kind === 'text')
    .map(block => block.kind === 'text' ? block.text : '')
    .filter(Boolean).join('\n\n') || message.intro || message.outro || '';
  const complete = tools.length === done && message.status !== 'running';

  return (
    <div className="turn-report" data-testid="turn-report">
      <header className="turn-summary">
        <span className={`turn-summary-icon${complete ? ' done' : ' live'}`}><Icon name={complete ? 'check' : 'refresh'} /></span>
        <div className="turn-summary-copy"><span>本轮任务</span><h2>{complete ? '执行完成' : '正在执行'}</h2><p>{tools.length} 次工具调用 · {thinking.length} 轮思考 · {artifacts.length} 个本轮产物{message.stats ? ` · ${fmtMs(message.stats.duration)}` : ''}</p></div>
      </header>

      {answer && (
        <section className="tr-section tr-result">
          <div className="tr-sec-head"><span>结果</span><small>Agent 最终输出</small></div>
          <MdText className="tr-out" text={answer} />
        </section>
      )}

      {artifacts.length > 0 && (
        <section className="tr-section">
          <div className="tr-sec-head"><span>本轮产物</span><small>{artifacts.length} 个文件</small></div>
          <div className="tr-arts">
            {artifacts.map((artifact, index) => (
              <button key={`${artifact.name}-${index}`} className="tr-art" data-testid="turn-artifact" onClick={() => openInCanvas(artifact.path || artifact.name)}>
                <span className={`tree-ico ftype-${artifact.type}`}><Icon name={fileIcon(artifact.type)} /></span>
                <span><b>{text(artifact.name)}</b><small>{text(artifact.label)}</small></span>
                <span className="arr">↗</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="tr-section">
        <div className="tr-sec-head"><span>执行过程</span><small>{trajectory.length} 个事件</small></div>
        <div className="tr-timeline">
          {trajectory.length === 0 && <div className="tr-empty">本轮没有工具调用。</div>}
          {trajectory.map((step, si) => (
            <button key={step.id || si} className={`tr-tl-row ${step.status}${step.t === 'think' ? ' think' : ''}`} data-testid="turn-step" onClick={() => showStep(mi, si)}>
              <span className="tr-tl-rail" />
              <span className={`tr-tl-ico ${step.status}`}><Icon name={trajIcon(step.t)} /></span>
              <span className="tr-tl-main"><b>{text(step.title)}</b><small>{text(step.det || '无附加信息')}</small></span>
              <span className="tr-tl-time">{text(step.time)}</span>
              <span className="tr-tl-arr">↗</span>
            </button>
          ))}
        </div>
      </section>

      {message.stats && (
        <section className="tr-section">
          <div className="tr-sec-head"><span>运行信息</span><small>诊断指标</small></div>
          <dl className="tr-kpis" data-testid="turn-kpis">
            <Metric value={fmtTok(message.stats.totalTokens)} label="响应总 token" />
            <Metric value={fmtTok(message.stats.input)} label="未缓存输入" />
            <Metric value={fmtTok(message.stats.output)} label="输出 token" />
            <Metric value={fmtMs(message.stats.ttft)} label="首字延迟" />
            <Metric value={message.stats.tpot > 0 ? `${message.stats.tpot.toFixed(0)}ms` : '—'} label="每 token" />
            <Metric value={fmtMs(message.stats.duration)} label="总耗时" />
            <Metric value={fmtTok(message.stats.cacheRead)} label="缓存读取" />
            <Metric value={fmtTok(message.stats.cacheWrite)} label="缓存写入" />
            <Metric value={`${Math.round((message.stats.cacheHitRate || 0) * 100)}%`} label="缓存命中率" />
            <Metric value={message.stats.contextPrefixStable === false ? '已变化' : '稳定'} label={`Context 前缀${message.stats.contextPrefix ? ` · ${message.stats.contextPrefix}` : ''}`} />
          </dl>
        </section>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="tr-kpi"><dt>{label}</dt><dd>{value}</dd></div>;
}
