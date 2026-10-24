import type { ReactNode } from 'react';

export function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal-card" style={{ width: props.width ?? 460 }}>
        <div className="modal-head">
          <span>{props.title}</span>
          <button className="icon-btn" onClick={props.onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}
