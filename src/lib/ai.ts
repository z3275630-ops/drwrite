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
  // DeepSeek 的思考型模型：默认高努力会烧大量 token 在推理上，写作任务用 low 足够
  const effort = /deepseek/i.test(cfg.baseUrl) ? 'low' : undefined;
  const maxTokens = Math.max(800, opts?.maxTokens ?? 2048);
  const payload = {
    model: cfg.model,
    messages,
    max_tokens: maxTokens,
    temperature: opts?.temperature ?? 0.8,
    stream: false,
    ...(effort ? { effort } : {}),
  };

  let data: JsonValue;
  let usedMax = maxTokens;
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    data = await invoke<JsonValue>('ai_chat', {
      args: { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, messages, maxTokens, temperature: opts?.temperature, effort },
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

  const obj = toObj(data);
  if (obj.error) throw new Error(obj.error.message ?? '接口返回错误');
  const choice = obj.choices?.[0];
  const content = choice?.message?.content;
  const finish = choice?.finish_reason;
  const reasoning = choice?.message?.reasoning_content;

  // 思考型模型可能把预算全烧在推理上（content 空 + length）：自动加码重试一次
  if (typeof content !== 'string' || !content.trim()) {
    if (finish === 'length' && reasoning && usedMax < 8000) {
      return callAi(cfg, messages, {
        ...opts,
        maxTokens: Math.min(8000, Math.max(3000, usedMax * 3)),
      });
    }
    throw new Error('模型没有产出正文（可能被思考耗尽预算），请重试或换非思考型模型');
  }
  return {
    text: content.trim(),
    promptTokens: obj.usage?.prompt_tokens,
    completionTokens: obj.usage?.completion_tokens,
  };
}

function toObj(data: JsonValue): {
  choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number };
} {
  return data as ReturnType<typeof toObj>;
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

/* ---------- 流式调用（P5）：字到了就推给界面 ---------- */

export interface StreamHandlers {
  /** 正文增量（参数是到目前为止的全文） */
  onContent?: (full: string) => void;
  /** 思考型模型的推理进度（字数） */
  onReasoning?: (chars: number) => void;
}

interface StreamSummary {
  content?: string;
  finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  reasoning_chars?: number;
}

/**
 * 流式对话补全：优先走流式；如果彻底没起来（一个字节都没收到）自动退回非流式老路径。
 * 思考型模型把预算全烧在推理上时（正文空 + length），与 callAi 一样自动加码重试。
 */
export async function chatAi(
  cfg: AiConfig,
  messages: AiMessage[],
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  ev?: StreamHandlers
): Promise<AiResult> {
  let sawAnything = false;
  try {
    return await streamAi(
      cfg,
      messages,
      opts,
      {
        onContent: (full) => {
          sawAnything = true;
          ev?.onContent?.(full);
        },
        onReasoning: (n) => {
          sawAnything = true;
          ev?.onReasoning?.(n);
        },
      }
    );
  } catch (e) {
    // 已经往界面推过内容就不能静默重来，直接报错
    if (sawAnything) throw e;
    return callAi(cfg, messages, opts);
  }
}

async function streamAi(
  cfg: AiConfig,
  messages: AiMessage[],
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  ev?: StreamHandlers
): Promise<AiResult> {
  const effort = /deepseek/i.test(cfg.baseUrl) ? 'low' : undefined;
  const maxTokens = Math.max(800, opts?.maxTokens ?? 2048);

  let content = '';
  let reasoningChars = 0;
  let finish: string | undefined;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  const eatChunk = (chunk: unknown) => {
    const c = chunk as {
      choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (c.usage && typeof c.usage === 'object') usage = c.usage;
    const ch = c.choices?.[0];
    if (!ch) return;
    const d = ch.delta ?? {};
    if (typeof d.content === 'string' && d.content) {
      content += d.content;
      ev?.onContent?.(content);
    }
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) {
      reasoningChars += d.reasoning_content.length;
      ev?.onReasoning?.(reasoningChars);
    }
    if (typeof ch.finish_reason === 'string' && ch.finish_reason) finish = ch.finish_reason;
  };

  if (isDesktop) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const ch = new Channel<string>();
    ch.onmessage = (raw: string) => {
      try {
        const e = JSON.parse(raw) as { t?: string; v?: string; n?: number };
        if (e.t === 'c' && typeof e.v === 'string') {
          content = e.v;
          ev?.onContent?.(content);
        } else if (e.t === 'r' && typeof e.n === 'number') {
          reasoningChars = e.n;
          ev?.onReasoning?.(reasoningChars);
        }
      } catch {
        /* 坏帧忽略 */
      }
    };
    const summary = await invoke<StreamSummary>('ai_chat_stream', {
      args: {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages,
        maxTokens,
        temperature: opts?.temperature,
        effort,
      },
      onEvent: ch,
    });
    // 汇总为准（Channel 与返回值可能极端情况下有出入）
    if (typeof summary.content === 'string' && summary.content !== content) {
      content = summary.content;
      ev?.onContent?.(content);
    }
    if (summary.usage) usage = summary.usage;
    if (summary.finish_reason) finish = summary.finish_reason;
  } else {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 300000);
    try {
      const res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          max_tokens: maxTokens,
          temperature: opts?.temperature ?? 0.8,
          stream: true,
          ...(effort ? { effort } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(friendlyHttpError(res.status, text));
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('接口没有返回流');
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const raw of lines) {
          const l = raw.trim();
          if (!l.startsWith('data:')) continue;
          const payload = l.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            eatChunk(JSON.parse(payload));
          } catch {
            /* 坏帧忽略 */
          }
        }
      }
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

  if (!content.trim()) {
    if (finish === 'length' && reasoningChars > 0 && maxTokens < 8000) {
      return streamAi(
        cfg,
        messages,
        { ...opts, maxTokens: Math.min(8000, Math.max(3000, maxTokens * 3)) },
        ev
      );
    }
    throw new Error('模型没有产出正文（可能被思考耗尽预算），请重试或换非思考型模型');
  }
  return {
    text: content.trim(),
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
  };
}
