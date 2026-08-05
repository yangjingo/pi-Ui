import { Icon, t, text, trajectoryLabel, trajIcon } from '../../ui';
import { useWorkspace } from '../../workspace';

export function TurnReport({ mi }: { mi: number }) {
  const { active, showStep } = useWorkspace();
  const message = active.messages[mi];
  if (!message || message.role !== 'agent') {
    return <div className="turn-empty">{t('run.noDetails')}</div>;
  }

  const trajectory = message.traj ?? [];
  const toolCount = trajectory.filter(step => step.t !== 'think').length;
  const thinkingCount = trajectory.length - toolCount;

  return (
    <div className="turn-report run-overview" data-testid="turn-report">
      <header className="run-overview-head">
        <div>
          <span>{t('run.overviewKicker')}</span>
          <h2>{t('run.details')}</h2>
        </div>
        {message.stats && <time>{formatDuration(message.stats.duration)}</time>}
      </header>

      <section className="run-section">
        <div className="run-section-head">
          <b>{t('run.trajectory')}</b>
          <small>{t('run.toolsCount', { count: toolCount })}{thinkingCount ? ` · ${t('run.thinkingCount', { count: thinkingCount })}` : ''}</small>
        </div>
        <div className="run-trajectory">
          {trajectory.length === 0 && <div className="tr-empty">{t('run.noToolCalls')}</div>}
          {trajectory.map((step, si) => (
            <button
              type="button"
              key={step.id || si}
              className={`run-step ${step.status}${step.t === 'think' ? ' thinking' : ''}${step.error ? ' failed' : ''}`}
              data-testid="turn-step"
              data-kind={step.t}
              onClick={() => showStep(mi, si)}
            >
              <span className={`run-step-icon ${step.status}`}><Icon name={trajIcon(step.t)} /></span>
              <span className="run-step-copy">
                <b>{trajectoryLabel(step.t, step.shell)}</b>
                {step.det && <small>{text(step.det)}</small>}
              </span>
              <time>{text(step.time)}</time>
              <Icon name="chevron" className="run-step-open" />
            </button>
          ))}
        </div>
      </section>

      {message.stats && (
        <details className="run-diagnostics" data-testid="turn-diagnostics">
          <summary>
            <span>{t('run.diagnostics')}</span>
            <Icon name="chevron" />
          </summary>
          <dl>
            <Metric label="TTFT" value={`${message.stats.ttft} ms`} />
            <Metric label="TPOT" value={`${message.stats.tpot.toFixed(2)} ms/token`} />
            <Metric label="TPS" value={message.stats.tpot > 0 ? `${(1_000 / message.stats.tpot).toFixed(2)} token/s` : '—'} />
            <Metric label="IN" value={exactTokens(message.stats.input)} />
            <Metric label="OUT" value={exactTokens(message.stats.output)} />
            <Metric label="CACHE R" value={exactTokens(message.stats.cacheRead)} />
            <Metric label="CACHE W" value={exactTokens(message.stats.cacheWrite)} />
            <Metric label="Total" value={exactTokens(message.stats.totalTokens)} />
            <Metric label={t('run.duration')} value={`${message.stats.duration} ms`} />
            {message.stats.cacheHitRate != null && <Metric label="Cache hit" value={`${(message.stats.cacheHitRate * 100).toFixed(1)}%`} />}
            {message.stats.contextPrefix && <Metric label={t('run.context')} value={message.stats.contextPrefix} />}
          </dl>
        </details>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function exactTokens(value: number | undefined): string {
  return value == null ? '—' : `${value.toLocaleString('en-US')} tok`;
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${value}ms` : `${(value / 1_000).toFixed(1)}s`;
}
