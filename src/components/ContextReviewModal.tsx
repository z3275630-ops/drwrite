import { UiSelect } from './Controls';
import { useMemo, useState } from 'react';
import type { AiMessage } from '../lib/ai';
import { budgetContext, DEFAULT_CONTEXT_POLICY, type BudgetSource, type ContextPolicy } from '../lib/contextBudget';
import { Modal } from './Modal';
export interface ContextReview { base: AiMessage[]; sources: BudgetSource[]; onSend: (messages: AiMessage[], policy: ContextPolicy) => void; onCancel: () => void; initial?: ContextPolicy }
export function ContextControls({ policy, onChange, disabled = false }: { policy: ContextPolicy; onChange: (next: ContextPolicy) => void; disabled?: boolean }) {
  return <div className="context-budget-controls"><label>上下文预算<UiSelect disabled={disabled} value={[6000, 12000, 24000].includes(policy.maxChars) ? policy.maxChars : 'custom'} onChange={event => onChange({ ...policy, maxChars: event.target.value === 'custom' ? 18000 : Number(event.target.value) })}>
    <option value={6000}>精简 · 6000 字符</option><option value={12000}>均衡 · 12000 字符</option><option value={24000}>充分 · 24000 字符</option><option value="custom">自定义</option></UiSelect></label>
    <label>字符上限<input disabled={disabled} type="number" min={1} value={Number.isFinite(policy.maxChars) ? policy.maxChars : ''} onChange={event => onChange({ ...policy, maxChars: event.target.value === '' ? 0 : Number(event.target.value) })} /></label>
  </div>;
}
export function ContextReviewModal({ request }: { request: ContextReview }) {
  const [policy, setPolicy] = useState(request.initial ?? DEFAULT_CONTEXT_POLICY);
  const result = useMemo(() => budgetContext(request.base, request.sources, policy), [request, policy]);
  return <Modal title="确认发送内容" description="看清本次带给模型的资料，再开始生成。" width={760} onClose={request.onCancel} className="tool-modal" layer={240}
    footer={<><span className="footer-caption">建议生成后仍需你确认采纳</span><div className="footer-actions"><button className="ghost-btn" onClick={request.onCancel}>返回</button><button className="primary-btn" disabled={!!result.error} onClick={() => request.onSend(result.messages, policy)}>确认发送</button></div></>}>
    <div className="context-usage"><div><strong>{result.chars.toLocaleString()}</strong><span>本次消息字符</span></div><span>预算上限 {policy.maxChars.toLocaleString()}</span></div>
    <details className="tool-disclosure"><summary>调整上下文预算<span>{policy.maxChars === 6000 ? '精简' : policy.maxChars === 12000 ? '均衡' : policy.maxChars === 24000 ? '充分' : '自定义'}</span></summary><div>
      <ContextControls policy={policy} onChange={setPolicy} /><p className="hint-text">统计完整消息 JSON，包含规则、历史、标签与转义；字符数不等于 tokens，也不是费用。</p>
    </div></details>
    {result.error && <div className="tool-message error" role="alert">{result.error}</div>}
    <h3 className="tool-section-title">本次带上</h3>
    <div className="context-source-list polished-sources">{request.sources.map(source => { const allocated = result.sources.find(item => item.key === source.key)!; return <section key={source.key}>
      <div className="context-source-row"><label><input type="checkbox" checked={source.required || !policy.disabled.includes(source.key)} disabled={source.required} onChange={event => setPolicy({ ...policy, disabled: event.target.checked ? policy.disabled.filter(key => key !== source.key) : [...policy.disabled, source.key] })} />
        <span>{source.label}{source.required && <em className="soft-badge">必需</em>}</span></label>
        <small>{allocated.included.toLocaleString()} / {allocated.original.toLocaleString()} 字符</small></div>
      <div className="context-source-detail"><span>{allocated.reason}</span>{!!allocated.text && <details><summary>查看片段</summary><pre>{allocated.text}</pre></details>}</div>
    </section>; })}</div>
    <details className="context-preview tool-disclosure"><summary>查看完整实际请求</summary><div>{result.messages.map((message, index) => <section key={index}><b>{{ system: '写作规则与资料', user: '作者要求', assistant: '先前回复' }[message.role]}</b><pre>{message.content}</pre></section>)}</div></details>
  </Modal>;
}
