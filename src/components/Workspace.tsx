import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import type { FileNode } from '../../core/types';
import { countFiles, pathOf } from '../../core/util';
import { Icon, fileIcon } from '../icons';
import { esc } from '../render';
import { useWorkspace } from '../workspace';
import { agentClient } from '../agentClient';
import { FileRenderer, StepResult, Editor } from './renderers';
import { FileTree } from './FileTree';
import { TurnReport } from './TurnReport';
import { ReportView } from './ReportView';

const editable = (f?: FileNode | null) => !!f && (f.type === 'md' || f.type === 'sheet' || f.type === 'html' || f.type === 'code');

export function Workspace() {
  const {
    active, activeTab, canvasTab, activeStep, activeTurn, editing,
    setActiveTab, openInCanvas, closeCanvasTab, toggleFolder,
    enterEdit, exitEdit, saveEdit, navCanvas
  } = useWorkspace();

  const [dragging, setDragging] = useState(false);
  const [fileDrop, setFileDrop] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);

  // Drag-and-drop text files into the data center → write them into the agent's working dir
  // (reuses POST /api/file; the Core emits a 'file' event so the tree refreshes).
  const onFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setFileDrop(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (!dropped.length) return;
    let ok = 0, skip = 0;
    for (const f of dropped) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.includes(0)) { skip++; continue; }            // binary (NUL byte) → skip
      try { await agentClient.saveFile(f.name, new TextDecoder().decode(bytes)); ok++; }
      catch { skip++; }
    }
    setDropMsg(`已上传 ${ok} 个文件${skip ? `，跳过 ${skip} 个（暂仅支持文本文件）` : ''}`);
    window.setTimeout(() => setDropMsg(null), 3000);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(360, Math.min(1400, window.innerWidth - e.clientX));
      document.querySelector('.app')?.setAttribute('style', `--ws-w:${w}px`);
    };
    const onUp = () => { setDragging(false); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const files = active.files;
  const fileCount = countFiles(files);
  const openTabs = active.openTabs;

  let viewport: React.ReactNode;
  let path1 = '—';
  let path2 = '—';
  let editDisabled = true;
  let showSave = false;
  let canNav = false;       // show ← → when a turn/step view is active

  if (activeTurn) {
    const turnMsg = active.messages[activeTurn.mi];
    const agentIdx = active.messages.map((m, i) => (m.role === 'agent' ? i : -1)).filter(i => i >= 0);
    const pos = agentIdx.indexOf(activeTurn.mi);
    viewport = <TurnReport mi={activeTurn.mi} />;
    path1 = '执行报告 · 第 ' + (pos >= 0 ? pos + 1 : '?') + ' 轮';
    path2 = turnMsg?.role === 'agent' ? (turnMsg.intro?.slice(0, 40) || '执行概览') : '执行概览';
    canNav = agentIdx.length > 1;
  } else if (activeStep) {
    const step = active.messages[activeStep.mi]?.traj?.[activeStep.si];
    if (step) {
      viewport = <StepResult step={step} file={step.file} />;
      path1 = '轨迹步骤 · ' + step.title;
      path2 = '步骤输出';
      const traj = active.messages[activeStep.mi]?.traj ?? [];
      canNav = traj.length > 1;
    }
  } else {
    const f = canvasTab ? findIn(files, canvasTab) : null;
    editDisabled = !editable(f);
    showSave = editing;
    if (editing && canvasTab && editable(f)) {
      viewport = <Editor f={f!} />;
      path1 = pathOf(active, f!) + ' · 编辑中';
      path2 = '编辑模式';
    } else if (!canvasTab) {
      viewport = <div style={{ color: 'var(--content-tertiary)', fontSize: '12.5px', textAlign: 'center' }}>点击左侧轨迹步骤查看输出，或打开一个文件。</div>;
    } else if (f) {
      viewport = <FileRenderer f={f} />;
      const p = pathOf(active, f);
      path1 = p; path2 = p;
    }
  }

  return (
    <aside className="workspace col">
      <div
        className={`ws-resizer${dragging ? ' active' : ''}`}
        data-testid="ws-resizer"
        title="拖动调节宽度"
        onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
      />
      <div className="ws-tabs">
        <button className={`ws-tab${activeTab === 'files' ? ' active' : ''}`} data-testid="ws-tab" data-tab="files" onClick={() => setActiveTab('files')}>
          <Icon name="folder" />数据中心 <span className="cnt">{fileCount}</span>
        </button>
        <button className={`ws-tab${activeTab === 'canvas' ? ' active' : ''}`} data-testid="ws-tab" data-tab="canvas" onClick={() => setActiveTab('canvas')}>
          <Icon name="frame" />Canvas
        </button>
        <button className={`ws-tab${activeTab === 'report' ? ' active' : ''}`} data-testid="ws-tab" data-tab="report" onClick={() => setActiveTab('report')}>
          <Icon name="chart" />报告
        </button>
      </div>

      <div className="ws-body scroll">
        <section
          className={`ws-panel${activeTab === 'files' ? ' active' : ''}${fileDrop ? ' file-drop' : ''}`}
          data-testid="files-panel"
          onDragOver={(e) => { e.preventDefault(); if (!fileDrop) setFileDrop(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setFileDrop(false); }}
          onDrop={onFileDrop}
        >
          {fileDrop && (
            <div className="drop-overlay" data-testid="drop-overlay">
              <Icon name="paperclip" /><span>松开以上传文件到工作目录</span>
            </div>
          )}
          <div className="ws-head">
            <b>{esc(active.title)}</b>
            <span>{fileCount} 个文件</span>
          </div>
          {dropMsg && <div className="drop-msg" data-testid="drop-msg">{dropMsg}</div>}
          {files.length === 0 ? (
            <div className="ws-empty">这个工作区还没有文件。<br />给 Agent 派个任务，产物会出现在这里。</div>
          ) : (
            <div className="file-tree" data-testid="file-tree">
              <FileTree list={files} depth={0} active={canvasTab} onToggle={toggleFolder} onOpen={(n) => openInCanvas(n.name)} />
            </div>
          )}
        </section>

        <section className={`ws-panel${activeTab === 'canvas' ? ' active' : ''}`} data-testid="canvas-panel">
          <div className="canvas-shell">
            <div className="canvas-tabs scroll" data-testid="canvas-tabs">
              {openTabs.map(name => {
                const f = findIn(files, name);
                return (
                  <button
                    key={name}
                    className={`canvas-tab${canvasTab === name ? ' active' : ''}`}
                    data-testid="canvas-tab"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-x]')) { e.stopPropagation(); closeCanvasTab(name); return; }
                      openInCanvas(name);
                    }}
                  >
                    <span className={`tree-ico ftype-${f ? f.type : ''}`}><Icon name={fileIcon(f ? f.type : 'file')} /></span>
                    {esc(name)}
                    <span className="x" data-x="1"><Icon name="x" /></span>
                  </button>
                );
              })}
            </div>
            <div className="canvas-bar">
              <span className="dots"><i /><i /><i /></span>
              <span data-testid="canvas-path">{path1}</span>
              <span className="grow" />
              {canNav && (
                <span className="cv-nav" data-testid="canvas-nav">
                  <button className="cv-nav-btn" data-testid="canvas-prev" title="上一项" onClick={() => navCanvas(-1)}><Icon name="chevron" className="rot270" /></button>
                  <button className="cv-nav-btn" data-testid="canvas-next" title="下一项" onClick={() => navCanvas(1)}><Icon name="chevron" className="rot90" /></button>
                </span>
              )}
              <button className="cv-share" title="分享"><Icon name="share" />分享</button>
              <button
                className={`cv-edit${editing ? ' on' : ''}`}
                data-testid="cv-edit"
                title="编辑该文件"
                disabled={editDisabled}
                onClick={() => (editing ? exitEdit() : enterEdit())}
              >
                <Icon name="pencil" />编辑
              </button>
              <span className="tool">100%</span>
            </div>
            <div className="canvas-viewport scroll" data-testid="canvas-viewport">{viewport}</div>
            <div className="canvas-footer">
              <span>{path2}</span>
              <span style={{ flex: 1 }} />
              <button className={`cv-save${showSave ? ' show' : ''}`} data-testid="cv-save" onClick={saveEdit}>
                <Icon name="check" />保存
              </button>
            </div>
          </div>
        </section>

        <section className={`ws-panel${activeTab === 'report' ? ' active' : ''}`} data-testid="report-panel">
          <ReportView />
        </section>
      </div>
    </aside>
  );
}

function findIn(list: FileNode[], name: string): FileNode | null {
  for (const n of list) {
    if (n.name === name) return n;
    if (n.children) { const r = findIn(n.children, name); if (r) return r; }
  }
  return null;
}
