// UI/UX layer — the "会话管理" full-page view. Lists sessions grouped by group, with search,
// rename/delete, new chat. Selecting a session returns to the chat view.

import { useState } from 'react';
import { Icon, relativeTimeLabel, sessionGroupLabel, t, text } from '../../ui';
import { matchesSessionSearch, sessionDisplayId, useWorkspace } from '../../workspace';

export function SessionPanel() {
  const { sessions, activeId, search, switchSession, newChat, renameSession, delSession, isSessionUnread, setSearch } = useWorkspace();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  const groups: { g: string; items: typeof sessions }[] = [];
  const order: string[] = [];
  for (const s of sessions) {
    if (!matchesSessionSearch(s, search)) continue;
    if (!order.includes(s.group)) { order.push(s.group); groups.push({ g: s.group, items: [] }); }
    groups[groups.length - 1].items.push(s);
  }

  const onRename = (id: string, cur: string) => {
    const v = window.prompt(t('session.renamePlaceholder'), cur);
    if (v && v.trim()) renameSession(id, v);
  };

  const onDelete = async (id: string) => {
    setDeleteBusy(id);
    setDeleteError(null);
    const result = await delSession(id);
    setDeleteBusy(null);
    if (result.ok) {
      setPendingDelete(null);
      return;
    }
    setDeleteError({ id, message: result.error || t('session.deleteFailed') });
  };

  return (
    <>
      <div className="drawer-head">
        <span>{t('session.title')}</span>
        <button className="drawer-new" data-testid="new-chat" onClick={() => void newChat()}><Icon name="plus" />{t('session.new')}</button>
      </div>
      <div className="side-search">
        <span className="ico"><Icon name="search" /></span>
        <input data-testid="session-search" placeholder={t('session.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="session-list" data-testid="session-list">
        {groups.length === 0 && (
          <div style={{ padding: '20px 10px', color: 'var(--content-tertiary)', fontSize: 12, textAlign: 'center' }}>{t('session.noMatches')}</div>
        )}
        {groups.map(({ g, items }) => (
          <div key={g}>
            <div className="session-group">{sessionGroupLabel(g)}</div>
            {items.map(s => (
              <div
                key={s.id}
                className={`session is-${s.status}${s.id === activeId ? ' active' : ''}${isSessionUnread(s.id) ? ' unread-complete' : ''}`}
                data-testid="session-item"
                data-session-status={s.status}
                onClick={(e) => {
                  const act = (e.target as HTMLElement).closest('[data-act]');
                  if (act) {
                    e.stopPropagation();
                    if (act.getAttribute('data-act') === 'rename') {
                      setPendingDelete(null);
                      setDeleteError(null);
                      onRename(s.id, s.title);
                    } else {
                      setPendingDelete(s.id);
                      setDeleteError(null);
                    }
                    return;
                  }
                  if (pendingDelete === s.id) return;
                  void switchSession(s.id);
                }}
              >
                <div className="s-title">{text(s.title)}</div>
                <div className="s-meta">
                  {s.status === 'running' && <span className="s-dot is-running" title={t('session.backgroundRunning')} />}
                  {isSessionUnread(s.id) && <span className="s-dot is-complete" title={t('session.unreadComplete')} />}
                  {s.status === 'error' && <span className="s-dot is-error" title={t('session.backgroundError')} />}
                  <span className="s-time">{relativeTimeLabel(s.time)}</span>
                  <span className="s-id" data-testid="session-id" title={sessionDisplayId(s)}>{sessionDisplayId(s)}</span>
                </div>
                {pendingDelete === s.id ? (
                  <div className="session-confirm" role="alertdialog" aria-label={t('session.permanentDelete', { title: s.title })} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !deleteBusy) setPendingDelete(null); }}>
                    <span role={deleteError?.id === s.id ? 'alert' : undefined}>
                      {deleteError?.id === s.id ? deleteError.message : t('session.confirmDelete', { title: s.title })}
                    </span>
                    <button autoFocus disabled={deleteBusy === s.id} onClick={() => { setPendingDelete(null); setDeleteError(null); }}>{t('common.cancel')}</button>
                    <button
                      className="destructive"
                      data-testid="session-delete-confirm"
                      disabled={deleteBusy === s.id}
                      onClick={() => void onDelete(s.id)}
                    >
                      {deleteBusy === s.id ? t('session.deleting') : t('common.delete')}
                    </button>
                  </div>
                ) : (
                  <span className="s-acts">
                    <button data-act="rename" title={t('common.rename')} aria-label={t('session.rename', { title: s.title })}><Icon name="pencil" /></button>
                    <button
                      data-act="del"
                      data-testid="session-delete"
                      disabled={s.status === 'running'}
                      title={s.status === 'running' ? t('session.runningDeleteTitle') : t('common.delete')}
                      aria-label={s.status === 'running' ? t('session.runningCannotDelete', { title: s.title }) : t('session.delete', { title: s.title })}
                    >
                      <Icon name="trash" />
                    </button>
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
