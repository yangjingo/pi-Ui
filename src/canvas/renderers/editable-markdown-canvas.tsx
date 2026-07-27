import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { MdText } from '../../ui';

interface EditableMarkdownCanvasProps {
  path: string;
  text: string;
  onChange?: (value: string) => void;
  onEditStart?: () => void;
  editing?: boolean;
  showTabs?: boolean;
  sourceFirst?: boolean;
}

function resolveInitModeWithPreference(editing: boolean, canEdit: boolean, sourceFirst: boolean) {
  if (!canEdit) return 'preview' as const;
  return editing || sourceFirst ? 'source' as const : 'preview' as const;
}

export function EditableMarkdownCanvas({
  path,
  text,
  onChange,
  onEditStart,
  editing = false,
  showTabs = true,
  sourceFirst = false,
}: EditableMarkdownCanvasProps) {
  const canEdit = !!onChange;
  const [mode, setMode] = useState<'preview' | 'source'>(resolveInitModeWithPreference(editing, canEdit, sourceFirst));
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMode(resolveInitModeWithPreference(editing, canEdit, sourceFirst));
  }, [path, editing, canEdit, sourceFirst]);

  useEffect(() => {
    if (mode === 'source') {
      window.requestAnimationFrame(() => {
        editorRef.current?.focus();
      });
    }
  }, [mode]);

  const value = text;

  const update = (next: string) => {
    if (!canEdit) return;
    if (!editing) {
      onEditStart?.();
    }
    onChange?.(next);
  };

  const switchToSource = () => {
    if (!canEdit) return;
    if (!editing) onEditStart?.();
    setMode('source');
  };

  const switchToPreview = () => setMode('preview');
  const onPreviewInputDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      switchToSource();
    }
  };

  return (
    <div className="r-html-wrap" data-testid="md-canvas-editor">
      {showTabs && (
        <div className="r-html-toolbar">
          <div className="r-html-bar" role="tablist" aria-label={`${path} 视图`}>
            <button
              type="button"
              role="tab"
              data-testid="markdown-preview"
              aria-selected={mode === 'preview'}
              className={mode === 'preview' ? 'on' : ''}
              onClick={switchToPreview}
            >
              预览
            </button>
            <button
              type="button"
              role="tab"
              data-testid="markdown-source"
              aria-selected={mode === 'source'}
              className={mode === 'source' ? 'on' : ''}
              disabled={!canEdit}
              onClick={switchToSource}
            >
              源码
            </button>
          </div>
        </div>
      )}
            <div className="r-html-stage">
        {mode === 'preview'
          ? (
            <div
              className="r-md-preview"
              role={canEdit ? 'textbox' : 'document'}
              tabIndex={canEdit ? 0 : -1}
              aria-label={canEdit ? '可直接编辑' : undefined}
              onClick={switchToSource}
              onDoubleClick={switchToSource}
              onKeyDown={onPreviewInputDown}
            >
              <MdText className="r-doc" text={value || '(空文档)'} />
            </div>
          ) : <div className="r-code" role="tabpanel" aria-label={`${path} 源码编辑`}><textarea ref={editorRef} className="r-edit-area" data-testid="markdown-edit-body" spellCheck={false} value={value} onChange={event => update(event.target.value)} /></div>
        }
      </div>
    </div>
  );
}
