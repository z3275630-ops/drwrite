import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

export type ProposalPhase = 'loading' | 'done' | 'error';

export interface ProposalState {
  phase: ProposalPhase;
  title: string;
  modelTag: string;
  /** 选区类提案的原文 */
  original?: string;
  aiText?: string;
  error?: string;
  startedAt: number;
  /** 花了多少 token（完成时显示） */
  usage?: string;
}

/**
 * AI 提案确认卡（学织境的底线：AI 建议、作者决定）。
 * loading 阶段展示耗时；done 展示原文/新文对照；error 展示人话错误。
 */
export default function ProposalModal(props: {
  state: ProposalState;
  onApply: () => void;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (props.state.phase !== 'loading') {
      window.clearInterval(timerRef.current);
      return;
    }
    setElapsed(Math.round((Date.now() - props.state.startedAt) / 1000));
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - props.state.startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timerRef.current);
  }, [props.state.phase, props.state.startedAt]);

  const s = props.state;

  return (
    <Modal title={'AI 提案 · ' + s.title} width={680} onClose={props.onClose}>
      <div className="prop-meta">
        <span className="chip static">{s.modelTag}</span>
        {s.phase === 'loading' && <span className="prop-status">正在写… {elapsed}s</span>}
        {s.phase === 'done' && s.usage && <span className="prop-status ok">{s.usage}</span>}
        {s.phase === 'error' && <span className="prop-status err">失败</span>}
      </div>

      {s.phase === 'loading' && (
        <div className="prop-loading">
          <div className="prop-shimmer" />
          <div className="prop-shimmer short" />
          <div className="prop-shimmer" />
          <p className="hint-text">模型在写，别关窗口；确认前一个字都不会动你的正文。</p>
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

      <div className="modal-actions">
        <button className="ghost-btn" onClick={props.onClose}>
          {s.phase === 'done' ? '放弃' : '取消'}
        </button>
        {s.phase !== 'done' && s.phase === 'error' && (
          <button className="ghost-btn" onClick={props.onRegenerate}>
            重试
          </button>
        )}
        {s.phase === 'done' && (
          <>
            <button className="ghost-btn" onClick={props.onRegenerate}>
              不满意，重新生成
            </button>
            <button className="primary-btn" disabled={!s.aiText} onClick={props.onApply}>
              应用到正文（可 Ctrl+Z 撤销）
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
