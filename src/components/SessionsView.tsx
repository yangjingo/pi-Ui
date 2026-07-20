// UI/UX layer — the "会话管理" full-page view. Lists sessions grouped by group, with search,
// rename/delete, new chat. Selecting a session returns to the chat view.

import { Icon } from '../icons';
import { esc } from '../render';
import { useWorkspace } from '../workspace';

export function SessionsView() {
  const { sessions, activeId, search, switchSession, newChat, renameSession, delSession, setSearch, setView } = useWorkspace();

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
        <button className="drawer-new" data-testid="new-chat" onClick={() => { newChat(); setView('chat'); }}><Icon name="plus" />新建对话</button>
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
                    if (act.getAttribute('data-act') === 'rename') onRename(s.id, s.title);
                    else delSession(s.id);
                    return;
                  }
                  switchSession(s.id);
                  setView('chat');
                }}
              >
                <div className="s-title">{esc(s.title)}</div>
                <div className="s-meta">
                  {s.live && <span className="s-dot" />}
                  <span className="s-time">{s.time}</span>
                </div>
                <span className="s-acts">
                  <button data-act="rename" title="重命名"><Icon name="pencil" /></button>
                  <button data-act="del" title="删除"><Icon name="trash" /></button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
