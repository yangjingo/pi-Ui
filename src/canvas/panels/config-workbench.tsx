import type { ReactNode } from 'react';
import { Icon, t, term } from '../../ui';
import { TopBar } from './top-bar';

interface ConfigWorkbenchProps {
  kind: 'model' | 'skill';
  title: string;
  master: ReactNode;
  canvas: ReactNode;
  files?: ReactNode;
  activeTab?: 'canvas' | 'files';
  onTabChange?: (tab: 'canvas' | 'files') => void;
}

/** Shared master/detail shell for configuration surfaces. The list stays in the same place as
 * conversation history while the selected item's actions live in the right-hand Canvas. */
export function ConfigWorkbench({ kind, title, master, canvas, files, activeTab = 'canvas', onTabChange }: ConfigWorkbenchProps) {
  return (
    <>
      <section className="conversation col config-master-shell" data-testid={`${kind}-master`}>
        <TopBar />
        <div className="config-master-body scroll">{master}</div>
      </section>

      <aside className="workspace col config-canvas-workspace" data-testid="config-canvas" aria-label={t('config.canvasLabel', { title, canvas: term('canvas') })}>
        <div className="ws-tabs config-workbench-tabs">
          <div className="ws-tab-list" role="tablist" aria-label={t('config.views', { title })} onKeyDown={(event) => {
            if (!files || !onTabChange || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'files' : event.key === 'End' ? 'canvas' : activeTab === 'canvas' ? 'files' : 'canvas';
            onTabChange(next);
            window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`#config-workbench-tab-${next}`)?.focus());
          }}>
            {files && <button
              id="config-workbench-tab-files"
              type="button"
              className={`ws-tab${activeTab === 'files' ? ' active' : ''}`}
              data-testid="config-workbench-files-tab"
              role="tab"
              tabIndex={activeTab === 'files' ? 0 : -1}
              aria-selected={activeTab === 'files'}
              aria-controls="config-canvas-panel"
              onClick={() => onTabChange?.('files')}
            >
              <Icon name="file" />{term('files')}
            </button>}
            <button
              id="config-workbench-tab-canvas"
              type="button"
              className={`ws-tab${activeTab === 'canvas' ? ' active' : ''}`}
              data-testid="config-workbench-tab"
              role="tab"
              tabIndex={activeTab === 'canvas' ? 0 : -1}
              aria-selected={activeTab === 'canvas'}
              aria-controls="config-canvas-panel"
              onClick={() => onTabChange?.('canvas')}
            >
              <Icon name="frame" />{term('canvas')}
            </button>
          </div>
          <span className="grow" />
        </div>
        <div className="ws-body scroll">
          <section id="config-canvas-panel" className="ws-panel active" data-testid="config-canvas-panel" role="tabpanel" aria-labelledby={`config-workbench-tab-${activeTab}`}>
            <div className="canvas-shell">
              <div className="canvas-viewport config-canvas-viewport scroll" data-testid="config-canvas-viewport">
                <div className="config-canvas-content">{activeTab === 'files' && files ? files : canvas}</div>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
