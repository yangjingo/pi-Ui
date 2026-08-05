import { Icon, t } from '../../ui';
import { useWorkspace, type View } from '../../workspace';
import { preloadConfigView } from './config-preload';

// TopBar is the navigation strip shared by chat and configuration workbenches. Clicking an
// The active destination returns to chat; model details open in the right-hand Canvas.
export function TopBar() {
  const { view, setView, wsOpen, setWsOpen, hasUnreadCompletions } = useWorkspace();

  const go = (v: View) => { void setView(view === v ? 'chat' : v); };
  const warm = (v: View) => { void preloadConfigView(v); };

  return (
    <header className="topbar">
      <div className="crumb">
        <button
          className={`icon-btn session-status-trigger${view === 'sessions' ? ' on' : ''}${hasUnreadCompletions ? ' has-completed' : ''}`}
          data-testid="session-switcher"
          title={hasUnreadCompletions ? t('top.backgroundComplete') : t('top.sessions')}
          aria-label={hasUnreadCompletions ? t('top.sessionsBackgroundComplete') : t('top.sessions')}
          onClick={() => go('sessions')}
        >
          <Icon name="chat" />
          {hasUnreadCompletions && <span className="session-complete-pulse" data-testid="session-complete-pulse" aria-hidden="true" />}
        </button>
        <button className={`icon-btn${view === 'skill' ? ' on' : ''}`} data-testid="skill-hub" title={t('top.localSkills')} aria-label={t('top.localSkills')} onPointerEnter={() => warm('skill')} onFocus={() => warm('skill')} onClick={() => go('skill')}><Icon name="blocks" /></button>
        <button className={`icon-btn${view === 'model' ? ' on' : ''}`} data-testid="model-center" title={t('top.modelConfiguration')} aria-label={t('top.modelConfiguration')} onPointerEnter={() => warm('model')} onFocus={() => warm('model')} onClick={() => go('model')}><Icon name="cpu" /></button>
      </div>
      <div className="top-actions">
        <button className={`icon-btn${wsOpen ? ' on' : ''}`} data-testid="ws-toggle" title={wsOpen ? t('top.hideWorkspace') : t('top.showWorkspace')} aria-label={wsOpen ? t('top.hideWorkspace') : t('top.showWorkspace')} onClick={() => void setWsOpen(!wsOpen)} disabled={view !== 'chat'}><Icon name="panel" /></button>
      </div>
    </header>
  );
}
