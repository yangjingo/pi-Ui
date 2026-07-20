// UI/UX layer — render a skill file's content by type, taking the content as a PROP (skill files
// live in localStorage, not the workspace contents map). Reuses MdText for markdown; code is a
// monospaced block; html is a sandboxed iframe with a preview/source toggle — mirroring the
// canvas HtmlRenderer, but sourced from the prop.

import { useState } from 'react';
import { fileTypeOf } from '../../core/agent';
import { MdText } from './MdText';

export function SkillFileView({ path, content }: { path: string; content: string }) {
  const type = fileTypeOf(path);
  if (type === 'md') return <MdText className="r-doc" text={content || '(空文件)'} />;
  if (type === 'html') return <HtmlPreview srcDoc={content} />;
  return <CodeBlock text={content} />;
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="r-code" data-testid="skill-file-code">
      <pre><code>{text || '（空文件）'}</code></pre>
    </div>
  );
}

function HtmlPreview({ srcDoc }: { srcDoc: string }) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  if (!srcDoc.trim()) return <div className="r-empty">（空文件）</div>;
  return (
    <div className="r-html-wrap" data-testid="skill-file-html">
      <div className="r-html-bar" role="tablist">
        <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>预览</button>
        <button className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')}>源码</button>
      </div>
      {mode === 'preview'
        ? <iframe className="r-html" sandbox="allow-scripts allow-same-origin" srcDoc={srcDoc} title="skill-html" />
        : <CodeBlock text={srcDoc} />}
    </div>
  );
}
