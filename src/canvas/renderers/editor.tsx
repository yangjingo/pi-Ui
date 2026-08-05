import { useState } from 'react';
import type { FileNode } from '../../core/agent/protocol';
import { t, text } from '../../ui';
import { useWorkspace } from '../../workspace';

export function Editor({ f }: { f: FileNode }) {
  const { getEditBuffer, setEditBuffer, editSaving } = useWorkspace();
  const [value, setValue] = useState(() => getEditBuffer(f.path));
  return (
    <div className="r-edit" data-testid="renderer-edit">
      <div className="r-edit-bar"><span>{t('renderer.editMode', { name: text(f.name) })}</span><span className="r-edit-hint">{t('renderer.saveShortcut')}</span></div>
      <textarea className="r-edit-area" data-testid="editor-area" spellCheck={false} autoFocus readOnly={editSaving} aria-busy={editSaving} value={value} onChange={(event) => { setValue(event.target.value); setEditBuffer(event.target.value); }} />
    </div>
  );
}
