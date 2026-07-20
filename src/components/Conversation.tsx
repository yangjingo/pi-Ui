import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { Message, FileNode } from '../../core/types';
import { Icon } from '../icons';
import { esc, fmtMs } from '../render';
import { trajIcon, fileIcon } from '../icons';
import { finalArtifact } from '../../core/util';
import { useWorkspace } from '../workspace';
import { agentClient } from '../agentClient';
import { MdText } from './MdText';
import { useSkills, skillEntryBody } from '../skills';

interface MentionItem {
  kind: 'skill' | 'file';
  id: string;
  name: string;
  desc: string;
  icon: string;
  body?: string;
}

export function Conversation() {
  const { active, showStep, openInCanvas, openTurn, sendMessage, flashMsg, setFlashMsg, error, loading } = useWorkspace();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [input, setInput] = useState('');
  const [sendTick, setSendTick] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (flashMsg == null || !dialogRef.current) return;
    const node = dialogRef.current.querySelector(`[data-msg="${flashMsg}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setFlashMsg(null), 1400);
    return () => clearTimeout(t);
  }, [flashMsg, setFlashMsg]);

  useEffect(() => {
    if (sendTick && dialogRef.current) dialogRef.current.scrollTop = dialogRef.current.scrollHeight;
  }, [sendTick]);

  // keep the bottom in view while the agent streams
  useEffect(() => {
    if (loading && dialogRef.current) dialogRef.current.scrollTop = dialogRef.current.scrollHeight;
  }, [loading, active.messages]);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '26px';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  };

  const onSend = () => {
    const v = input.trim();
    if (!v) return;
    sendMessage(v);
    setInput('');
    if (taRef.current) taRef.current.style.height = '26px';
    setSendTick(t => t + 1);
  };

  const skills = useSkills();
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
      return skills
        .filter(s => !q || s.name.toLowerCase().includes(q) || (s.desc || '').toLowerCase().includes(q))
        .slice(0, 6)
        .map(s => ({ kind: 'skill' as const, id: s.id, name: s.name, desc: s.desc || '', icon: 'spark', body: skillEntryBody(s) }));
    }
    return files
      .filter(f => !q || f.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map(f => ({ kind: 'file' as const, id: f.path, name: f.name, desc: f.type, icon: fileIcon(f.type) }));
  }, [mention, skills, files]);
  const pickMention = (item: MentionItem) => {
    if (!mention) return;
    const before = input.slice(0, mention.at);
    const after = input.slice(mention.at + 1 + mention.query.length);
    const tail = after === '' || after.startsWith(' ') ? '' : ' ';
    // "/" injects the skill body; "@" leaves an @name reference tag (expanded on send).
    const injection = item.kind === 'skill' ? (item.body || '') + tail : '@' + item.name + tail;
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
    } else setMention(null);
  };
  const onKeyDownInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatches.length) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pickMention(mentionMatches[0]); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  const messages = active.messages ?? [];
  const dateLabel = active.group === '今天' ? `TODAY · ${active.time}` : (active.group?.toUpperCase() ?? '');

  return (
    <>
      <div className="dialog scroll" ref={dialogRef} data-testid="conversation">
        {messages.length === 0 ? (
          <EmptyState onPick={(t) => { setInput(t); taRef.current?.focus(); }} />
        ) : (
          <>
            {dateLabel && <div className="date-sep">{dateLabel}</div>}
            {messages.map((m, mi) =>
              m.role === 'user' ? (
                <article key={mi} className="msg user" data-testid="user-message" data-msg={mi}>
                  <div className="bubble"><p>{esc(m.text)}</p></div>
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
                />
              )
            )}
          </>
        )}
      </div>

      {error && (
        <div data-testid="error-bar" style={{
          position: 'absolute', left: 0, right: 0, bottom: 168, margin: '0 auto', maxWidth: 640,
          padding: '8px 14px', border: '1px solid var(--border-strong)', borderRadius: 6,
          background: 'var(--error-soft)', color: 'var(--error)', fontSize: 12.5, lineHeight: 1.5,
          textAlign: 'center', pointerEvents: 'auto',
        }}>{esc(error)}</div>
      )}

      <Composer
        value={input}
        taRef={taRef}
        mentionMatches={mentionMatches}
        onPickMention={pickMention}
        onChange={onChangeInput}
        onKeyDown={onKeyDownInput}
        onSend={onSend}
      />
    </>
  );
}

function AgentMessage({
  mi, m, open, onToggle, onStep, onOpenCanvas, onOpenTurn, flash
}: {
  mi: number;
  m: Message;
  open: boolean;
  onToggle(): void;
  onStep(si: number): void;
  onOpenCanvas(name: string): void;
  onOpenTurn(): void;
  flash: boolean;
}) {
  const live = m.status === 'running';
  const traj = m.traj ?? [];
  return (
    <article className={`msg${flash ? ' flash' : ''}`} data-testid="agent-message" data-msg={mi}>
      <div
        className="agent-head"
        data-testid="open-turn"
        title="查看本轮执行报告"
        onClick={onOpenTurn}
      >
        <div className="agent-avatar"><Icon name="spark" /></div>
        <div><div className="who">Pi</div></div>
        <div className="stat">
          {live ? <><span className="live" />正在执行任务…</> : <><Icon name="check" /> 已完成</>}
        </div>
        <span className="head-arr" title="执行报告">报告 ↗</span>
      </div>
      {m.intro && (
        <div className="answer">
          {live ? <p>{m.intro}<span className="caret" /></p> : <MdText className="md-body" text={m.intro} />}
        </div>
      )}
      {traj.length > 0 && (
        <section className={`traj${open ? '' : ' collapsed'}`} data-testid="trajectory">
          <div className="traj-head" data-testid="traj-toggle" onClick={onToggle}>
            <span className="tico"><Icon name="route" /></span>
            <span className="t-title">Agent 执行轨迹</span>
            <span className="t-count">{traj.length} 步</span>
            <span className="spacer" />
            <span className={`badge ${live ? 'live' : 'done'}`}>{live ? 'LIVE' : '已完成'}</span>
            <span className="chev"><Icon name="chevron" className="chev" /></span>
          </div>
          <div className="traj-body"><div className="tbody">
            {traj.map((s, i) => (
              <div key={i} className={`trow${s.t === 'think' ? ' think' : ''}`} data-testid="traj-row" data-kind={s.t} onClick={() => onStep(i)}>
                <span className="rail" />
                <span className={`ticon ${s.status}`}><Icon name={trajIcon(s.t)} /></span>
                <div className="tmain"><b>{esc(s.title)}</b><div className="tdet">{esc(s.det)}</div></div>
                <span className="ttime">{s.time}</span>
              </div>
            ))}
          </div></div>
        </section>
      )}
      {m.outro && <div className="answer"><MdText className="md-body" text={m.outro} /></div>}
      {(m.artifacts ?? []).map((ar, i) => (
        <div className="out-card" key={i}>
          <div className="out-thumb"><Icon name={fileIcon(ar.type)} /></div>
          <div className="out-meta"><b>{esc(ar.name)}</b><span>{esc(ar.label)} · 刚刚生成</span></div>
          <button className="out-open" data-testid="open-canvas" onClick={() => onOpenCanvas(ar.name)}>
            在 Canvas 中打开 <Icon name="frame" />
          </button>
        </div>
      ))}
      <div className="msg-acts">
        <button><Icon name="copy" /> 复制</button>
        <button><Icon name="refresh" /> 重新生成</button>
        <button><Icon name="thumbs" /> 有用</button>
      </div>
      {m.stats && !live && (
        <div className="turn-stats" data-testid="turn-stats">
          <span><b>TTFT</b> {fmtMs(m.stats.ttft)}</span>
          <span><b>TPOT</b> {m.stats.tpot > 0 ? `${m.stats.tpot.toFixed(0)}ms/tok` : '—'}</span>
          <span><b>输出</b> {m.stats.output} tok</span>
          <span><b>输入</b> {m.stats.input} tok</span>
          <span><b>耗时</b> {(m.stats.duration / 1000).toFixed(1)}s</span>
        </div>
      )}
    </article>
  );
}

function Composer({
  value, onChange, onKeyDown, onSend, taRef, mentionMatches, onPickMention,
}: {
  value: string;
  onChange(v: string): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  onSend(): void;
  taRef: React.RefObject<HTMLTextAreaElement>;
  mentionMatches: MentionItem[];
  onPickMention(item: MentionItem): void;
}) {
  const { loading, thinking, toggleThinking } = useWorkspace();
  return (
    <div className="composer-wrap">
      {mentionMatches.length > 0 && (
        <div className="slash-menu" data-testid="slash-menu">
          {mentionMatches.map(it => (
            <button
              key={it.kind + it.id}
              className="slash-item"
              data-testid="slash-item"
              type="button"
              onClick={() => onPickMention(it)}
            >
              <span className="slash-ico"><Icon name={it.icon} /></span>
              <span className="slash-name">{it.kind === 'skill' ? '/' : '@'}{it.name}</span>
              {it.desc && <span className="slash-desc">{it.desc}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="composer">
        <textarea
          data-testid="composer-input"
          ref={taRef}
          placeholder="尽管问，或做个 Agent 任务…"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-tools">
          <button className="pill"><Icon name="paperclip" />附件</button>
          <button
            className={`pill${thinking ? ' on' : ''}`}
            data-testid="think-toggle"
            aria-pressed={thinking}
            onClick={toggleThinking}
          >
            <Icon name="brain" />思考
          </button>
          <span className="spacer" />
          <button className={`send${loading ? ' loading' : ''}`} data-testid="composer-send" disabled={!value.trim() || loading} onClick={onSend}>
            <Icon name="send" />
          </button>
        </div>
      </div>
      <div className="composer-hint">{loading ? 'Agent 执行中…' : 'Enter 发送 · Shift+Enter 换行'}</div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick(t: string): void }) {
  const suggests = [
    { t: '在 workspace 里写一个 README.md，介绍这个项目', b: '写文档', s: '让 Agent 生成一个 Markdown 文件' },
    { t: '生成一份示例 CSV 预算表 budget.csv', b: '做表格', s: '生成可在 Canvas 查看的数据表' },
    { t: '写一个 self-contained 的交互 HTML 报告', b: '写代码', s: '生成可在 Canvas 中交互的页面' },
    { t: '读取 workspace 目录下的文件并列出来', b: '探查文件', s: '用 Agent 工具查看本地文件' },
  ];
  return (
    <div className="empty" style={{ height: '100%' }}>
      <div className="ico"><Icon name="spark" /></div>
      <h2>开始一个新的 Agent 任务</h2>
      <p>由 Pi 驱动。告诉它你想做什么，它会调用工具、把成果写进右侧工作区。</p>
      <div className="suggest">
        {suggests.map((x, i) => (
          <button key={i} onClick={() => onPick(x.t)}><b>{x.b}</b>{x.s}</button>
        ))}
      </div>
      <button className="demo-btn" data-testid="load-demo" onClick={() => void agentClient.loadDemo()}>
        <Icon name="database" />载入示例数据（预览报告与联动）
      </button>
    </div>
  );
}
