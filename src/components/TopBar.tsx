import { Icon } from '../icons';
import { useWorkspace, type View } from '../workspace';

// TopBar is just the navigation strip. The three left buttons switch the main area between
// full-page config views (会话 / 模型 / SkillHub) and the chat — no modals/overlays. Clicking the
// active view's button returns to chat.
export function TopBar() {
  const { view, setView, wsOpen, setWsOpen } = useWorkspace();

  const go = (v: View) => setView(view === v ? 'chat' : v);

  return (
    <header className="topbar">
      <div className="crumb">
        <button className={`icon-btn${view === 'sessions' ? ' on' : ''}`} data-testid="session-switcher" title="会话管理" onClick={() => go('sessions')}><Icon name="chat" /></button>
        <button className={`icon-btn${view === 'model' ? ' on' : ''}`} data-testid="model-center" title="模型配置" onClick={() => go('model')}><Icon name="cpu" /></button>
        <button className={`icon-btn${view === 'skill' ? ' on' : ''}`} data-testid="skill-hub" title="Skill Hub" onClick={() => go('skill')}><Icon name="blocks" /></button>
      </div>
      <div className="top-actions">
        <button className={`icon-btn${wsOpen ? ' on' : ''}`} data-testid="ws-toggle" title="显示 / 隐藏工作区" onClick={() => setWsOpen(!wsOpen)} disabled={view !== 'chat'}><Icon name="panel" /></button>
      </div>
    </header>
  );
}
