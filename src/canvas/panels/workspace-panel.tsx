import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import type { FileNode } from '../../core/agent/protocol';
import {
  countFiles,
  findFileInSession,
  isOfficeFile,
  parentPath,
  pathOf,
  subscribeWorkspaceEvents,
  useFileImport,
  useWorkspace,
} from '../../workspace';
import { Icon, fileIcon, text } from '../../ui';
import { FileRenderer, StepResult, Editor } from '../renderers';
import { previewPlainText, supportsPreviewTextCopy } from '../preview-text';
import { TurnReport } from '../components/turn-report';
import { MIN_WORKSPACE_WIDTH, useWorkspaceWidth } from '../hooks/use-workspace-width';
import { FilesPanel } from './files-panel';

// The shell coordinates top-level File / Canvas / Traj navigation; document rendering and
// import behavior live behind their own Canvas modules.
const editable = (f?: FileNode | null) => !!f && !isOfficeFile(f.name) && (f.type === 'md' || f.type === 'sheet' || f.type === 'html' || f.type === 'code' || f.type === 'json' || f.type === 'mermaid' || f.type === 'excalidraw');
type FileActionMode = 'menu' | 'rename' | 'delete';
export function WorkspacePanel() {
  const {
    active, activeTab, canvasTab, activeStep, activeTurn, editing, editDirty, editSaving, editSaveError,
    setActiveTab, openInCanvas, closeCanvasTab, closeOtherCanvasTabs, closeAllCanvasTabs,
    renameWorkspaceFile, deleteWorkspaceFile,
    getFileContent, getEditBuffer, saveEdit, navCanvas, setWsOpen
  } = useWorkspace();

  const { dragging, workspaceWidth, maxWorkspaceWidth, beginResize, moveResize, finishResize, resizeWithKeyboard, resetWorkspaceWidth } = useWorkspaceWidth();
  const fileImport = useFileImport();
  const { fileDrop, onFileDrop, onWorkspaceDragEnter, onWorkspaceDragLeave } = fileImport;
  const [fileQuery, setFileQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [fileMenuInstant, setFileMenuInstant] = useState(false);
  const [tabMenuInstant, setTabMenuInstant] = useState(false);
  const [fileActionMode, setFileActionMode] = useState<FileActionMode>('menu');
  const [renameValue, setRenameValue] = useState('');
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [fileActionBusy, setFileActionBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const canvasDocumentRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const fileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

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
    setFileMenuOpen(false);
    setTabMenuOpen(false);
    setFileActionMode('menu');
    setFileActionError(null);
    setFileActionBusy(false);
  }, [canvasTab, activeTab]);

  useEffect(() => {
    const activeElement = tabsRef.current?.querySelector('[aria-selected="true"]');
    activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [canvasTab]);

  useEffect(() => {
    if (!fileMenuOpen && !tabMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (fileMenuRef.current?.contains(target) || tabMenuRef.current?.contains(target)) return;
      setFileMenuOpen(false);
      setTabMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const returnFocus = fileMenuOpen ? fileMenuButtonRef.current : tabMenuButtonRef.current;
      setFileMenuOpen(false);
      setTabMenuOpen(false);
      window.requestAnimationFrame(() => returnFocus?.focus());
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fileMenuOpen, tabMenuOpen]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    window.requestAnimationFrame(() => {
      const activeItem = tabMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
      const firstItem = tabMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"]:not(:disabled)');
      (activeItem || firstItem)?.focus();
    });
  }, [tabMenuOpen]);

  useEffect(() => {
    if (!fileMenuOpen || fileActionMode !== 'menu') return;
    window.requestAnimationFrame(() => {
      (fileMenuRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
    });
  }, [fileMenuOpen, fileActionMode]);

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


  useEffect(() => {
    if (editing || activeTab !== 'canvas' || openTabs.length < 2) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'PageDown' && e.key !== 'PageUp')) return;
      e.preventDefault();
      navCanvas(e.key === 'PageDown' ? 1 : -1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editing, activeTab, openTabs.length, navCanvas]);

  let viewport: React.ReactNode;
  let path1 = '—';
  let canNav = false;       // show ← → when a turn/step view is active
  let selectedFile: FileNode | null = null;
  let contextLabel: string | null = null;

  if (activeTurn) {
    const agentIdx = active.messages.map((m, i) => (m.role === 'agent' ? i : -1)).filter(i => i >= 0);
    const pos = agentIdx.indexOf(activeTurn.mi);
    viewport = <TurnReport mi={activeTurn.mi} />;
    path1 = '任务详情 · 第 ' + (pos >= 0 ? pos + 1 : '?') + ' 轮';
    contextLabel = path1;
    canNav = agentIdx.length > 1;
  } else if (activeStep) {
    const step = active.messages[activeStep.mi]?.traj?.[activeStep.si];
    if (step) {
      const traj = active.messages[activeStep.mi]?.traj ?? [];
      viewport = <StepResult step={step} file={step.file} index={activeStep.si} total={traj.length} />;
      path1 = '轨迹步骤 · ' + step.title;
      contextLabel = path1;
      canNav = traj.length > 1;
    }
  } else {
    const f = canvasTab ? findFileInSession(active, canvasTab) : null;
    selectedFile = f;
    if (editing && canvasTab && editable(f)) {
      // Keep the uncontrolled textarea mounted when another window renames this file, so a
      // local dirty buffer is never visually replaced by the server snapshot mid-edit.
      if (f?.type === 'md' || f?.type === 'html' || f?.type === 'code') {
        viewport = <FileRenderer f={f} />;
        path1 = pathOf(active, f!) + ' · 编辑中';
      } else {
        viewport = <Editor f={f!} />;
        path1 = pathOf(active, f!) + ' · 编辑中';
      }
    } else if (!canvasTab) {
      viewport = (
        <div className="canvas-empty" data-testid="canvas-empty">
          <span className="canvas-empty-ico"><Icon name="frame" /></span>
          <b>Canvas 已就绪</b>
          <p>从 File 打开一个文件，或在对话中选择轨迹步骤查看执行详情。</p>
          <button onClick={() => void setActiveTab('files')}><Icon name="folder" />浏览工作区文件</button>
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
      if (event.type === 'file_rename') showNotice(`已重命名为 ${event.file.name}`);
      if (event.type === 'file_delete') {
        const name = event.path.replace(/\\/g, '/').split('/').pop() || event.path;
        showNotice(`已删除 ${name}`);
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

  const openFileActions = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!selectedFile) return;
    setFileMenuInstant(e.detail === 0);
    setRenameValue(selectedFile.name);
    setFileActionMode('menu');
    setFileActionError(null);
    setFileActionBusy(false);
    setTabMenuOpen(false);
    setFileMenuOpen(open => !open);
  };

  const renameSelectedFile = async () => {
    const path = selectedFile?.path || selectedFile?.name;
    if (!path || fileActionBusy) return;
    setFileActionError(null);
    setFileActionBusy(true);
    try {
      const result = await renameWorkspaceFile(path, renameValue);
      if (!result.ok) {
        setFileActionError(result.error || '重命名失败');
        return;
      }
      setFileMenuOpen(false);
      showNotice(`已重命名为 ${renameValue.trim()}`);
    } finally {
      setFileActionBusy(false);
    }
  };

  const deleteSelectedFile = async () => {
    const path = selectedFile?.path || selectedFile?.name;
    if (!path || fileActionBusy) return;
    const name = selectedFile?.name || path;
    setFileActionError(null);
    setFileActionBusy(true);
    try {
      const result = await deleteWorkspaceFile(path);
      if (!result.ok) {
        setFileActionError(result.error || '删除失败');
        return;
      }
      setFileMenuOpen(false);
      showNotice(`已删除 ${name}`);
    } finally {
      setFileActionBusy(false);
    }
  };

  return (
    <aside
      className={`workspace col${fileDrop ? ' file-drop' : ''}`}
      aria-label="Workspace 工作区"
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
        aria-label="调整工作区宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_WORKSPACE_WIDTH}
        aria-valuemax={maxWorkspaceWidth()}
        aria-valuenow={workspaceWidth}
        aria-valuetext={`${workspaceWidth} 像素`}
        title="拖动调节宽度 · 方向键微调 · Shift 加速 · 双击恢复默认"
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={resetWorkspaceWidth}
      />
      <div className="ws-tabs">
        <div className="ws-tab-list" role="tablist" aria-label="Workspace 视图" onKeyDown={navigateWorkspaceTabs}>
          <button id="workspace-tab-files" className={`ws-tab${activeTab === 'files' ? ' active' : ''}`} data-testid="ws-tab" data-tab="files" role="tab" tabIndex={activeTab === 'files' ? 0 : -1} aria-selected={activeTab === 'files'} aria-controls="workspace-panel-files" onClick={() => void setActiveTab('files')}>
            <Icon name="folder" />File <span className="cnt">{fileCount}</span>
          </button>
          <button id="workspace-tab-canvas" className={`ws-tab${activeTab === 'canvas' ? ' active' : ''}`} data-testid="ws-tab" data-tab="canvas" role="tab" tabIndex={activeTab === 'canvas' ? 0 : -1} aria-selected={activeTab === 'canvas'} aria-controls="workspace-panel-canvas" onClick={() => void setActiveTab('canvas')}>
            <Icon name="frame" />Canvas
          </button>
        </div>
        <span className="grow" />
        <button className="ws-dismiss" data-testid="ws-dismiss" title="返回对话" aria-label="返回对话" onClick={() => void setWsOpen(false)}><Icon name="x" /><span className="ws-dismiss-label">返回对话</span></button>
      </div>

      <div className="drop-overlay" data-testid="drop-overlay">
        <Icon name="paperclip" /><span>松开以导入到当前工作区</span>
      </div>

      <div className="ws-body scroll">
        <FilesPanel active={activeTab === 'files'} query={fileQuery} setQuery={setFileQuery} importer={fileImport} />

        <section id="workspace-panel-canvas" className={`ws-panel${activeTab === 'canvas' ? ' active' : ''}`} data-testid="canvas-panel" role="tabpanel" aria-labelledby="workspace-tab-canvas">
          <div className="canvas-shell">
            <div className="canvas-tabs-shell">
              <div className="canvas-tabs scroll" data-testid="canvas-tabs" ref={tabsRef} role="tablist" aria-label="已打开文件">
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
                        aria-label={`${f?.name || name}，按 Delete 关闭`}
                        title={f?.path || name}
                        onClick={() => void openInCanvas(name)}
                        onAuxClick={(e) => { if (e.button === 1) void closeCanvasTab(name); }}
                        onKeyDown={(e) => navigateCanvasTabs(e, name)}
                      >
                        <span className={`tree-ico ftype-${f ? f.type : ''}`}><Icon name={fileIcon(f ? f.type : 'file')} /></span>
                        <span className="canvas-tab-name">{text(f?.name || name)}</span>
                      </button>
                      <button className="canvas-tab-close" data-testid="canvas-tab-close" tabIndex={-1} title={`关闭 ${f?.name || name}`} aria-label={`关闭 ${f?.name || name}`} onClick={() => void closeTabAndRestoreFocus(name)}><Icon name="x" /></button>
                    </div>
                  );
                })}
                {contextLabel && <span className="canvas-context-tab"><Icon name={activeStep ? 'route' : 'chart'} />{text(contextLabel)}</span>}
                {!openTabs.length && !contextLabel && <span className="canvas-tabs-empty">尚未打开文件</span>}
              </div>
              {openTabs.length > 0 && (
                <div className="canvas-tab-menu-wrap" ref={tabMenuRef}>
                  <button ref={tabMenuButtonRef} className={`canvas-tabs-more${tabMenuOpen ? ' on' : ''}`} data-testid="canvas-tabs-more" title={`切换或管理 ${openTabs.length} 个已打开文件`} aria-label={`切换或管理已打开文件，共 ${openTabs.length} 个`} aria-haspopup="menu" aria-expanded={tabMenuOpen} aria-controls="canvas-tab-menu" onClick={(e) => { setTabMenuInstant(e.detail === 0); setFileMenuOpen(false); setTabMenuOpen(open => !open); }}><Icon name="more" /><span className="tabs-count" aria-hidden="true">{openTabs.length}</span></button>
                  {tabMenuOpen && (
                    <div id="canvas-tab-menu" className={`canvas-tab-popover${tabMenuInstant ? ' instant' : ''}`} data-testid="canvas-tab-popover" role="menu" aria-label="已打开文件操作" onKeyDown={navigateMenu}>
                      <div className="popover-label" role="presentation">已打开 {openTabs.length} 个文件</div>
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
                        <button role="menuitem" disabled={!canvasTab || openTabs.length < 2} onClick={() => { setTabMenuOpen(false); if (canvasTab) void closeOtherCanvasTabs(canvasTab).then(ok => { if (ok) focusCanvasContext(); }); }}>关闭其他文件</button>
                        <button role="menuitem" onClick={() => { setTabMenuOpen(false); void closeAllCanvasTabs().then(ok => { if (ok) focusCanvasContext(); }); }}>关闭全部文件</button>
                      </div>
                      <div className="popover-hint" role="presentation">↑↓ 选择 · Enter 打开 · Delete 关闭标签</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="canvas-bar">
              <span className="dots"><i /><i /><i /></span>
              <span className="canvas-path" data-testid="canvas-path" title={path1}>{path1}</span>
              <span className="grow" />
              {canNav && (
                <span className="cv-nav" data-testid="canvas-nav">
                  <button className="cv-nav-btn" data-testid="canvas-prev" title="上一项" aria-label="在 Canvas 中打开上一项" onClick={() => navCanvas(-1)}><Icon name="chevron" className="rot270" /></button>
                  <button className="cv-nav-btn" data-testid="canvas-next" title="下一项" aria-label="在 Canvas 中打开下一项" onClick={() => navCanvas(1)}><Icon name="chevron" className="rot90" /></button>
                </span>
              )}
              {editing && <span className={`edit-status${editSaveError ? ' error' : editDirty ? ' dirty' : ''}`} role={editSaveError ? 'alert' : 'status'} aria-live={!editSaveError ? 'polite' : undefined}>{editSaveError ? `保存失败 · ${editSaveError}` : editSaving ? '正在保存…' : editDirty ? '未保存 · Ctrl+S' : '编辑中 · 暂无更改'}</span>}
              {editing && (
                <button className="cv-save show" data-testid="cv-save" disabled={!editDirty || editSaving} onClick={() => void saveEdit()}>
                  <Icon name="check" />{editSaving ? '保存中…' : '保存'}
                </button>
              )}
              {supportsPreviewTextCopy(selectedFile) && <button className="cv-copy" data-testid="cv-copy" title="复制预览文本" aria-label="复制预览文本" onClick={() => void copyPreviewText()}><Icon name={copied ? 'check' : 'copy'} />{copied ? '已复制' : '复制'}</button>}
              {selectedFile && (
                <div className="file-action-wrap" ref={fileMenuRef}>
                  <button ref={fileMenuButtonRef} className={`cv-more${fileMenuOpen ? ' on' : ''}`} data-testid="cv-more" title="更多文件操作" aria-label="更多文件操作" aria-haspopup="menu" aria-expanded={fileMenuOpen} aria-controls="canvas-file-menu" onClick={openFileActions}><Icon name="more" /></button>
                  {fileMenuOpen && (
                    <div id="canvas-file-menu" className={`file-action-popover${fileMenuInstant ? ' instant' : ''}`} data-testid="file-action-popover" role={fileActionMode === 'menu' ? 'menu' : 'dialog'} aria-label={fileActionMode === 'menu' ? '文件操作' : fileActionMode === 'rename' ? '重命名文件' : '删除文件'} onKeyDown={fileActionMode === 'menu' ? navigateMenu : undefined}>
                      <div className="file-action-head">
                        <span className={`tree-ico ftype-${selectedFile.type}`}><Icon name={fileIcon(selectedFile.type)} /></span>
                        <b title={selectedFile.path || selectedFile.name}>{text(selectedFile.name)}</b>
                      </div>
                      {fileActionMode === 'menu' && (
                        <div className="file-action-list">
                          <button role="menuitem" onClick={() => { setRenameValue(selectedFile!.name); setFileActionMode('rename'); setFileActionError(null); }}><Icon name="pencil" /><span><b>重命名</b><small>保留在当前目录</small></span></button>
                          <button role="menuitem" className="danger" onClick={() => { setFileActionMode('delete'); setFileActionError(null); }}><Icon name="trash" /><span><b>删除文件</b><small>此操作无法撤销</small></span></button>
                        </div>
                      )}
                      {fileActionMode === 'rename' && (
                        <div className="file-action-form">
                          <label htmlFor="workspace-rename">新文件名</label>
                          <input id="workspace-rename" data-testid="file-rename-input" autoFocus disabled={fileActionBusy} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void renameSelectedFile(); }} />
                          {fileActionError && <div className="file-action-error" role="alert">{text(fileActionError)}</div>}
                          <div className="file-action-buttons"><button disabled={fileActionBusy} onClick={() => { setFileActionMode('menu'); setFileActionError(null); }}>返回</button><button className="primary" data-testid="file-rename-submit" disabled={fileActionBusy || !renameValue.trim() || renameValue.trim() === selectedFile.name} onClick={() => void renameSelectedFile()}>{fileActionBusy ? '重命名中…' : '重命名'}</button></div>
                        </div>
                      )}
                      {fileActionMode === 'delete' && (
                        <div className="file-action-form">
                          <div className="file-delete-copy"><b>确认删除“{text(selectedFile.name)}”？</b><span>文件会从工作目录和已打开标签中移除。</span></div>
                          {fileActionError && <div className="file-action-error" role="alert">{text(fileActionError)}</div>}
                          <div className="file-action-buttons"><button disabled={fileActionBusy} onClick={() => { setFileActionMode('menu'); setFileActionError(null); }}>取消</button><button className="destructive" data-testid="file-delete-confirm" disabled={fileActionBusy} onClick={() => void deleteSelectedFile()}>{fileActionBusy ? '删除中…' : '确认删除'}</button></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div ref={canvasDocumentRef} id="canvas-document-panel" className="canvas-viewport scroll" data-testid="canvas-viewport" role="tabpanel" aria-label={path1}>{viewport}</div>
          </div>
        </section>
      </div>
      {fileNotice && <div className="ws-notice" role="status" data-testid="ws-notice"><Icon name="check" />{text(fileNotice)}</div>}
    </aside>
  );
}
