import { WorkspaceProvider, useWorkspace } from './workspace';
import { TopBar } from './components/TopBar';
import { Conversation } from './components/Conversation';
import { Workspace } from './components/Workspace';
import { SessionsView } from './components/SessionsView';
import { ModelDrawer } from './components/ModelDrawer';
import { SkillHub } from './components/SkillHub';

function Shell() {
  const { wsOpen, view } = useWorkspace();

  // A config page occupies the whole main area (no conversation, no workspace, no overlay) —
  // clicking the active button again returns to 'chat'.
  if (view !== 'chat') {
    return (
      <main className="app page-view">
        <section className="conversation col" style={{ position: 'relative' }}>
          <TopBar />
          <div className="page-body scroll">
            {view === 'sessions' && <SessionsView />}
            {view === 'model' && <ModelDrawer />}
            {view === 'skill' && <SkillHub />}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`app${wsOpen ? '' : ' ws-collapsed'}`}>
      <section className="conversation col" style={{ position: 'relative' }}>
        <TopBar />
        <Conversation />
      </section>
      <Workspace />
    </main>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
