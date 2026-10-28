import { useId, useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
  busy?: boolean;
  description?: string;
  footer?: ReactNode;
  className?: string;
  layer?: number;
}) {
  const previous = useRef(document.activeElement as HTMLElement | null);
  const descriptionId = useId();
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !props.busy) props.onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" style={{ zIndex: props.layer ?? 200 }} />
      <Dialog.Content className={'modal-card managed-modal ' + (props.className ?? '')} style={{ width: props.width ?? 460, zIndex: (props.layer ?? 200) + 1 }} aria-describedby={props.description ? descriptionId : undefined}
        onEscapeKeyDown={(event) => { if (props.busy || event.isComposing || event.keyCode === 229) event.preventDefault(); }}
        onInteractOutside={(event) => { if (props.busy) event.preventDefault(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); }}>
        <div className="modal-head">
          <div className="modal-heading"><Dialog.Title asChild><span>{props.title}</span></Dialog.Title>
          {props.description && <Dialog.Description id={descriptionId}>{props.description}</Dialog.Description>}</div>
          <button className="icon-btn" disabled={props.busy} onClick={props.onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  );
}
