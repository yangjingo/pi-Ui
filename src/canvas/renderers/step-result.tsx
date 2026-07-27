import type { FileNode, TrajStep } from '../../core/agent/protocol';
import { Icon, fileIcon, trajIcon, text } from '../../ui';
import { useWorkspace } from '../../workspace';
import { FileRenderer } from './file-renderer';

function formatTrajectoryPayload(value?: string, fallback = '（无）'): string {
  if (!value) return fallback;
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
}

export function StepResult({ step, file, index = 0, total = 1 }: { step: TrajStep; file?: string; index?: number; total?: number }) {
  const { active, openInCanvas } = useWorkspace();
  const selected = file ? findIn(active.files, file) : null;
  const kind = step.t === 'code' ? 'BASH' : step.t.toUpperCase();
  const isThinking = step.t === 'think';
  return (
    <div className="step-result" data-testid="renderer-step">
      <div className="step-kicker" data-testid="step-position"><span>TRAJECTORY</span><b>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</b></div>
      <div className="step-head">
        <span className={`step-ico ${step.status}`}><Icon name={trajIcon(step.t)} /></span>
        <div className="step-hd">
          <b>{text(step.title)}</b>
          {step.status === 'running' ? <span className="badge live">进行中</span> : <span className="badge done">已完成</span>}
          {!isThinking && <span className="step-det">{text(step.det)}</span>}
          <span className="step-time">{text(step.time)}</span>
        </div>
      </div>
      {isThinking ? (
        <div className="step-think" data-testid="step-think"><span className="lab">完整 Thinking</span><div className="step-think-body">{text(step.text || step.det || '（无）')}</div></div>
      ) : (
        <>
          <div className="step-io" data-testid="step-input"><span className="lab">输入 · {kind}</span><pre className="step-io-body">{formatTrajectoryPayload(step.in)}</pre></div>
          <div className="step-io" data-testid="step-output"><span className="lab">输出</span><pre className="step-io-body">{formatTrajectoryPayload(step.out, step.status === 'running' ? '正在等待工具输出…' : '（无输出）')}</pre></div>
          <div className="step-info" data-testid="step-info"><div className="step-info-cell"><span className="lab">类型</span><b>{text(kind)}</b></div><div className="step-info-cell"><span className="lab">状态</span><b className={`step-info-status ${step.status}`}>{step.status === 'running' ? '进行中' : '已完成'}</b></div><div className="step-info-cell"><span className="lab">时间</span><b>{text(step.time || '—')}</b></div></div>
          {file && <div className="step-file"><span className="lab">生成文件</span><button className="step-file-btn" onClick={() => openInCanvas(file)}><span className={`tree-ico ftype-${selected ? selected.type : 'file'}`}><Icon name={fileIcon(selected ? selected.type : 'file')} /></span>{text(file)}<span className="arr">↗</span></button></div>}
          {file && selected && <div className="step-preview" data-testid="step-preview"><FileRenderer f={selected} /></div>}
        </>
      )}
    </div>
  );
}

function findIn(list: FileNode[], name: string): FileNode | null {
  for (const node of list) {
    if (node.path === name || node.name === name) return node;
    if (node.children) { const result = findIn(node.children, name); if (result) return result; }
  }
  return null;
}
