import type { AiMessage } from './ai';
export interface ContextPolicy { maxChars: number; disabled: string[] }
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = { maxChars: 12000, disabled: [] };
export interface BudgetSource { key: string; label: string; text: string; originalChars?: number; required?: boolean; tail?: boolean; priority?: number }
export interface SourceAllocation { key: string; label: string; original: number; included: number; text: string; reason: string }
export interface BudgetResult { messages: AiMessage[]; sources: SourceAllocation[]; chars: number; error?: string }
export const messageChars = (messages: AiMessage[]) => JSON.stringify(messages).length;
const sourceText = (source: BudgetSource, text: string) => `【${source.label}】\n${text}`;
function clipped(text: string, length: number, tail: boolean) {
  if (length >= text.length) return text;
  if (length <= 1) return '';
  let value = tail ? text.slice(-(length - 1)) : text.slice(0, length - 1);
  // Never cut a surrogate pair at the retained boundary.
  if (tail && /^[\uDC00-\uDFFF]/.test(value)) value = value.slice(1);
  if (!tail && /[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return tail ? '…' + value : value + '…';
}
/** Counts the exact message JSON, including history, labels and escaping. No token/cost guesses. */
export function budgetContext(base: AiMessage[], sources: BudgetSource[], policy: ContextPolicy): BudgetResult {
  const picked = new Map<string, string>();
  const render = () => {
    const blocks = sources.flatMap(source => picked.has(source.key) ? [sourceText(source, picked.get(source.key)!)] : []);
    if (!blocks.length) return base.map(message => ({ ...message }));
    const copy = base.map(message => ({ ...message }));
    const index = copy.findIndex(message => message.role === 'system');
    if (index >= 0) copy[index].content += '\n\n' + blocks.join('\n\n');
    else copy.unshift({ role: 'system', content: blocks.join('\n\n') });
    return copy;
  };
  const report = (error?: string): BudgetResult => {
    const messages = render(); return { messages, chars: messageChars(messages), error,
      sources: sources.map(source => ({ key: source.key, label: source.label, original: source.originalChars ?? source.text.length,
        included: picked.get(source.key)?.length ?? 0, text: picked.get(source.key) ?? '', reason: picked.has(source.key)
          ? picked.get(source.key) === source.text ? (source.originalChars ?? source.text.length) > source.text.length ? '按来源上限截取' : '完整纳入' : '按预算截取' : policy.disabled.includes(source.key) && !source.required ? '已关闭' : '预算不足，省略' })) };
  };
  for (const source of sources.filter(source => source.required && source.text)) picked.set(source.key, source.text);
  if (!Number.isSafeInteger(policy.maxChars) || policy.maxChars <= 0) return report('请输入大于 0 的整数字符上限');
  if (messageChars(render()) > policy.maxChars) return report('任务、选区、最新结尾或历史已超过预算，请提高上限或缩短本次提问。必需内容没有被截断。');
  for (const source of sources.filter(source => !source.required && source.text && !policy.disabled.includes(source.key)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
    picked.set(source.key, source.text);
    if (messageChars(render()) <= policy.maxChars) continue;
    let low = 0, high = source.text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); picked.set(source.key, clipped(source.text, middle, !!source.tail));
      if (messageChars(render()) <= policy.maxChars) low = middle; else high = middle - 1;
    }
    const text = clipped(source.text, low, !!source.tail); if (text) picked.set(source.key, text); else picked.delete(source.key);
  }
  return report();
}
