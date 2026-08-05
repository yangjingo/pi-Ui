import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '../../core/agent/protocol';
import { FileUploadIcon, Icon, MdText, prewarmMarkdown, t, text } from '../../ui';
import {
  buildFileTree,
  deleteSkill,
  makeSkillMd,
  loadSkill,
  refreshSkills,
  saveSkill,
  useSkills,
  workspaceFileType,
} from '../../workspace';
import { FileTree, keepTreeRovingFocus, navigateFileTree } from '../components/file-tree';
import { ConfigWorkbench } from './config-workbench';

type DetailMode = 'create' | 'edit';

/** The same master/detail Canvas contract as model configuration, backed only by local Skills. */
export function SkillPanel() {
  const skills = useSkills();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>('create');
  const [configTab, setConfigTab] = useState<'canvas' | 'files'>('canvas');
  const selected = useMemo(() => skills.find(skill => skill.id === selectedId) || null, [selectedId, skills]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewWarming, setPreviewWarming] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [fileDraft, setFileDraft] = useState('');
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const uploadWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selected) return;
    setDetailMode('edit');
    setName(selected.name);
    setDesc(selected.desc);
    setBody(selected.files['SKILL.md'] || selected.files['skill.md'] || '');
    const entry = Object.keys(selected.files).find(path => path.toLowerCase() === 'skill.md') || Object.keys(selected.files)[0] || '';
    setSelectedFilePath(current => selected.files[current] != null ? current : entry);
    setError('');
  }, [selected]);

  useEffect(() => {
    setFileDraft(selected?.files[selectedFilePath] || '');
  }, [selected, selectedFilePath]);

  useEffect(() => {
    const source = selected?.files['SKILL.md'] || selected?.files['skill.md'] || '';
    if (!source) { setPreviewWarming(false); return; }
    let cancelled = false;
    setPreviewWarming(true);
    const warm = () => {
      prewarmMarkdown(source);
      if (!cancelled) setPreviewWarming(false);
    };
    const idleWindow = window as Partial<Window>;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(warm, { timeout: 800 });
      return () => { cancelled = true; idleWindow.cancelIdleCallback?.(handle); };
    }
    const handle = window.setTimeout(warm, 0);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [selected]);

  // Close upload menu on outside click
  useEffect(() => {
    if (!uploadMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (uploadWrapRef.current && !uploadWrapRef.current.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [uploadMenuOpen]);

  const openSkill = async (id: string) => {
    setError('');
    setSelectedId(id);
    setDetailMode('edit');
    setConfigTab('canvas');
    setDetailLoading(true);
    try {
      await loadSkill(id);
    } catch (reason: any) {
      setError(reason?.message || t('skill.readFailed'));
    } finally { setDetailLoading(false); }
  };

  const startNew = () => {
    setSelectedId(null); setDetailMode('create'); setName(''); setDesc(''); setBody(''); setError(''); setSelectedFilePath(''); setConfigTab('canvas');
  };
  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName || !body.trim()) { setError(t('skill.required')); return; }
    setSaving(true); setError('');
    try {
      const skill = await saveSkill({
        id: detailMode === 'edit' ? selected?.id : undefined,
        name: cleanName,
        desc: desc.trim(),
        enabled: selected?.enabled ?? true,
        files: { ...(selected?.files || {}), 'SKILL.md': body.startsWith('---') ? body : makeSkillMd(cleanName, desc, body) },
      });
      setSelectedId(skill.id);
      setDetailMode('edit');
    } catch (reason: any) { setError(reason?.message || t('files.renameFailed')); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try { await deleteSkill(selected.id); startNew(); }
    catch (reason: any) { setError(reason?.message || t('files.deleteFailed')); }
    finally { setSaving(false); }
  };
  const saveCurrentFile = async () => {
    if (!selected || !selectedFilePath) return;
    setSaving(true); setError('');
    try {
      await saveSkill({
        id: selected.id, name: selected.name, desc: selected.desc, enabled: selected.enabled,
        files: { ...selected.files, [selectedFilePath]: fileDraft },
      });
    } catch (reason: any) { setError(reason?.message || t('skill.saveFileFailed')); }
    finally { setSaving(false); }
  };
  const uploadFiles = async (files: File[]) => {
    if (!selected || !files.length) return;
    setSaving(true); setError('');
    try {
      const additions: Record<string, string> = {};
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.includes(0)) throw new Error(t('skill.notText', { name: file.name }));
        const relative = ((file as any).webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!relative) throw new Error(t('skill.invalidFileName'));
        additions[relative] = new TextDecoder().decode(bytes);
      }
      const saved = await saveSkill({ id: selected.id, name: selected.name, desc: selected.desc, enabled: selected.enabled, files: { ...selected.files, ...additions } });
      const first = Object.keys(additions)[0];
      if (first) setSelectedFilePath(first);
      setConfigTab('files');
      setSelectedId(saved.id);
    } catch (reason: any) { setError(reason?.message || t('skill.uploadFailed')); }
    finally { setSaving(false); }
  };

  const skillFileTree = useMemo(() => {
    if (!selected) return [];
    const files: FileNode[] = Object.entries(selected.files).map(([path, content]) => ({
      name: path.split('/').pop() || path, path, type: workspaceFileType(path), size: `${new Blob([content]).size} B`,
    }));
    const tree = buildFileTree(files);
    const applyOpen = (nodes: FileNode[]) => nodes.forEach(node => {
      if (node.type === 'folder') { node.open = !closedFolders.has(node.path || node.name); if (node.children) applyOpen(node.children); }
    });
    applyOpen(tree);
    return tree;
  }, [selected, closedFolders]);
  const toggleFolder = (node: FileNode) => setClosedFolders(current => {
    const next = new Set(current); const path = node.path || node.name;
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const master = (
    <div className="skill-workbench-master">
      <div className="drawer-head"><span>{t('skill.title')}</span><span className="model-tag">{t('skill.local')}</span></div>
      <div className="config-master-intro"><b>{t('skill.introTitle')}</b><span>{t('skill.introHint')}</span></div>
      <div className="model-section-label"><span>{t('skill.localList')}</span><span>{t('common.selectedCount', { count: skills.length })}</span></div>
      <div className="model-list scroll skill-list" data-testid="skill-list">
        {skills.length === 0 && <div className="model-empty">{t('skill.empty')}</div>}
        {skills.map(skill => (
          <button key={skill.id} type="button" className={`model-opt skill-opt${selectedId === skill.id && detailMode === 'edit' ? ' active' : ''}`} data-testid="skill-item" aria-pressed={selectedId === skill.id && detailMode === 'edit'} onClick={() => void openSkill(skill.id)}>
            <span className="mo-ico"><Icon name="blocks" /></span>
            <span className="mo-main"><b>/{text(skill.name)}</b><small>{text(skill.desc || t('conversation.skillFallback'))}</small></span>
            <span className="skill-file-count">{t('common.fileCount', { count: skill.fileCount ?? Object.keys(skill.files).length })}</span>
            <Icon name="chevron" className="config-row-arrow" />
          </button>
        ))}
      </div>
      <div className="model-section-label"><span>{t('skill.entries')}</span></div>
      <div className="config-entry-list"><button type="button" className={`model-opt${detailMode === 'create' ? ' active' : ''}`} data-testid="skill-new" onClick={startNew}><span className="mo-ico"><Icon name="plus" /></span><span className="mo-main"><b>{t('skill.new')}</b><small>{t('skill.newHint')}</small></span><Icon name="chevron" className="config-row-arrow" /></button></div>
    </div>
  );

  const canvas = (
    <section className="config-detail-card skill-detail" data-testid="skill-hub-page">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name="blocks" /></span>
        <div><span>{detailMode === 'edit' ? t('conversation.skillFallback') : t('skill.newLabel')}</span><h2>{detailMode === 'edit' ? `/${text(selected?.name || t('term.skill'))}` : t('skill.create')}</h2><p>{detailMode === 'edit' ? t('skill.editHint') : t('skill.createHint')}</p></div>
        {detailMode === 'edit' && <span className="config-status active"><i />{t('skill.local')}</span>}
      </div>
      {detailLoading ? <div className="config-detail-loading" role="status" aria-label={t('common.loading')}><i className="config-loader-copy" /><i className="config-loader-field" /><i className="config-loader-field" /><i className="config-loader-editor" /></div> : <>
        {error && <div className="model-test err skill-form-error" role="alert"><Icon name="x" />{error}</div>}
        <div className="skill-detail-grid">
          <label className="config-field-label">{t('skill.name')}<input data-testid="skill-name" value={name} onChange={event => setName(event.target.value)} placeholder={t('skill.nameExample')} spellCheck={false} /></label>
          <label className="config-field-label">{t('skill.description')}<input data-testid="skill-desc" value={desc} onChange={event => setDesc(event.target.value)} placeholder={t('skill.descriptionHint')} /></label>
        </div>
        <div className="skill-editor-area"><label className="config-field-label" htmlFor="skill-body">SKILL.md<span>{t('skill.bodyHint')}</span></label><textarea id="skill-body" className="skill-editor" data-testid="skill-body" value={body} onChange={event => setBody(event.target.value)} placeholder={t('skill.bodyPlaceholder')} spellCheck={false} /></div>
        <div className="config-detail-actions skill-detail-actions">
          <button type="button" className="pill" data-testid="skill-refresh" disabled={saving} onClick={() => void refreshSkills(true).catch(() => setError(t('skill.readFailed')))}><Icon name="refresh" />{t('common.refresh')}</button>
          {detailMode === 'edit' && <button type="button" className="config-danger-action" data-testid="skill-delete" disabled={saving} onClick={() => void remove()}><Icon name="trash" />{t('common.delete')}</button>}
          <button type="button" className="send config-primary-action" data-testid="skill-save" disabled={saving} onClick={() => void save()}><Icon name="check" />{saving ? t('common.saving') : t('skill.save')}</button>
        </div>
      </>}
    </section>
  );

  const files = selected ? (
    <section className="model-config-files skill-config-files" data-testid="skill-files-panel">
      <aside className="model-config-file-tree" aria-label={t('skill.files')}>
        <div className="model-config-files-head"><b>{t('term.files')}</b><span>{Object.keys(selected.files).length}</span><div className="skill-upload-wrap" ref={uploadWrapRef}><button type="button" className="skill-file-upload" data-testid="skill-file-upload" disabled={saving} onClick={() => setUploadMenuOpen(o => !o)}><FileUploadIcon />{t('skill.upload')}</button>{uploadMenuOpen && <div className="skill-upload-menu" data-testid="skill-upload-menu"><button type="button" onClick={() => { setUploadMenuOpen(false); uploadRef.current?.click(); }}><FileUploadIcon />{t('files.importFile')}</button><button type="button" onClick={() => { setUploadMenuOpen(false); folderRef.current?.click(); }}><Icon name="folder" />{t('files.importFolder')}</button></div>}</div><input ref={uploadRef} type="file" multiple data-testid="skill-file-input" hidden onChange={event => { void uploadFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /><input ref={folderRef} type="file" {...({ webkitdirectory: '', directory: '' } as any)} data-testid="skill-folder-input" hidden onChange={event => { void uploadFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /></div>
        <div className="file-tree" role="tree" aria-label={t('skill.namedFiles', { name: selected.name })} onKeyDown={navigateFileTree} onFocusCapture={keepTreeRovingFocus}>
          <FileTree list={skillFileTree} active={selectedFilePath} idPrefix="skill-file" onToggle={toggleFolder} onOpen={node => setSelectedFilePath(node.path || node.name)} />
        </div>
      </aside>
      <div className="model-config-file-editor-pane">
        <div className="model-config-file-path"><Icon name="file" />{selectedFilePath || t('skill.selectFile')}</div>
        {!selectedFilePath ? <div className="model-config-file-empty">{t('skill.selectFileHint')}</div> : selectedFilePath.toLowerCase() === 'skill.md' ? (previewWarming ? <div className="skill-preview-loading" role="status" aria-label={t('common.loading')}><i /><i /><i /><i /></div> : <div className="skill-file-preview scroll" data-testid="skill-file-preview-content"><MdText className="md-body" text={fileDraft} /></div>) : <textarea className="model-config-file-editor" data-testid="skill-file-editor" value={fileDraft} onChange={event => setFileDraft(event.target.value)} spellCheck={false} aria-label={t('skill.fileContent', { path: selectedFilePath })} />}
        {error && <div className="model-test err"><Icon name="x" />{error}</div>}
        {selectedFilePath && selectedFilePath.toLowerCase() !== 'skill.md' && <div className="model-config-file-actions">
          <button type="button" className="send config-primary-action" data-testid="skill-file-save" disabled={saving || !selectedFilePath} onClick={() => void saveCurrentFile()}>{saving ? t('common.saving') : t('skill.saveFile')}</button>
        </div>}
      </div>
    </section>
  ) : undefined;

  return <ConfigWorkbench kind="skill" title={t('skill.title')} master={master} canvas={canvas} files={files} activeTab={configTab} onTabChange={setConfigTab} />;
}
