import { lazy, Suspense, useEffect } from 'react';
import { ConversationPanel, TopBar, WorkspacePanel } from './canvas';
import { WorkspaceProvider, useWorkspace } from './workspace';

const SessionPanel = lazy(() => import('./canvas').then(module => ({ default: module.SessionPanel })));
const ModelPanel = lazy(() => import('./canvas').then(module => ({ default: module.ModelPanel })));
const SkillPanel = lazy(() => import('./canvas').then(module => ({ default: module.SkillPanel })));

function PageLoader() {
  return <div className="page-loader" role="status">正在加载…</div>;
}

function Shell() {
  const { wsOpen, view, setWsOpen } = useWorkspace();

  useEffect(() => {
    const root = document.documentElement;
    const usePointer = () => { root.dataset.input = 'pointer'; };
    const useKeyboard = () => { root.dataset.input = 'keyboard'; };
    root.dataset.input = 'keyboard';
    window.addEventListener('pointerdown', usePointer, true);
    window.addEventListener('keydown', useKeyboard, true);
    return () => {
      window.removeEventListener('pointerdown', usePointer, true);
      window.removeEventListener('keydown', useKeyboard, true);
      delete root.dataset.input;
    };
  }, []);

  // Sessions stay a focused index. Model configuration uses its own conversation-like
  // master/detail workbench, with browsing on the left and editing in Canvas on the right.
  if (view === 'sessions') {
    return (
      <main className="app page-view">
        <section className="conversation col" style={{ position: 'relative' }}>
          <TopBar />
          <div className="page-body scroll">
            <Suspense fallback={<PageLoader />}><SessionPanel /></Suspense>
          </div>
        </section>
      </main>
    );
  }

  if (view === 'model') {
    return (
      <main className="app config-page-workbench">
        <Suspense fallback={<PageLoader />}><ModelPanel /></Suspense>
      </main>
    );
  }

  if (view === 'skill') {
    return (
      <main className="app config-page-workbench">
        <Suspense fallback={<PageLoader />}><SkillPanel /></Suspense>
      </main>
    );
  }

  return (
    <main className={`app${wsOpen ? '' : ' ws-collapsed'}`}>
      <section className="conversation col" style={{ position: 'relative' }}>
        <TopBar />
        <ConversationPanel />
      </section>
      <button className="ws-scrim" aria-label="关闭工作区" onClick={() => void setWsOpen(false)} />
      <WorkspacePanel />
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
