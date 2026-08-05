import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { AgentContentBlock, Artifact, FileNode, Message, TrajStep } from '../../core/agent/protocol';
import { FileUploadIcon, Icon, MdText, PiIcon, artifactIcon, compactTurnMetrics, fileIcon, readBrand, relativeTimeLabel, sessionGroupLabel, t, term, text, trajectoryLabel, trajIcon } from '../../ui';
import {
  createSkillFromTurn as createWorkspaceSkillFromTurn,
  importWorkspaceFile,
  skillSlashCommand,
  useSkills,
  useWorkspace,
} from '../../workspace';
import { useLoopPet } from '../hooks/use-loop-pet';

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

interface SessionSkillDraft {
  id: string;
  directory: string;
  path: string;
  sourceMessageIndex: number;
}

function sessionCacheHitRates(messages: readonly Message[]): Array<number | undefined> {
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  return messages.map(message => {
    if (message.role !== 'agent' || !message.stats) return undefined;
    const tokenCount = (value: number | undefined) => Number.isFinite(value) && Number(value) > 0
      ? Number(value)
      : 0;
    input += tokenCount(message.stats.input);
    cacheRead += tokenCount(message.stats.cacheRead);
    cacheWrite += tokenCount(message.stats.cacheWrite);
    const promptTokens = input + cacheRead + cacheWrite;
    return promptTokens > 0 ? cacheRead / promptTokens : undefined;
  });
}

export function ConversationPanel() {
  const {
    active, goal, openInCanvas, openTurn, showStep, sendMessage, steerMessage, interruptWithSteer, flashMsg, setFlashMsg, error, loading, connectionStatus,
    composerDraft: input, setComposerDraft: setInput,
  } = useWorkspace();
  const skills = useSkills();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sendTick, setSendTick] = useState(0);
  const [followingStream, setFollowingStream] = useState(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const followStreamRef = useRef(true);
  const lastSessionIdRef = useRef<string | null>(null);
  const pendingSessionEndRef = useRef<string | null>(null);
  const [steerDraft, setSteerDraft] = useState<string | null>(null);
  const steerDraftAtRef = useRef(0);
  const [creatingSkill, setCreatingSkill] = useState<number | null>(null);
  const [skillDraft, setSkillDraft] = useState<SessionSkillDraft | null>(null);

  useEffect(() => { setSkillDraft(null); }, [active.id]);

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

  useLayoutEffect(() => {
    if (!active.id) {
      lastSessionIdRef.current = null;
      pendingSessionEndRef.current = null;
      return;
    }
    if (lastSessionIdRef.current !== active.id) {
      lastSessionIdRef.current = active.id;
      pendingSessionEndRef.current = active.id;
    }
    // Session snapshots can arrive after the route has rendered its empty shell. Restore only
    // once real transcript content is present, then leave scrolling under the reader's control.
    if (active.messages.length === 0 || pendingSessionEndRef.current !== active.id) return;
    const node = dialogRef.current;
    if (!node) return;
    followStreamRef.current = true;
    setFollowingStream(true);
    pendingSessionEndRef.current = null;
    const settleAtEnd = () => { node.scrollTop = node.scrollHeight; };
    settleAtEnd();
    // Markdown and the composer can finish layout after this layout effect. Re-pin for the next
    // two frames only; ongoing user scrolling remains untouched after the Session opens.
    const firstFrame = requestAnimationFrame(() => {
      settleAtEnd();
      requestAnimationFrame(settleAtEnd);
    });
    const afterTypography = window.setTimeout(settleAtEnd, 120);
    return () => {
      cancelAnimationFrame(firstFrame);
      window.clearTimeout(afterTypography);
    };
  }, [active.id, active.messages.length]);

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
      if (!active.id) return;
      const result = await createWorkspaceSkillFromTurn(active.id, index);
      if (result.ok && result.draft) {
        setSkillDraft(result.draft);
        setInput(t('conversation.skillDraftValidationPrompt', { path: result.draft.path }));
        requestAnimationFrame(() => { autosize(); taRef.current?.focus(); });
      }
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
        .map(skill => ({ kind: 'skill' as const, id: skill.id, name: skill.name, desc: skill.desc || t('conversation.skillFallback'), icon: 'blocks', command: skillSlashCommand(skill) }));
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
  const skillDraftValidated = useMemo(() => {
    if (!skillDraft) return false;
    const validationTurn = messages.findIndex((message, index) => index > skillDraft.sourceMessageIndex && message.role === 'user' && (
      (message.text || '').includes(`@${skillDraft.path}`) ||
      (message.attachments || []).some(attachment => (attachment.path || attachment.name) === skillDraft.path)
    ));
    return validationTurn >= 0 && messages.slice(validationTurn + 1).some(message => message.role === 'agent' && message.status !== 'running');
  }, [messages, skillDraft]);

  const discussSkillContribution = () => {
    if (!skillDraft || !skillDraftValidated) return;
    setInput(t('conversation.skillDraftContributionPrompt', { path: skillDraft.path }));
    requestAnimationFrame(() => { autosize(); taRef.current?.focus(); });
  };
  const cumulativeCacheHitRates = useMemo(() => sessionCacheHitRates(messages), [messages]);
  const loopPet = useLoopPet(loading, loading ? `${active.id}:${messages.length}` : '');
  const groupLabel = sessionGroupLabel(active.group || '');
  const dateLabel = groupLabel === t('session.today') || groupLabel === t('session.existingToday')
    ? t('conversation.todayAt', { time: relativeTimeLabel(active.time) })
    : groupLabel.toUpperCase();
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
                          <button type="button" key={(attachment.path || attachment.name) + index} onClick={() => void openInCanvas(attachment.path || attachment.name)} title={t('conversation.openAttachment', { path: attachment.path || attachment.name })}>
                            <span className="tree-ico"><Icon name={fileIcon(attachment.type)} /></span><span><b>{text(attachment.name)}</b><small>{t('conversation.workspaceReference')}</small></span><Icon name="frame" />
                          </button>
                        ))}
                      </div>
                    )}
                    {!!m.workspaceChanges?.length && (
                      <div className="user-workspace-changes" data-testid="user-workspace-changes">
                        <span className="user-change-label"><Icon name="edit" />{t('conversation.syncedCanvasChanges')}</span>
                        {m.workspaceChanges.map((change, index) => (
                          <button type="button" key={change.path + index} onClick={() => void openInCanvas(change.path)} title={t('conversation.openSyncedChange', { path: change.path })}>
                            <span>{text(change.path)}</span><Icon name="frame" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="msg-acts user-msg-acts" aria-label={t('conversation.messageActions')}>
                    <button type="button" data-testid="message-edit" disabled={loading || !m.text} onClick={() => editBubble(m)}><Icon name="edit" />{t('conversation.editMessage')}</button>
                    <button type="button" data-testid="message-resend" disabled={loading || !m.text} onClick={() => resendBubble(mi)}><Icon name="refresh" />{t('conversation.resendMessage')}</button>
                  </div>
                  <div className="when">{m.when || t('conversation.justNow')}</div>
                </article>
              ) : (
                <AgentMessage
                  key={mi}
                  mi={mi}
                  m={m}
                  cumulativeCacheHitRate={cumulativeCacheHitRates[mi]}
                  onOpenCanvas={(name) => openInCanvas(name)}
                  onOpenTurn={() => openTurn(mi)}
                  onStep={(si) => void showStep(mi, si)}
                  conciseMode={goal !== null}
                  flash={flashMsg === mi}
                  onResend={() => resendBubble(mi)}
                  onCreateSkill={() => void createSkillFromTurn(mi)}
                  actionDisabled={loading}
                  creatingSkill={creatingSkill === mi}
                  reconnecting={connectionStatus === 'reconnecting' && !messages.slice(mi + 1).some(message => message.role === 'agent')}
                  loopPet={m.status === 'running' ? loopPet : null}
                />
              )
            )}
          </>
        )}
      </div>

      {loading && !followingStream && (
        <button className="stream-jump" data-testid="stream-jump" onClick={jumpToLatest}>
          {t('conversation.jumpLatest')} <Icon name="chevron" />
        </button>
      )}

      {error && (
        <div className="conversation-error" data-testid="error-bar" role="alert">{text(error)}</div>
      )}

      {skillDraft && (
        <div className={`session-skill-draft${skillDraftValidated ? ' validated' : ''}`} data-testid="session-skill-draft" role="status">
          <span className="session-skill-draft-icon"><Icon name={skillDraftValidated ? 'check' : 'file'} /></span>
          <span className="session-skill-draft-copy">
            <b>{t(skillDraftValidated ? 'conversation.skillDraftValidated' : 'conversation.skillDraftReady')}</b>
            <small>{t(skillDraftValidated ? 'conversation.skillDraftValidatedHint' : 'conversation.skillDraftReadyHint', { path: skillDraft.path })}</small>
          </span>
          <button type="button" className="pill" onClick={() => void openInCanvas(skillDraft.path)}><Icon name="frame" />{t('conversation.skillDraftOpen')}</button>
          {skillDraftValidated && <button type="button" className="send session-skill-contribute" data-testid="skill-draft-contribute" onClick={discussSkillContribution}><Icon name="blocks" />{t('conversation.skillDraftContribute')}</button>}
          <button type="button" className="session-skill-draft-dismiss" aria-label={t('common.close')} onClick={() => setSkillDraft(null)}><Icon name="x" /></button>
        </div>
      )}

      {!isNewConversation && composer}
    </>
  );
}
function AgentMessage({
  mi, m, cumulativeCacheHitRate, onOpenCanvas, onOpenTurn, onStep, conciseMode, flash, onResend, onCreateSkill, actionDisabled,
  creatingSkill, reconnecting, loopPet,
}: {
  mi: number;
  m: Message;
  cumulativeCacheHitRate?: number;
  onOpenCanvas(name: string): void;
  onOpenTurn(): void;
  onStep(index: number): void;
  conciseMode: boolean;
  flash: boolean;
  onResend(): void;
  onCreateSkill(): void;
  actionDisabled: boolean;
  creatingSkill: boolean;
  reconnecting: boolean;
  loopPet: string | null;
}) {
  const live = m.status === 'running';
  const blocks = m.blocks ?? [];
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyText = blocks.length
    ? answerTextBlocks(blocks, conciseMode).map(block => block.text).join('\n\n')
    : [m.intro, m.outro].filter(Boolean).join('\n\n');
  const latestStep = [...(m.traj ?? [])].reverse().find(step => step.status === 'running')
    ?? m.traj?.at(-1);

  useEffect(() => () => {
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [menuOpen]);

  const copyAnswer = async () => {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setMenuOpen(false);
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const runAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <article className={`msg agent-msg${flash ? ' flash' : ''}`} data-testid="agent-message" data-msg={mi} aria-busy={live}>
      <div className="agent-head">
        <span className="agent-avatar"><PiIcon /></span>
        {live && (
          <span
            className={`stat${reconnecting ? ' reconnecting' : ''}`}
            data-testid={reconnecting ? 'agent-reconnecting' : 'agent-running-status'}
            role="status"
            aria-live="polite"
          >
            <span className="live" />
            {runningLabel(latestStep, reconnecting)}
          </span>
        )}
        {loopPet && <pre className="loop-pet" data-testid="loop-pet" aria-hidden="true">{loopPet}</pre>}
        <div className={`message-actions${menuOpen ? ' open' : ''}`} ref={menuRef}>
          <button
            ref={menuButtonRef}
            type="button"
            className={`message-more${copied ? ' copied' : ''}`}
            data-testid="message-more"
            aria-label={copied ? t('common.copied') : t('conversation.answerActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            <Icon name={copied ? 'check' : 'more'} />
          </button>
          {menuOpen && (
            <div className="message-action-menu" data-testid="message-action-menu" role="menu">
              <button type="button" role="menuitem" data-testid="message-copy" disabled={!copyText} onClick={() => void copyAnswer()}>
                <Icon name="copy" />{t('common.copy')}
              </button>
              <button type="button" role="menuitem" data-testid="message-resend" disabled={actionDisabled} onClick={() => runAction(onResend)}>
                <Icon name="refresh" />{t('conversation.regenerate')}
              </button>
              <button type="button" role="menuitem" data-testid="message-create-skill" disabled={live || actionDisabled || creatingSkill} onClick={() => runAction(onCreateSkill)}>
                <Icon name="blocks" />{creatingSkill ? t('common.creating') : t('conversation.createSkill')}
              </button>
              <button type="button" role="menuitem" data-testid="open-turn" onClick={() => runAction(onOpenTurn)}>
                <Icon name="route" />{t('conversation.runDetails')}
              </button>
            </div>
          )}
        </div>
      </div>

      <AgentAnswer
        artifacts={m.artifacts ?? []}
        blocks={blocks}
        steps={m.traj ?? []}
        intro={m.intro}
        outro={m.outro}
        live={live}
        conciseMode={conciseMode}
        onStep={onStep}
        onOpenArtifact={onOpenCanvas}
      />

      {m.stats && !live && <CompactStats stats={m.stats} cumulativeCacheHitRate={cumulativeCacheHitRate} />}
    </article>
  );
}

function runningLabel(step: TrajStep | undefined, reconnecting: boolean): string {
  if (reconnecting) return t('conversation.reconnecting');
  if (!step) return t('conversation.working');
  if (step.t === 'code') return `${step.shell === 'powershell' ? 'PowerShell' : 'Bash'}…`;
  const labels = {
    think: 'conversation.thinkingProgress',
    read: 'conversation.reading',
    search: 'conversation.searching',
    write: 'conversation.writing',
    analyze: 'conversation.analyzing',
    goal: 'conversation.processingGoal',
  } as const;
  const label = labels[step.t as keyof typeof labels];
  return label ? t(label) : t('conversation.working');
}

function AgentAnswer({
  artifacts, blocks, steps, intro, outro, live, conciseMode, onStep, onOpenArtifact,
}: {
  artifacts: Artifact[];
  blocks: AgentContentBlock[];
  steps: TrajStep[];
  intro?: string;
  outro?: string;
  live: boolean;
  conciseMode: boolean;
  onStep(index: number): void;
  onOpenArtifact(path: string): void;
}) {
  const textBlocks = answerTextBlocks(blocks, conciseMode);
  const hasOrderedSteps = blocks.some(block => block.kind === 'step');
  const flowBlocks: AgentContentBlock[] = hasOrderedSteps
    ? blocks
    : [
      ...(blocks.length ? blocks : intro ? [{ kind: 'text' as const, text: intro }] : []),
      ...steps.map((_, step) => ({ kind: 'step' as const, step })),
      ...(!blocks.length && outro && outro !== intro ? [{ kind: 'text' as const, text: outro }] : []),
    ];
  const finalArtifacts = artifacts.filter((artifact, index) => {
    const key = artifactPathKeys(artifact.path || artifact.name)[0];
    return artifacts.findIndex(candidate =>
      artifactPathKeys(candidate.path || candidate.name)[0] === key
    ) === index;
  });

  return (
    <div className="agent-answer" data-testid="agent-answer">
      {!conciseMode && (flowBlocks.length > 0 || steps.length > 0)
        ? (
          <AgentFlow
            blocks={flowBlocks}
            steps={steps}
            live={live}
            onStep={onStep}
            onOpenArtifact={onOpenArtifact}
          />
        )
        : textBlocks.length > 0
        ? textBlocks.map((block, index) => {
          const streaming = live && index === textBlocks.length - 1;
          return (
            <div className={`answer flow-text${streaming ? ' streaming' : ''}`} data-testid="flow-text" data-streaming={streaming || undefined} key={`text-${index}`}>
              {streaming ? <p>{block.text}</p> : <MdText className="md-body" text={block.text} />}
            </div>
          );
        })
        : (
          <>
            {intro && <div className="answer">{live ? <p>{intro}</p> : <MdText className="md-body" text={intro} />}</div>}
            {outro && outro !== intro && <div className="answer"><MdText className="md-body" text={outro} /></div>}
          </>
        )}
      {!live && finalArtifacts.length > 0 && (
        <div className="agent-artifacts" aria-label={t('conversation.artifacts')}>
          {finalArtifacts.map((artifact, index) => {
            const path = artifact.path || artifact.name;
            return (
              <button
                type="button"
                className="agent-artifact"
                data-testid="agent-artifact"
                data-artifact-path={path}
                key={`${path}-${index}`}
                onClick={() => onOpenArtifact(path)}
              >
                <span className={`agent-artifact-icon ftype-${artifact.type}`}><Icon name={artifactIcon(artifact.type)} /></span>
                <span className="flow-step-copy">
                  <b>{text(artifact.name)}</b>
                  {path !== artifact.name && <small>{text(path)}</small>}
                </span>
                <span className="flow-step-target" aria-hidden="true">
                  <span>{t('conversation.canvasTarget')}</span>
                  <Icon name="frame" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AgentFlow({
  blocks, steps, live, onStep, onOpenArtifact,
}: {
  blocks: AgentContentBlock[];
  steps: TrajStep[];
  live: boolean;
  onStep(index: number): void;
  onOpenArtifact(path: string): void;
}) {
  const onStepRef = useRef(onStep);
  const onOpenArtifactRef = useRef(onOpenArtifact);
  onStepRef.current = onStep;
  onOpenArtifactRef.current = onOpenArtifact;
  const openStep = useCallback((index: number, artifactPath?: string) => {
    if (artifactPath) onOpenArtifactRef.current(artifactPath);
    else onStepRef.current(index);
  }, []);

  return (
    <div className="agent-flow" data-testid="agent-flow" aria-label={t('conversation.agentTrajectory')}>
      {blocks.map((block, index) => {
        if (block.kind === 'text') {
          if (!block.text) return null;
          const streaming = live && index === blocks.length - 1;
          return (
            <div className={`answer flow-text${streaming ? ' streaming' : ''}`} data-testid="flow-text" data-streaming={streaming || undefined} key={`text-${index}`}>
              {streaming ? <p>{block.text}</p> : <MdText className="md-body" text={block.text} />}
            </div>
          );
        }
        const step = steps[block.step];
        if (!step) return null;
        return (
          <AgentFlowStep
            artifactPath={step.file}
            key={`step-${block.step}`}
            stepIndex={block.step}
            step={step}
            onOpen={openStep}
          />
        );
      })}
    </div>
  );
}

const AgentFlowStep = memo(function AgentFlowStep({
  artifactPath, stepIndex, step, onOpen,
}: {
  artifactPath?: string;
  stepIndex: number;
  step: TrajStep;
  onOpen(index: number, artifactPath?: string): void;
}) {
  const isThinking = step.t === 'think';
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const running = step.status === 'running';
  const thinkingText = isThinking ? (step.text || step.det) : '';
  const stepLabel = trajectoryLabel(step.t, step.shell);
  return (
    <div
      className={`flow-step-shell${isThinking ? ' think' : ''}`}
      data-testid="flow-step-shell"
      data-kind={step.t}
      data-status={step.status}
      data-expanded={isThinking ? thinkingOpen : undefined}
      data-artifact-path={artifactPath}
    >
      <button
        type="button"
        className={`flow-step${isThinking ? ' think' : ''}`}
        data-testid="flow-step"
        data-kind={step.t}
        data-status={step.status}
        aria-expanded={isThinking ? thinkingOpen : undefined}
        aria-label={isThinking
          ? t(thinkingOpen ? 'conversation.collapseThinking' : 'conversation.expandThinking')
          : artifactPath
            ? t('conversation.openArtifact', { path: artifactPath })
            : t('conversation.openTrajectory', { title: stepLabel })}
        onClick={isThinking ? () => setThinkingOpen(open => !open) : () => onOpen(stepIndex, artifactPath)}
      >
        <span className={`flow-step-icon ${step.status}`}><Icon name={trajIcon(step.t)} /></span>
        <span className="flow-step-copy"><b>{stepLabel}</b>{step.det && <small>{text(step.det)}</small>}</span>
        {(!isThinking || !running) && (
          <span className={`flow-step-status ${step.status}`} role="status" aria-live="polite">
            {running ? t('conversation.runningStatus') : <><Icon name="check" />{step.time}</>}
          </span>
        )}
        <span className={`flow-step-target${isThinking ? ' disclosure' : ''}`} aria-hidden="true">
          <span>{isThinking ? t(thinkingOpen ? 'common.close' : 'common.open') : t('conversation.canvasTarget')}</span>
          <Icon name={isThinking ? 'chevron' : 'frame'} />
        </span>
      </button>
      {thinkingOpen && thinkingText && (
        <div className="flow-thinking" data-testid="flow-thinking" aria-label={t('conversation.fullThinking')}>
          {text(thinkingText)}
        </div>
      )}
    </div>
  );
});

function answerTextBlocks(
  blocks: AgentContentBlock[],
  conciseMode: boolean,
): Array<Extract<AgentContentBlock, { kind: 'text' }>> {
  if (conciseMode) return finalAnswerTextBlocks(blocks);
  return blocks.filter(
    (block): block is Extract<AgentContentBlock, { kind: 'text' }> => block.kind === 'text' && !!block.text,
  );
}

function finalAnswerTextBlocks(blocks: AgentContentBlock[]): Array<Extract<AgentContentBlock, { kind: 'text' }>> {
  let lastStep = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].kind === 'step') {
      lastStep = index;
      break;
    }
  }
  const trailing = blocks.slice(lastStep + 1).filter(
    (block): block is Extract<AgentContentBlock, { kind: 'text' }> => block.kind === 'text' && !!block.text,
  );
  if (trailing.length) return trailing;
  if (lastStep >= 0) {
    for (let index = lastStep - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.kind === 'text' && block.text) return [block];
    }
  }
  return blocks.filter(
    (block): block is Extract<AgentContentBlock, { kind: 'text' }> => block.kind === 'text' && !!block.text,
  );
}

function CompactStats({ stats, cumulativeCacheHitRate }: {
  stats: NonNullable<Message['stats']>;
  cumulativeCacheHitRate?: number;
}) {
  const metrics = compactTurnMetrics(stats, cumulativeCacheHitRate);
  if (!metrics.length) return null;
  return (
    <div className="turn-stats" data-testid="turn-stats" aria-label={t('conversation.runMetrics')}>
      {metrics.map(metric => <span key={metric.label}><b>{metric.label}</b> {metric.value}</span>)}
    </div>
  );
}

function artifactPathKeys(path: string): string[] {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase();
  const leaf = normalized.split('/').at(-1);
  return leaf && leaf !== normalized ? [normalized, leaf] : [normalized];
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
  const {
    active,
    loading,
    steerQueue,
    openInCanvas,
    pendingAgentChanges,
    goal,
    intent,
    confirmIntent,
    dismissIntent,
  } = useWorkspace();
  const attachRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [intentBusy, setIntentBusy] = useState<'confirm' | 'dismiss' | null>(null);
  const [intentError, setIntentError] = useState('');
  const liveAgent = [...active.messages].reverse().find(message => message.role === 'agent' && message.status === 'running');
  const currentStep = liveAgent?.traj?.[liveAgent.traj.length - 1];
  const agentThinking = !!loading && currentStep?.t === 'think' && currentStep.status === 'running';
  const showSteerPanel = agentThinking && (!!value.trim() || !!steerDraft);
  const visibleIntent = intent && intent.status !== 'dismissed' && !intent.linkedGoalId ? intent : null;

  const confirmCurrentIntent = async () => {
    if (!visibleIntent) return;
    setIntentBusy('confirm');
    setIntentError('');
    const replace = visibleIntent.blockedReason === 'activeGoalConflict' || !!visibleIntent.replacesGoalId;
    const result = await confirmIntent(replace);
    if (!result.ok) setIntentError(result.error || t('conversation.confirmFailed'));
    setIntentBusy(null);
  };

  const dismissCurrentIntent = async () => {
    setIntentBusy('dismiss');
    setIntentError('');
    const result = await dismissIntent();
    if (!result.ok) setIntentError(result.error || t('conversation.cancelFailed'));
    setIntentBusy(null);
  };

  const reviseCurrentIntent = () => {
    const next = t('conversation.goalContractEdit');
    onChange(next);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(next.length, next.length);
    });
  };

  const attachFiles = async (files: File[]) => {
    const attached: ComposerAttachment[] = [];
    for (const file of files) {
      try {
        if (!active.id) continue;
        const result = await importWorkspaceFile(active.id, file);
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
      {visibleIntent && (
        <section
          className={`intent-card ${visibleIntent.status}`}
          data-testid="goal-contract"
          aria-label={t('conversation.goalContract')}
        >
          <div className="intent-card-head">
            <span><b>{t('conversation.goalContract')}</b><small>{t('conversation.revision', { revision: visibleIntent.revision })}</small></span>
            <em>
              {visibleIntent.status === 'confirmed' ? t('conversation.intentConfirmed')
                : visibleIntent.status === 'clarifying' ? t('conversation.intentClarifying', { round: visibleIntent.clarificationRound })
                  : visibleIntent.blockedReason === 'activeGoalConflict' ? t('conversation.intentReplace')
                    : visibleIntent.status === 'blocked' ? t('conversation.intentBlocked')
                      : t('conversation.intentAwaiting')}
            </em>
          </div>
          <h3>{text(visibleIntent.objective)}</h3>
          {visibleIntent.status === 'clarifying' && visibleIntent.openQuestions.length > 0 ? (
            <ol className="intent-questions">
              {visibleIntent.openQuestions.map(question => (
                <li key={question.id}>
                  {text(question.prompt)}
                  {question.recommendation && <small>{t('conversation.recommendation', { value: question.recommendation })}</small>}
                </li>
              ))}
            </ol>
          ) : (
            <details>
              <summary>{t('conversation.intentDetails')}</summary>
              <div className="intent-contract-grid">
                <ContractItems title={t('conversation.deliverables')} items={visibleIntent.deliverables} />
                <ContractItems title={t('conversation.acceptance')} items={visibleIntent.acceptanceCriteria} />
                <ContractItems title={t('conversation.constraints')} items={visibleIntent.constraints} empty={t('conversation.noConstraints')} />
                <ContractItems title={t('conversation.verification')} items={visibleIntent.verificationPlan} />
              </div>
            </details>
          )}
          {visibleIntent.blockedReason === 'activeGoalConflict' && (
            <p className="intent-warning">{t('conversation.activeGoalConflict')}</p>
          )}
          {intentError && <p className="intent-error" role="alert">{text(intentError)}</p>}
          {visibleIntent.status !== 'confirmed' ? (
            <div className="intent-actions">
              {(visibleIntent.status === 'awaitingConfirmation' || visibleIntent.blockedReason === 'activeGoalConflict') && (
                <button
                  type="button"
                  className="intent-confirm"
                  data-testid="goal-contract-confirm"
                  disabled={intentBusy !== null}
                  onClick={() => void confirmCurrentIntent()}
                >
                  {intentBusy === 'confirm' ? t('conversation.confirming')
                    : visibleIntent.blockedReason === 'activeGoalConflict' ? t('conversation.confirmReplace')
                      : t('conversation.confirmStart')}
                </button>
              )}
              <button type="button" data-testid="goal-contract-revise" disabled={intentBusy !== null} onClick={reviseCurrentIntent}>{t('conversation.revise')}</button>
              <button type="button" data-testid="goal-contract-dismiss" disabled={intentBusy !== null} onClick={() => void dismissCurrentIntent()}>
                {intentBusy === 'dismiss' ? t('conversation.cancelling') : t('common.cancel')}
              </button>
            </div>
          ) : (
            <div className="intent-actions">
              <button
                type="button"
                className="intent-confirm"
                data-testid="goal-contract-retry"
                disabled={intentBusy !== null || loading}
                onClick={() => void confirmCurrentIntent()}
              >
                {loading ? t('conversation.creatingGoal') : intentBusy === 'confirm' ? t('conversation.retrying') : t('conversation.retryCreate')}
              </button>
            </div>
          )}
        </section>
      )}
      {goal && goal.status !== 'complete' && (
        <div className={`goal-status ${goal.status}`} role="status">
          <span className="goal-status-dot" />
          <span className="goal-status-copy"><b>{term('goal')}</b><small>{text(goal.objective)}</small></span>
          {goal.status === 'active' && <button type="button" data-testid="goal-pause">{t('conversation.goalPaused')}</button>}
        </div>
      )}
      {mentionMatches.length > 0 && (
        <div id="composer-mention-menu" className="slash-menu" data-testid="slash-menu" role="listbox" aria-label={mentionMatches[0]?.kind === 'file' ? t('files.tree') : t('top.localSkills')}>
          <div className="slash-menu-label">{mentionMatches[0]?.kind === 'file' ? t('files.tree') : t('conversation.commands')}<span>{t('conversation.suggestionInsert')}</span></div>
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
              <span className="slash-kind">{it.kind === 'skill' ? t('conversation.local') : it.desc}</span>
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
        {dragging && <div className="composer-drop" data-testid="composer-drop"><FileUploadIcon />{t('conversation.dropReference')}</div>}
        {showSteerPanel && (
          <div className="steer-panel" data-testid="steer-panel" role="status">
            <span className="steer-title"><Icon name="send" />STEER</span>
            <span className="steer-help">{t('conversation.steerHint')}</span>
            {steerQueue.length > 0 && (
              <div className="steer-queue" data-testid="steer-queue">
                {steerQueue.map(item => <span key={item.id}><b>{t('conversation.queued')}</b>{text(item.text)}</span>)}
              </div>
            )}
          </div>
        )}
        {steerDraft && (
          <div className="steer-draft" data-testid="steer-draft" role="status">
            <span className="steer-draft-copy"><b>{t('conversation.steerPending')}</b><small>{text(steerDraft)}</small></span>
            <button type="button" className="steer-draft-confirm" data-testid="steer-confirm" onClick={onConfirmSteer}>{t('conversation.confirmInsert')}</button>
            <button type="button" className="steer-draft-cancel" data-testid="steer-cancel" aria-label={t('conversation.cancelPending')} onClick={onCancelSteer}><Icon name="x" /></button>
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
          <div className="composer-attachments" data-testid="composer-attachments" aria-label={t('conversation.attachedFiles')}>
            {attachments.map(attachment => (
              <div className="composer-attachment" data-testid="composer-attachment" key={attachment.id}>
                <button type="button" className="composer-attachment-open" title={t('conversation.openAttachment', { path: attachment.path })} onClick={() => void openInCanvas(attachment.path)}>
                  <span className="composer-attachment-icon"><Icon name={fileIcon(attachment.type)} /></span>
                  <span className="composer-attachment-copy"><b>{text(attachment.name)}</b><small>{t('conversation.addedToWorkspace')}</small></span>
                </button>
                <button type="button" className="composer-attachment-remove" data-testid="composer-attachment-remove" title={t('conversation.removeAttachment', { name: attachment.name })} aria-label={t('conversation.removeAttachment', { name: attachment.name })} onClick={() => onRemoveAttachment(attachment.id)}><Icon name="x" /></button>
              </div>
            ))}
          </div>
        )}
      {pendingAgentChanges.length > 0 && (
          <div className="composer-agent-context" data-testid="composer-agent-context" role="status">
            <span><Icon name="edit" /><b>{t('conversation.canvasChangesKnown')}</b></span>
            <small>{t('conversation.syncedNextMessage', { paths: pendingAgentChanges.map(change => change.path).join(', ') })}</small>
          </div>
      )}
        <textarea
          data-testid="composer-input"
          className={loading ? 'steer-input' : undefined}
          ref={taRef}
          placeholder={loading ? t('conversation.steerPlaceholder') : t('conversation.taskPlaceholder')}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-controls={mentionMatches.length ? 'composer-mention-menu' : undefined}
          aria-activedescendant={mentionMatches.length ? `mention-option-${mentionIndex}` : undefined}
        />
        <div className="composer-tools">
          <button className="pill" data-testid="composer-attach" onClick={() => attachRef.current?.click()}><FileUploadIcon />{t('conversation.attach')}</button>
          <button
            type="button"
            className={`pill goal-pill${goal || /^\/goal(?:\s|$)/i.test(value) ? ' on active' : ''}`}
            data-testid="goal-toggle"
            aria-pressed={goal !== null || /^\/goal(?:\s|$)/i.test(value)}
            onClick={() => {
              const next = /^\/goal(?:\s|$)/i.test(value)
                ? value.replace(/^\/goal\s*/i, '')
                : `/goal ${value}`;
              onChange(next);
              requestAnimationFrame(() => {
                taRef.current?.focus();
                taRef.current?.setSelectionRange(next.length, next.length);
              });
            }}
          >
            <Icon name="target" />{term('goal')}
          </button>

          <span className="spacer" />
          <button className={`send${loading ? ' steering' : ''}`} data-testid="composer-send" aria-label={loading ? t('conversation.queueInstruction') : t('conversation.send')} disabled={!value.trim()} onClick={onSend}>
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ContractItems({ title, items, empty = t('common.none') }: { title: string; items: string[]; empty?: string }) {
  return (
    <div>
      <b>{title}</b>
      {items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{text(item)}</li>)}</ul> : <small>{empty}</small>}
    </div>
  );
}

function EmptyState({ composer }: { composer: React.ReactNode }) {
  const aida = readBrand(document.documentElement) === 'aida';
  return (
    <div className="empty" style={{ height: '100%' }}>
      <div className="empty-welcome-lockup">
        <div className="empty-pi-banner" aria-hidden="true"><PiIcon /></div>
        <h2>{t(aida ? 'conversation.newTaskAida' : 'conversation.newTask')}</h2>
      </div>
      {composer}
    </div>
  );
}
