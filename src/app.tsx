import { lazy, Suspense, useEffect } from 'react';
import {
  ConversationPanel,
  ConversationRail,
  loadModelPanel,
  loadSessionPanel,
  loadSkillPanel,
  preloadConfigView,
  TopBar,
  WorkspacePanel,
} from './canvas';
import { t } from './ui';
import { WorkspaceProvider, useWorkspace } from './workspace';

const SessionPanel = lazy(() => loadSessionPanel().then(module => ({ default: module.SessionPanel })));
const ModelPanel = lazy(() => loadModelPanel().then(module => ({ default: module.ModelPanel })));
const SkillPanel = lazy(() => loadSkillPanel().then(module => ({ default: module.SkillPanel })));

function PageLoader({ config = false }: { config?: boolean }) {
  if (!config) return <div className="page-loader" role="status">{t('common.loading')}</div>;
  return (
    <div className="page-loader config-page-loader" role="status" aria-label={t('common.loading')}>
      <span className="visually-hidden">{t('common.loading')}</span>
      <div className="config-loader-master" aria-hidden="true">
        <i className="config-loader-title" />
        <i className="config-loader-intro" />
        {[0, 1, 2, 3, 4].map(index => <i className="config-loader-row" key={index} />)}
      </div>
      <div className="config-loader-detail" aria-hidden="true">
        <i className="config-loader-heading" />
        <i className="config-loader-copy" />
        <i className="config-loader-copy short" />
        <i className="config-loader-field" />
        <i className="config-loader-field" />
      </div>
    </div>
  );
}

function Shell() {
  const { activeTab, canvasFocused, wsOpen, view } = useWorkspace();
  const showFocusedCanvas = wsOpen && activeTab === 'canvas' && canvasFocused;

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

  useEffect(() => {
    const warm = () => {
      void preloadConfigView('skill');
      void preloadConfigView('model');
    };
    const idleWindow = window as Partial<Window>;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(warm, { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(handle);
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
        <Suspense fallback={<PageLoader config />}><ModelPanel /></Suspense>
      </main>
    );
  }

  if (view === 'skill') {
    return (
      <main className="app config-page-workbench">
        <Suspense fallback={<PageLoader config />}><SkillPanel /></Suspense>
      </main>
    );
  }

  return (
    <main className={`app${wsOpen ? '' : ' ws-collapsed'}${showFocusedCanvas ? ' canvas-focused' : ''}`}>
      <section className="conversation col" style={{ position: 'relative' }}>
        <div className="conversation-main">
          <TopBar />
          <ConversationPanel />
        </div>
        <ConversationRail />
      </section>
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
