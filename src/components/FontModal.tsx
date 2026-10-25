import { useState } from 'react';
import { Modal } from './Modal';
import type { EditorPrefs } from '../lib/library';
import { DEFAULT_PREFS } from '../lib/library';

/** 字体栈：serif 用 CSS 默认衬线，其余显式指定 */
const FONT_STACKS: Record<string, string | undefined> = {
  serif: undefined,
  song: "'SimSun', '宋体', 'Noto Serif SC', serif",
  hei: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  kai: "'KaiTi', '楷体', 'Noto Serif SC', serif",
  fang: "'FangSong', '仿宋', 'Noto Serif SC', serif",
};

const FONT_LABELS: { key: string; label: string }[] = [
  { key: 'serif', label: '默认衬线' },
  { key: 'song', label: '宋体' },
  { key: 'hei', label: '黑体' },
  { key: 'kai', label: '楷体' },
  { key: 'fang', label: '仿宋' },
];

export function fontStackOf(key: string): string | undefined {
  return FONT_STACKS[key];
}

/**
 * 排版设置（P5）：字号 / 行距 / 字体 / 打字机滚动，即时预览。
 */
export default function FontModal(props: {
  prefs: EditorPrefs;
  /** 即时应用（每改一下就生效，不等关闭） */
  onApply: (p: EditorPrefs) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<EditorPrefs>({ ...props.prefs });
  const apply = (next: EditorPrefs) => {
    setP(next);
    props.onApply(next);
  };

  return (
    <Modal title="排版与手感" onClose={props.onClose}>
      <div className="font-row">
        <span className="font-label">字号</span>
        <input
          type="range"
          min={15}
          max={24}
          step={0.5}
          value={p.fontSize}
          onChange={(e) => apply({ ...p, fontSize: Number(e.target.value) })}
        />
        <span className="font-val">{p.fontSize} px</span>
      </div>
      <div className="font-row">
        <span className="font-label">行距</span>
        <input
          type="range"
          min={1.6}
          max={2.8}
          step={0.05}
          value={p.lineHeight}
          onChange={(e) => apply({ ...p, lineHeight: Number(e.target.value) })}
        />
        <span className="font-val">{p.lineHeight.toFixed(2)}</span>
      </div>
      <div className="font-row">
        <span className="font-label">正文字体</span>
        <div className="chips" style={{ flex: 1 }}>
          {FONT_LABELS.map((f) => (
            <button
              key={f.key}
              className={'chip toggle' + (p.fontFamily === f.key ? ' on' : '')}
              onClick={() => apply({ ...p, fontFamily: f.key })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <label className="font-toggle">
        <input
          type="checkbox"
          checked={p.typewriter}
          onChange={(e) => apply({ ...p, typewriter: e.target.checked })}
        />
        <span>
          打字机滚动
          <span className="entity-sub">　打字时让光标停在屏幕中上部，长文不追页</span>
        </span>
      </label>

      <div
        className="font-preview novel-doc"
        style={{
          fontSize: p.fontSize + 'px',
          lineHeight: p.lineHeight,
          fontFamily: fontStackOf(p.fontFamily),
        }}
      >
        <p>雪停的时候，有人敲门。陆沉数了数手里的铜钱，还剩三十七枚。</p>
      </div>

      <div className="modal-actions">
        <button
          className="ghost-btn"
          onClick={() => apply({ ...DEFAULT_PREFS, typewriter: p.typewriter })}
        >
          恢复默认
        </button>
        <button className="primary-btn" onClick={props.onClose}>
          完成
        </button>
      </div>
    </Modal>
  );
}
