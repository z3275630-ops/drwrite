/**
 * AI 调用层（BYOK：用户自己的密钥只存在本机）。
 * 桌面端走 Rust 的 ai_chat 命令（无 CORS 限制，本地 Ollama 也能连）；
 * 浏览器端直连 fetch（DeepSeek 等开放 CORS 的服务可用）。
 */
import type { JsonValue } from './json';
import { isDesktop, readJsonOrNull, writeJson, appSettingsPath } from './fs';

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiPreset {
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const AI_PRESETS: AiPreset[] = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', hint: '便宜大碗，推荐日常用；另有 deepseek-v4-pro' },
  { label: 'DeepSeek Pro', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', hint: '更强，贵一点' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: '月之暗面' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hint: '阿里云百炼' },
  { label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b', hint: '本机跑模型，免密钥不花钱（地址 http://localhost:11434/v1）' },
];

export async function loadAiConfig(): Promise<AiConfig | null> {
  const p = await appSettingsPath();
  const v = await readJsonOrNull(p);
  const ai = (v as { ai?: AiConfig } | null)?.ai;
  if (ai && ai.baseUrl && ai.apiKey && ai.model) return ai;
  return null;
}

export async function saveAiConfig(cfg: AiConfig): Promise<void> {
  const p = await appSettingsPath();
  const v = (await readJsonOrNull(p)) as Record<string, JsonValue> | null;
  await writeJson(p, { ...(v ?? {}), ai: cfg as unknown as JsonValue });
}

/** 调一次对话补全。错误信息面向用户可直接展示。 */
export async function callAi(
  cfg: AiConfig,
  messages: AiMessage[],
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
): Promise<AiResult> {
  const payload = {
    model: cfg.model,
    messages,
    max_tokens: opts?.maxTokens ?? 2048,
    temperature: opts?.temperature ?? 0.8,
    stream: false,
  };

  let data: JsonValue;
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    data = await invoke<JsonValue>('ai_chat', {
      args: { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, messages, maxTokens: opts?.maxTokens, temperature: opts?.temperature },
    });
  } else {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 120000);
    try {
      const res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.apiKey,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(friendlyHttpError(res.status, text));
      }
      data = JSON.parse(text) as JsonValue;
    } catch (e) {
      if (String(e).includes('abort')) throw new Error('请求超时（模型响应太慢或网络不通）');
      if (e instanceof Error && e.message.startsWith('接口返回')) throw e;
      if (e instanceof Error && e.message.includes('Failed to fetch')) {
        throw new Error('连接失败：该服务可能不允许浏览器直连（桌面版不受此限制），或地址/网络有误');
      }
      throw e;
    } finally {
      window.clearTimeout(timer);
    }
  }

  const obj = data as { choices?: { message?: { content?: string } }[]; error?: { message?: string }; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  if (obj.error) throw new Error(obj.error.message ?? '接口返回错误');
  const text = obj.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('接口返回里没有正文内容');
  return {
    text: text.trim(),
    promptTokens: obj.usage?.prompt_tokens,
    completionTokens: obj.usage?.completion_tokens,
  };
}

function friendlyHttpError(status: number, body: string): string {
  let detail = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) detail = j.error.message;
  } catch {
    /* 保留原文 */
  }
  if (status === 401) return '密钥无效或已过期（401）';
  if (status === 402) return '账户余额不足（402），请到服务商平台充值';
  if (status === 404) return '接口地址或模型名不对（404）';
  if (status === 429) return '请求太频繁或额度受限（429）';
  return '接口返回 ' + status + '：' + detail.slice(0, 200);
}

/** 测试连通性：一句话对话 */
export async function testConnection(cfg: AiConfig): Promise<number> {
  const t0 = Date.now();
  await callAi(cfg, [{ role: 'user', content: '回复：好' }], { maxTokens: 8, temperature: 0 });
  return Date.now() - t0;
}
