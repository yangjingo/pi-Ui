import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { AgentContentBlock, Artifact, FileNode, Message, TrajStep } from '../../core/agent/protocol';
import { Icon, MdText, PiIcon, fileIcon, fmtMs, text, trajIcon } from '../../ui';
import {
  createSkillFromTurn as createWorkspaceSkillFromTurn,
  importWorkspaceFile,
  skillSlashCommand,
  useSkills,
  useWorkspace,
} from '../../workspace';

interface MentionItem {
  kind: 'skill' | 'file';
  id: string;
  name: string;
  desc: string;
  icon: string;
  command?: string;
}

interface ComposerAttachment {
  id: string;
  path: string;
  name: string;
  type: string;
}

function fileMention(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

export function ConversationPanel() {
  const {
    active, showStep, openInCanvas, openTurn, sendMessage, steerMessage, interruptWithSteer, flashMsg, setFlashMsg, error, loading, connectionStatus,
    composerDraft: input, setComposerDraft: setInput, setView,
  } = useWorkspace();
  const skills = useSkills();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sendTick, setSendTick] = useState(0);
  const [followingStream, setFollowingStream] = useState(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const followStreamRef = useRef(true);
  const [steerDraft, setSteerDraft] = useState<string | null>(null);
  const steerDraftAtRef = useRef(0);
  const [creatingSkill, setCreatingSkill] = useState<number | null>(null);

  useEffect(() => {
    if (flashMsg == null || !dialogRef.current) return;
    const node = dialogRef.current.querySelector(`[data-msg="${flashMsg}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setFlashMsg(null), 1400);
    return () => clearTimeout(t);
  }, [flashMsg, setFlashMsg]);

  useEffect(() => {
    if (!sendTick || !dialogRef.current) return;
    followStreamRef.current = true;
    setFollowingStream(true);
    dialogRef.current.scrollTop = dialogRef.current.scrollHeight;
  }, [sendTick]);

  // Follow streaming output only while the reader stays near the bottom. Direct scrollTop updates
  // are intentional: per-token smooth scrolling queues motion and makes live output feel delayed.
  useEffect(() => {
    if (loading && followStreamRef.current && dialogRef.current) {
      dialogRef.current.scrollTop = dialogRef.current.scrollHeight;
    }
  }, [loading, active.messages]);

  useEffect(() => {
    if (!loading) setSteerDraft(null);
  }, [loading]);

  const updateStreamFollowing = () => {
    const node = dialogRef.current;
    if (!node) return;
    const next = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    if (next === followStreamRef.current) return;
    followStreamRef.current = next;
    setFollowingStream(next);
  };

  const jumpToLatest = () => {
    const node = dialogRef.current;
    if (!node) return;
    followStreamRef.current = true;
    setFollowingStream(true);
    node.scrollTop = node.scrollHeight;
    // Markdown/layout can gain a few pixels immediately after the click. Re-pin on the next
    // frame so "回到最新" reliably lands at the real bottom without introducing smooth lag.
    requestAnimationFrame(() => {
      if (followStreamRef.current && dialogRef.current) {
        dialogRef.current.scrollTop = dialogRef.current.scrollHeight;
      }
    });
  };

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '26px';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  };

  useEffect(() => {
    if (!input) return;
    requestAnimationFrame(() => { autosize(); taRef.current?.focus(); });
    // A fresh composer should not steal focus again on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const composedInput = () => {
    const refs = attachments.map(attachment => fileMention(attachment.path)).join(' ');
    return [input.trim(), refs].filter(Boolean).join(input.trim() ? '\n\n' : '').trim();
  };

  const clearComposer = () => {
    setInput('');
    setAttachments([]);
    if (taRef.current) taRef.current.style.height = '26px';
  };

  const onSend = () => {
    const v = composedInput();
    if (!v) return;
    if (loading) {
      // A running turn never receives text merely because it was typed. Keep it visibly
      // hovering above the composer until the user explicitly confirms an insertion.
      setSteerDraft(v);
      steerDraftAtRef.current = Date.now();
    } else {
      sendMessage(v);
    }
    clearComposer();
    setSendTick(t => t + 1);
  };

  const onImmediateSteer = () => {
    const v = composedInput() || steerDraft || '';
    if (!v) return;
    interruptWithSteer(v);
    setSteerDraft(null);
    clearComposer();
    setSendTick(t => t + 1);
  };

  const editBubble = (message: Message) => {
    const refs = (message.attachments || []).map(attachment => fileMention(attachment.path || attachment.name));
    const source = [message.text || '', ...refs.filter(ref => !(message.text || '').includes(ref))].filter(Boolean).join('\n\n');
    setInput(source);
    setAttachments([]);
    requestAnimationFrame(() => { autosize(); taRef.current?.focus(); });
  };

  const resendBubble = (index: number) => {
    if (loading) return;
    let source = messages[index]?.role === 'user' ? messages[index]?.text : '';
    if (!source) {
      for (let cursor = index - 1; cursor >= 0; cursor--) {
        if (messages[cursor]?.role === 'user' && messages[cursor]?.text) { source = messages[cursor]!.text!; break; }
      }
    }
    if (!source) return;
    sendMessage(source);
    setSendTick(t => t + 1);
  };
  const createSkillFromTurn = async (index: number) => {
    setCreatingSkill(index);
    try {
      const result = await createWorkspaceSkillFromTurn(index);
      if (result.ok) await setView('skill');
    } finally {
      setCreatingSkill(null);
    }
  };

  const files = useMemo(() => {
    const out: { name: string; path: string; type: string }[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') { if (n.children) walk(n.children); }
        else out.push({ name: n.name, path: n.path || n.name, type: n.type });
      }
    };
    walk(active.files);
    return out;
  }, [active.files]);
  const [mention, setMention] = useState<{ trigger: '/' | '@'; at: number; query: string } | null>(null);
  const mentionMatches = useMemo<MentionItem[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    if (mention.trigger === '/') {
      const localSkills: MentionItem[] = skills
        .filter(skill => skill.enabled && (!q || skill.name.toLowerCase().includes(q) || skill.desc.toLowerCase().includes(q)))
        .map(skill => ({ kind: 'skill' as const, id: skill.id, name: skill.name, desc: skill.desc || '本地 Skill', icon: 'blocks', command: skillSlashCommand(skill) }));
      return localSkills.slice(0, 8);
    }
    return files
      .filter(f => !q || f.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map(f => ({ kind: 'file' as const, id: f.path, name: f.name, desc: f.type, icon: fileIcon(f.type) }));
  }, [mention, files, skills]);
  const pickMention = (item: MentionItem) => {
    if (!mention) return;
    const before = input.slice(0, mention.at);
    const after = input.slice(mention.at + 1 + mention.query.length);
    const tail = after.startsWith(' ') ? '' : ' ';
    const injection = item.kind === 'file' ? fileMention(item.id) + tail : (item.command || `/${item.name}`) + tail;
    const next = before + injection + after;
    setInput(next);
    setMention(null);
    const target = before.length + injection.length;
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(target, target); }
    });
  };
  const onChangeInput = (v: string) => {
    setInput(v);
    autosize();
    const ta = taRef.current;
    const pos = ta ? ta.selectionStart : v.length;
    const m = v.slice(0, pos).match(/(?:^|\s)([\/@][\w一-龥.\-]*)$/);
    if (m) {
      const tok = m[1];
      setMention({ trigger: tok[0] === '/' ? '/' : '@', at: pos - tok.length, query: tok.slice(1) });
      setMentionIndex(0);
    } else setMention(null);
  };
  const onKeyDownInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(index => (index + (e.key === 'ArrowDown' ? 1 : -1) + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pickMention(mentionMatches[mentionIndex] || mentionMatches[0]); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (loading && steerDraft && Date.now() - steerDraftAtRef.current < 900) onImmediateSteer();
      else onSend();
    }
  };

  const messages = active.messages ?? [];
  const dateLabel = active.group === '今天' ? `TODAY · ${active.time}` : (active.group?.toUpperCase() ?? '');
  const isNewConversation = messages.length === 0;
  const composer = <Composer
    value={input}
    taRef={taRef}
    mentionMatches={mentionMatches}
    mentionIndex={mentionIndex}
    attachments={attachments}
    steerDraft={steerDraft}
    inline={isNewConversation}
    onPickMention={pickMention}
    onMentionIndex={setMentionIndex}
    onAttached={(items) => setAttachments(previous => {
      const known = new Set(previous.map(item => item.path));
      return [...previous, ...items.filter(item => !known.has(item.path))];
    })}
    onRemoveAttachment={(id) => setAttachments(previous => previous.filter(item => item.id !== id))}
    onConfirmSteer={() => {
      if (!steerDraft) return;
      steerMessage(steerDraft);
      setSteerDraft(null);
    }}
    onCancelSteer={() => setSteerDraft(null)}
    onChange={onChangeInput}
    onKeyDown={onKeyDownInput}
    onSend={onSend}
  />;

  return (
    <>
      <div className={`dialog scroll${loading ? ' streaming' : ''}`} ref={dialogRef} data-testid="conversation" onScroll={updateStreamFollowing}>
        {isNewConversation ? (
          <EmptyState composer={composer} />
        ) : (
          <>
            {dateLabel && <div className="date-sep">{dateLabel}</div>}
            {messages.map((m, mi) =>
              m.role === 'user' ? (
                <article key={mi} className="msg user" data-testid="user-message" data-msg={mi}>
                  <div className="bubble">
                    {m.text && <p>{text(m.text)}</p>}
                    {!!m.attachments?.length && (
                      <div className="user-attachments" data-testid="user-attachments">
                        {m.attachments.map((attachment, index) => (
                          <button type="button" key={(attachment.path || attachment.name) + index} onClick={() => void openInCanvas(attachment.path || attachment.name)} title={`在 Canvas 打开 ${attachment.path || attachment.name}`}>
                            <span className="tree-ico"><Icon name={fileIcon(attachment.type)} /></span><span><b>{text(attachment.name)}</b><small>工作区引用</small></span><Icon name="frame" />
                          </button>
                        ))}
                      </div>
                    )}
                    {!!m.workspaceChanges?.length && (
                      <div className="user-workspace-changes" data-testid="user-workspace-changes">
                        <span className="user-change-label"><Icon name="edit" />已同步 Canvas 修改</span>
                        {m.workspaceChanges.map((change, index) => (
                          <button type="button" key={change.path + index} onClick={() => void openInCanvas(change.path)} title={`打开已同步的 ${change.path}`}>
                            <span>{text(change.path)}</span><Icon name="frame" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="msg-acts user-msg-acts" aria-label="消息操作">
                    <button type="button" data-testid="message-edit" disabled={loading || !m.text} onClick={() => editBubble(m)}><Icon name="edit" />编辑</button>
                    <button type="button" data-testid="message-resend" disabled={loading || !m.text} onClick={() => resendBubble(mi)}><Icon name="refresh" />重新发送</button>
                  </div>
                  <div className="when">{m.when || '刚刚'}</div>
                </article>
              ) : (
                <AgentMessage
                  key={mi}
                  mi={mi}
                  m={m}
                  open={expanded.has(mi)}
                  onToggle={() => setExpanded(prev => {
                    const next = new Set(prev);
                    if (next.has(mi)) next.delete(mi); else next.add(mi);
                    return next;
                  })}
                  onStep={(si) => showStep(mi, si)}
                  onOpenCanvas={(name) => openInCanvas(name)}
                  onOpenTurn={() => openTurn(mi)}
                  flash={flashMsg === mi}
                  onResend={() => resendBubble(mi)}
                  onCreateSkill={() => void createSkillFromTurn(mi)}
                  actionDisabled={loading}
                  creatingSkill={creatingSkill === mi}
                  reconnecting={connectionStatus === 'reconnecting' && !messages.slice(mi + 1).some(message => message.role === 'agent')}
                />
              )
            )}
          </>
        )}
      </div>

      {loading && !followingStream && (
        <button className="stream-jump" data-testid="stream-jump" onClick={jumpToLatest}>
          回到最新 <Icon name="chevron" />
        </button>
      )}

      {error && (
        <div data-testid="error-bar" style={{
          position: 'absolute', left: 0, right: 0, bottom: 168, margin: '0 auto', maxWidth: 640,
          padding: '8px 14px', border: '1px solid var(--border-strong)', borderRadius: 6,
          background: 'var(--error-soft)', color: 'var(--error)', fontSize: 12.5, lineHeight: 1.5,
          textAlign: 'center', pointerEvents: 'auto',
        }}>{text(error)}</div>
      )}

      {!isNewConversation && composer}
    </>
  );
}
function AgentMessage({
  mi, m, open, onToggle, onStep, onOpenCanvas, onOpenTurn, flash, onResend, onCreateSkill, actionDisabled, creatingSkill, reconnecting
}: {
  mi: number;
  m: Message;
  open: boolean;
  onToggle(): void;
  onStep(si: number): void;
  onOpenCanvas(name: string): void;
  onOpenTurn(): void;
  flash: boolean;
  onResend(): void;
  onCreateSkill(): void;
  actionDisabled: boolean;
  creatingSkill: boolean;
  reconnecting: boolean;
}) {
  const live = m.status === 'running';
  const traj = m.traj ?? [];
  const blocks = m.blocks ?? [];
  const hasFlow = blocks.length > 0;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const copyText = hasFlow
    ? blocks.filter((block): block is Extract<AgentContentBlock, { kind: 'text' }> => block.kind === 'text').map(block => block.text).join('\n\n')
    : [m.intro, m.outro].filter(Boolean).join('\n\n');

  useEffect(() => () => {
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
  }, []);

  const copyAnswer = async () => {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className={`msg${flash ? ' flash' : ''}`} data-testid="agent-message" data-msg={mi} aria-busy={live}>
      <div className="agent-head">
        <span className="agent-avatar"><PiIcon /></span>
        <span className="stat">
          {live ? <><span className="live" />正在执行任务…</> : <><Icon name="check" /> 已完成</>}
        </span>
        {reconnecting && (
          <span className="agent-reconnecting" data-testid="agent-reconnecting" role="status">
            <Icon name="refresh" />Reconnecting…
          </span>
        )}
        <button type="button" className="head-arr" data-testid="open-turn" title="查看本轮详情" onClick={onOpenTurn}>查看过程 ↗</button>
      </div>
      {hasFlow ? (
        <AgentFlow
          artifacts={m.artifacts ?? []}
          blocks={blocks}
          steps={traj}
          live={live}
          onStep={onStep}
          onOpenArtifact={onOpenCanvas}
        />
      ) : (
        <>
          {m.intro && (
            <div className="answer">
              {live ? <p>{m.intro}</p> : <MdText className="md-body" text={m.intro} />}
            </div>
          )}
          {traj.length > 0 && (
        <section className={`traj${open ? '' : ' collapsed'}`} data-testid="trajectory">
          <button type="button" className="traj-head" data-testid="traj-toggle" aria-expanded={open} onClick={onToggle}>
            <span className="tico"><Icon name="route" /></span>
            <span className="t-title">Agent 执行轨迹</span>
            <span className="t-count">{traj.length} 步</span>
            <span className="spacer" />
            <span className={`badge ${live ? 'live' : 'done'}`}>{live ? 'LIVE' : '已完成'}</span>
            <span className="chev"><Icon name="chevron" className="chev" /></span>
          </button>
          <div className="traj-body"><div className="tbody">
            {traj.map((s, i) => (
              <button type="button" key={i} className={`trow${s.t === 'think' ? ' think' : ''}`} data-testid="traj-row" data-kind={s.t} onClick={() => onStep(i)}>
                <span className="rail" />
                <span className={`ticon ${s.status}`}><Icon name={trajIcon(s.t)} /></span>
                <span className="tmain"><b>{text(s.title)}</b><span className="tdet">{text(s.det)}</span></span>
                <span className="ttime">{s.time}</span>
              </button>
            ))}
          </div></div>
        </section>
          )}
          {m.outro && <div className="answer"><MdText className="md-body" text={m.outro} /></div>}
        </>
      )}
      {!hasFlow && !!m.artifacts?.length && (
        <AgentFlow
          artifacts={m.artifacts}
          blocks={[]}
          steps={traj}
          live={live}
          onStep={onStep}
          onOpenArtifact={onOpenCanvas}
        />
      )}
      {live && (
        <div className="agent-thinking-bar" data-testid="agent-thinking-bar" role="status" aria-live="polite">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
      )}
      <div className="msg-acts">
        <button
          className={copied ? 'copied' : ''}
          data-testid="message-copy"
          disabled={!copyText}
          onClick={() => void copyAnswer()}
        >
          <Icon name={copied ? 'check' : 'copy'} /> {copied ? '已复制' : '复制回答'}
        </button>
        <button type="button" data-testid="message-resend" disabled={actionDisabled} onClick={onResend}><Icon name="refresh" />重新生成</button>
        <button type="button" data-testid="message-create-skill" disabled={live || actionDisabled || creatingSkill} onClick={onCreateSkill}><Icon name="blocks" />{creatingSkill ? '生成中…' : '生成 Skill'}</button>
      </div>
      {m.stats && !live && (
        <div className="turn-stats" data-testid="turn-stats">
          <span><b>TTFT</b> {fmtMs(m.stats.ttft)}</span>
          <span><b>TPOT</b> {m.stats.tpot > 0 ? `${m.stats.tpot.toFixed(0)}ms/tok` : '—'}</span>
          <span><b>输出</b> {m.stats.output} tok</span>
          <span><b>未缓存输入</b> {m.stats.input} tok</span>
          {m.stats.totalTokens != null && <span><b>总量</b> {m.stats.totalTokens} tok</span>}
          {m.stats.cacheHitRate != null && <span><b>缓存</b> {Math.round(m.stats.cacheHitRate * 100)}%</span>}
          <span><b>耗时</b> {(m.stats.duration / 1000).toFixed(1)}s</span>
        </div>
      )}
    </article>
  );
}

function AgentFlow({
  artifacts, blocks, steps, live, onStep, onOpenArtifact,
}: {
  artifacts: Artifact[];
  blocks: AgentContentBlock[];
  steps: TrajStep[];
  live: boolean;
  onStep(si: number): void;
  onOpenArtifact(path: string): void;
}) {
  const finalArtifacts = artifacts.filter((artifact, index) => {
    const key = artifactPathKeys(artifact.path || artifact.name)[0];
    return artifacts.findIndex(candidate =>
      artifactPathKeys(candidate.path || candidate.name)[0] === key
    ) === index;
  });

  return (
    <div className="agent-flow" data-testid="agent-flow" aria-label="Agent 执行流">
      {blocks.map((block, index) => {
        if (block.kind === 'text') {
          if (!block.text) return null;
          const streaming = live && index === blocks.length - 1;
          return (
            <div className={`answer flow-text${streaming ? ' streaming' : ''}`} data-testid="flow-text" data-streaming={streaming || undefined} key={`text-${index}`}>
              {streaming
                ? <p>{block.text}</p>
                : <MdText className="md-body" text={block.text} />}
            </div>
          );
        }
        const step = steps[block.step];
        if (!step) return null;
        return (
          <AgentFlowStep
            artifactPath={step.file}
            key={`step-${block.step}`}
            step={step}
            onOpen={() => step.file ? onOpenArtifact(step.file) : onStep(block.step)}
          />
        );
      })}
      {!live && finalArtifacts.map((artifact, index) => {
        const path = artifact.path || artifact.name;
        return (
          <AgentFlowStep
            artifactPath={path}
            artifactType={artifact.type}
            key={`final-artifact-${path}-${index}`}
            step={{
              t: 'write',
              title: artifact.name,
              det: artifact.label,
              status: 'done',
              time: '可打开',
              file: path,
            }}
            onOpen={() => onOpenArtifact(path)}
          />
        );
      })}
    </div>
  );
}

function artifactPathKeys(path: string): string[] {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase();
  const leaf = normalized.split('/').at(-1);
  return leaf && leaf !== normalized ? [normalized, leaf] : [normalized];
}

function AgentFlowStep({
  artifactPath, artifactType, step, onOpen,
}: {
  artifactPath?: string;
  artifactType?: Artifact['type'];
  step: TrajStep;
  onOpen(): void;
}) {
  const running = step.status === 'running';
  const thinkingText = step.t === 'think' ? (step.text || step.det) : '';
  return (
    <div
      className={`flow-step-shell${step.t === 'think' ? ' think' : ''}`}
      data-testid="flow-step-shell"
      data-kind={step.t}
      data-status={step.status}
      data-artifact-path={artifactPath}
    >
      <button
        type="button"
        className={`flow-step${step.t === 'think' ? ' think' : ''}`}
        data-testid="flow-step"
        data-kind={step.t}
        data-status={step.status}
        aria-label={artifactPath
          ? `在 Canvas 打开 ${artifactPath}`
          : `在 Canvas 查看 ${step.title} Trajectory，${step.det || (running ? '运行中' : '已完成')}`}
        onClick={onOpen}
      >
        <span className={`flow-step-icon ${step.status}`}><Icon name={artifactType ? fileIcon(artifactType) : trajIcon(step.t)} /></span>
        <span className="flow-step-copy"><b>{text(step.title)}</b>{step.t !== 'think' && step.det && <small>{text(step.det)}</small>}</span>
        <span className={`flow-step-status ${step.status}`} role="status" aria-live="polite">
          {running ? (step.t === 'think' ? '思考中' : '运行中') : <><Icon name="check" />{step.time}</>}
        </span>
        <span className="flow-step-target" aria-hidden="true"><span>Canvas</span><Icon name="frame" /></span>
      </button>
      {thinkingText && (
        <div className="flow-thinking" data-testid="flow-thinking" aria-label="完整 Thinking 轨迹">
          {text(thinkingText)}
        </div>
      )}
    </div>
  );
}

function Composer({
  value, onChange, onKeyDown, onSend, taRef, mentionMatches, mentionIndex, attachments,
  steerDraft, inline = false, onPickMention, onMentionIndex, onAttached, onRemoveAttachment, onConfirmSteer, onCancelSteer,
}: {
  value: string;
  onChange(v: string): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  onSend(): void;
  taRef: React.RefObject<HTMLTextAreaElement>;
  mentionMatches: MentionItem[];
  mentionIndex: number;
  attachments: ComposerAttachment[];
  steerDraft: string | null;
  inline?: boolean;
  onPickMention(item: MentionItem): void;
  onMentionIndex(index: number): void;
  onAttached(items: ComposerAttachment[]): void;
  onRemoveAttachment(id: string): void;
  onConfirmSteer(): void;
  onCancelSteer(): void;
}) {
  const { active, loading, steerQueue, openInCanvas, pendingAgentChanges } = useWorkspace();
  const attachRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const liveAgent = [...active.messages].reverse().find(message => message.role === 'agent' && message.status === 'running');
  const currentStep = liveAgent?.traj?.[liveAgent.traj.length - 1];
  const agentThinking = !!loading && currentStep?.t === 'think' && currentStep.status === 'running';
  const showSteerPanel = agentThinking && (!!value.trim() || !!steerDraft);

  const attachFiles = async (files: File[]) => {
    const attached: ComposerAttachment[] = [];
    for (const file of files) {
      try {
        const result = await importWorkspaceFile(file);
        if (!result.ok || !result.file) continue;
        attached.push(result.file);
      } catch { /* Continue importing the remaining files. */ }
    }
    if (!attached.length) return;
    onAttached(attached);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(value.length, value.length);
    });
  };

  return (
    <div className={`composer-wrap${inline ? ' composer-welcome' : ''}`}>
      {mentionMatches.length > 0 && (
        <div id="composer-mention-menu" className="slash-menu" data-testid="slash-menu" role="listbox" aria-label={mentionMatches[0]?.kind === 'file' ? '工作区文件' : '本地 Skill'}>
          <div className="slash-menu-label">{mentionMatches[0]?.kind === 'file' ? '工作区文件' : '命令'}<span>↑↓ 选择 · Enter 插入</span></div>
          {mentionMatches.map((it, index) => (
            <button
              key={it.kind + it.id}
              id={`mention-option-${index}`}
              className={`slash-item${index === mentionIndex ? ' active' : ''}`}
              data-testid="slash-item"
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              onPointerMove={() => onMentionIndex(index)}
              onClick={() => onPickMention(it)}
            >
              <span className="slash-ico"><Icon name={it.icon} /></span>
              <span className="slash-copy"><span className="slash-name">{it.kind === 'file' ? it.name : (it.command || `/${it.name}`)}</span>{it.desc && <span className="slash-desc">{it.desc}</span>}</span>
              <span className="slash-kind">{it.kind === 'skill' ? '本地' : it.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className={`composer${dragging ? ' dragging' : ''}`}
        onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void attachFiles(Array.from(event.dataTransfer.files)); }}
      >
        {dragging && <div className="composer-drop" data-testid="composer-drop"><Icon name="paperclip" />松开以加入工作区并引用</div>}
        {showSteerPanel && (
          <div className="steer-panel" data-testid="steer-panel" role="status">
            <span className="steer-title"><Icon name="send" />STEER</span>
            <span className="steer-help">Enter 仅暂存 · 确认后插入队列 · 连按 Enter 立即中断并切换上下文</span>
            {steerQueue.length > 0 && (
              <div className="steer-queue" data-testid="steer-queue">
                {steerQueue.map(item => <span key={item.id}><b>待插入</b>{text(item.text)}</span>)}
              </div>
            )}
          </div>
        )}
        {steerDraft && (
          <div className="steer-draft" data-testid="steer-draft" role="status">
            <span className="steer-draft-copy"><b>STEER 待确认</b><small>{text(steerDraft)}</small></span>
            <button type="button" className="steer-draft-confirm" data-testid="steer-confirm" onClick={onConfirmSteer}>确认插入</button>
            <button type="button" className="steer-draft-cancel" data-testid="steer-cancel" aria-label="取消待确认指令" onClick={onCancelSteer}><Icon name="x" /></button>
          </div>
        )}
        <input
          ref={attachRef}
          data-testid="composer-file-input"
          type="file"
          multiple
          accept=".md,.markdown,.txt,.csv,.tsv,.html,.htm,.json,.py,.js,.ts,.tsx,.jsx,.css,.yml,.yaml,.toml,.docx,.docm,.dotx,.dotm,.xlsx,.xlsm,.xltx,.xltm,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.png,.jpg,.jpeg,.gif,.svg,.webp,.pdf,.zip,.tar,.gz,.tgz,.bz2,.7z,.xz,text/*"
          hidden
          onChange={(e) => {
            void attachFiles(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
        {attachments.length > 0 && (
          <div className="composer-attachments" data-testid="composer-attachments" aria-label="已附加文件">
            {attachments.map(attachment => (
              <div className="composer-attachment" data-testid="composer-attachment" key={attachment.id}>
                <button type="button" className="composer-attachment-open" title={`在 Canvas 打开 ${attachment.path}`} onClick={() => void openInCanvas(attachment.path)}>
                  <span className="composer-attachment-icon"><Icon name={fileIcon(attachment.type)} /></span>
                  <span className="composer-attachment-copy"><b>{text(attachment.name)}</b><small>已加入工作区</small></span>
                </button>
                <button type="button" className="composer-attachment-remove" data-testid="composer-attachment-remove" title={`移除 ${attachment.name}`} aria-label={`移除 ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)}><Icon name="x" /></button>
              </div>
            ))}
          </div>
        )}
      {pendingAgentChanges.length > 0 && (
          <div className="composer-agent-context" data-testid="composer-agent-context" role="status">
            <span><Icon name="edit" /><b>Agent 将了解 Canvas 修改</b></span>
            <small>{pendingAgentChanges.map(change => change.path).join('、')} · 随下一条消息同步</small>
          </div>
      )}
        <textarea
          data-testid="composer-input"
          className={loading ? 'steer-input' : undefined}
          ref={taRef}
          placeholder={loading ? '输入后按 Enter 插入当前 Agent loop…' : '描述任务；输入 / 使用本地 Skill，输入 @ 引用文件…'}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-controls={mentionMatches.length ? 'composer-mention-menu' : undefined}
          aria-activedescendant={mentionMatches.length ? `mention-option-${mentionIndex}` : undefined}
        />
        <div className="composer-tools">
          <button className="pill" data-testid="composer-attach" onClick={() => attachRef.current?.click()}><Icon name="paperclip" />附件</button>

          <span className="spacer" />
          <button className={`send${loading ? ' steering' : ''}`} data-testid="composer-send" aria-label={loading ? '暂存 Agent 指令' : '发送消息'} disabled={!value.trim()} onClick={onSend}>
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ composer }: { composer: React.ReactNode }) {
  return (
    <div className="empty" style={{ height: '100%' }}>
      <div className="empty-pi-banner"><PiIcon /></div>
      <h2>开始一个新的 Agent 任务</h2>
      <p>由 Pi 驱动。告诉它你想做什么，它会调用工具、把成果写进右侧工作区。</p>
      {composer}
    </div>
  );
}
