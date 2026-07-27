import { useState } from 'react';
import type { FileNode } from '../../core/agent/protocol';
import { text } from '../../ui';
import { useWorkspace } from '../../workspace';

export function Editor({ f }: { f: FileNode }) {
  const { getEditBuffer, setEditBuffer, editSaving } = useWorkspace();
  const [value, setValue] = useState(() => getEditBuffer(f.path));
  return (
    <div className="r-edit" data-testid="renderer-edit">
      <div className="r-edit-bar"><span>编辑模式 · {text(f.name)}</span><span className="r-edit-hint">Ctrl+S 保存；切换文件或工作区视图时自动保存；Esc 退出。</span></div>
      <textarea className="r-edit-area" data-testid="editor-area" spellCheck={false} autoFocus readOnly={editSaving} aria-busy={editSaving} value={value} onChange={(event) => { setValue(event.target.value); setEditBuffer(event.target.value); }} />
    </div>
  );
}
