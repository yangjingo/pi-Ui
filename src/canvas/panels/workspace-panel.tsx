import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import type { FileNode } from '../../core/agent/protocol';
import {
  countFiles,
  fetchWorkspaceFileBlob,
  findFileInSession,
  isOfficeFile,
  parentPath,
  pathOf,
  saveBlobAs,
  subscribeWorkspaceEvents,
  useFileImport,
  useWorkspace,
  WorkspaceFileRequestError,
} from '../../workspace';
import { FileUploadIcon, Icon, fileIcon, t, term, text, trajectoryLabel } from '../../ui';
import { FileRenderer, StepResult, Editor } from '../renderers';
import { previewPlainText, supportsPreviewTextCopy } from '../preview-text';
import { TurnReport } from '../components/turn-report';
import { useWorkspaceWidth } from '../hooks/use-workspace-width';
import { FilesPanel } from './files-panel';

// The shell coordinates top-level File / Canvas / Traj navigation; document rendering and
// import behavior live behind their own Canvas modules.
const editable = (f?: FileNode | null) => !!f && !isOfficeFile(f.name) && (f.type === 'md' || f.type === 'sheet' || f.type === 'html' || f.type === 'code' || f.type === 'json' || f.type === 'mermaid' || f.type === 'excalidraw');
export function WorkspacePanel() {
  const {
    active, activeId, activeTab, canvasTab, activeStep, activeTurn, canvasFocused, editing, editDirty, editSaving, editSaveError,
    setActiveTab, setCanvasFocused, openInCanvas, openTurn, closeCanvasTab, closeOtherCanvasTabs, closeAllCanvasTabs,
    getFileContent, getEditBuffer, refreshWorkspaceFiles, saveEdit
  } = useWorkspace();

  const { dragging, workspaceWidth, minWorkspaceWidth, maxWorkspaceWidth, beginResize, moveResize, finishResize, resizeWithKeyboard, resetWorkspaceWidth } = useWorkspaceWidth();
  const fileImport = useFileImport();
  const { fileDrop, onFileDrop, onWorkspaceDragEnter, onWorkspaceDragLeave } = fileImport;
  const [fileQuery, setFileQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabMenuInstant, setTabMenuInstant] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [fileDownloadBusy, setFileDownloadBusy] = useState(false);
  const [fileDownloadError, setFileDownloadError] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const canvasDocumentRef = useRef<HTMLDivElement | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const tabMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const fileDownloadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (editSaving) return;
        void saveEdit();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editing, editSaving, saveEdit]);

  useEffect(() => setCopied(false), [canvasTab]);

  useEffect(() => {
    fileDownloadAbortRef.current?.abort();
    fileDownloadAbortRef.current = null;
    setFileDownloadBusy(false);
    setFileDownloadError(null);
  }, [activeId, canvasTab]);

  useEffect(() => () => {
    const controller = fileDownloadAbortRef.current;
    fileDownloadAbortRef.current = null;
    controller?.abort();
  }, []);

  useEffect(() => {
    setTabMenuOpen(false);
  }, [canvasTab, activeTab]);

  useEffect(() => {
    const activeElement = tabsRef.current?.querySelector('[aria-selected="true"]');
    activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [canvasTab]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (tabMenuRef.current?.contains(target)) return;
      setTabMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTabMenuOpen(false);
      window.requestAnimationFrame(() => tabMenuButtonRef.current?.focus());
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tabMenuOpen]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    window.requestAnimationFrame(() => {
      const activeItem = tabMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
      const firstItem = tabMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"]:not(:disabled)');
      (activeItem || firstItem)?.focus();
    });
  }, [tabMenuOpen]);

  const files = active.files;
  const fileCount = countFiles(files);
  const openTabs = active.openTabs;

  const focusCanvasContext = () => {
    window.requestAnimationFrame(() => {
      const target = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
        || document.querySelector<HTMLElement>('[data-testid="ws-tab"][data-tab="canvas"]');
      target?.focus();
    });
  };

  const closeTabAndRestoreFocus = async (name: string) => {
    if (await closeCanvasTab(name)) focusCanvasContext();
  };

  const navigateCanvasTabs = (e: React.KeyboardEvent<HTMLButtonElement>, name: string) => {
    if (e.key === 'Delete') {
      e.preventDefault();
      void closeTabAndRestoreFocus(name);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const current = Math.max(0, openTabs.indexOf(name));
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? openTabs.length - 1
        : (current + (e.key === 'ArrowRight' ? 1 : -1) + openTabs.length) % openTabs.length;
    const targetName = openTabs[next];
    void openInCanvas(targetName).then(ok => {
      if (!ok) return;
      window.requestAnimationFrame(() => {
        tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      });
    });
  };

  const navigateWorkspaceTabs = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
        : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const target = tabs[next];
    const tab = target.dataset.tab;
    if (tab !== 'files' && tab !== 'canvas') return;
    void setActiveTab(tab).then(ok => { if (ok) target.focus(); });
  };

  let viewport: React.ReactNode;
  let path1 = '—';
  let selectedFile: FileNode | null = null;
  let contextLabel: string | null = null;

  if (activeTurn) {
    const agentIdx = active.messages.map((m, i) => (m.role === 'agent' ? i : -1)).filter(i => i >= 0);
    const pos = agentIdx.indexOf(activeTurn.mi);
    viewport = <TurnReport mi={activeTurn.mi} />;
    path1 = t('workspace.taskRound', { round: pos >= 0 ? pos + 1 : '?' });
    contextLabel = path1;
  } else if (activeStep) {
    const step = active.messages[activeStep.mi]?.traj?.[activeStep.si];
    if (step) {
      const traj = active.messages[activeStep.mi]?.traj ?? [];
      viewport = (
        <StepResult
          step={step}
          file={step.file}
          index={activeStep.si}
          total={traj.length}
          onBack={() => void openTurn(activeStep.mi)}
        />
      );
      path1 = t('workspace.trajectoryStep', { title: trajectoryLabel(step.t, step.shell) });
      contextLabel = path1;
    }
  } else {
    const f = canvasTab ? findFileInSession(active, canvasTab) : null;
    selectedFile = f;
    if (editing && canvasTab && editable(f)) {
      // Keep the uncontrolled textarea mounted when another window renames this file, so a
      // local dirty buffer is never visually replaced by the server snapshot mid-edit.
      if (f?.type === 'md' || f?.type === 'html' || f?.type === 'code') {
        viewport = <FileRenderer f={f} />;
        path1 = t('workspace.editingPath', { path: pathOf(active, f!) });
      } else {
        viewport = <Editor f={f!} />;
        path1 = t('workspace.editingPath', { path: pathOf(active, f!) });
      }
    } else if (!canvasTab) {
      viewport = (
        <div className="canvas-empty" data-testid="canvas-empty">
          <span className="canvas-empty-ico"><Icon name="frame" /></span>
          <b>{t('workspace.readyTitle')}</b>
          <p>{t('workspace.readyHint')}</p>
          <button onClick={() => void setActiveTab('files')}><Icon name="folder" />{t('workspace.browseFiles')}</button>
        </div>
      );
    } else if (f) {
      viewport = <FileRenderer f={f} />;
      path1 = pathOf(active, f);
    }
  }

  const copyPreviewText = async () => {
    if (!canvasDocumentRef.current || !supportsPreviewTextCopy(selectedFile)) return;
    const source = editing ? getEditBuffer(selectedFile.path) : getFileContent(selectedFile.path);
    const value = previewPlainText(canvasDocumentRef.current, selectedFile, source || '');
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    setFileNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setFileNotice(null);
      noticeTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === 'file_rename') showNotice(t('workspace.renamed', { name: event.file.name }));
      if (event.type === 'file_delete') {
        const name = event.path.replace(/\\/g, '/').split('/').pop() || event.path;
        showNotice(t('workspace.deleted', { name }));
      }
    });
    return () => {
      unsubscribe();
      if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    };
  }, [showNotice]);

  const navigateMenu = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]:not([disabled])'));
    if (!items.length) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next].focus();
  };

  const downloadSelectedFile = async () => {
    if (!selectedFile || !activeId || editSaving || fileDownloadBusy) return;
    if (editing && editDirty && !(await saveEdit())) {
      showNotice(t('workspace.unsavedDownloadCancelled'));
      return;
    }
    const path = selectedFile.path || selectedFile.name;
    const filename = selectedFile.name;
    const controller = new AbortController();
    fileDownloadAbortRef.current?.abort();
    fileDownloadAbortRef.current = controller;
    setFileDownloadBusy(true);
    setFileDownloadError(null);
    try {
      const blob = await fetchWorkspaceFileBlob(activeId, path, controller.signal);
      if (!controller.signal.aborted) saveBlobAs(blob, filename);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : t('files.downloadFailed');
      setFileDownloadError(t('workspace.downloadFailed', { name: filename, error: message }));
      if (error instanceof WorkspaceFileRequestError && error.status === 404) void refreshWorkspaceFiles();
    } finally {
      if (fileDownloadAbortRef.current === controller) {
        fileDownloadAbortRef.current = null;
        setFileDownloadBusy(false);
      }
    }
  };

  return (
    <aside
      className={`workspace col${fileDrop ? ' file-drop' : ''}`}
      aria-label={term('workspace')}
      onDragEnter={onWorkspaceDragEnter}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onFileDrop}
    >
      <div
        className={`ws-resizer${dragging ? ' active' : ''}`}
        data-testid="ws-resizer"
        role="separator"
        tabIndex={0}
        aria-label={t('workspace.resize')}
        aria-orientation="vertical"
        aria-valuemin={minWorkspaceWidth()}
        aria-valuemax={maxWorkspaceWidth()}
        aria-valuenow={workspaceWidth}
        aria-valuetext={t('workspace.widthPixels', { width: workspaceWidth })}
        title={t('workspace.resizeHint')}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={resetWorkspaceWidth}
      />
      <div className="ws-tabs">
        <div className="ws-tab-list" role="tablist" aria-label={t('workspace.views')} onKeyDown={navigateWorkspaceTabs}>
          <button id="workspace-tab-files" className={`ws-tab${activeTab === 'files' ? ' active' : ''}`} data-testid="ws-tab" data-tab="files" role="tab" tabIndex={activeTab === 'files' ? 0 : -1} aria-selected={activeTab === 'files'} aria-controls="workspace-panel-files" onClick={() => void setActiveTab('files')}>
            <Icon name="folder" />{term('files')} <span className="cnt">{fileCount}</span>
          </button>
          <button id="workspace-tab-canvas" className={`ws-tab${activeTab === 'canvas' ? ' active' : ''}`} data-testid="ws-tab" data-tab="canvas" role="tab" tabIndex={activeTab === 'canvas' ? 0 : -1} aria-selected={activeTab === 'canvas'} aria-controls="workspace-panel-canvas" onClick={() => void setActiveTab('canvas')}>
            <Icon name="frame" />{term('canvas')}
          </button>
        </div>
        <span className="grow" />
        {activeTab === 'canvas' && (
          <button
            type="button"
            className={`canvas-focus-toggle${canvasFocused ? ' on' : ''}`}
            data-testid="canvas-focus-toggle"
            aria-pressed={canvasFocused}
            aria-label={t(canvasFocused ? 'workspace.exitFullscreen' : 'workspace.enterFullscreen')}
            title={t(canvasFocused ? 'workspace.exitFullscreen' : 'workspace.enterFullscreen')}
            onClick={() => setCanvasFocused(!canvasFocused)}
          >
            <Icon name={canvasFocused ? 'minimize' : 'maximize'} />
          </button>
        )}
      </div>

      <div className="drop-overlay" data-testid="drop-overlay">
        <FileUploadIcon /><span>{t('workspace.dropImport')}</span>
      </div>

      <div className="ws-body scroll">
        <FilesPanel active={activeTab === 'files'} query={fileQuery} setQuery={setFileQuery} importer={fileImport} />

        <section id="workspace-panel-canvas" className={`ws-panel${activeTab === 'canvas' ? ' active' : ''}`} data-testid="canvas-panel" role="tabpanel" aria-labelledby="workspace-tab-canvas">
          <div className={`canvas-shell${contextLabel ? ' context-view' : ''}`}>
            {!contextLabel && <div className="canvas-tabs-shell">
              <div className="canvas-tabs scroll" data-testid="canvas-tabs" ref={tabsRef} role="tablist" aria-label={t('workspace.openFiles')}>
                {openTabs.map(name => {
                  const f = findFileInSession(active, name);
                  const isActive = canvasTab === name && !contextLabel;
                  return (
                    <div key={name} className={`canvas-tab-item${isActive ? ' active' : ''}`} data-testid="canvas-tab-item">
                      <button
                        className="canvas-tab"
                        data-testid="canvas-tab"
                        data-tab-path={name}
                        role="tab"
                        tabIndex={isActive || (!canvasTab && name === openTabs[0]) ? 0 : -1}
                        aria-selected={isActive}
                        aria-controls="canvas-document-panel"
                        aria-label={t('workspace.closeFileDelete', { name: f?.name || name })}
                        title={f?.path || name}
                        onClick={() => void openInCanvas(name)}
                        onAuxClick={(e) => { if (e.button === 1) void closeCanvasTab(name); }}
                        onKeyDown={(e) => navigateCanvasTabs(e, name)}
                      >
                        <span className={`tree-ico ftype-${f ? f.type : ''}`}><Icon name={fileIcon(f ? f.type : 'file')} /></span>
                        <span className="canvas-tab-name">{text(f?.name || name)}</span>
                      </button>
                      <button className="canvas-tab-close" data-testid="canvas-tab-close" tabIndex={-1} title={t('workspace.closeFile', { name: f?.name || name })} aria-label={t('workspace.closeFile', { name: f?.name || name })} onClick={() => void closeTabAndRestoreFocus(name)}><Icon name="x" /></button>
                    </div>
                  );
                })}
                {!openTabs.length && <span className="canvas-tabs-empty">{t('workspace.noOpenFiles')}</span>}
              </div>
              {openTabs.length > 0 && (
                <div className="canvas-tab-menu-wrap" ref={tabMenuRef}>
                  <button ref={tabMenuButtonRef} className={`canvas-tabs-more${tabMenuOpen ? ' on' : ''}`} data-testid="canvas-tabs-more" title={t('workspace.manageOpenFiles', { count: openTabs.length })} aria-label={t('workspace.manageOpenFilesLabel', { count: openTabs.length })} aria-haspopup="menu" aria-expanded={tabMenuOpen} aria-controls="canvas-tab-menu" onClick={(e) => { setTabMenuInstant(e.detail === 0); setTabMenuOpen(open => !open); }}><Icon name="more" /><span className="tabs-count" aria-hidden="true">{openTabs.length}</span></button>
                  {tabMenuOpen && (
                    <div id="canvas-tab-menu" className={`canvas-tab-popover${tabMenuInstant ? ' instant' : ''}`} data-testid="canvas-tab-popover" role="menu" aria-label={t('workspace.openFilesActions')} onKeyDown={navigateMenu}>
                      <div className="popover-label" role="presentation">{t('workspace.openFilesCount', { count: openTabs.length })}</div>
                      <div className="canvas-tab-switch-list" role="presentation">
                        {openTabs.map(name => {
                          const f = findFileInSession(active, name);
                          const isCurrent = canvasTab === name && !contextLabel;
                          const path = f?.path || name;
                          return (
                            <button
                              key={name}
                              role="menuitemradio"
                              aria-checked={isCurrent}
                              className={isCurrent ? 'active' : ''}
                              data-testid="canvas-tab-menu-item"
                              title={path}
                              onClick={() => {
                                setTabMenuOpen(false);
                                void openInCanvas(name).then(ok => { if (ok) focusCanvasContext(); });
                              }}
                            >
                              <span className={`tree-ico ftype-${f ? f.type : ''}`}><Icon name={fileIcon(f ? f.type : 'file')} /></span>
                              <span className="tab-switch-copy"><b>{text(f?.name || name)}</b><small>{text(parentPath(path))}</small></span>
                              {isCurrent && <Icon name="check" className="tab-switch-check" />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="canvas-tab-actions" role="presentation">
                        <button role="menuitem" disabled={!canvasTab || openTabs.length < 2} onClick={() => { setTabMenuOpen(false); if (canvasTab) void closeOtherCanvasTabs(canvasTab).then(ok => { if (ok) focusCanvasContext(); }); }}>{t('workspace.closeOtherFiles')}</button>
                        <button role="menuitem" onClick={() => { setTabMenuOpen(false); void closeAllCanvasTabs().then(ok => { if (ok) focusCanvasContext(); }); }}>{t('workspace.closeAllFiles')}</button>
                      </div>
                      <div className="popover-hint" role="presentation">{t('workspace.fileMenuHint')}</div>
                    </div>
                  )}
                </div>
              )}
            </div>}
            {!contextLabel && <div className="canvas-bar">
              <span className={`canvas-file-mark ftype-${selectedFile?.type || 'file'}`} aria-hidden="true"><Icon name={fileIcon(selectedFile?.type || 'file')} /></span>
              <span className="canvas-path" data-testid="canvas-path" title={path1}>{path1}</span>
              <span className="grow" />
              {editing && <span className={`edit-status${editSaveError ? ' error' : editDirty ? ' dirty' : ''}`} role={editSaveError ? 'alert' : 'status'} aria-live={!editSaveError ? 'polite' : undefined}>{editSaveError ? t('workspace.saveFailed', { error: editSaveError }) : editSaving ? t('workspace.saving') : editDirty ? t('workspace.unsavedShortcut') : t('workspace.editingNoChanges')}</span>}
              {editing && (
                <button className="cv-save show" data-testid="cv-save" disabled={!editDirty || editSaving} onClick={() => void saveEdit()}>
                  <Icon name="check" />{editSaving ? t('common.saving') : t('common.save')}
                </button>
              )}
              {supportsPreviewTextCopy(selectedFile) && <button className="cv-copy" data-testid="cv-copy" title={t('workspace.copyPreview')} aria-label={t('workspace.copyPreview')} onClick={() => void copyPreviewText()}><Icon name={copied ? 'check' : 'copy'} />{copied ? t('common.copied') : t('common.copy')}</button>}
              {selectedFile && <button className="cv-download" data-testid="cv-download" disabled={editSaving || fileDownloadBusy} aria-busy={fileDownloadBusy} title={t('workspace.downloadCurrent')} aria-label={t('workspace.downloadNamed', { name: selectedFile.name })} onClick={() => void downloadSelectedFile()}><Icon name="download" />{fileDownloadBusy ? t('workspace.preparingDownload') : t('common.download')}</button>}
            </div>}
            <div ref={canvasDocumentRef} id="canvas-document-panel" className="canvas-viewport scroll" data-testid="canvas-viewport" role="tabpanel" aria-label={path1}>{viewport}</div>
          </div>
        </section>
      </div>
      {fileNotice && <div className="ws-notice" role="status" data-testid="ws-notice"><Icon name="check" />{text(fileNotice)}</div>}
      {fileDownloadError && <div className="ws-notice error" role="alert" data-testid="ws-download-error"><Icon name="warning" />{text(fileDownloadError)}</div>}
    </aside>
  );
}
