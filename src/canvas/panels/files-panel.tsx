import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { FileNode } from '../../core/agent/protocol';
import {
  countFiles,
  fetchWorkspaceArchive,
  filterFileTree,
  listFiles,
  saveBlobAs,
  useWorkspace,
  type FileImportController,
  type FileImportNotice,
} from '../../workspace';
import { FileUploadIcon, Icon, t, text } from '../../ui';
import { FileTree, fileTreeItemId, keepTreeRovingFocus, navigateFileTree } from '../components/file-tree';

interface WorkspaceFilesPanelProps {
  active: boolean;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  importer: FileImportController;
}

function importNoticeText(notice: FileImportNotice) {
  if (notice.kind === 'session-required') return t('files.importSessionRequired');
  const parts = [notice.imported ? t('files.importedCount', { count: notice.imported }) : t('files.importNone')];
  if (notice.office) parts.push(t('files.importedOffice', { count: notice.office }));
  if (notice.unsupported) parts.push(t('files.importSkipped', { count: notice.unsupported }));
  if (notice.failed) parts.push(t('files.importFailed', { count: notice.failed }));
  return parts.join(' · ');
}

export function FilesPanel({ active: visible, query, setQuery, importer }: WorkspaceFilesPanelProps) {
  const {
    active,
    activeId,
    canvasTab,
    cwd,
    fileSelectionMode,
    selectedFilePaths,
    openInCanvas,
    renameWorkspaceFile,
    deleteWorkspaceFile,
    setActiveTab,
    setWsOpen,
    setFileSelectionMode,
    setSelectedFilePaths,
    toggleFileSelection,
    toggleFolder,
  } = useWorkspace();
  const [searchIndex, setSearchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const fileTreeRef = useRef<HTMLDivElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [actionPath, setActionPath] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const [renameValue, setRenameValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMenuInstant, setActionMenuInstant] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const uploadWrapRef = useRef<HTMLDivElement | null>(null);
  const actionWrapRef = useRef<HTMLDivElement | null>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [actionPosition, setActionPosition] = useState({ top: 8, left: 8, above: false });
  const lastSelectedPathRef = useRef<string | null>(null);
  const archiveAbortRef = useRef<AbortController | null>(null);
  const archiveRequestRef = useRef(0);
  const files = active.files;
  const fileCount = countFiles(files);
  const filteredFiles = useMemo(() => filterFileTree(files, query), [files, query]);
  const searchMatches = useMemo(() => listFiles(filteredFiles), [filteredFiles]);
  const selectedSearchMatch = searchMatches[searchIndex] ?? null;
  const selectedSearchPath = selectedSearchMatch?.path || selectedSearchMatch?.name || null;
  const selectedSet = useMemo(() => new Set(selectedFilePaths), [selectedFilePaths]);
  const resultPaths = useMemo(
    () => searchMatches.map(file => file.path || file.name),
    [searchMatches],
  );
  const allResultsSelected = resultPaths.length > 0 && resultPaths.every(path => selectedSet.has(path));

  const positionActionPopover = useCallback(() => {
    const trigger = actionTriggerRef.current;
    const popover = actionWrapRef.current;
    if (!trigger || !popover) return;
    const triggerBox = trigger.getBoundingClientRect();
    const popoverBox = popover.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const roomBelow = window.innerHeight - triggerBox.bottom - edge;
    const roomAbove = triggerBox.top - edge;
    const above = roomBelow < popoverBox.height + gap && roomAbove > roomBelow;
    const top = above
      ? Math.max(edge, triggerBox.top - popoverBox.height - gap)
      : Math.min(window.innerHeight - popoverBox.height - edge, triggerBox.bottom + gap);
    const left = Math.min(
      window.innerWidth - popoverBox.width - edge,
      Math.max(edge, triggerBox.right - popoverBox.width),
    );
    setActionPosition({ top: Math.max(edge, top), left: Math.max(edge, left), above });
  }, []);

  useEffect(() => {
    setSearchIndex(index => searchMatches.length ? Math.min(index, searchMatches.length - 1) : 0);
  }, [searchMatches.length]);

  useEffect(() => {
    archiveAbortRef.current?.abort();
    archiveAbortRef.current = null;
    archiveRequestRef.current += 1;
    setArchiveBusy(false);
    setArchiveError(null);
    setUploadMenuOpen(false);
    setActionPath(null);
    setActionMode('menu');
    setActionError(null);
    setActionBusy(false);
    setQuery('');
    setSearchIndex(0);
    lastSelectedPathRef.current = null;
    return () => {
      archiveAbortRef.current?.abort();
      archiveAbortRef.current = null;
      archiveRequestRef.current += 1;
    };
  }, [activeId, setQuery]);

  useEffect(() => {
    if (!query || !selectedSearchPath) return;
    window.requestAnimationFrame(() => fileTreeRef.current?.querySelector<HTMLElement>('[data-search-active="true"]')?.scrollIntoView({ block: 'nearest' }));
  }, [query, selectedSearchPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      void setWsOpen(true);
      void setActiveTab('files').then(ok => { if (ok) window.requestAnimationFrame(() => searchRef.current?.focus()); });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setActiveTab, setWsOpen]);

  useEffect(() => {
    if (!visible || !canvasTab) return;
    window.requestAnimationFrame(() => {
      const row = Array.from(fileTreeRef.current?.querySelectorAll<HTMLElement>('[data-file-path]') || [])
        .find(node => node.dataset.filePath === canvasTab);
      row?.scrollIntoView({ block: 'nearest' });
    });
  }, [visible, canvasTab, filteredFiles]);

  // Close upload menu on outside click
  useEffect(() => {
    if (!uploadMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (uploadWrapRef.current && !uploadWrapRef.current.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [uploadMenuOpen]);

  useEffect(() => {
    if (!actionPath) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!actionWrapRef.current?.contains(target) && !actionTriggerRef.current?.contains(target)) setActionPath(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setActionPath(null);
      actionTriggerRef.current?.focus();
    };
    const onScroll = () => setActionPath(null);
    const onResize = () => positionActionPopover();
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [actionPath, positionActionPopover]);

  useLayoutEffect(() => {
    if (!actionPath) return;
    positionActionPopover();
  }, [actionPath, actionMode, actionError, positionActionPopover]);

  useEffect(() => {
    if (!actionPath || actionMode !== 'menu') return;
    window.requestAnimationFrame(() => actionWrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [actionPath, actionMode]);

  useEffect(() => {
    if (!visible || !fileSelectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFileSelectionMode(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, fileSelectionMode, setFileSelectionMode]);

  const clearSearch = () => {
    setQuery('');
    setSearchIndex(0);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };
  const focusCanvas = () => window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>('.canvas-tabs [aria-selected="true"]')
      || document.querySelector<HTMLElement>('[data-testid="ws-tab"][data-tab="canvas"]');
    target?.focus();
  });

  const selectNode = (node: FileNode, event: MouseEvent<HTMLButtonElement>) => {
    const paths = node.type === 'folder'
      ? listFiles(node.children || []).map(file => file.path || file.name)
      : [node.path || node.name];
    const anchorPath = paths[0];
    const lastPath = lastSelectedPathRef.current;
    if (event.shiftKey && lastPath && anchorPath) {
      const start = resultPaths.indexOf(lastPath);
      const end = resultPaths.indexOf(anchorPath);
      if (start >= 0 && end >= 0) {
        const range = resultPaths.slice(Math.min(start, end), Math.max(start, end) + 1);
        setSelectedFilePaths([...selectedFilePaths, ...range]);
      } else {
        toggleFileSelection(paths);
      }
    } else {
      toggleFileSelection(paths);
    }
    if (anchorPath) lastSelectedPathRef.current = anchorPath;
  };

  const toggleAllResults = () => {
    if (allResultsSelected) {
      const resultSet = new Set(resultPaths);
      setSelectedFilePaths(selectedFilePaths.filter(path => !resultSet.has(path)));
    } else {
      setSelectedFilePaths([...selectedFilePaths, ...resultPaths]);
    }
  };

  const downloadSelection = async () => {
    if (!activeId || !selectedFilePaths.length || archiveBusy) return;
    const controller = new AbortController();
    const requestId = archiveRequestRef.current + 1;
    const sessionId = activeId;
    const paths = [...selectedFilePaths];
    archiveAbortRef.current?.abort();
    archiveAbortRef.current = controller;
    archiveRequestRef.current = requestId;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const archive = await fetchWorkspaceArchive(sessionId, paths, controller.signal);
      if (!controller.signal.aborted && archiveRequestRef.current === requestId) saveBlobAs(archive.blob, archive.filename);
    } catch (error: any) {
      if (!controller.signal.aborted && archiveRequestRef.current === requestId) {
        setArchiveError(error?.message || t('files.downloadFailed'));
      }
    } finally {
      if (archiveRequestRef.current === requestId) {
        archiveAbortRef.current = null;
        setArchiveBusy(false);
      }
    }
  };

  const openActions = (node: FileNode, trigger: HTMLButtonElement) => {
    const path = node.path || node.name;
    if (actionPath === path) {
      setActionPath(null);
      return;
    }
    actionTriggerRef.current = trigger;
    const triggerBox = trigger.getBoundingClientRect();
    setActionPosition({
      top: Math.min(window.innerHeight - 8, triggerBox.bottom + 4),
      left: Math.max(8, triggerBox.right - 272),
      above: false,
    });
    setActionPath(path);
    setActionMode('menu');
    setRenameValue(node.name);
    setActionError(null);
    setActionBusy(false);
    setActionMenuInstant(document.documentElement.dataset.input === 'keyboard');
  };

  const navigateActionMenu = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (actionMode !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (Math.max(current, 0) + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const renameFile = async (node: FileNode) => {
    const path = node.path || node.name;
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await renameWorkspaceFile(path, renameValue);
      if (!result.ok) setActionError(result.error || t('files.renameFailed'));
      else setActionPath(null);
    } finally {
      setActionBusy(false);
    }
  };

  const deleteFile = async (node: FileNode) => {
    const path = node.path || node.name;
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await deleteWorkspaceFile(path);
      if (!result.ok) setActionError(result.error || t('files.deleteFailed'));
      else setActionPath(null);
    } finally {
      setActionBusy(false);
    }
  };

  const renderFileActions = (node: FileNode) => {
    const path = node.path || node.name;
    const open = actionPath === path;
    return (
      <div className="file-row-action-wrap">
        <button
          className={`file-row-action${open ? ' on' : ''}`}
          data-testid="file-row-action"
          title={t('files.manage', { name: node.name })}
          aria-label={t('files.manage', { name: node.name })}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'workspace-file-action-menu' : undefined}
          onClick={(event) => { event.stopPropagation(); openActions(node, event.currentTarget); }}
        >
          <Icon name="more" />
        </button>
        {open && typeof document !== 'undefined' && createPortal(
          <div
            ref={actionWrapRef}
            id="workspace-file-action-menu"
            className={`file-action-popover file-row-popover file-row-floating${actionMenuInstant ? ' instant' : ''}`}
            data-testid="file-action-popover"
            data-placement={actionPosition.above ? 'top' : 'bottom'}
            role={actionMode === 'menu' ? 'menu' : 'dialog'}
            aria-label={t('files.actions')}
            onKeyDown={navigateActionMenu}
            style={{ top: actionPosition.top, left: actionPosition.left, transformOrigin: actionPosition.above ? 'bottom right' : 'top right' }}
          >
            <div className="file-action-head"><span className={`tree-ico ftype-${node.type}`}><Icon name={node.type === 'folder' ? 'folder' : 'file'} /></span><b title={path}>{text(node.name)}</b></div>
            {actionMode === 'menu' && (
              <div className="file-action-list">
                <button role="menuitem" onClick={() => { setActionMode('rename'); setActionError(null); }}><Icon name="pencil" /><span><b>{t('common.rename')}</b><small>{t('files.renameHint')}</small></span></button>
                <button role="menuitem" className="danger" onClick={() => { setActionMode('delete'); setActionError(null); }}><Icon name="trash" /><span><b>{t('files.deleteFile')}</b><small>{t('files.deleteIrreversible')}</small></span></button>
              </div>
            )}
            {actionMode === 'rename' && (
              <div className="file-action-form">
                <label htmlFor="workspace-rename">{t('files.newName')}</label>
                <input id="workspace-rename" data-testid="file-rename-input" autoFocus disabled={actionBusy} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameFile(node); }} />
                {actionError && <div className="file-action-error" role="alert">{text(actionError)}</div>}
                <div className="file-action-buttons"><button disabled={actionBusy} onClick={() => setActionMode('menu')}>{t('common.back')}</button><button className="primary" data-testid="file-rename-submit" disabled={actionBusy || !renameValue.trim() || renameValue.trim() === node.name} onClick={() => void renameFile(node)}>{actionBusy ? t('common.renaming') : t('common.rename')}</button></div>
              </div>
            )}
            {actionMode === 'delete' && (
              <div className="file-action-form">
                <div className="file-delete-copy"><b>{t('files.confirmDelete', { name: node.name })}</b><span>{t('files.deleteHint')}</span></div>
                {actionError && <div className="file-action-error" role="alert">{text(actionError)}</div>}
                <div className="file-action-buttons"><button autoFocus disabled={actionBusy} onClick={() => setActionMode('menu')}>{t('common.cancel')}</button><button className="destructive" data-testid="file-delete-confirm" disabled={actionBusy} onClick={() => void deleteFile(node)}>{actionBusy ? t('common.deleting') : t('common.delete')}</button></div>
              </div>
            )}
          </div>,
          document.body,
        )}
      </div>
    );
  };

  return (
    <section id="workspace-panel-files" className={`ws-panel${visible ? ' active' : ''}`} data-testid="files-panel" role="tabpanel" aria-labelledby="workspace-tab-files">
      <div className="ws-head">
        <div><b>{text(active.title)}</b><small title={cwd || undefined}>{cwd ? text(cwd) : t('files.availableArtifacts')}</small></div>
        {fileSelectionMode ? (
          <div className="file-selection-toolbar" data-testid="file-selection-toolbar">
            <span>{t('common.selectedCount', { count: selectedFilePaths.length })}</span>
            <button data-testid="file-select-all" onClick={toggleAllResults}>{allResultsSelected ? t('files.clearSelection') : query ? t('files.selectAllResults') : t('files.selectAll')}</button>
            <button className="primary" data-testid="file-download-zip" disabled={!selectedFilePaths.length || archiveBusy} aria-busy={archiveBusy} onClick={() => void downloadSelection()}><Icon name="download" />{archiveBusy ? t('files.packing') : t('files.downloadZip')}</button>
            <span className="visually-hidden" role="status" aria-live="polite">{archiveBusy ? t('files.packing') : ''}</span>
            <button data-testid="file-select-cancel" onClick={() => { setArchiveError(null); setFileSelectionMode(false); }}>{t('common.cancel')}</button>
          </div>
        ) : (
          <div className="ws-head-actions">
            <button className="ws-select" data-testid="file-select" onClick={() => setFileSelectionMode(true)}><Icon name="check" />{t('files.select')}</button>
            <div className="skill-upload-wrap" ref={uploadWrapRef}>
              <button className="ws-import" data-testid="ws-import" title={t('files.importTitle')} onClick={() => setUploadMenuOpen(o => !o)}><FileUploadIcon />{t('files.import')}</button>
              {uploadMenuOpen && <div className="skill-upload-menu" data-testid="ws-upload-menu"><button type="button" onClick={() => { setUploadMenuOpen(false); importer.uploadRef.current?.click(); }}><FileUploadIcon />{t('files.importFile')}</button><button type="button" onClick={() => { setUploadMenuOpen(false); importer.folderRef.current?.click(); }}><Icon name="folder" />{t('files.importFolder')}</button></div>}
            </div>
          </div>
        )}
      </div>
      {archiveError && <div className="file-action-error ws-archive-error" role="alert">{text(archiveError)}</div>}
      <input
        ref={importer.uploadRef}
        className="visually-hidden"
        data-testid="ws-file-input"
        type="file"
        multiple
        accept=".md,.markdown,.txt,.csv,.tsv,.html,.htm,.json,.docx,.docm,.dotx,.dotm,.xlsx,.xlsm,.xltx,.xltm,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.png,.jpg,.jpeg,.gif,.svg,.webp,.pdf,.zip,.tar,.gz,.tgz,.bz2,.7z,.xz,text/*"
        onChange={(event) => {
          void importer.ingestFiles(Array.from(event.currentTarget.files || []));
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={importer.folderRef}
        className="visually-hidden"
        data-testid="ws-folder-input"
        type="file"
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={(event) => {
          void importer.ingestFiles(Array.from(event.currentTarget.files || []));
          event.currentTarget.value = '';
        }}
      />
      <label className="ws-search">
        <Icon name="search" />
        <input
          data-testid="file-search"
          ref={searchRef}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="tree"
          aria-expanded={files.length > 0}
          aria-controls="workspace-file-tree"
          aria-describedby={query ? 'workspace-search-status' : undefined}
          aria-activedescendant={query && selectedSearchPath ? fileTreeItemId('workspace-file', selectedSearchPath) : undefined}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSearchIndex(0); }}
          placeholder={t('files.searchPlaceholder', { count: fileCount })}
          aria-label={t('files.searchLabel')}
          title={t('files.searchTitle')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault(); clearSearch();
            } else if (query && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && searchMatches.length) {
              event.preventDefault();
              setSearchIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + searchMatches.length) % searchMatches.length);
            } else if (query && event.key === 'Enter' && selectedSearchMatch) {
              event.preventDefault();
              void openInCanvas(selectedSearchMatch.path || selectedSearchMatch.name).then(ok => { if (ok) focusCanvas(); });
            }
          }}
        />
        {query && <button aria-label={t('files.clearSearch')} title={t('files.clearSearch')} onClick={clearSearch}><Icon name="x" /></button>}
      </label>
      {query && <div className="ws-search-meta" id="workspace-search-status" role="status" aria-live="polite">{selectedSearchPath ? t('files.searchFound', { count: searchMatches.length, current: searchIndex + 1, path: selectedSearchPath }) : t('files.searchNone', { query })}</div>}
      {importer.importProgress && <div className="ws-import-progress" data-testid="ws-import-progress" role="status" aria-live="polite">{t('files.importProgress', { completed: importer.importProgress.completed, total: importer.importProgress.total, name: importer.importProgress.fileName })}</div>}
      {importer.dropNotice && <div className="drop-msg" data-testid="drop-msg" role="status" aria-live="polite">{importNoticeText(importer.dropNotice)}</div>}
      {files.length === 0 ? (
        <div className="ws-empty ws-empty-files"><Icon name="folder" /><b>{t('files.emptyTitle')}</b><span>{t('files.emptyHint')}</span><button data-testid="ws-empty-import" onClick={() => setUploadMenuOpen(o => !o)}><FileUploadIcon />{t('files.importFiles')}</button></div>
      ) : filteredFiles.length === 0 ? (
        <div className="ws-empty ws-empty-search"><span>{t('files.searchNone', { query })}</span><button onClick={clearSearch}>{t('files.clearSearch')}</button></div>
      ) : (
        <div id="workspace-file-tree" className="file-tree" data-testid="file-tree" ref={fileTreeRef} role="tree" aria-multiselectable={fileSelectionMode || undefined} aria-label={query ? t('files.searchResults') : t('files.tree')} onKeyDown={navigateFileTree} onFocusCapture={keepTreeRovingFocus}>
          <FileTree list={filteredFiles} depth={0} active={canvasTab} highlighted={query ? selectedSearchPath : null} idPrefix="workspace-file" selectionMode={fileSelectionMode} selectedPaths={selectedSet} renderFileActions={renderFileActions} onSelect={selectNode} onToggle={toggleFolder} onOpen={(node) => {
            void openInCanvas(node.path || node.name).then(ok => { if (ok && document.documentElement.dataset.input === 'keyboard') focusCanvas(); });
          }} />
        </div>
      )}
    </section>
  );
}
