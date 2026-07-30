import { Icon } from '../../ui';
import { useWorkspace, type View } from '../../workspace';

// TopBar is the navigation strip shared by chat and configuration workbenches. Clicking an
// The active destination returns to chat; model details open in the right-hand Canvas.
export function TopBar() {
  const { view, setView, wsOpen, setWsOpen, hasUnreadCompletions } = useWorkspace();

  const go = (v: View) => { void setView(view === v ? 'chat' : v); };

  return (
    <header className="topbar">
      <div className="crumb">
        <button
          className={`icon-btn session-status-trigger${view === 'sessions' ? ' on' : ''}${hasUnreadCompletions ? ' has-completed' : ''}`}
          data-testid="session-switcher"
          title={hasUnreadCompletions ? '有后台 Session 已完成' : '会话管理'}
          aria-label={hasUnreadCompletions ? '会话管理，有后台 Session 已完成' : '会话管理'}
          onClick={() => go('sessions')}
        >
          <Icon name="chat" />
          {hasUnreadCompletions && <span className="session-complete-pulse" data-testid="session-complete-pulse" aria-hidden="true" />}
        </button>
        <button className={`icon-btn${view === 'skill' ? ' on' : ''}`} data-testid="skill-hub" title="本地 Skill Hub" aria-label="本地 Skill Hub" onClick={() => go('skill')}><Icon name="blocks" /></button>
        <button className={`icon-btn${view === 'model' ? ' on' : ''}`} data-testid="model-center" title="模型配置" aria-label="模型配置" onClick={() => go('model')}><Icon name="cpu" /></button>
      </div>
      <div className="top-actions">
        <button className={`icon-btn${wsOpen ? ' on' : ''}`} data-testid="ws-toggle" title={wsOpen ? '隐藏工作区' : '显示工作区'} aria-label={wsOpen ? '隐藏工作区' : '显示工作区'} onClick={() => void setWsOpen(!wsOpen)} disabled={view !== 'chat'}><Icon name="panel" /></button>
      </div>
    </header>
  );
}
