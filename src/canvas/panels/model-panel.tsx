// UI/UX layer — lists the models selected by the Workspace bootstrap plus local
// Core models, and lets users test, edit, add, or activate them. All actions go
// through Workspace facades.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon, MdText, fmtMs, text } from '../../ui';
import {
  modelService,
  useWorkspace,
  type CustomModelEntry,
  type ModelConfigFile,
  type ModelOption,
  type ModelTestResult,
} from '../../workspace';
import { ConfigWorkbench } from './config-workbench';

const EMPTY_MODEL_FORM: CustomModelEntry = {
  id: '',
  label: '',
  format: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelId: '',
};

function TestResult({ result, testId }: { result: ModelTestResult; testId: string }) {
  if (!result.ok) return <div className="model-test err" data-testid={testId}><Icon name="x" />{text(result.error || '失败')}</div>;
  return <div className="model-test-result" data-testid={testId}>
    <div className="answer model-test-answer" data-testid={`${testId}-output`}>
      {result.reply ? <MdText className="md-body" text={result.reply} /> : <p>模型返回了空内容。</p>}
    </div>
    <div className="turn-stats model-test-stats" aria-label="模型测试指标">
      <span><b>TTFT</b> {fmtMs(result.ttft)}</span>
      <span><b>TPOT</b> {result.tpot ? `${fmtMs(result.tpot)}/tok` : '—'}</span>
      <span><b>输出</b> {result.outputTokens ?? '—'} tok</span>
      <span><b>输入</b> {result.inputTokens ?? '—'} tok</span>
      <span><b>耗时</b> {fmtMs(result.latencyMs)}</span>
    </div>
  </div>;
}

export function ModelPanel() {
  const { model, workspaceRoot, piInheritanceRevision } = useWorkspace();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<'model' | 'environment' | 'add'>('model');
  const [configTab, setConfigTab] = useState<'canvas' | 'files'>('canvas');
  const [canvasOpen, setCanvasOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 1180px)').matches);
  const [form, setForm] = useState<CustomModelEntry>(EMPTY_MODEL_FORM);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<ModelTestResult | null>(null);
  const [detailTesting, setDetailTesting] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [detailTestRes, setDetailTestRes] = useState<ModelTestResult | null>(null);
  const [testPrompt, setTestPrompt] = useState('');
  const [modelConfigFile, setModelConfigFile] = useState<ModelConfigFile | null>(null);
  const [modelConfigDraft, setModelConfigDraft] = useState('');
  const [modelConfigLoading, setModelConfigLoading] = useState(false);
  const [modelConfigTree, setModelConfigTree] = useState({ workspace: true, core: true });
  const [selectedConfigFile, setSelectedConfigFile] = useState<'models' | 'auth'>('models');
  const [modelConfigSaving, setModelConfigSaving] = useState(false);
  const [modelConfigErr, setModelConfigErr] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ label: '', baseUrl: '', apiKey: '', modelId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cwdInput, setCwdInput] = useState(workspaceRoot || '');
  const [cwdSaving, setCwdSaving] = useState(false);
  const [cwdErr, setCwdErr] = useState<string | null>(null);
  const jsonRef = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void modelService.listModels().then(next => {
      setModels(next);
      setSelectedId(current => next.some(item => item.id === current) ? current : (next.find(item => item.active)?.id || next[0]?.id || null));
    });
    setTestRes(null);
    setErr(null);
  }, [piInheritanceRevision]);
  useEffect(() => { setCwdInput(workspaceRoot || ''); }, [workspaceRoot]);

  const selected = useMemo(() => models.find(item => item.id === selectedId) || null, [models, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setDetailDraft({ label: selected.label || '', baseUrl: selected.baseUrl || '', apiKey: '', modelId: selected.modelId || '' });
  }, [selected]);

  const refreshModels = async (preferredId?: string | null) => {
    const next = await modelService.listModels();
    setModels(next);
    setSelectedId(current => {
      const wanted = preferredId || current;
      return next.some(item => item.id === wanted) ? wanted : (next.find(item => item.active)?.id || next[0]?.id || null);
    });
    return next;
  };

  const loadModelConfigFile = async () => {
    setSelectedConfigFile('models');
    setModelConfigLoading(true); setModelConfigErr(null);
    try {
      const file = await modelService.getConfigFile();
      setModelConfigFile(file); setModelConfigDraft(file.content);
    } catch (e: any) { setModelConfigErr(e?.message || '无法读取 Core models.json'); }
    finally { setModelConfigLoading(false); }
  };

  const openDetail = (mode: 'model' | 'environment' | 'add', id?: string) => {
    if (id) setSelectedId(id);
    setConfigTab('canvas');
    setDetailMode(mode);
    setCanvasOpen(true);
    setErr(null);
    setTestRes(null);
    setDetailTestRes(null);
  };

  const onConfigTabChange = (tab: 'canvas' | 'files') => {
    setConfigTab(tab);
    if (tab === 'files' && !modelConfigLoading) void loadModelConfigFile();
  };

  const onCwdSave = async () => {
    setCwdSaving(true); setCwdErr(null);
    const r = await modelService.setCwd(cwdInput.trim());
    setCwdSaving(false);
    if (!r.ok) setCwdErr(r.error || '设置失败');
  };

  // Folder picker (like the zip/json uploads). A browser folder picker only exposes a path
  // relative to the chosen folder (webkitRelativePath) — never the absolute location — so we
  // prefill the top folder name and let the user adjust before saving.
  const onPickDir = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rel = (f as any).webkitRelativePath as string | undefined;
    const top = rel ? rel.replace(/\\/g, '/').split('/')[0] : f.name;
    if (top) { setCwdInput(top); setCwdErr(null); }
    e.target.value = '';
  };

  // Core interprets imported configuration so Provider aliases and SDK schema rules do not
  // leak into Canvas.
  const onJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    const result = await modelService.parseConfigFile(await f.text());
    if (!result.ok || !result.entry) {
      setErr(result.error || 'Core 无法解析该模型配置');
      return;
    }
    const parsed = result.entry;
    setForm(previous => ({
      ...previous,
      id: parsed.id || previous.id,
      label: parsed.label || previous.label,
      format: parsed.format || previous.format,
      baseUrl: parsed.baseUrl || previous.baseUrl,
      apiKey: parsed.apiKey || '',
      modelId: parsed.modelId || previous.modelId,
    }));
    openDetail('add');
    setErr(result.missing?.length ? `配置缺少：${result.missing.join('、')}` : null);
  };

  const set = (k: keyof CustomModelEntry, v: string) => setForm(f => ({ ...f, [k]: v }));

  const onTest = async () => {
    setTesting(true); setTestRes(null); setErr(null);
    setTestRes(await modelService.testCustom(form, testPrompt));
    setTesting(false);
  };

  const isHttpUrl = (value: string | undefined) => Boolean(value && /^https?:\/\//i.test(value.trim()));

  const onTestDetail = async () => {
    if (!selected) return;
    setDetailTesting(true); setDetailTestRes(null); setErr(null);
    setDetailTestRes(await modelService.test(selected.provider, selected.modelId, false, testPrompt));
    setDetailTesting(false);
  };
  const onBenchmarkDetail = async () => {
    if (!selected) return;
    setBenchmarking(true); setDetailTestRes(null); setErr(null);
    setDetailTestRes(await modelService.test(selected.provider, selected.modelId, true));
    setBenchmarking(false);
  };
  const onSaveModelConfigFile = async () => {
    setModelConfigSaving(true); setModelConfigErr(null);
    const result = await modelService.saveConfigFile(modelConfigDraft);
    setModelConfigSaving(false);
    if (!result.ok) { setModelConfigErr(result.error || '保存失败'); return; }
    if (result.file) { setModelConfigFile(result.file); setModelConfigDraft(result.file.content); }
    await refreshModels(selectedId);
  };
  const onSaveDetailConfig = async () => {
    if (!selected) return;
    const nextModelId = detailDraft.modelId.trim();
    if (!nextModelId) { setErr('模型 ID 不能为空'); return; }
    setModelConfigSaving(true); setErr(null);
    try {
      const result = await modelService.update(selected.provider, selected.modelId, {
        label: detailDraft.label.trim() || nextModelId,
        format: selected.format || 'openai',
        baseUrl: detailDraft.baseUrl.trim(),
        apiKey: detailDraft.apiKey.trim() || undefined,
        modelId: nextModelId,
      });
      if (!result.ok) throw new Error(result.error || '保存失败');
      if (modelConfigFile) await loadModelConfigFile();
      await refreshModels(`${selected.provider}/${nextModelId}`);
    } catch (e: any) { setErr(e?.message || '保存 Core 模型配置失败'); }
    finally { setModelConfigSaving(false); }
  };
  const onSave = async () => {
    setBusy(true); setErr(null);
    const r = await modelService.addCustom(form);
    setBusy(false);
    if (r.ok) {
      const savedModelId = form.modelId;
      const savedLabel = form.label;
      setForm(EMPTY_MODEL_FORM); setTestRes(null);
      const next = await refreshModels();
      const added = next.find(item => item.custom && item.modelId === savedModelId && item.label === savedLabel)
        || next.find(item => item.custom && item.modelId === savedModelId);
      if (added) setSelectedId(added.id);
      setDetailMode('model');
      await modelService.refreshHealth();
    } else {
      setErr(r.error || '保存失败');
    }
  };
  const onRemove = async (id: string) => {
    await modelService.removeCustom(id);
    await refreshModels(null);
    await modelService.refreshHealth();
  };
  const onActivate = async (m: ModelOption) => {
    if (m.active || busy) return;
    setBusy(true); setErr(null);
    const r = await modelService.setActive(m.provider, m.modelId);
    setBusy(false);
    if (!r.ok) setErr(r.error || '切换失败');
    await refreshModels(m.id);
  };

  const at = (model || '').indexOf('/');
  const provider = at >= 0 ? model!.slice(0, at) : '';

  const master = (
    <div className="model-workbench-master">
      <div className="drawer-head">
        <span>模型配置</span>
        <span className="model-tag">{provider || '当前会话'}</span>
      </div>
      <div className="config-master-intro">
        <b>选择模型，前往 Canvas 完成配置</b>
        <span>列表只负责浏览；激活、目录与连接测试都在右侧进行。</span>
      </div>
      <div className="model-section-label"><span>可用模型</span><span>{models.length} 项</span></div>
      <div className="model-list scroll" data-testid="model-list">
        {models.length === 0 && <div className="model-empty">还没有可用模型，添加一个自定义模型开始吧。</div>}
        {models.map(m => (
          <button
            type="button"
            key={m.id}
            className={`model-opt${m.id === selectedId && detailMode === 'model' ? ' active' : ''}${m.active ? ' is-current' : ''}`}
            data-testid="model-option"
            aria-pressed={m.id === selectedId && detailMode === 'model'}
            onClick={() => openDetail('model', m.id)}
          >
            <span className="mo-ico"><Icon name={m.custom ? 'cpu' : 'spark'} /></span>
            <span className="mo-main">
              <b>{text(m.label)}</b>
              <small>{text(m.provider + '/' + m.modelId)} · Core 配置</small>
            </span>
            {m.active && <span className="model-current" data-testid="model-active"><Icon name="check" />当前</span>}
            <Icon name="chevron" className="config-row-arrow" />
          </button>
        ))}
      </div>
      <div className="model-section-label"><span>配置入口</span></div>
      <div className="config-entry-list">
        <button type="button" className={`model-opt${detailMode === 'environment' ? ' active' : ''}`} data-testid="model-environment" onClick={() => openDetail('environment')}>
          <span className="mo-ico"><Icon name="folder" /></span>
          <span className="mo-main"><b>Workspace 根目录</b><small>{text(workspaceRoot || '.workspace')}</small></span>
          <Icon name="chevron" className="config-row-arrow" />
        </button>
        <button type="button" className={`model-opt${detailMode === 'add' ? ' active' : ''}`} data-testid="add-custom-model" onClick={() => openDetail('add')}>
          <span className="mo-ico"><Icon name="plus" /></span>
          <span className="mo-main"><b>添加自定义模型</b><small>导入模型配置或手动连接</small></span>
          <Icon name="chevron" className="config-row-arrow" />
        </button>
      </div>
    </div>
  );

  const canvas = detailMode === 'environment' ? (
    <section className="config-detail-card config-environment" data-testid="model-environment-detail">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name="folder" /></span>
        <div><span>运行环境</span><h2>选择 Workspace 根目录</h2><p>模型配置位于根目录；每个 Agent 的 Files 与 Traj 使用独立的 sessionId 子目录。</p></div>
      </div>
      <div className="config-form-section">
        <label className="config-field-label" htmlFor="model-cwd">Workspace 根目录</label>
        <div className="cfg-cwd">
          <input id="model-cwd" className="cfg-input" data-testid="cwd-input" value={cwdInput} onChange={e => setCwdInput(e.target.value)} placeholder=".workspace" spellCheck={false} />
          <button className="pill" data-testid="cwd-save" disabled={cwdSaving || !cwdInput.trim() || cwdInput.trim() === (workspaceRoot || '')} onClick={onCwdSave}>{cwdSaving ? '保存中…' : '应用目录'}</button>
        </div>
        <button className="btn-upload config-picker" data-testid="cwd-pick" onClick={() => dirRef.current?.click()}><Icon name="folder" />从本机选择目录</button>
        <input ref={dirRef} type="file" {...({ webkitdirectory: '', directory: '' } as any)} onChange={onPickDir} hidden />
        <p className="config-field-hint">浏览器会先读取所选目录名，你可以在应用前校对完整路径。</p>
        {cwdErr && <div className="model-test err"><Icon name="x" /> {text(cwdErr)}</div>}
      </div>
    </section>
  ) : detailMode === 'add' ? (
    <section className="config-detail-card" data-testid="custom-model-form">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name="cpu" /></span>
        <div><span>模型连接</span><h2>添加自定义模型</h2><p>先导入或填写配置，再在同一面板内完成连接测试。</p></div>
      </div>
      <div className="model-form config-model-form">
        <button className="btn-upload" data-testid="cm-upload" onClick={() => jsonRef.current?.click()}><Icon name="paperclip" />上传模型配置</button>
        <input ref={jsonRef} type="file" accept=".json,application/json" onChange={onJson} hidden />
        <div className="seg" data-testid="format-seg">
          {(['openai', 'anthropic'] as const).map(f => (
            <button type="button" key={f} className={form.format === f ? 'on' : ''} onClick={() => set('format', f)} data-testid={`fmt-${f}`}>{f === 'openai' ? 'OpenAI 格式' : 'Anthropic 格式'}</button>
          ))}
        </div>
        <label className="config-field-label">显示名称<input placeholder="如 我的 GPT" value={form.label} onChange={e => set('label', e.target.value)} data-testid="cm-label" /></label>
        <label className="config-field-label">Base URL<input placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} data-testid="cm-baseurl" spellCheck={false} /></label>
        <label className="config-field-label">API Key<input placeholder="sk-…" type="password" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} data-testid="cm-apikey" spellCheck={false} /></label>
        <label className="config-field-label">模型 ID<input placeholder="如 gpt-4o-mini" value={form.modelId} onChange={e => set('modelId', e.target.value)} data-testid="cm-modelid" spellCheck={false} /></label>
        <label className="model-test-prompt"><textarea data-testid="custom-model-test-prompt" value={testPrompt} onChange={event => setTestPrompt(event.target.value)} placeholder="输入要发送给模型的测试内容" rows={3} /></label>
      {testRes && <TestResult result={testRes} testId="custom-model-test" />}
        {err && <div className="model-test err"><Icon name="x" /> {text(err)}</div>}
        <div className="model-form-acts config-form-actions">
          <button className="pill" disabled={testing || !testPrompt.trim()} onClick={onTest} data-testid="cm-test"><Icon name="refresh" />{testing ? '测试中…' : '测试连接'}</button>
          <button className="send config-primary-action" disabled={busy || !form.label.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || !form.modelId.trim()} onClick={onSave} data-testid="cm-save">{busy ? '保存中…' : '保存模型'}</button>
        </div>
      </div>
    </section>
  ) : selected ? (
    <section className="config-detail-card" data-testid="model-detail">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name={selected.custom ? 'cpu' : 'spark'} /></span>
        <div><span>Core 模型</span><h2>{text(detailDraft.label || selected.label)}</h2><p>{text(selected.provider + '/' + (detailDraft.modelId || selected.modelId))}</p></div>
        <span className={`config-status${selected.active ? ' active' : ''}`}><i />{selected.active ? '当前使用' : '待选择'}</span>
      </div>
      <dl className="config-detail-grid">
        <div><dt>Provider</dt><dd>{text(selected.provider)}</dd></div>
        <div><dt>显示名称</dt><dd><input data-testid="model-detail-label" value={detailDraft.label} onChange={e => setDetailDraft(draft => ({ ...draft, label: e.target.value }))} /></dd></div>
        <div><dt>Base URL</dt><dd className="model-config-value"><input data-testid="model-detail-baseurl" value={detailDraft.baseUrl} onChange={e => setDetailDraft(draft => ({ ...draft, baseUrl: e.target.value }))} spellCheck={false} /></dd></div>
        <div><dt>Model ID</dt><dd><input data-testid="model-detail-modelid" value={detailDraft.modelId} onChange={e => setDetailDraft(draft => ({ ...draft, modelId: e.target.value }))} spellCheck={false} /></dd></div>
        <div><dt>API Key</dt><dd className="model-config-value"><input data-testid="model-detail-apikey" type="password" value={detailDraft.apiKey} onChange={e => setDetailDraft(draft => ({ ...draft, apiKey: e.target.value }))} placeholder={selected.apiKeyConfigured ? '已由 Core 安全存储；留空不修改' : '输入新的 API Key'} spellCheck={false} aria-label="API Key" /></dd></div>
        {selected.custom && selected.baseUrl ? (
          <div>
            <dt>测试链接</dt>
            <dd>
              {isHttpUrl(selected.baseUrl)
                ? <a href={text(selected.baseUrl)} target="_blank" rel="noreferrer" className="model-detail-link">{text(selected.baseUrl)}</a>
                : <span>{text(selected.baseUrl)}</span>}
            </dd>
          </div>
        ) : null}
        <div><dt>来源</dt><dd>{selected.sourceLabel || (selected.configSource === 'core' ? 'Core models.json' : 'pi-ai SDK Provider')}</dd></div>
        <div><dt>会话状态</dt><dd>{selected.active ? '正在使用' : '未激活'}</dd></div>
      </dl>
      <label className="model-test-prompt"><textarea data-testid="model-test-prompt" value={testPrompt} onChange={event => setTestPrompt(event.target.value)} placeholder="输入要发送给模型的测试内容" rows={3} disabled={detailTesting || benchmarking} /></label>
      {(detailTesting || benchmarking) && <div className="model-test-progress" data-testid="model-test-progress" role="status" aria-label={benchmarking ? 'Benchmark 正在运行' : 'Thinking 连通性测试正在运行'}><span className="model-test-progress-copy"><b>{benchmarking ? '输入 → 输出' : 'Thinking · 输入 → 输出'}</b><small>{benchmarking ? '1K → 1K · 8K → 1K · 512 → 512 · 每组 × 3' : `${testPrompt || '测试 Prompt'} → 模型真实回复`}</small></span><span className="model-test-progress-orb"><i /></span></div>}
      {detailTestRes && !detailTestRes.benchmarks && <TestResult result={detailTestRes} testId="model-detail-test" />}
      {!!detailTestRes?.benchmarks?.length && <div className="model-benchmark" data-testid="model-benchmark">
        <div className="model-benchmark-head"><b>Agent Core Benchmark</b><span>实际 token 以 provider usage 为准</span></div>
        {detailTestRes.benchmarks.map((result, index) => <div className={`model-benchmark-row${result.ok ? '' : ' err'}`} key={`${result.inputTarget}-${result.outputTarget}-${index}`}>
          <b>{result.inputTarget >= 1024 ? `${result.inputTarget / 1024}K` : result.inputTarget} → {result.outputTarget >= 1024 ? `${result.outputTarget / 1024}K` : result.outputTarget} × {result.runs}</b>
          <span>输入 {result.inputTokens ?? '—'} · 输出 {result.outputTokens ?? '—'}</span>
          <span>TTFT {fmtMs(result.ttft)} · TPOT {result.tpot ? `${fmtMs(result.tpot)}/tok` : '—'}</span>
          {!result.ok && <em>{text(result.error || '失败')}</em>}
        </div>)}
      </div>}
      {err && <div className="model-test err"><Icon name="x" /> {text(err)}</div>}
      <div className="config-detail-actions">
        <button type="button" className="pill" data-testid="model-detail-save" disabled={modelConfigSaving} onClick={() => void onSaveDetailConfig()}><Icon name="check" />{modelConfigSaving ? '保存中…' : '保存到 Core'}</button>
        <button type="button" className={`pill${detailTesting ? ' is-pending' : ''}`} data-testid="model-test" disabled={detailTesting || benchmarking || !testPrompt.trim()} onClick={() => void onTestDetail()}><Icon name="refresh" />{detailTesting ? '测试中…' : '测试连接'}</button>
        <button type="button" className={`pill${benchmarking ? ' is-pending' : ''}`} data-testid="model-benchmark-run" disabled={detailTesting || benchmarking} onClick={() => void onBenchmarkDetail()}><Icon name="gauge" />{benchmarking ? 'Benchmark 中…' : 'Benchmark · 3 组 × 3'}</button>
        <button type="button" className="send config-primary-action" data-testid="model-activate" disabled={selected.active || busy} onClick={() => void onActivate(selected)}>{busy ? '切换中…' : selected.active ? '已设为当前' : '设为当前模型'}</button>
        {selected.custom && !selected.active && <button type="button" className="config-danger-action" data-testid="model-delete" onClick={() => void onRemove(selected.provider)}><Icon name="trash" />删除配置</button>}
      </div>
    </section>
  ) : (
    <div className="canvas-empty"><span className="canvas-empty-ico"><Icon name="cpu" /></span><b>选择一个模型</b><p>配置详情和操作会显示在这个 Canvas 中。</p></div>
  );

  const files = <section className="model-config-files" data-testid="model-config-file">
    <aside className="model-config-file-tree" aria-label="模型配置文件">
      <div className="model-config-files-head"><b>Files</b><span>2</span></div>
      <div className="file-tree" role="tree" aria-label="Pi 运行时配置目录">
        <button type="button" className={`file-row folder${modelConfigTree.workspace ? '' : ' closed'}`} data-testid="model-config-workspace-folder" role="treeitem" aria-level={1} aria-expanded={modelConfigTree.workspace} onClick={() => setModelConfigTree(tree => ({ ...tree, workspace: !tree.workspace }))}><span className="indent" style={{ width: 0 }} /><span className="tree-ico"><Icon name="folder" /></span><span className="name">.workspace</span></button>
        {modelConfigTree.workspace && <button type="button" className={`file-row folder${modelConfigTree.core ? '' : ' closed'}`} data-testid="model-config-core-folder" role="treeitem" aria-level={2} aria-expanded={modelConfigTree.core} onClick={() => setModelConfigTree(tree => ({ ...tree, core: !tree.core }))}><span className="indent" style={{ width: 16 }} /><span className="tree-ico"><Icon name="folder" /></span><span className="name">.agentcore</span></button>}
        {modelConfigTree.workspace && modelConfigTree.core && <>
          <button type="button" className={`file-row${selectedConfigFile === 'models' ? ' active' : ''}`} data-testid="model-config-models-file" role="treeitem" aria-level={3} aria-current={selectedConfigFile === 'models' ? 'true' : undefined} aria-selected={selectedConfigFile === 'models'} onClick={() => void loadModelConfigFile()}><span className="indent" style={{ width: 32 }} /><span className="tree-ico ftype-code"><Icon name="code" /></span><span className="name">models.json</span></button>
          <button type="button" className={`file-row${selectedConfigFile === 'auth' ? ' active' : ''}`} data-testid="model-config-auth-file" role="treeitem" aria-level={3} aria-current={selectedConfigFile === 'auth' ? 'true' : undefined} aria-selected={selectedConfigFile === 'auth'} onClick={() => { setSelectedConfigFile('auth'); setModelConfigErr(null); }}><span className="indent" style={{ width: 32 }} /><span className="tree-ico"><Icon name="file" /></span><span className="name">auth.json</span></button>
        </>}
      </div>
    </aside>
    <div className="model-config-file-editor-pane">
      {selectedConfigFile === 'auth' ? <>
        <div className="model-config-file-path"><Icon name="file" />{modelConfigFile?.authPath || '.workspace/.agentcore/auth.json'}</div>
        <div className="model-config-file-empty model-config-protected" data-testid="model-config-auth-protected">
          <span className="model-config-protected-icon"><Icon name="settings" /></span>
          <b>凭据由 Core 保护</b>
          <p>auth.json 存在于 Workspace 配置中，但内容不会发送到浏览器。请通过模型详情中的 API Key 输入更新凭据。</p>
        </div>
      </> : <>
        <div className="model-config-file-path"><Icon name="code" />{modelConfigFile?.path || '.workspace/.agentcore/models.json'}</div>
        {modelConfigLoading ? <div className="model-config-file-empty">正在读取配置文件…</div> : <textarea className="model-config-file-editor" data-testid="model-config-json" value={modelConfigDraft} onChange={e => setModelConfigDraft(e.target.value)} onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (!modelConfigSaving) void onSaveModelConfigFile();
          }
        }} spellCheck={false} aria-label="Core models.json 内容" />}
        {modelConfigErr && <div className="model-test err"><Icon name="x" />{text(modelConfigErr)}</div>}
        <div className="model-config-file-actions">
          <button type="button" className="pill" disabled={modelConfigLoading || modelConfigSaving} onClick={() => void loadModelConfigFile()}><Icon name="refresh" />刷新</button>
          <button type="button" className="send config-primary-action" data-testid="model-config-save" disabled={modelConfigLoading || modelConfigSaving} onClick={() => void onSaveModelConfigFile()}>{modelConfigSaving ? '应用中…' : '保存并应用'}</button>
        </div>
      </>}
    </div>
  </section>;

  return <ConfigWorkbench kind="model" title="模型配置" open={canvasOpen} onClose={() => setCanvasOpen(false)} master={master} canvas={canvas} files={files} activeTab={configTab} onTabChange={onConfigTabChange} />;
}
