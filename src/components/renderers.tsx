import { useRef, useState } from 'react';
import type * as React from 'react';
import type { FileNode, TrajStep } from '../../core/types';
import { parseCSV } from '../../core/util';
import { esc } from '../render';
import { Icon, fileIcon, trajIcon } from '../icons';
import { useWorkspace } from '../workspace';
import { MdText } from './MdText';

/* ---------- HTML (live preview by default, with a source toggle) ---------- */
export function HtmlRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const content = getFileContent(f.path) || '';
  return (
    <div className="r-html-wrap" data-testid="renderer-html">
      <div className="r-html-bar" role="tablist">
        <button className={mode === 'preview' ? 'on' : ''} data-testid="html-preview" onClick={() => setMode('preview')}>预览</button>
        <button className={mode === 'source' ? 'on' : ''} data-testid="html-source" onClick={() => setMode('source')}>源码</button>
      </div>
      {mode === 'preview' ? (
        content.trim() ? (
          <iframe className="r-html" title={f.name} sandbox="allow-scripts allow-same-origin" srcDoc={content} />
        ) : (
          <div className="r-empty">（{esc(f.name)} 内容为空）</div>
        )
      ) : (
        <div className="r-code"><pre><code>{content || '（空文件）'}</code></pre></div>
      )}
    </div>
  );
}

/* ---------- Source code (rendered as a plain monospaced block, not markdown) ---------- */
export function CodeRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  const content = getFileContent(f.path) || '';
  const dot = f.name.lastIndexOf('.');
  const ext = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : '';
  return (
    <div className="r-code" data-testid="renderer-code">
      <div className="r-code-head"><Icon name="code" /> {esc(f.name)}<span className="r-code-lang">{esc(ext || 'txt')}</span></div>
      <pre><code>{content || '（空文件）'}</code></pre>
    </div>
  );
}

/* ---------- Markdown ---------- */
export function MdRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  return <MdText className="r-doc" testId="renderer-md" text={getFileContent(f.path) || '(空文档)'} />;
}

/* ---------- Sheet (CSV / inline rows) ---------- */
const isTotalRow = (r: string[]) => /合计|总计|共/.test(String(r[0] || ''));

export function SheetRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  const rows = f.rows ? f.rows : parseCSV(getFileContent(f.path));
  const totals: number[] = f.totals || [];
  const head = rows[0] || [];
  const body = rows.slice(1);
  return (
    <div className="r-sheet" data-testid="renderer-sheet">
      <table>
        <thead>
          <tr>{head.map((c, i) => <th key={i}>{esc(String(c))}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className={totals.includes(i + 1) || isTotalRow(r) ? 'total' : ''}>
              {r.map((c, j) => <td key={j}>{esc(String(c))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Image (CSS art by variant) ---------- */
export function ImageRenderer({ f }: { f: FileNode }) {
  let stage: React.ReactNode;
  if (f.variant === 'palette') {
    stage = (
      <div style={{ display: 'flex', gap: 8 }}>
        {['#203C35', '#D8F1B2', '#FBFAF7', '#82B794', '#1f3d35'].map((c, i) => (
          <div key={i} style={{ width: 54, height: 54, borderRadius: 8, background: c, border: c === '#FBFAF7' ? '1px solid #e4e4e6' : undefined }} />
        ))}
      </div>
    );
  } else if (f.variant === 'paper') {
    stage = <div style={{ width: 200, height: 140, borderRadius: 8, background: 'linear-gradient(135deg,#fbfaf7,#efe9da)', boxShadow: 'inset 0 0 40px rgba(120,100,60,.15)' }} />;
  } else if (f.variant === 'map') {
    stage = (
      <div style={{ position: 'relative', width: 240, height: 150, borderRadius: 8, background: 'linear-gradient(135deg,#dfe9e3,#cfe0d8)', overflow: 'hidden' }}>
        <svg viewBox="0 0 240 150" style={{ width: '100%', height: '100%' }}>
          <path d="M0 90 Q60 70 120 95 T240 80" stroke="#7fb6a0" strokeWidth={10} fill="none" opacity={0.5} />
          <circle cx="60" cy="80" r="6" fill="#e86d42" /><circle cx="130" cy="92" r="6" fill="#e86d42" /><circle cx="200" cy="78" r="6" fill="#e86d42" />
          <path d="M60 80 130 92 200 78" stroke="#e86d42" strokeWidth={2} fill="none" strokeDasharray="4 4" />
        </svg>
      </div>
    );
  } else if (f.variant === 'chart') {
    stage = (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 150 }}>
        {[135, 95, 50, 20].map((h, i) => (
          <div key={i} style={{ width: 34, height: h, background: ['#3451d1', '#6b8af2', '#a9bdf8', '#cdd9fc'][i], borderRadius: 5 }} />
        ))}
      </div>
    );
  } else {
    stage = <Icon name="image" />;
  }
  return (
    <div className="r-img" data-testid="renderer-png">
      <div className="stage">{stage}</div>
      <div className="cap"><span>{esc(f.caption || f.name)}</span><span>{esc(f.size || '')}</span></div>
    </div>
  );
}

/* ---------- Fig artboard (from a JSON spec the agent wrote) ---------- */
export function FigRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  let spec: any = {};
  try { spec = JSON.parse(getFileContent(f.path) || '{}'); } catch { /* empty */ }
  const eyebrow = spec.eyebrow || 'SPRING LIVING FESTIVAL';
  const title = (spec.title || '万物\n正在醒来').replace(/\n/g, '<br>');
  const subtitle = spec.subtitle || '';
  const date = spec.date || '';
  const m = spec.market || {};
  const mdesc = (m.desc || '').replace(/\n/g, '<br>');
  const bg = spec.bg || '#203c35';
  const cc = spec.copyColor || '#f7f3e6';

  const abRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<{ l: number; t: number; w: number; h: number } | null>(null);

  const select = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const ab = abRef.current;
    if (!ab) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ar = ab.getBoundingClientRect();
    setSel({ l: r.left - ar.left, t: r.top - ar.top, w: r.width, h: r.height });
  };

  return (
    <div data-testid="renderer-fig" style={{ position: 'relative' }}>
      <div className="artboard" ref={abRef} onClick={() => setSel(null)}>
        <div className="ab-bg ab-layer" style={{ background: bg }} onClick={select} />
        <div className="ab-grain" />
        <div className="ab-orb ab-layer" onClick={select} />
        <div className="ab-copy ab-layer" style={{ color: cc }} onClick={select}>
          <small>{esc(eyebrow)}</small>
          <h2 dangerouslySetInnerHTML={{ __html: title }} />
          <p>{esc(subtitle)}</p>
          {date ? <span className="ab-pill">{esc(date)}</span> : null}
        </div>
        <div className="ab-card ab-layer" onClick={select}>
          <b>{esc(m.title || '')}</b>
          <p dangerouslySetInnerHTML={{ __html: mdesc }} />
        </div>
        {sel && (
          <div className="ab-sel" style={{ left: sel.l, top: sel.t, width: sel.w, height: sel.h }}>
            <i style={{ left: -4, top: -4 }} /><i style={{ right: -4, top: -4 }} />
            <i style={{ left: -4, bottom: -4 }} /><i style={{ right: -4, bottom: -4 }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- dispatcher ---------- */
export function FileRenderer({ f }: { f: FileNode }) {
  switch (f.type) {
    case 'fig': return <FigRenderer f={f} />;
    case 'html': return <HtmlRenderer f={f} />;
    case 'md': return <MdRenderer f={f} />;
    case 'sheet': return <SheetRenderer f={f} />;
    case 'png': return <ImageRenderer f={f} />;
    case 'code': return <CodeRenderer f={f} />;
    default: return null;
  }
}

/* ---------- step result (right panel when a traj step is clicked) ---------- */
export function StepResult({ step, file }: { step: TrajStep; file?: string }) {
  const { active, openInCanvas } = useWorkspace();
  const f = file ? findIn(active.files, file) : null;
  return (
    <div className="step-result" data-testid="renderer-step">
      <div className="step-head">
        <span className={`step-ico ${step.status}`}><Icon name={trajIcon(step.t)} /></span>
        <div className="step-hd">
          <b>{esc(step.title)}</b>
          <div className="step-sub">
            {step.status === 'running' ? <span className="badge live">进行中</span> : <span className="badge done">已完成</span>}
            <span className="step-det">{esc(step.det)}</span>
            <span className="step-time">{esc(step.time)}</span>
          </div>
        </div>
      </div>
      {step.t === 'think' ? (
        <div className="step-think" data-testid="step-think">
          <span className="lab">思考</span>
          <div className="step-think-body">{esc(step.text || step.det || '（无）')}</div>
        </div>
      ) : (
        <>
          <div className="step-io"><span className="lab">输入</span><div className="step-io-body">{esc(step.in || '（无）')}</div></div>
          <div className="step-io"><span className="lab">输出</span><div className="step-io-body">{esc(step.out || '（无输出）')}</div></div>
          <div className="step-info" data-testid="step-info">
            <div className="step-info-cell"><span className="lab">类型</span><b>{esc(step.title)}</b></div>
            <div className="step-info-cell">
              <span className="lab">状态</span>
              <b className={`step-info-status ${step.status}`}>{step.status === 'running' ? '进行中' : '已完成'}</b>
            </div>
            <div className="step-info-cell"><span className="lab">时间</span><b>{esc(step.time || '—')}</b></div>
          </div>
          {file && (
            <div className="step-file">
              <span className="lab">生成文件</span>
              <button className="step-file-btn" onClick={() => openInCanvas(file)}>
                <span className={`tree-ico ftype-${f ? f.type : 'file'}`}><Icon name={fileIcon(f ? f.type : 'file')} /></span>
                {esc(file)}
                <span className="arr">↗</span>
              </button>
            </div>
          )}
          {file && f && (
            <div className="step-preview" data-testid="step-preview"><FileRenderer f={f} /></div>
          )}
        </>
      )}
    </div>
  );
}

function findIn(list: FileNode[], name: string): FileNode | null {
  for (const n of list) {
    if (n.name === name) return n;
    if (n.children) { const r = findIn(n.children, name); if (r) return r; }
  }
  return null;
}

/* ---------- editor ---------- */
export function Editor({ f }: { f: FileNode }) {
  const { getFileContent, setEditBuffer } = useWorkspace();
  return (
    <div className="r-edit" data-testid="renderer-edit">
      <div className="r-edit-bar">
        <span>编辑模式 · {esc(f.name)}</span>
        <span className="r-edit-hint">保存后会写回 Core 文件系统；如需 Agent 重新生成，发一条新消息。</span>
      </div>
      <textarea
        className="r-edit-area"
        data-testid="editor-area"
        spellCheck={false}
        autoFocus
        defaultValue={getFileContent(f.path)}
        onChange={(e) => setEditBuffer(e.target.value)}
      />
    </div>
  );
}
