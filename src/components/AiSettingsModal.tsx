import { useState } from 'react';
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
  const set = (patch: Partial<AiConfig>) => setCfg((p) => ({ ...p, ...patch }));

  const doTest = async () => {
    setTesting(true);
    try {
      const ms = await testConnection(cfg);
      toast(`连接成功，模型响应 ${ms} 毫秒`);
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'err');
    } finally {
      setTesting(false);
    }
  };

  const doSave = async () => {
    if (!cfg.baseUrl.trim() || !cfg.model.trim()) {
      toast('接口地址和模型名不能为空', 'err');
      return;
    }
    await saveAiConfig({ baseUrl: cfg.baseUrl.trim(), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() });
    props.onSaved(cfg);
    toast('AI 设置已保存（只存在这台电脑上）');
  };

  return (
    <Modal title="AI 设置（用你自己的密钥）" width={560} onClose={props.onClose}>
      <p className="hint-text">
        密钥只保存在本机设置文件里，不上传任何服务器。任何 OpenAI 兼容接口都能用；用本地 Ollama 时密钥随便填。
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
