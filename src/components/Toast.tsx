import { useEffect, useState } from 'react';

export interface ToastMsg {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}

let seq = 1;
const listeners = new Set<(m: ToastMsg) => void>();

export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  const m = { id: seq++, text, kind };
  listeners.forEach((l) => l(m));
}

export function Toasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const on = (m: ToastMsg) => {
      setItems((prev) => [...prev, m]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== m.id)), 2800);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((m) => (
        <div key={m.id} className={`toast ${m.kind}`}>
          {m.text}
        </div>
      ))}
    </div>
  );
}
