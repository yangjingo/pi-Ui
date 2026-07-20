// UI/UX layer — the model config modal. Lists every selectable model (builtin +
// user-defined), lets the user add an OpenAI/Anthropic-format endpoint, test it,
// and switch the active model. All actions go through the Core via agentClient.

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '../icons';
import { esc } from '../render';
import { agentClient } from '../agentClient';
import { useWorkspace } from '../workspace';
import type { CustomModelEntry, ModelOption, ModelTestResult } from '../../core/types';

const EMPTY_FORM: CustomModelEntry = {
  id: '', label: '', format: 'openai',
  baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: '',
};

/** Leniently parse an uploaded settings.json into custom-model form fields. Tolerates a
 *  wrapper object and common key aliases (baseUrl/base_url/url, apiKey/api_key/key, …). */
function parseModelJson(text: string): Partial<CustomModelEntry> | null {
  let o: any;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const src: any = (o.baseUrl || o.apiKey || o.modelId || o.label || o.format) ? o
    : (o.models && typeof o.models === 'object') ? o.models
    : (o.model && typeof o.model === 'object') ? o.model : o;
  const pick = (...keys: string[]) => {
    for (const k of keys) { const v = src[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
    return undefined;
  };
  const fmt = pick('format', 'provider', 'api', 'apiType');
  return {
    label: pick('label', 'name', 'title'),
    format: (!fmt || /anthropic/i.test(fmt)) ? 'anthropic' : 'openai',
    baseUrl: pick('baseUrl', 'base_url', 'baseURL', 'url', 'endpoint', 'apiBase'),
    apiKey: pick('apiKey', 'api_key', 'apikey', 'key', 'token', 'authorization'),
    modelId: pick('modelId', 'model_id', 'modelID', 'model'),
  };
}

export function ModelDrawer() {
  const { model, cwd } = useWorkspace();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<CustomModelEntry>(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<ModelTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cwdInput, setCwdInput] = useState(cwd || '');
  const [cwdSaving, setCwdSaving] = useState(false);
  const [cwdErr, setCwdErr] = useState<string | null>(null);
  const jsonRef = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef<HTMLInputElement | null>(null);

  // This component is only mounted while the 模型配置 page is active, so loading on mount is
  // equivalent to the old "load when the modal opens".
  useEffect(() => {
    void agentClient.listModels().then(setModels);
    setTestRes(null);
    setErr(null);
  }, []);
  useEffect(() => { setCwdInput(cwd || ''); }, [cwd]);

  const onCwdSave = async () => {
    setCwdSaving(true); setCwdErr(null);
    const r = await agentClient.setCwd(cwdInput.trim());
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

  // Upload a settings.json and fill the custom-model form (review before save), mirroring the
  // SkillHub zip import. Lenient parse — see parseModelJson for accepted key aliases.
  const onJson = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseModelJson(String(reader.result || ''));
      if (!parsed) { setErr('无法解析该 settings.json'); return; }
      setForm(prev => ({
        ...prev,
        ...(parsed.label ? { label: parsed.label } : {}),
        ...(parsed.format ? { format: parsed.format } : {}),
        ...(parsed.baseUrl ? { baseUrl: parsed.baseUrl } : {}),
        ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
        ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
      }));
      setErr(null);
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const set = (k: keyof CustomModelEntry, v: string) => setForm(f => ({ ...f, [k]: v }));

  const onTest = async () => {
    setTesting(true); setTestRes(null); setErr(null);
    setTestRes(await agentClient.testCustomModel(form));
    setTesting(false);
  };
  const onSave = async () => {
    setBusy(true); setErr(null);
    const r = await agentClient.addCustomModel(form);
    setBusy(false);
    if (r.ok) {
      setForm(EMPTY_FORM); setAdding(false); setTestRes(null);
      setModels(await agentClient.listModels());
      await agentClient.refreshHealth();
    } else {
      setErr(r.error || '保存失败');
    }
  };
  const onRemove = async (id: string) => {
    await agentClient.removeCustomModel(id);
    setModels(await agentClient.listModels());
    await agentClient.refreshHealth();
  };
  const onPick = async (m: ModelOption) => {
    if (m.active || busy) return;
    setBusy(true); setErr(null);
    const r = await agentClient.setActiveModel(m.provider, m.modelId);
    setBusy(false);
    if (!r.ok) setErr(r.error || '切换失败');
    setModels(await agentClient.listModels());
  };

  const at = (model || '').indexOf('/');
  const provider = at >= 0 ? model!.slice(0, at) : '';
  const modelId = at >= 0 ? model!.slice(at + 1) : (model || '');

  return (
    <>
      <div className="drawer-head">
        <span>模型配置</span>
        <span className="model-tag">{provider || '当前会话'}</span>
      </div>

      <div className="model-section-label"><span>可用模型</span></div>

      <div className="model-list scroll">
        {models.length === 0 && <div className="model-empty">还没有可用模型，添加一个自定义模型开始吧。</div>}
        {models.map(m => (
          <div
            key={m.id}
            className={`model-opt${m.active ? ' active' : ''}`}
            data-testid="model-option"
            onClick={() => onPick(m)}
          >
            <span className="mo-ico"><Icon name={m.custom ? 'cpu' : 'spark'} /></span>
            <span className="mo-main">
              <b>{esc(m.label)}</b>
              <small>{esc(m.provider + '/' + m.modelId)}{m.custom ? ' · 自定义' : ''}</small>
            </span>
            {m.custom && !m.active && (
              <button
                className="mo-del"
                data-testid="model-delete"
                title="删除"
                onClick={(e) => { e.stopPropagation(); void onRemove(m.provider); }}
              >
                <Icon name="trash" />
              </button>
            )}
            {m.active && <span className="chk" data-testid="model-active">✓</span>}
          </div>
        ))}
      </div>

      <div className="model-section-label">运行环境</div>
      <div className="model-cfg">
        <div className="cfg-cwd">
          <span className="lab">工作目录</span>
          <input
            className="cfg-input"
            data-testid="cwd-input"
            value={cwdInput}
            onChange={e => setCwdInput(e.target.value)}
            placeholder="./workspace"
            spellCheck={false}
          />
          <button className="pill" data-testid="cwd-save" disabled={cwdSaving || !cwdInput.trim() || cwdInput.trim() === (cwd || '')} onClick={onCwdSave}>
            {cwdSaving ? '保存中…' : '保存'}
          </button>
        </div>
        {cwdErr && <div className="model-test err"><Icon name="x" /> {esc(cwdErr)}</div>}
        <button className="btn-upload" data-testid="cwd-pick" onClick={() => dirRef.current?.click()}>
          <Icon name="paperclip" /> 选择工作目录…
        </button>
        <input ref={dirRef} type="file" {...({ webkitdirectory: '', directory: '' } as any)} onChange={onPickDir} hidden />
      </div>

      {adding && (
        <div className="model-form" data-testid="custom-model-form">
          <button className="btn-upload" data-testid="cm-upload" onClick={() => jsonRef.current?.click()}>
            <Icon name="paperclip" /> 上传 settings.json
          </button>
          <input ref={jsonRef} type="file" accept=".json,application/json" onChange={onJson} hidden />
          <div className="seg" data-testid="format-seg">
            {(['openai', 'anthropic'] as const).map(f => (
              <button key={f} className={form.format === f ? 'on' : ''} onClick={() => set('format', f)} data-testid={`fmt-${f}`}>
                {f === 'openai' ? 'OpenAI 格式' : 'Anthropic 格式'}
              </button>
            ))}
          </div>
          <input placeholder="名称（如 我的 GPT）" value={form.label} onChange={e => set('label', e.target.value)} data-testid="cm-label" />
          <input placeholder="Base URL" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} data-testid="cm-baseurl" spellCheck={false} />
          <input placeholder="API Key" type="password" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} data-testid="cm-apikey" spellCheck={false} />
          <input placeholder="模型 ID（如 gpt-4o-mini）" value={form.modelId} onChange={e => set('modelId', e.target.value)} data-testid="cm-modelid" spellCheck={false} />
          {testRes && (
            <div className={`model-test ${testRes.ok ? 'ok' : 'err'}`} data-testid="custom-model-test">
              {testRes.ok
                ? <><Icon name="check" /> 通过 · {testRes.latencyMs}ms{testRes.reply ? ` · "${esc(testRes.reply)}"` : ''}</>
                : <><Icon name="x" /> {esc(testRes.error || '失败')}</>}
            </div>
          )}
          {err && <div className="model-test err"><Icon name="x" /> {esc(err)}</div>}
          <div className="model-form-acts">
            <button className="pill" disabled={testing} onClick={onTest} data-testid="cm-test">
              {testing ? '测试中…' : '测试'}
            </button>
            <button className="send" disabled={busy} onClick={onSave} data-testid="cm-save">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      <div className="model-add-foot">
        <button
          className="model-add-primary"
          data-testid="add-custom-model"
          onClick={() => { setAdding(a => !a); setTestRes(null); setErr(null); }}
        >
          <Icon name="plus" />{adding ? '取消添加' : '添加自定义'}
        </button>
      </div>
    </>
  );
}
