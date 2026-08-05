import type { FileNode, TrajStep } from '../../core/agent/protocol';
import { Icon, fileIcon, t, term, trajectoryLabel, trajIcon, text } from '../../ui';
import { useWorkspace } from '../../workspace';
import { FileRenderer } from './file-renderer';

function formatTrajectoryPayload(value?: string, fallback = t('common.none')): string {
  if (!value) return fallback;
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
}

function formatShellOutput(
  value: string | undefined,
  encoding: TrajStep['outputEncoding'],
  fallback: string,
): string {
  const formatted = formatTrajectoryPayload(value, fallback);
  if (encoding !== 'lossy') return formatted;
  const visible = [...formatted].filter(character => !/\s/u.test(character));
  const replacementCount = visible.filter(character => character === '\ufffd').length;
  if (replacementCount < 8 || replacementCount / Math.max(visible.length, 1) < 0.5) return formatted;
  const readableLines = formatted.split('\n').filter(line => {
    const characters = [...line].filter(character => !/\s/u.test(character));
    const replacements = characters.filter(character => character === '\ufffd').length;
    return characters.length > 0 && replacements / characters.length < 0.5;
  });
  return [
    t('trajectory.historyDamaged'),
    ...readableLines,
  ].join('\n');
}

export function StepResult({
  step, file, index = 0, total = 1, onBack,
}: {
  step: TrajStep;
  file?: string;
  index?: number;
  total?: number;
  onBack?: () => void;
}) {
  const { active, openInCanvas } = useWorkspace();
  const selected = file ? findIn(active.files, file) : null;
  const isShell = step.t === 'code';
  const kind = trajectoryLabel(step.t, step.shell);
  const isThinking = step.t === 'think';
  const encodingNote = step.outputEncoding === 'lossy'
    ? t('trajectory.encodingLoss')
    : step.outputEncoding === 'normalized'
      ? t('trajectory.encodingNormalized')
      : null;

  if (isShell) {
    return (
      <div className="step-result shell-step-result" data-testid="renderer-step">
        {onBack && <BackToRun onBack={onBack} />}
        <header className="shell-step-head">
          <h2 data-testid="shell-title">{kind}{step.error ? ` · ${t('common.failed')}` : ''}</h2>
          <time>{text(step.time)}</time>
        </header>
        <div className="shell-command" data-testid="step-input">
          <span aria-hidden="true">&gt;</span>
          <pre>{formatTrajectoryPayload(step.in)}</pre>
        </div>
        <div className="shell-output" data-testid="step-output">
          {encodingNote && <span className={`step-encoding-note is-${step.outputEncoding}`}>{encodingNote}</span>}
          <pre>{formatShellOutput(
            step.out,
            step.outputEncoding,
            step.status === 'running' ? t('trajectory.waitingOutput') : t('common.noOutput'),
          )}</pre>
        </div>
        {file && (
          <div className="step-file">
            <button className="step-file-btn" onClick={() => openInCanvas(file)}>
              <span className={`tree-ico ftype-${selected ? selected.type : 'file'}`}><Icon name={fileIcon(selected ? selected.type : 'file')} /></span>
              {text(file)}<span className="arr">↗</span>
            </button>
          </div>
        )}
        {file && selected && <div className="step-preview" data-testid="step-preview"><FileRenderer f={selected} /></div>}
      </div>
    );
  }

  return (
    <div className="step-result" data-testid="renderer-step">
      {onBack && <BackToRun onBack={onBack} />}
      <div className="step-kicker" data-testid="step-position"><span>{term('trajectory')}</span><b>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</b></div>
      <div className="step-head">
        <span className={`step-ico ${step.status}${step.error ? ' failed' : ''}`}><Icon name={trajIcon(step.t)} /></span>
        <div className="step-hd">
          <b>{kind}</b>
          {step.status === 'running'
            ? <span className="badge live">{t('common.running')}</span>
            : step.error
              ? <span className="badge failed">{t('common.failed')}</span>
              : <span className="badge done">{t('common.done')}</span>}
          {!isThinking && <span className="step-det">{text(step.det)}</span>}
          <span className="step-time">{text(step.time)}</span>
        </div>
      </div>
      {isThinking ? (
        <div className="step-think" data-testid="step-think"><span className="lab">{t('conversation.fullThinking')}</span><div className="step-think-body">{text(step.text || step.det || t('common.none'))}</div></div>
      ) : (
        <>
          <div className="step-io" data-testid="step-input"><span className="lab">{isShell ? t('trajectory.command') : t('common.input')} · {kind}</span><pre className="step-io-body">{formatTrajectoryPayload(step.in)}</pre></div>
          <div className="step-io" data-testid="step-output">
            <span className="lab">
              {isShell ? `${t('trajectory.combinedOutput')} · ${kind}` : t('common.output')}
              {encodingNote && <em className={`step-encoding-note is-${step.outputEncoding}`}>{encodingNote}</em>}
            </span>
            <pre className="step-io-body">{isShell
              ? formatShellOutput(
                step.out,
                step.outputEncoding,
                step.status === 'running' ? t('trajectory.waitingOutput') : t('common.noOutput'),
              )
              : formatTrajectoryPayload(step.out, step.status === 'running' ? t('trajectory.waitingOutput') : t('common.noOutput'))}</pre>
          </div>
          <div className="step-info" data-testid="step-info"><div className="step-info-cell"><span className="lab">{t('common.type')}</span><b>{text(kind)}</b></div><div className="step-info-cell"><span className="lab">{t('common.status')}</span><b className={`step-info-status ${step.status}`}>{step.status === 'running' ? t('common.running') : t('common.done')}</b></div><div className="step-info-cell"><span className="lab">{t('common.time')}</span><b>{text(step.time || '—')}</b></div></div>
          {file && <div className="step-file"><span className="lab">{t('trajectory.generatedFile')}</span><button className="step-file-btn" onClick={() => openInCanvas(file)}><span className={`tree-ico ftype-${selected ? selected.type : 'file'}`}><Icon name={fileIcon(selected ? selected.type : 'file')} /></span>{text(file)}<span className="arr">↗</span></button></div>}
          {file && selected && <div className="step-preview" data-testid="step-preview"><FileRenderer f={selected} /></div>}
        </>
      )}
    </div>
  );
}

function BackToRun({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="step-back" data-testid="step-back" onClick={onBack}>
      <Icon name="chevron" />{t('run.overview')}
    </button>
  );
}

function findIn(list: FileNode[], name: string): FileNode | null {
  for (const node of list) {
    if (node.path === name || node.name === name) return node;
    if (node.children) { const result = findIn(node.children, name); if (result) return result; }
  }
  return null;
}
