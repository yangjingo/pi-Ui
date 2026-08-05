// UI/UX layer — lists the models selected by the Workspace bootstrap plus local
// Core models, and lets users test, edit, add, or activate them. All actions go
// through Workspace facades.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { FileUploadIcon, Icon, MdText, fmtMs, t, text } from '../../ui';
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
  if (!result.ok) return <div className="model-test err" data-testid={testId}><Icon name="x" />{text(result.error || t('common.failed'))}</div>;
  return <div className="model-test-result" data-testid={testId}>
    <div className="answer model-test-answer" data-testid={`${testId}-output`}>
      {result.reply ? <MdText className="md-body" text={result.reply} /> : <p>{t('model.emptyReply')}</p>}
    </div>
    <div className="turn-stats model-test-stats" aria-label={t('model.testMetrics')}>
      <span><b>TTFT</b> {fmtMs(result.ttft)}</span>
      <span><b>TPOT</b> {result.tpot ? `${fmtMs(result.tpot)}/tok` : '—'}</span>
      <span><b>OUT</b> {result.outputTokens ?? '—'} tok</span>
      <span><b>IN</b> {result.inputTokens ?? '—'} tok</span>
      <span><b>{t('model.duration')}</b> {fmtMs(result.latencyMs)}</span>
    </div>
  </div>;
}

export function ModelPanel() {
  const { activeId, model, workspaceRoot, piInheritanceRevision } = useWorkspace();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<'model' | 'environment' | 'add'>('model');
  const [configTab, setConfigTab] = useState<'canvas' | 'files'>('canvas');
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
    let active = true;
    setModelsLoading(true);
    void modelService.listModels().then(next => {
      if (!active) return;
      setModels(next);
      setSelectedId(current => next.some(item => item.id === current) ? current : (next.find(item => item.active)?.id || next[0]?.id || null));
    }).catch(reason => {
      if (active) setErr(reason?.message || t('common.failed'));
    }).finally(() => { if (active) setModelsLoading(false); });
    setTestRes(null);
    setErr(null);
    return () => { active = false; };
  }, [piInheritanceRevision]);
  useEffect(() => { setCwdInput(workspaceRoot || ''); }, [workspaceRoot]);

  const selected = useMemo(() => models.find(item => item.id === selectedId) || null, [models, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setDetailDraft({ label: selected.label || '', baseUrl: selected.baseUrl || '', apiKey: '', modelId: selected.modelId || '' });
  }, [selected]);

  const refreshModels = async (preferredId?: string | null) => {
    const next = await modelService.listModels(true);
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
    } catch (e: any) { setModelConfigErr(e?.message || t('model.readConfigFailed')); }
    finally { setModelConfigLoading(false); }
  };

  const openDetail = (mode: 'model' | 'environment' | 'add', id?: string) => {
    if (id) setSelectedId(id);
    setConfigTab('canvas');
    setDetailMode(mode);
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
    if (!r.ok) setCwdErr(r.error || t('model.setFailed'));
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
      setErr(result.error || t('model.parseFailed'));
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
    setErr(result.missing?.length ? t('model.missingConfig', { fields: result.missing.join(', ') }) : null);
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
    if (!result.ok) { setModelConfigErr(result.error || t('model.saveCoreFailed')); return; }
    if (result.file) { setModelConfigFile(result.file); setModelConfigDraft(result.file.content); }
    await refreshModels(selectedId);
  };
  const onSaveDetailConfig = async () => {
    if (!selected) return;
    const nextModelId = detailDraft.modelId.trim();
    if (!nextModelId) { setErr(t('model.modelIdRequired')); return; }
    setModelConfigSaving(true); setErr(null);
    try {
      const result = await modelService.update(selected.provider, selected.modelId, {
        label: detailDraft.label.trim() || nextModelId,
        format: selected.format || 'openai',
        baseUrl: detailDraft.baseUrl.trim(),
        apiKey: detailDraft.apiKey.trim() || undefined,
        modelId: nextModelId,
      });
      if (!result.ok) throw new Error(result.error || t('model.saveCoreFailed'));
      if (modelConfigFile) await loadModelConfigFile();
      await refreshModels(`${selected.provider}/${nextModelId}`);
    } catch (e: any) { setErr(e?.message || t('model.saveCoreFailed')); }
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
      setErr(r.error || t('model.saveCoreFailed'));
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
    if (!activeId) {
      setErr(t('model.createSessionFirst'));
      return;
    }
    const r = await modelService.setActive(activeId, m.provider, m.modelId);
    setBusy(false);
    if (!r.ok) setErr(r.error || t('model.switchFailed'));
    await refreshModels(m.id);
  };

  const at = (model || '').indexOf('/');
  const provider = at >= 0 ? model!.slice(0, at) : '';

  const master = (
    <div className="model-workbench-master">
      <div className="drawer-head">
        <span>{t('model.title')}</span>
        <span className="model-tag">{provider || t('model.currentSession')}</span>
      </div>
      <div className="config-master-intro">
        <b>{t('model.introTitle')}</b>
        <span>{t('model.introHint')}</span>
      </div>
      <div className="model-section-label"><span>{t('model.available')}</span><span>{t('common.selectedCount', { count: models.length })}</span></div>
      <div className="model-list scroll" data-testid="model-list">
        {modelsLoading ? <div className="config-list-loading" role="status" aria-label={t('common.loading')}>{[0, 1, 2, 3, 4].map(index => <i key={index} />)}</div> : models.length === 0 && <div className="model-empty">{t('model.empty')}</div>}
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
              <small>{text(m.provider + '/' + m.modelId)} · {t('model.coreConfig')}</small>
            </span>
            {m.active && <span className="model-current" data-testid="model-active"><Icon name="check" />{t('model.current')}</span>}
            <Icon name="chevron" className="config-row-arrow" />
          </button>
        ))}
      </div>
      <div className="model-section-label"><span>{t('model.runtime')}</span></div>
      <div className="config-entry-list">
        <button type="button" className={`model-opt${detailMode === 'environment' ? ' active' : ''}`} data-testid="model-environment" onClick={() => openDetail('environment')}>
          <span className="mo-ico"><Icon name="folder" /></span>
          <span className="mo-main"><b>{t('model.workspaceRoot')}</b><small>{text(workspaceRoot || '.workspace')}</small></span>
          <Icon name="chevron" className="config-row-arrow" />
        </button>
      </div>
      <div className="model-section-label"><span>{t('model.actions')}</span></div>
      <div className="config-entry-list">
        <button type="button" className={`model-opt${detailMode === 'add' ? ' active' : ''}`} data-testid="add-custom-model" onClick={() => openDetail('add')}>
          <span className="mo-ico"><Icon name="plus" /></span>
          <span className="mo-main"><b>{t('model.addCustom')}</b><small>{t('model.addCustomHint')}</small></span>
          <Icon name="chevron" className="config-row-arrow" />
        </button>
      </div>
    </div>
  );

  const canvas = detailMode === 'environment' ? (
    <section className="config-detail-card config-environment" data-testid="model-environment-detail">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name="folder" /></span>
        <div><span>{t('model.runtime')}</span><h2>{t('model.chooseRoot')}</h2><p>{t('model.rootHint')}</p></div>
      </div>
      <div className="config-form-section">
        <label className="config-field-label" htmlFor="model-cwd">{t('model.workspaceRoot')}</label>
        <div className="cfg-cwd">
          <input id="model-cwd" className="cfg-input" data-testid="cwd-input" value={cwdInput} onChange={e => setCwdInput(e.target.value)} placeholder=".workspace" spellCheck={false} />
          <button className="pill" data-testid="cwd-save" disabled={cwdSaving || !cwdInput.trim() || cwdInput.trim() === (workspaceRoot || '')} onClick={onCwdSave}>{cwdSaving ? t('common.saving') : t('model.applyDirectory')}</button>
        </div>
        <button className="btn-upload config-picker" data-testid="cwd-pick" onClick={() => dirRef.current?.click()}><Icon name="folder" />{t('model.pickDirectory')}</button>
        <input ref={dirRef} type="file" {...({ webkitdirectory: '', directory: '' } as any)} onChange={onPickDir} hidden />
        <p className="config-field-hint">{t('model.pickDirectoryHint')}</p>
        {cwdErr && <div className="model-test err"><Icon name="x" /> {text(cwdErr)}</div>}
      </div>
    </section>
  ) : detailMode === 'add' ? (
    <section className="config-detail-card" data-testid="custom-model-form">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name="cpu" /></span>
        <div><span>{t('model.connection')}</span><h2>{t('model.addCustom')}</h2><p>{t('model.addHint')}</p></div>
      </div>
      <div className="model-form config-model-form">
        <button className="btn-upload" data-testid="cm-upload" onClick={() => jsonRef.current?.click()}><FileUploadIcon />{t('model.uploadConfig')}</button>
        <input ref={jsonRef} type="file" accept=".json,application/json" onChange={onJson} hidden />
        <div className="seg" data-testid="format-seg">
          {(['openai', 'anthropic'] as const).map(f => (
            <button type="button" key={f} className={form.format === f ? 'on' : ''} onClick={() => set('format', f)} data-testid={`fmt-${f}`}>{f === 'openai' ? t('model.openaiFormat') : t('model.anthropicFormat')}</button>
          ))}
        </div>
        <label className="config-field-label">{t('model.displayName')}<input placeholder={t('model.displayNameExample')} value={form.label} onChange={e => set('label', e.target.value)} data-testid="cm-label" /></label>
        <label className="config-field-label">Base URL<input placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} data-testid="cm-baseurl" spellCheck={false} /></label>
        <label className="config-field-label">API Key<input placeholder="sk-…" type="password" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} data-testid="cm-apikey" spellCheck={false} /></label>
        <label className="config-field-label">{t('model.modelId')}<input placeholder={t('model.modelIdExample')} value={form.modelId} onChange={e => set('modelId', e.target.value)} data-testid="cm-modelid" spellCheck={false} /></label>
        <label className="model-test-prompt"><textarea data-testid="custom-model-test-prompt" value={testPrompt} onChange={event => setTestPrompt(event.target.value)} placeholder={t('model.testPrompt')} rows={3} /></label>
      {testRes && <TestResult result={testRes} testId="custom-model-test" />}
        {err && <div className="model-test err"><Icon name="x" /> {text(err)}</div>}
        <div className="model-form-acts config-form-actions">
          <button className="pill" disabled={testing || !testPrompt.trim()} onClick={onTest} data-testid="cm-test"><Icon name="refresh" />{testing ? t('model.testing') : t('model.testConnection')}</button>
          <button className="send config-primary-action" disabled={busy || !form.label.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || !form.modelId.trim()} onClick={onSave} data-testid="cm-save">{busy ? t('common.saving') : t('model.saveModel')}</button>
        </div>
      </div>
    </section>
  ) : selected ? (
    <section className="config-detail-card" data-testid="model-detail">
      <div className="config-detail-heading">
        <span className="config-detail-icon"><Icon name={selected.custom ? 'cpu' : 'spark'} /></span>
        <div><span>{t('model.coreModel')}</span><h2>{text(detailDraft.label || selected.label)}</h2><p>{text(selected.provider + '/' + (detailDraft.modelId || selected.modelId))}</p></div>
        <span className={`config-status${selected.active ? ' active' : ''}`}><i />{selected.active ? t('model.inUse') : t('model.notSelected')}</span>
      </div>
      <dl className="config-detail-grid">
        <div><dt>Provider</dt><dd>{text(selected.provider)}</dd></div>
        <div><dt>{t('model.displayName')}</dt><dd><input data-testid="model-detail-label" value={detailDraft.label} onChange={e => setDetailDraft(draft => ({ ...draft, label: e.target.value }))} /></dd></div>
        <div><dt>Base URL</dt><dd className="model-config-value"><input data-testid="model-detail-baseurl" value={detailDraft.baseUrl} onChange={e => setDetailDraft(draft => ({ ...draft, baseUrl: e.target.value }))} spellCheck={false} /></dd></div>
        <div><dt>Model ID</dt><dd><input data-testid="model-detail-modelid" value={detailDraft.modelId} onChange={e => setDetailDraft(draft => ({ ...draft, modelId: e.target.value }))} spellCheck={false} /></dd></div>
        <div><dt>API Key</dt><dd className="model-config-value"><input data-testid="model-detail-apikey" type="password" value={detailDraft.apiKey} onChange={e => setDetailDraft(draft => ({ ...draft, apiKey: e.target.value }))} placeholder={selected.apiKeyConfigured ? t('model.storedCredential') : t('model.newCredential')} spellCheck={false} aria-label="API Key" /></dd></div>
        {selected.custom && selected.baseUrl ? (
          <div>
            <dt>{t('model.testLink')}</dt>
            <dd>
              {isHttpUrl(selected.baseUrl)
                ? <a href={text(selected.baseUrl)} target="_blank" rel="noreferrer" className="model-detail-link">{text(selected.baseUrl)}</a>
                : <span>{text(selected.baseUrl)}</span>}
            </dd>
          </div>
        ) : null}
        <div><dt>{t('model.source')}</dt><dd>{selected.sourceLabel || (selected.configSource === 'core' ? 'Core models.json' : 'pi-ai SDK Provider')}</dd></div>
        <div><dt>{t('model.sessionStatus')}</dt><dd>{selected.active ? t('model.inUse') : t('model.inactive')}</dd></div>
      </dl>
      <label className="model-test-prompt"><textarea data-testid="model-test-prompt" value={testPrompt} onChange={event => setTestPrompt(event.target.value)} placeholder={t('model.testPrompt')} rows={3} disabled={detailTesting || benchmarking} /></label>
      {(detailTesting || benchmarking) && <div className="model-test-progress" data-testid="model-test-progress" role="status" aria-label={benchmarking ? t('model.benchmarkRunning') : t('model.testRunning')}><span className="model-test-progress-copy"><b>{benchmarking ? t('model.inputOutput') : t('model.thinkingInputOutput')}</b><small>{benchmarking ? '1K → 1K · 8K → 1K · 512 → 512 · × 3' : t('model.realReply', { prompt: testPrompt || t('model.testPromptFallback') })}</small></span><span className="model-test-progress-orb"><i /></span></div>}
      {detailTestRes && !detailTestRes.benchmarks && <TestResult result={detailTestRes} testId="model-detail-test" />}
      {!!detailTestRes?.benchmarks?.length && <div className="model-benchmark" data-testid="model-benchmark">
        <div className="model-benchmark-head"><b>Agent Core Benchmark</b><span>{t('model.usageHint')}</span></div>
        {detailTestRes.benchmarks.map((result, index) => <div className={`model-benchmark-row${result.ok ? '' : ' err'}`} key={`${result.inputTarget}-${result.outputTarget}-${index}`}>
          <b>{result.inputTarget >= 1024 ? `${result.inputTarget / 1024}K` : result.inputTarget} → {result.outputTarget >= 1024 ? `${result.outputTarget / 1024}K` : result.outputTarget} × {result.runs}</b>
          <span>{t('model.inputOutputTokens', { input: result.inputTokens ?? '—', output: result.outputTokens ?? '—' })}</span>
          <span>TTFT {fmtMs(result.ttft)} · TPOT {result.tpot ? `${fmtMs(result.tpot)}/tok` : '—'}</span>
          {!result.ok && <em>{text(result.error || t('common.failed'))}</em>}
        </div>)}
      </div>}
      {err && <div className="model-test err"><Icon name="x" /> {text(err)}</div>}
      <div className="config-detail-actions">
        <button type="button" className="pill" data-testid="model-detail-save" disabled={modelConfigSaving} onClick={() => void onSaveDetailConfig()}><Icon name="check" />{modelConfigSaving ? t('common.saving') : t('model.saveToCore')}</button>
        <button type="button" className={`pill${detailTesting ? ' is-pending' : ''}`} data-testid="model-test" disabled={detailTesting || benchmarking || !testPrompt.trim()} onClick={() => void onTestDetail()}><Icon name="refresh" />{detailTesting ? t('model.testing') : t('model.testConnection')}</button>
        <button type="button" className={`pill${benchmarking ? ' is-pending' : ''}`} data-testid="model-benchmark-run" disabled={detailTesting || benchmarking} onClick={() => void onBenchmarkDetail()}><Icon name="gauge" />{benchmarking ? t('model.benchmarking') : t('model.benchmarkLabel')}</button>
        <button type="button" className="send config-primary-action" data-testid="model-activate" disabled={selected.active || busy} onClick={() => void onActivate(selected)}>{busy ? t('model.switching') : selected.active ? t('model.currentModel') : t('model.setCurrent')}</button>
        {selected.custom && !selected.active && <button type="button" className="config-danger-action" data-testid="model-delete" onClick={() => void onRemove(selected.provider)}><Icon name="trash" />{t('model.deleteConfig')}</button>}
      </div>
    </section>
  ) : modelsLoading ? (
    <div className="config-detail-loading config-detail-loading-centered" role="status" aria-label={t('common.loading')}><i className="config-loader-heading" /><i className="config-loader-copy" /><i className="config-loader-copy short" /><i className="config-loader-field" /><i className="config-loader-field" /></div>
  ) : (
    <div className="canvas-empty"><span className="canvas-empty-ico"><Icon name="cpu" /></span><b>{t('model.selectTitle')}</b><p>{t('model.selectHint')}</p></div>
  );

  const files = <section className="model-config-files" data-testid="model-config-file">
    <aside className="model-config-file-tree" aria-label={t('model.configFiles')}>
      <div className="model-config-files-head"><b>{t('term.files')}</b><span>2</span></div>
      <div className="file-tree" role="tree" aria-label={t('model.runtimeConfigDirectory')}>
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
          <b>{t('model.credentialsProtected')}</b>
          <p>{t('model.credentialsHint')}</p>
        </div>
      </> : <>
        <div className="model-config-file-path"><Icon name="code" />{modelConfigFile?.path || '.workspace/.agentcore/models.json'}</div>
        {modelConfigLoading ? <div className="model-config-file-empty">{t('model.loadingConfig')}</div> : <textarea className="model-config-file-editor" data-testid="model-config-json" value={modelConfigDraft} onChange={e => setModelConfigDraft(e.target.value)} onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (!modelConfigSaving) void onSaveModelConfigFile();
          }
        }} spellCheck={false} aria-label={t('model.configContent')} />}
        {modelConfigErr && <div className="model-test err"><Icon name="x" />{text(modelConfigErr)}</div>}
        <div className="model-config-file-actions">
          <button type="button" className="pill" disabled={modelConfigLoading || modelConfigSaving} onClick={() => void loadModelConfigFile()}><Icon name="refresh" />{t('common.refresh')}</button>
          <button type="button" className="send config-primary-action" data-testid="model-config-save" disabled={modelConfigLoading || modelConfigSaving} onClick={() => void onSaveModelConfigFile()}>{modelConfigSaving ? t('common.applying') : t('model.saveApply')}</button>
        </div>
      </>}
    </div>
  </section>;

  return <ConfigWorkbench kind="model" title={t('model.title')} master={master} canvas={canvas} files={files} activeTab={configTab} onTabChange={onConfigTabChange} />;
}
