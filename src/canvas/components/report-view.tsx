// Workspace-level task review. This is intentionally a calm evidence ledger rather than a
// dashboard: outcome first, then turns, files and tool details on demand.

import { useMemo, useState } from 'react';
import type { FileNode, Message } from '../../core/agent/protocol';
import { Icon, trajIcon, fileIcon, t, text, fmtMs, fmtTok, trajectoryLabel } from '../../ui';
import { useWorkspace } from '../../workspace';

type Section = 'overview' | 'tools' | 'files' | 'turns';

interface FlatStep {
  mi: number;
  si: number;
  key: string;
  t: string;
  shell?: 'bash' | 'powershell';
  det: string;
  in?: string;
  out?: string;
  status: string;
  time: string;
  file?: string;
  bucket: string;
}

const buckets = () => [
  { key: 'all', label: t('report.all') },
  { key: 'read', label: t('report.read') },
  { key: 'write', label: t('report.write') },
  { key: 'code', label: t('report.execute') },
  { key: 'other', label: t('report.other') },
];

function bucketOf(t: string): string {
  if (t === 'read' || t === 'search') return 'read';
  if (t === 'write') return 'write';
  if (t === 'code') return 'code';
  return 'other';
}

function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'folder') flattenFiles(node.children || [], out);
    else out.push(node);
  }
  return out;
}

function answerOf(message: Message): string {
  const blockText = (message.blocks || [])
    .filter((block): block is Extract<NonNullable<Message['blocks']>[number], { kind: 'text' }> => block.kind === 'text')
    .map(block => block.text.trim()).filter(Boolean).join(' ');
  return (blockText || message.intro || message.outro || t('report.noText')).replace(/\s+/g, ' ').trim();
}

export function ReportView() {
  const { active, showStep, openInCanvas, openTurn } = useWorkspace();
  const [section, setSection] = useState<Section>('overview');
  const [toolFilter, setToolFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const turns = useMemo(
    () => active.messages.map((m, mi) => ({ m, mi })).filter(item => item.m.role === 'agent'),
    [active.messages],
  );
  const steps = useMemo<FlatStep[]>(() => {
    const result: FlatStep[] = [];
    for (const { m, mi } of turns) {
      (m.traj || []).forEach((step, si) => result.push({
        mi, si, key: `${mi}-${si}`, t: step.t, shell: step.shell, det: step.det,
        in: step.in, out: step.out, status: step.status, time: step.time, file: step.file,
        bucket: bucketOf(step.t),
      }));
    }
    return result;
  }, [turns]);
  const files = useMemo(() => flattenFiles(active.files), [active.files]);

  const toolDone = steps.filter(step => step.status === 'done').length;
  const toolRunning = steps.filter(step => step.status === 'running').length;
  const tokIn = turns.reduce((sum, turn) => sum + (turn.m.stats?.input || 0), 0);
  const cacheRead = turns.reduce((sum, turn) => sum + (turn.m.stats?.cacheRead || 0), 0);
  const cacheWrite = turns.reduce((sum, turn) => sum + (turn.m.stats?.cacheWrite || 0), 0);
  const promptTokens = tokIn + cacheRead + cacheWrite;
  const cacheHitRate = promptTokens > 0 ? cacheRead / promptTokens : 0;
  const totalTokens = turns.reduce((sum, turn) => {
    const stats = turn.m.stats;
    return sum + (stats?.totalTokens ?? (
      (stats?.input || 0) + (stats?.output || 0) +
      (stats?.cacheRead || 0) + (stats?.cacheWrite || 0)
    ));
  }, 0);
  const duration = turns.reduce((sum, turn) => sum + (turn.m.stats?.duration || 0), 0);
  const shownSteps = toolFilter === 'all' ? steps : steps.filter(step => step.bucket === toolFilter);

  const nav: { key: Section; label: string; icon: string; count?: number }[] = [
    { key: 'overview', label: 'Traj', icon: 'spark' },
    { key: 'tools', label: t('report.process'), icon: 'route', count: steps.length },
    { key: 'files', label: t('term.files'), icon: 'folder', count: files.length },
    { key: 'turns', label: t('report.turns'), icon: 'chat', count: turns.length },
  ];

  return (
    <div className="report-shell" data-testid="report-view">
      <header className="report-header">
        <div className="report-kicker"><Icon name="chart" />Agent {t('term.trajectory')}</div>
        <div className="report-title-row">
          <div><h2>{text(active.title)}</h2><p>{t('report.tagline')}</p></div>
          <span className={`report-state${active.live ? ' live' : ''}`}><Icon name={active.live ? 'refresh' : 'check'} />{active.live ? t('report.running') : t('report.synced')}</span>
        </div>
      </header>

      <nav className="report-nav scroll" aria-label={t('report.views')}>
        {nav.map(item => (
          <button
            key={item.key}
            className={`report-nav-item${section === item.key ? ' active' : ''}`}
            data-testid="report-nav"
            data-sec={item.key}
            aria-current={section === item.key ? 'page' : undefined}
            onClick={() => setSection(item.key)}
          >
            <Icon name={item.icon} />
            <span className="rn-label">{item.label}</span>
            {item.count != null && <span className="rn-cnt">{item.count}</span>}
          </button>
        ))}
      </nav>

      <div className="report-main scroll">
        {section === 'overview' && (
          <div className="report-overview" data-testid="report-overview">
            <div className="report-kpis" data-testid="report-kpis">
              <Fact value={String(turns.length)} label={t('report.turnFact')} />
              <Fact value={String(steps.length)} label={t('report.stepFact', { status: toolRunning ? t('report.runningCount', { count: toolRunning }) : t('report.completeCount', { count: toolDone }) })} />
              <Fact value={String(files.length)} label={t('report.fileFact')} />
              <Fact value={fmtMs(duration)} label={t('report.tokenFact', { tokens: fmtTok(totalTokens), cache: Math.round(cacheHitRate * 100) })} />
            </div>

            <section className="report-block">
              <div className="report-block-head"><div><b>{t('report.recentTurns')}</b><span>{t('report.recentTurnsHint')}</span></div><span>{turns.length}</span></div>
              <div className="report-turn-feed">
                {turns.length === 0 && <Empty>{t('report.noTrajectory')}</Empty>}
                {[...turns].reverse().slice(0, 6).map(({ m, mi }, reverseIndex) => {
                  const order = turns.length - reverseIndex;
                  const toolCount = (m.traj || []).filter(step => step.t !== 'think').length;
                  return (
                    <button className="report-turn-card" data-testid="report-turn-card" key={mi} onClick={() => openTurn(mi)}>
                      <span className="report-turn-index">{String(order).padStart(2, '0')}</span>
                      <span className="report-turn-copy"><b>{text(answerOf(m))}</b><small>{t('report.turnSummary', { tools: toolCount, artifacts: m.artifacts?.length || 0, duration: fmtMs(m.stats?.duration) })}</small></span>
                      <Icon name="chevron" className="report-open-icon" />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="report-block">
              <div className="report-block-head"><div><b>{t('report.workspaceFiles')}</b><span>{t('report.recentFilesHint')}</span></div><button onClick={() => setSection('files')}>{t('report.viewAll')}</button></div>
              <div className="report-file-strip">
                {files.length === 0 && <Empty>{t('report.noFiles')}</Empty>}
                {files.slice(0, 6).map((file, index) => (
                  <button key={(file.path || file.name) + index} onClick={() => openInCanvas(file.path || file.name)}>
                    <span className={`tree-ico ftype-${file.type}`}><Icon name={fileIcon(file.type)} /></span>
                    <span><b>{text(file.name)}</b><small>{text(file.size || file.type)}</small></span>
                    <span className="rarr">{t('report.open')}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {section === 'tools' && (
          <div className="report-section" data-testid="report-tools">
            <div className="report-section-head"><div><b>{t('report.process')}</b><span>{t('report.processHint')}</span></div></div>
            <div className="report-filter">
              {buckets().map(bucket => (
                <button key={bucket.key} className={`ft${toolFilter === bucket.key ? ' on' : ''}`} data-testid="report-filter" data-bucket={bucket.key} aria-pressed={toolFilter === bucket.key} onClick={() => setToolFilter(bucket.key)}>
                  {bucket.label}<span className="ft-cnt">{bucket.key === 'all' ? steps.length : steps.filter(step => step.bucket === bucket.key).length}</span>
                </button>
              ))}
            </div>
            <div className="report-table-scroll scroll">
              <div className="report-ledger report-tools-table" data-testid="report-tools-table">
                {shownSteps.length === 0 && <Empty>{t('report.noMatchingTools')}</Empty>}
                {shownSteps.map((step, index) => (
                  <StepItem key={step.key} step={step} index={index} open={expanded === step.key} onJump={() => showStep(step.mi, step.si)} onToggle={() => setExpanded(current => current === step.key ? null : step.key)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'files' && (
          <div className="report-section" data-testid="report-files">
            <div className="report-section-head"><div><b>{t('report.workspaceFiles')}</b><span>{t('report.filesHint')}</span></div><span>{t('common.fileCount', { count: files.length })}</span></div>
            <div className="report-table-scroll scroll">
              <div className="report-file-grid report-files-table" data-testid="report-files-table">
                {files.length === 0 && <Empty>{t('report.noArtifacts')}</Empty>}
                {files.map((file, index) => (
                  <button key={(file.path || file.name) + index} className="report-file-card" data-testid="report-file-row" aria-label={t('report.openFile', { name: file.name })} onClick={() => openInCanvas(file.path || file.name)}>
                    <span className={`report-file-icon ftype-${file.type}`}><Icon name={fileIcon(file.type)} /></span>
                    <span className="report-file-copy"><b>{text(file.name)}</b><small>{text(file.path || file.type)}</small></span>
                    <span className="report-file-size">{text(file.size || '—')}</span>
                    <span className="rarr">↗</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'turns' && (
          <div className="report-section" data-testid="report-turns">
            <div className="report-section-head"><div><b>{t('report.turns')}</b><span>{t('report.turnsHint')}</span></div><span>{t('common.turnCount', { count: turns.length })}</span></div>
            <div className="report-table-scroll scroll">
              <div className="report-turn-list report-turns-table" data-testid="report-turns-table">
                {turns.length === 0 && <Empty>{t('report.noTurns')}</Empty>}
                {turns.map(({ m, mi }, index) => (
                  <button key={mi} className="report-turn-row" data-testid="report-turn-row" aria-label={t('report.openTurn', { turn: index + 1 })} onClick={() => openTurn(mi)}>
                    <span className="report-turn-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="report-turn-copy"><b>{text(answerOf(m))}</b><small>{t('report.turnMetrics', { steps: (m.traj || []).length, input: fmtTok(m.stats?.input), output: fmtTok(m.stats?.output), cache: Math.round((m.stats?.cacheHitRate || 0) * 100) })}</small></span>
                    <span className="report-turn-metrics"><b>{fmtMs(m.stats?.duration)}</b><small>{t('report.artifactCount', { count: m.artifacts?.length || 0 })}</small></span>
                    <Icon name="chevron" className="report-open-icon" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function Fact({ value, label }: { value: string; label: string }) {
  return <div className="report-kpi" data-testid="report-kpi"><b>{value}</b><span>{label}</span></div>;
}

function Empty({ children }: { children: string }) {
  return <div className="report-empty">{children}</div>;
}

function StepItem({ step, index, open, onJump, onToggle }: { step: FlatStep; index: number; open: boolean; onJump(): void; onToggle(): void }) {
  const label = trajectoryLabel(step.t, step.shell);
  return (
    <div className={`report-tool-item${open ? ' open' : ''}`}>
      <div className="report-tool-row">
        <button className="report-tool-main" data-testid="report-tool-row" aria-label={t('report.openStep', { title: label })} onClick={onJump}>
          <span className="report-tool-index">{String(index + 1).padStart(2, '0')}</span>
          <span className={`report-tool-icon st-${step.t}`}><Icon name={trajIcon(step.t)} /></span>
          <span className="report-tool-copy"><b>{label}</b><small>{text(step.det || t('report.noDetails'))}</small></span>
          {step.file && <span className="rfile">{text(step.file)}</span>}
          <span className={`badge ${step.status === 'running' ? 'live' : 'done'}`}>{step.status === 'running' ? t('common.running') : text(step.time || t('common.complete'))}</span>
        </button>
        <button className="row-toggle" data-testid="tool-toggle" aria-label={open ? t('report.collapse') : t('report.expand')} aria-expanded={open} onClick={onToggle}><Icon name="chevron" className={`chev${open ? ' open' : ''}`} /></button>
      </div>
      {open && (
        <div className="detail-grid">
          <div><span className="lab">{t('common.input')}</span><pre>{text(step.in || t('common.none'))}</pre></div>
          <div><span className="lab">{t('common.output')}</span><pre>{text(step.out || t('common.noOutput'))}</pre></div>
        </div>
      )}
    </div>
  );
}
