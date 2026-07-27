// UI/UX layer — the "会话管理" full-page view. Lists sessions grouped by group, with search,
// rename/delete, new chat. Selecting a session returns to the chat view.

import { useState } from 'react';
import { Icon, text } from '../../ui';
import { useWorkspace } from '../../workspace';

export function SessionPanel() {
  const { sessions, activeId, search, switchSession, newChat, renameSession, delSession, setSearch, setView } = useWorkspace();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const groups: { g: string; items: typeof sessions }[] = [];
  const order: string[] = [];
  const filter = search.trim().toLowerCase();
  for (const s of sessions) {
    if (filter && !s.title.toLowerCase().includes(filter)) continue;
    if (!order.includes(s.group)) { order.push(s.group); groups.push({ g: s.group, items: [] }); }
    groups[groups.length - 1].items.push(s);
  }

  const onRename = (id: string, cur: string) => {
    const v = window.prompt('重命名会话', cur);
    if (v && v.trim()) renameSession(id, v);
  };

  return (
    <>
      <div className="drawer-head">
        <span>对话历史</span>
        <button className="drawer-new" data-testid="new-chat" onClick={() => void newChat()}><Icon name="plus" />新建对话</button>
      </div>
      <div className="side-search">
        <span className="ico"><Icon name="search" /></span>
        <input data-testid="session-search" placeholder="搜索会话…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="session-list" data-testid="session-list">
        {groups.length === 0 && (
          <div style={{ padding: '20px 10px', color: 'var(--content-tertiary)', fontSize: 12, textAlign: 'center' }}>没有匹配的会话</div>
        )}
        {groups.map(({ g, items }) => (
          <div key={g}>
            <div className="session-group">{g}</div>
            {items.map(s => (
              <div
                key={s.id}
                className={`session${s.id === activeId ? ' active' : ''}`}
                data-testid="session-item"
                onClick={(e) => {
                  const act = (e.target as HTMLElement).closest('[data-act]');
                  if (act) {
                    e.stopPropagation();
                    if (act.getAttribute('data-act') === 'rename') {
                      setPendingDelete(null);
                      onRename(s.id, s.title);
                    } else setPendingDelete(s.id);
                    return;
                  }
                  if (pendingDelete === s.id) return;
                  switchSession(s.id);
                  void setView('chat');
                }}
              >
                <div className="s-title">{text(s.title)}</div>
                <div className="s-meta">
                  {s.live && <span className="s-dot" />}
                  <span className="s-time">{s.time}</span>
                </div>
                {pendingDelete === s.id ? (
                  <div className="session-confirm" role="alertdialog" aria-label={`删除会话 ${s.title}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setPendingDelete(null); }}>
                    <span>删除这个会话？</span>
                    <button autoFocus onClick={() => setPendingDelete(null)}>取消</button>
                    <button className="destructive" data-testid="session-delete-confirm" onClick={() => { void delSession(s.id).then(ok => { if (ok) setPendingDelete(null); }); }}>删除</button>
                  </div>
                ) : (
                  <span className="s-acts">
                    <button data-act="rename" title="重命名" aria-label={`重命名会话 ${s.title}`}><Icon name="pencil" /></button>
                    <button data-act="del" title="删除" aria-label={`删除会话 ${s.title}`}><Icon name="trash" /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
