import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  countFiles,
  filterFileTree,
  listFiles,
  useWorkspace,
  type FileImportController,
} from '../../workspace';
import { Icon, text } from '../../ui';
import { FileTree, fileTreeItemId, keepTreeRovingFocus, navigateFileTree } from '../components/file-tree';

interface WorkspaceFilesPanelProps {
  active: boolean;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  importer: FileImportController;
}

export function FilesPanel({ active: visible, query, setQuery, importer }: WorkspaceFilesPanelProps) {
  const { active, canvasTab, cwd, openInCanvas, setActiveTab, setWsOpen, toggleFolder } = useWorkspace();
  const [searchIndex, setSearchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const fileTreeRef = useRef<HTMLDivElement | null>(null);
  const files = active.files;
  const fileCount = countFiles(files);
  const filteredFiles = useMemo(() => filterFileTree(files, query), [files, query]);
  const searchMatches = useMemo(() => listFiles(filteredFiles), [filteredFiles]);
  const selectedSearchMatch = searchMatches[searchIndex] ?? null;
  const selectedSearchPath = selectedSearchMatch?.path || selectedSearchMatch?.name || null;

  useEffect(() => {
    setSearchIndex(index => searchMatches.length ? Math.min(index, searchMatches.length - 1) : 0);
  }, [searchMatches.length]);

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

  return (
    <section id="workspace-panel-files" className={`ws-panel${visible ? ' active' : ''}`} data-testid="files-panel" role="tabpanel" aria-labelledby="workspace-tab-files">
      <div className="ws-head">
        <div><b>{text(active.title)}</b><small title={cwd || undefined}>{cwd ? text(cwd) : '工作目录中的可用产物'}</small></div>
        <button className="ws-import" data-testid="ws-import" title="导入文本或 Office 文件" onClick={() => importer.uploadRef.current?.click()}><Icon name="paperclip" />导入</button>
      </div>
      <input
        ref={importer.uploadRef}
        className="visually-hidden"
        data-testid="ws-file-input"
        type="file"
        multiple
        accept=".md,.markdown,.txt,.csv,.tsv,.html,.htm,.json,.docx,.docm,.dotx,.dotm,.xlsx,.xlsm,.xltx,.xltm,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,text/*"
        onChange={(event) => {
          void importer.ingestFiles(Array.from(event.currentTarget.files || []));
          event.currentTarget.value = '';
        }}
      />
      <label className="ws-search">
        <Icon name="search" />
        <input
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
          placeholder={`搜索 ${fileCount} 个文件`}
          aria-label="搜索工作区文件"
          title="搜索工作区文件（Ctrl+Shift+F）"
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
        {query && <button aria-label="清除搜索" title="清除搜索" onClick={clearSearch}><Icon name="x" /></button>}
      </label>
      {query && <div className="ws-search-meta" id="workspace-search-status" role="status" aria-live="polite">{selectedSearchPath ? `找到 ${searchMatches.length} 个文件 · ${searchIndex + 1}/${searchMatches.length} ${selectedSearchPath} · ↑↓ 选择 · Enter 打开` : `没有匹配“${query}”的文件`}</div>}
      {importer.importProgress && <div className="ws-import-progress" data-testid="ws-import-progress" role="status" aria-live="polite">正在导入到当前工作区 {importer.importProgress.completed}/{importer.importProgress.total} · {text(importer.importProgress.fileName)}</div>}
      {importer.dropMsg && <div className="drop-msg" data-testid="drop-msg" role="status" aria-live="polite">{importer.dropMsg}</div>}
      {files.length === 0 ? (
        <div className="ws-empty ws-empty-files"><Icon name="folder" /><b>还没有可预览的文件</b><span>导入文本、Word、Excel 或 PowerPoint，或让 Agent 创建内容。</span><button onClick={() => importer.uploadRef.current?.click()}><Icon name="paperclip" />导入文件</button></div>
      ) : filteredFiles.length === 0 ? (
        <div className="ws-empty ws-empty-search"><span>没有匹配“{text(query)}”的文件</span><button onClick={clearSearch}>清除搜索</button></div>
      ) : (
        <div id="workspace-file-tree" className="file-tree" data-testid="file-tree" ref={fileTreeRef} role="tree" aria-label={query ? '工作区文件搜索结果' : '工作区文件'} onKeyDown={navigateFileTree} onFocusCapture={keepTreeRovingFocus}>
          <FileTree list={filteredFiles} depth={0} active={canvasTab} highlighted={query ? selectedSearchPath : null} idPrefix="workspace-file" onToggle={toggleFolder} onOpen={(node) => {
            void openInCanvas(node.path || node.name).then(ok => { if (ok && document.documentElement.dataset.input === 'keyboard') focusCanvas(); });
          }} />
        </div>
      )}
    </section>
  );
}
