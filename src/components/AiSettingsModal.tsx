import { useRef, useState } from 'react';
import type { AiConfig } from '../lib/ai';
import { AI_PRESETS, testConnection, saveAiConfig } from '../lib/ai';
import { Modal } from './Modal';
import { toast } from './Toast';

export default function AiSettingsModal(props: {
  initial: AiConfig | null;
  onClose: () => void;
  onSaved: (cfg: AiConfig) => void;
}) {
  const [cfg, setCfg] = useState<AiConfig>(
    props.initial ?? { baseUrl: AI_PRESETS[0].baseUrl, apiKey: '', model: AI_PRESETS[0].model }
  );
  const [testing, setTesting] = useState(false);
  const revision = useRef(0);
  const [result, setResult] = useState<{ kind: 'ok' | 'error' | 'stale'; text: string } | null>(null);
  const set = (patch: Partial<AiConfig>) => {
    revision.current++;
    setCfg((p) => ({ ...p, ...patch }));
    setResult((previous) => previous || testing ? { kind: 'stale', text: '设置已更改，请重新测试连接。' } : null);
  };
  const safeError = (error: unknown) => {
    const text = String(error instanceof Error ? error.message : error);
    return cfg.apiKey ? text.split(cfg.apiKey).join('（密钥已隐藏）') : text;
  };

  const doTest = async () => {
    const testedRevision = revision.current;
    setTesting(true);
    setResult(null);
    try {
      const ms = await testConnection(cfg);
      if (testedRevision === revision.current) setResult({ kind: 'ok', text: `连接成功 · ${cfg.model} · 响应 ${ms} 毫秒` });
    } catch (e) {
      if (testedRevision === revision.current) setResult({ kind: 'error', text: '连接失败：' + safeError(e) });
    } finally {
      setTesting(false);
    }
  };

  const doSave = async () => {
    if (!cfg.baseUrl.trim() || !cfg.model.trim()) {
      toast('接口地址和模型名不能为空', 'err');
      return;
    }
    try {
      const saved = { baseUrl: cfg.baseUrl.trim(), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() };
      await saveAiConfig(saved);
      props.onSaved(saved);
      toast('AI 设置已保存在本机');
    } catch (error) { setResult({ kind: 'error', text: '设置未保存：' + safeError(error) }); }
  };

  return (
    <Modal title="AI 设置（用你自己的密钥）" width={560} onClose={props.onClose}>
      <p className="hint-text">
        配置保存在本机。使用在线 AI 时，所选正文与资料会发送到你配置的服务商，密钥用于该接口认证；使用本地 Ollama 可在本机处理。
      </p>

      <label className="field">
        <span>常用服务（点一下自动填）</span>
        <div className="chips">
          {AI_PRESETS.map((p) => (
            <button
              key={p.label}
              className={'chip toggle' + (cfg.baseUrl === p.baseUrl && cfg.model === p.model ? ' on' : '')}
              title={p.hint}
              onClick={() => set({ baseUrl: p.baseUrl, model: p.model })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </label>
      <div className="form-grid">
        <label className="field">
          <span>接口地址</span>
          <input value={cfg.baseUrl} placeholder="https://api.deepseek.com" onChange={(e) => set({ baseUrl: e.target.value })} />
        </label>
        <label className="field">
          <span>模型名</span>
          <input value={cfg.model} placeholder="deepseek-flash" onChange={(e) => set({ model: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>API 密钥（sk- 开头；Ollama 本地可随意填）</span>
        <input
          type="password"
          value={cfg.apiKey}
          placeholder="sk-…"
          onChange={(e) => set({ apiKey: e.target.value })}
        />
      </label>
      {result && <div className={'connection-result ' + result.kind} role="status">{result.text}</div>}
      <div className="modal-actions">
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button className="ghost-btn" disabled={testing || !cfg.apiKey.trim()} onClick={() => void doTest()}>
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button className="primary-btn" onClick={() => void doSave()}>
          保存
        </button>
      </div>
    </Modal>
  );
}
