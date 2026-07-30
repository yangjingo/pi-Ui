import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '../../core/agent/protocol';
import { Icon, MdText, text } from '../../ui';
import {
  buildFileTree,
  deleteSkill,
  makeSkillMd,
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
  const [canvasOpen, setCanvasOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 1180px)').matches);
  const [configTab, setConfigTab] = useState<'canvas' | 'files'>('canvas');
  const selected = useMemo(() => skills.find(skill => skill.id === selectedId) || null, [selectedId, skills]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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

  // Close upload menu on outside click
  useEffect(() => {
    if (!uploadMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (uploadWrapRef.current && !uploadWrapRef.current.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [uploadMenuOpen]);

  const openSkill = (id: string) => {
    setSelectedId(id);
    setDetailMode('edit');
    setConfigTab('canvas');
    setCanvasOpen(true);
    setError('');
  };
  const startNew = () => {
    setSelectedId(null); setDetailMode('create'); setName(''); setDesc(''); setBody(''); setError(''); setSelectedFilePath(''); setConfigTab('canvas'); setCanvasOpen(true);
  };
  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName || !body.trim()) { setError('请填写名称和 SKILL.md 内容。'); return; }
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
    } catch (reason: any) { setError(reason?.message || '保存失败'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try { await deleteSkill(selected.id); startNew(); }
    catch (reason: any) { setError(reason?.message || '删除失败'); }
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
    } catch (reason: any) { setError(reason?.message || '保存文件失败'); }
    finally { setSaving(false); }
  };
  const uploadFiles = async (files: File[]) => {
    if (!selected || !files.length) return;
    setSaving(true); setError('');
    try {
      const additions: Record<string, string> = {};
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.includes(0)) throw new Error(`${file.name} 不是可保存到 Skill 的文本文件`);
        const relative = ((file as any).webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!relative) throw new Error('上传文件缺少有效名称');
        additions[relative] = new TextDecoder().decode(bytes);
      }
      const saved = await saveSkill({ id: selected.id, name: selected.name, desc: selected.desc, enabled: selected.enabled, files: { ...selected.files, ...additions } });
      const first = Object.keys(additions)[0];
      if (first) setSelectedFilePath(first);
      setConfigTab('files');
      setSelectedId(saved.id);
    } catch (reason: any) { setError(reason?.message || '上传文件失败'); }
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
      <div className="drawer-head"><span>Skill Hub</span><span className="model-tag">本地</span></div>
      <div className="config-master-intro"><b>选择一个本地 Skill，在 Canvas 中维护指令</b><span>Skill 存放在当前工作区；输入 /名称 时由 Core 注入 SKILL.md。</span></div>
      <div className="model-section-label"><span>本地 Skills</span><span>{skills.length} 项</span></div>
      <div className="model-list scroll skill-list" data-testid="skill-list">
        {skills.length === 0 && <div className="model-empty">还没有本地 Skill。新建一个开始吧。</div>}
        {skills.map(skill => (
          <button key={skill.id} type="button" className={`model-opt skill-opt${selectedId === skill.id && detailMode === 'edit' ? ' active' : ''}`} data-testid="skill-item" aria-pressed={selectedId === skill.id && detailMode === 'edit'} onClick={() => openSkill(skill.id)}>
            <span className="mo-ico"><Icon name="blocks" /></span>
            <span className="mo-main"><b>/{text(skill.name)}</b><small>{text(skill.desc || '本地 Skill')}</small></span>
            <span className="skill-file-count">{Object.keys(skill.files).length} files</span>
            <Icon name="chevron" className="config-row-arrow" />
          </button>
        ))}
      </div>
      <div className="model-section-label"><span>配置入口</span></div>
      <div className="config-entry-list"><button type="button" className={`model-opt${detailMode === 'create' ? ' active' : ''}`} data-testid="skill-new" onClick={startNew}><span className="mo-ico"><Icon name="plus" /></span><span className="mo-main"><b>新建本地 Skill</b><small>编写 SKILL.md 并保存在此工作区</small></span><Icon name="chevron" className="config-row-arrow" /></button></div>
    </div>
  );

  const canvas = (
    <section className="config-detail-card skill-detail" data-testid="skill-hub-page">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name="blocks" /></span>
        <div><span>{detailMode === 'edit' ? '本地 Skill' : '新建本地 Skill'}</span><h2>{detailMode === 'edit' ? `/${text(selected?.name || 'Skill')}` : '创建 Skill'}</h2><p>{detailMode === 'edit' ? '编辑后保存到当前工作区，slash 补全会自动更新。' : '为重复任务写入一段可显式调用的本地指令。'}</p></div>
        {detailMode === 'edit' && <span className="config-status active"><i />本地</span>}
      </div>
      {error && <div className="model-test err skill-form-error" role="alert"><Icon name="x" />{error}</div>}
      <div className="skill-detail-grid">
        <label className="config-field-label">名称<input data-testid="skill-name" value={name} onChange={event => setName(event.target.value)} placeholder="例如 code-review" spellCheck={false} /></label>
        <label className="config-field-label">说明<input data-testid="skill-desc" value={desc} onChange={event => setDesc(event.target.value)} placeholder="一句话说明何时使用" /></label>
      </div>
      <div className="skill-editor-area"><label className="config-field-label" htmlFor="skill-body">SKILL.md<span>支持 frontmatter；正文会在用户显式输入 /名称 时注入。</span></label><textarea id="skill-body" className="skill-editor" data-testid="skill-body" value={body} onChange={event => setBody(event.target.value)} placeholder="写入本地 Skill 指令；可包含 frontmatter。" spellCheck={false} /></div>
      <div className="config-detail-actions skill-detail-actions">
        <button type="button" className="pill" data-testid="skill-refresh" disabled={saving} onClick={() => void refreshSkills().catch(() => setError('无法读取本地 Skills'))}><Icon name="refresh" />刷新</button>
        {detailMode === 'edit' && <button type="button" className="config-danger-action" data-testid="skill-delete" disabled={saving} onClick={() => void remove()}><Icon name="trash" />删除</button>}
        <button type="button" className="send config-primary-action" data-testid="skill-save" disabled={saving} onClick={() => void save()}><Icon name="check" />{saving ? '保存中…' : '保存本地 Skill'}</button>
      </div>
    </section>
  );

  const files = selected ? (
    <section className="model-config-files skill-config-files" data-testid="skill-files-panel">
      <aside className="model-config-file-tree" aria-label="Skill 文件">
        <div className="model-config-files-head"><b>Files</b><span>{Object.keys(selected.files).length}</span><div className="skill-upload-wrap" ref={uploadWrapRef}><button type="button" className="skill-file-upload" data-testid="skill-file-upload" disabled={saving} onClick={() => setUploadMenuOpen(o => !o)}><Icon name="folder" />上传</button>{uploadMenuOpen && <div className="skill-upload-menu" data-testid="skill-upload-menu"><button type="button" onClick={() => { setUploadMenuOpen(false); uploadRef.current?.click(); }}><Icon name="file" />文件</button><button type="button" onClick={() => { setUploadMenuOpen(false); folderRef.current?.click(); }}><Icon name="folder" />文件夹</button></div>}</div><input ref={uploadRef} type="file" multiple data-testid="skill-file-input" hidden onChange={event => { void uploadFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /><input ref={folderRef} type="file" {...({ webkitdirectory: '', directory: '' } as any)} data-testid="skill-folder-input" hidden onChange={event => { void uploadFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /></div>
        <div className="file-tree" role="tree" aria-label={`${selected.name} 的文件`} onKeyDown={navigateFileTree} onFocusCapture={keepTreeRovingFocus}>
          <FileTree list={skillFileTree} active={selectedFilePath} idPrefix="skill-file" onToggle={toggleFolder} onOpen={node => setSelectedFilePath(node.path || node.name)} />
        </div>
      </aside>
      <div className="model-config-file-editor-pane">
        <div className="model-config-file-path"><Icon name="file" />{selectedFilePath || '选择一个文件'}</div>
        {!selectedFilePath ? <div className="model-config-file-empty">选择一个文件查看内容。</div> : selectedFilePath.toLowerCase() === 'skill.md' ? <div className="skill-file-preview scroll" data-testid="skill-file-preview-content"><MdText className="md-body" text={fileDraft} /></div> : <textarea className="model-config-file-editor" data-testid="skill-file-editor" value={fileDraft} onChange={event => setFileDraft(event.target.value)} spellCheck={false} aria-label={`${selectedFilePath} 内容`} />}
        {error && <div className="model-test err"><Icon name="x" />{error}</div>}
        {selectedFilePath && selectedFilePath.toLowerCase() !== 'skill.md' && <div className="model-config-file-actions">
          <button type="button" className="send config-primary-action" data-testid="skill-file-save" disabled={saving || !selectedFilePath} onClick={() => void saveCurrentFile()}>{saving ? '保存中…' : '保存文件'}</button>
        </div>}
      </div>
    </section>
  ) : undefined;

  return <ConfigWorkbench kind="skill" title="Skill Hub" open={canvasOpen} onClose={() => setCanvasOpen(false)} master={master} canvas={canvas} files={files} activeTab={configTab} onTabChange={setConfigTab} />;
}
