import { useCallback, useEffect, useRef, useState } from 'react';
export type DraftFlush = (() => Promise<boolean>) & { isDirty?: () => boolean };
export type DraftRegistrar = (id: string, flush?: DraftFlush) => void;
export function InlineDraft({ id, label, value, onSave, onRegister, onExpand }: {
  id: string; label: string; value: string; onSave: (text: string) => Promise<void>;
  onRegister: DraftRegistrar; onExpand?: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(value), dirty = useRef(false), save = useRef(onSave), pending = useRef<Promise<boolean> | null>(null);
  save.current = onSave;
  useEffect(() => { if (!dirty.current && !pending.current) { current.current = value; setDraft(value); } }, [value]);
  const flush: DraftFlush = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (!dirty.current) return Promise.resolve(true);
    setBusy(true); setError('');
    pending.current = Promise.resolve().then(() => save.current(current.current)).then(() => {
      dirty.current = false; setEditing(false); return true;
    }).catch(reason => { setError('尚未保存，草稿仍保留：' + String(reason)); return false; })
      .finally(() => { setBusy(false); pending.current = null; });
    return pending.current;
  }, []);
  flush.isDirty = () => dirty.current;
  useEffect(() => { onRegister(id, flush); return () => onRegister(id); }, [id, flush, onRegister]);
  const cancel = () => { if (pending.current) return; dirty.current = false; current.current = value; setDraft(value); setEditing(false); setError(''); };
  return <div className="inline-draft">
    {editing ? <>
      <label>{label}<textarea autoFocus value={draft} disabled={busy} rows={5} onChange={event => { dirty.current = true; current.current = event.target.value; setDraft(event.target.value); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void flush(); }
        }} /></label>
      <div className="inline-actions"><button className="ghost-btn small" disabled={busy} onClick={() => void flush()}>保存</button>
        <button className="link-btn" disabled={busy} onClick={cancel}>取消</button>
        {onExpand && <button className="link-btn" disabled={busy} onClick={() => void flush().then(ok => { if (ok) onExpand(current.current); })}>展开编辑</button>}
      </div><small>Ctrl+Enter 保存；离开前会尝试保存，失败时保留在此。</small>
    </> : <button className="inline-preview" onClick={() => setEditing(true)} aria-label={`编辑${label}`}>
      <span className="cp-k">{label}</span><span>{value || '点击填写'}</span>
    </button>}
    {error && <p className="draft-error" role="alert">{error}</p>}
  </div>;
}
