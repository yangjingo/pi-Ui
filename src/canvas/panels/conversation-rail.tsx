import { useEffect } from 'react';
import { Icon, PiIcon, t } from '../../ui';
import { useWorkspace } from '../../workspace';

export function ConversationRail() {
  const { loading, hasUnreadCompletions, setCanvasFocused } = useWorkspace();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      setCanvasFocused(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setCanvasFocused]);

  return (
    <nav className="conversation-rail" aria-label={t('rail.navigation')}>
      <span className="conversation-rail-logo" aria-hidden="true"><PiIcon /></span>
      <button
        type="button"
        data-testid="conversation-rail-return"
        aria-label={t('rail.back')}
        title={t('rail.backWithEsc')}
        onClick={() => setCanvasFocused(false)}
      >
        <Icon name="chat" />
      </button>
      <span className="conversation-rail-grow" />
      {(loading || hasUnreadCompletions) && (
        <span
          className={`conversation-rail-status${loading ? ' running' : ' unread'}`}
          role="status"
          aria-label={loading
            ? t('rail.agentRunning')
            : t('rail.unreadCompletion')}
        />
      )}
    </nav>
  );
}
