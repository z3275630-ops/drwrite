import { Modal } from './Modal';
import type { ChapterMeta } from '../types';

/**
 * 章纲（P5）：动笔前给本章定要点。手写优先，也可让 AI 结合剧情总览 + 待回收伏笔起草。
 * 保存后，AI 续写本章时会随身携带这份章纲。
 */
export default function OutlineModal(props: {
  meta: ChapterMeta;
  draft: string;
  busy: boolean;
  aiReady: boolean;
  onChange: (v: string) => void;
  onGenerate: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={`第${props.meta.index + 1}章 · 章纲`} width={560} onClose={props.onClose}>
      <p className="hint-text">
        本章的写作要点（开场承接 → 事件推进 → 结尾钩子）。写正文前定个纲，AI 续写会严格按纲推进。
      </p>
      <textarea
        className="syn-area outline-area"
        rows={10}
        autoFocus
        value={props.draft}
        placeholder={'1. 承接上一章：……\n2. 主要事件：……\n3. 人物冲突：……\n4. 结尾钩子：……'}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <div className="modal-actions">
        <button
          className="ghost-btn"
          disabled={!props.aiReady || props.busy}
          title={!props.aiReady ? '先配置 AI' : ''}
          onClick={props.onGenerate}
        >
          {props.busy ? 'AI 起草中…' : '✦ AI 起草章纲'}
        </button>
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button className="primary-btn" onClick={props.onSave}>
          保存
        </button>
      </div>
    </Modal>
  );
}
