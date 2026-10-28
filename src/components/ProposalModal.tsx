import { UiSelect } from './Controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import type { ContextSource } from '../lib/assembler';
import { proposalDiff } from '../lib/proposalDiff';

export type ProposalPhase = 'preparing' | 'streaming' | 'done' | 'error';
export interface ProposalVersion { text: string; promptTokens?: number; completionTokens?: number; feedback?: string; at: number; contextSources?: ContextSource[] }

export interface ProposalState {
  phase: ProposalPhase;
  title: string;
  modelTag: string;
  /** 选区类提案的原文 */
  original?: string;
  aiText?: string;
  /** 流式过程中的实时文本 / 思考进度 */
  streamingText?: string;
  reasoningChars?: number;
  error?: string;
  startedAt: number;
  /** 花了多少 token（完成时显示） */
  usage?: string;
  contextSources?: ContextSource[];
  versions?: ProposalVersion[];
  selectedVersion?: number;
}

/**
 * AI 提案确认卡（学织境的底线：AI 建议、作者决定）。
 * streaming 阶段实时展示落下的字与耗时；done 展示原文/新文对照；error 展示人话错误。
 */
export default function ProposalModal(props: {
  state: ProposalState;
  onApply: () => void;
  onRegenerate: () => void;
  onRefine: (feedback: string) => void;
  onSelectVersion: (index: number) => void;
  onClose: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const streamBoxRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState('');
  const changes = useMemo(() => props.state.original !== undefined && props.state.aiText ? proposalDiff(props.state.original, props.state.aiText) : null, [props.state.original, props.state.aiText]);

  useEffect(() => {
    if (props.state.phase !== 'streaming') {
      window.clearInterval(timerRef.current);
      return;
    }
    setElapsed(Math.round((Date.now() - props.state.startedAt) / 1000));
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - props.state.startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timerRef.current);
  }, [props.state.phase, props.state.startedAt]);

  // 流式文本落下来时贴着底部滚
  useEffect(() => {
    const el = streamBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.state.streamingText]);

  const s = props.state;

  return (
    <Modal title={'AI 提案 · ' + s.title} description="先比较，再采纳。正文始终由你决定。" width={740} onClose={props.onClose}
      footer={<><span className="footer-caption">采纳后可用 Ctrl+Z 整段撤销</span><div className="footer-actions">
        <button className="ghost-btn" onClick={props.onClose}>{s.phase === 'done' ? '放弃提案' : '关闭'}</button>
        {s.phase === 'error' && <button className="primary-btn" onClick={props.onRegenerate}>重试生成</button>}
        {s.phase === 'done' && <button className="primary-btn" disabled={!s.aiText} onClick={props.onApply}>采纳这版</button>}
      </div></>}>
      <div className="prop-meta">
        <span className="chip static">{s.modelTag}</span>
        {s.phase === 'streaming' && (
          <span className="prop-status">
            {!s.streamingText && s.reasoningChars
              ? `思考中… 已推理 ${s.reasoningChars} 字 · ${elapsed}s`
              : `正在写… 已收到 ${s.streamingText?.length ?? 0} 字 · ${elapsed}s`}
          </span>
        )}
        {s.phase === 'done' && s.usage && <span className="prop-status ok">{s.usage}</span>}
        {s.phase === 'error' && <span className="prop-status err">失败</span>}
      </div>
      {!!s.versions?.length && <div className="proposal-history">
        <label>已生成版本<UiSelect disabled={s.phase === 'streaming' || s.phase === 'preparing'} value={s.selectedVersion ?? s.versions.length - 1} onChange={event => props.onSelectVersion(Number(event.target.value))}>
          {s.versions.map((version, index) => <option key={index} value={index}>版本 {index + 1}{version.feedback ? ' · ' + version.feedback.slice(0, 24) : ''}</option>)}
        </UiSelect></label>
        <small>累计已报告用量：输入 {s.versions.reduce((sum, version) => sum + (version.promptTokens ?? 0), 0)} / 输出 {s.versions.reduce((sum, version) => sum + (version.completionTokens ?? 0), 0)} tokens{s.versions.some(version => version.promptTokens === undefined || version.completionTokens === undefined) ? '（部分轮次接口未报告，未估算）' : ''}</small>
      </div>}
      {s.phase === 'preparing' && <p>正在准备上下文，确认后才发送。</p>}
      {!!s.contextSources?.length && <details className="context-preview tool-disclosure">
        <summary>查看这一版的实际上下文</summary>
        <div>{s.contextSources.map((source, index) => <section key={index}><b>{source.label}</b><pre>{source.text}</pre></section>)}</div>
        <p className="hint-text">这里只显示本次实际带入的片段；长度单位为字符，接口返回的 tokens 才是模型用量。</p>
      </details>}

      {s.phase === 'streaming' && (
        <div className="prop-stream">
          {!s.streamingText && !s.reasoningChars && (
            <div className="prop-loading">
              <div className="prop-shimmer" />
              <div className="prop-shimmer short" />
              <p className="hint-text">已连接模型，等待第一个字……</p>
            </div>
          )}
          {!!(s.streamingText || s.reasoningChars) && (
            <div className="prop-text ai stream" ref={streamBoxRef}>
              {s.streamingText || <span className="entity-sub">（模型还在思考，正文未落）</span>}
              <span className="stream-caret" />
            </div>
          )}
          <p className="hint-text">确认前一个字都不会动你的正文。</p>
        </div>
      )}

      {s.phase === 'error' && (
        <div className="prop-error">
          <p>{s.error}</p>
          <p className="hint-text">检查 AI 设置（密钥 / 余额 / 模型名）后可重试。</p>
        </div>
      )}

      {s.phase === 'done' && (
        <div className="prop-cols">
          {s.original != null && (
            <div className="prop-pane">
              <div className="sec-title">原文（{s.original.length} 字）</div>
              <div className="prop-text">{s.original}</div>
            </div>
          )}
          <div className="prop-pane">
            <div className="sec-title">AI 产出（{s.aiText?.length ?? 0} 字）</div>
            <div className="prop-text ai">
              {s.aiText || <span className="entity-sub">（模型没有产出内容，可重新生成）</span>}
            </div>
          </div>
        </div>
      )}
      {s.phase === 'done' && s.original !== undefined && <details className="proposal-diff"><summary>查看段落差异（原文 → 当前版本）</summary>
        {changes ? changes.map((change, index) => <div key={index} className={change.added ? 'diff-added' : change.removed ? 'diff-removed' : 'diff-same'}><b>{change.added ? '新增' : change.removed ? '删除' : '保留'}</b><pre>{change.value.join('\n')}</pre></div>) : <p>文字过长或差异过多，请使用上方原文与产出对照。</p>}
      </details>}
      {(s.phase === 'done' || s.phase === 'error' && !!s.versions?.length) && <details className="tool-disclosure"><summary>继续调整这一版<span>保留先前版本</span></summary><div><label className="field"><span>你的修改意见</span><textarea rows={3} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="例如：保留事件顺序，让对白更克制。" /></label><div className="refine-actions"><button className="ghost-btn" disabled={!feedback.trim()} onClick={() => props.onRefine(feedback.trim())}>按反馈生成下一版</button><button className="link-btn" onClick={props.onRegenerate}>重新生成一版</button></div></div></details>}
    </Modal>
  );
}
