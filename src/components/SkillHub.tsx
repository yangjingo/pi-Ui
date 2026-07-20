// UI/UX layer — SkillHub page. Each skill is a directory of files (SKILL.md entry + supporting
// files). Left: the skill list + a new-skill form (manual SKILL.md or zip upload). Right: a file
// browser for the selected skill — a tree (reusing the canvas FileTree) + a viewport that
// previews/edits each file. Pure UI over the skills store; "/name" inlines the SKILL.md body.

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { FileNode } from '../../core/types';
import { buildFileTree } from '../../core/util';
import { Icon } from '../icons';
import { esc } from '../render';
import {
  useSkills, addSkill, updateSkill, updateSkillFile, addSkillFile, removeSkillFile, removeSkill,
  makeSkillMd, skillToFileNodes, entryPath,
} from '../skills';
import { parseSkillZip } from '../skillZip';
import { FileTree } from './FileTree';
import { SkillFileView } from './SkillFileView';

const ENTRY = 'SKILL.md';
const ZIP_ERR: Record<string, string> = {
  'no-skill': 'zip 内未找到 SKILL.md',
  'empty-body': 'SKILL.md 没有 frontmatter 之后的正文',
  'too-big': 'zip 过大或压缩比异常（上限 4MB / 200 文件 / 8MB 解压后）',
  'bad-zip': 'zip 解压失败，请确认是有效的 zip 文件',
};

export function SkillHub() {
  const skills = useSkills();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => skills.find(s => s.id === selectedId) || null, [skills, selectedId]);

  // file browser (right pane)
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [fileBuf, setFileBuf] = useState('');
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  // skill header (name/desc) inline edit
  const [hName, setHName] = useState('');
  const [hDesc, setHDesc] = useState('');

  // new-skill form (left pane)
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Record<string, string> | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setImportErr(null); }, []);

  // (Re)load browser state whenever the selection changes.
  useEffect(() => {
    if (selected) {
      setSelectedFilePath(entryPath(selected));
      setMode('preview');
      setHName(selected.name);
      setHDesc(selected.desc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Load the edit buffer when entering edit mode (or switching file while editing).
  useEffect(() => {
    if (selected && mode === 'edit') setFileBuf(selected.files[selectedFilePath] || '');
  }, [mode, selectedFilePath, selected]);

  const fileTree = useMemo(() => {
    if (!selected) return [];
    const tree = buildFileTree(skillToFileNodes(selected));
    const apply = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') {
          (n as any).open = !closedFolders.has(n.path || n.name);
          if (n.children) apply(n.children);
        }
      }
    };
    apply(tree);
    return tree;
  }, [selected, closedFolders]);

  const reset = () => { setName(''); setDesc(''); setBody(''); setPendingFiles(null); };

  const add = () => {
    const files = pendingFiles || { [ENTRY]: makeSkillMd(name, desc, body) };
    if (addSkill({ name, desc, files })) reset();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportErr(null);
    const fname = f.name.toLowerCase();
    if (fname.endsWith('.zip')) {
      f.arrayBuffer()
        .then(buf => {
          const r = parseSkillZip(buf);
          if (r.ok) {
            setPendingFiles(r.skill.files);
            setName(r.skill.name);
            setDesc(r.skill.desc);
            setBody('');
            setImportErr(null);
          } else {
            setImportErr(ZIP_ERR[r.reason] || '导入失败');
          }
        })
        .catch(() => setImportErr('zip 读取失败，请确认是有效的 zip 文件'));
    } else {
      // single text file → treat as the SKILL.md body for a new skill
      const reader = new FileReader();
      reader.onload = () => {
        setPendingFiles(null);
        setName(f.name.replace(/\.[^.]+$/, ''));
        setDesc(`从 ${f.name} 导入`);
        setBody(String(reader.result || ''));
      };
      reader.readAsText(f);
    }
    e.target.value = '';
  };

  const openFile = (node: FileNode) => { setSelectedFilePath(node.path || node.name); setMode('preview'); };
  const toggleFolder = (node: FileNode) => setClosedFolders(prev => {
    const n = new Set(prev);
    const key = node.path || node.name;
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const saveFile = () => {
    if (!selected) return;
    updateSkillFile(selected.id, selectedFilePath, fileBuf);
    setMode('preview');
  };
  const newFile = () => {
    if (!selected) return;
    const p = (window.prompt('新文件路径（如 references/notes.md）', 'new.md') || '').trim();
    if (!p) return;
    if (addSkillFile(selected.id, p, '')) { setSelectedFilePath(p); setMode('edit'); }
  };
  const delFile = (path: string) => {
    if (!selected) return;
    if (removeSkillFile(selected.id, path) && selectedFilePath === path) setSelectedFilePath(entryPath(selected));
  };
  const saveHeader = () => {
    if (selected) updateSkill(selected.id, { name: hName, desc: hDesc });
  };
  const del = () => { if (selected) { removeSkill(selected.id); setSelectedId(null); } };

  const fileCount = selected ? Object.keys(selected.files).length : 0;

  return (
    <div className="skillhub">
      <div className="drawer-head">
        <span className="dh-title"><Icon name="blocks" /> Skill Hub</span>
        <span className="skill-hint">每个 skill 是一个目录；输入框输入 / 引用</span>
      </div>

      <div className="skillhub-split">
        {/* left: list + new-skill form */}
        <div className="skill-pane skill-pane-left">
          <div className="skill-list scroll" data-testid="skill-list">
            {skills.length === 0 && <div className="skill-empty">还没有 Skill。在下方新建，或上传 zip。</div>}
            {skills.map(s => (
              <button
                key={s.id}
                className={`skill-item${s.id === selectedId ? ' active' : ''}`}
                data-testid="skill-item"
                onClick={() => setSelectedId(s.id)}
              >
                <span className="skill-meta">
                  <b>/{esc(s.name)}</b>
                  {s.desc && <span>{esc(s.desc)}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="skill-add">
            {importErr && <div className="skill-import-err" data-testid="skill-import-err">{importErr}</div>}
            {pendingFiles && <div className="skill-import-err" style={{ color: 'var(--success)', background: 'var(--success-soft)' }}>zip 已解析：{Object.keys(pendingFiles).length} 个文件，将整包导入</div>}
            <button className="btn-upload" data-testid="skill-upload" onClick={() => fileRef.current?.click()}>
              <Icon name="paperclip" /> 上传 zip（SKILL.md 包）
            </button>
            <input ref={fileRef} type="file" accept=".zip,.md,.markdown,.txt" onChange={onFile} hidden />
            <div className="skill-add-bar">
              <input className="sa-input" placeholder="名称（如：周报）" value={name} onChange={e => setName(e.target.value)} data-testid="skill-name" />
              <input className="sa-input" placeholder="一句话描述（可选）" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            <textarea
              className="sa-body"
              data-testid="skill-body"
              placeholder={pendingFiles ? '（zip 已提供文件，此处留空即可）' : 'SKILL.md 正文（输入框输入「/名称」时注入这段内容）'}
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={3}
              disabled={!!pendingFiles}
            />
            <button className="sa-save" data-testid="skill-save" disabled={!name.trim() || (!pendingFiles && !body.trim())} onClick={add}>
              <Icon name="plus" /> 添加 Skill
            </button>
          </div>
        </div>

        {/* right: file browser for the selected skill */}
        <div className="skill-pane skill-pane-right">
          {selected ? (
            <div className="skill-detail" data-testid="skill-detail">
              <div className="skill-detail-head">
                <span className="skill-detail-title">
                  <span className="prefix">/</span>
                  <input className="skill-name-input" data-testid="skill-edit-name" value={hName} onChange={e => setHName(e.target.value)} onBlur={saveHeader} />
                </span>
                <button className="skill-del-btn" data-testid="skill-del" title="删除该 Skill" onClick={del}><Icon name="trash" /></button>
              </div>
              <input className="sa-input skill-desc-input" value={hDesc} placeholder="一句话描述" onChange={e => setHDesc(e.target.value)} onBlur={saveHeader} />

              <div className="skill-files-toolbar">
                <span className="lab">文件 ({fileCount})</span>
                <span className="grow" />
                <button className="skill-mini-btn" data-testid="skill-add-file" onClick={newFile}><Icon name="plus" /> 添加文件</button>
              </div>
              <div className="skill-file-tree scroll">
                <FileTree list={fileTree} active={selectedFilePath} onToggle={toggleFolder} onOpen={openFile} />
              </div>

              <div className="skill-viewport">
                <div className="skill-viewport-head">
                  <span className="sv-path">{esc(selectedFilePath)}</span>
                  <span className="grow" />
                  <div className="r-html-bar" role="tablist">
                    <button className={mode === 'preview' ? 'on' : ''} data-testid="skill-preview" onClick={() => setMode('preview')}>预览</button>
                    <button className={mode === 'edit' ? 'on' : ''} data-testid="skill-edit" onClick={() => setMode('edit')}>改写</button>
                  </div>
                </div>
                <div className="skill-viewport-body scroll">
                  {mode === 'preview' ? (
                    <SkillFileView path={selectedFilePath} content={selected.files[selectedFilePath] || ''} />
                  ) : (
                    <div className="skill-edit-form">
                      <textarea
                        className="sa-body skill-edit-area"
                        data-testid="skill-edit-body"
                        value={fileBuf}
                        onChange={e => setFileBuf(e.target.value)}
                        rows={16}
                      />
                      <div className="skill-edit-foot">
                        <button className="sa-save" data-testid="skill-edit-save" onClick={saveFile}><Icon name="check" /> 保存</button>
                        {selectedFilePath !== ENTRY && (
                          <button className="skill-del-btn" data-testid="skill-del-file" onClick={() => delFile(selectedFilePath)}><Icon name="trash" /> 删除该文件</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="skill-detail-empty">选择左侧的 skill 浏览、预览或改写其中的文件。</div>
          )}
        </div>
      </div>
    </div>
  );
}
