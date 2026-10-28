import { useEffect, useMemo, useState } from 'react';
import type { Character, RefIndexEntry } from '../types';
import { characterHealth } from '../lib/characterHealth';
import { loadWorkspace, updateWorkspace } from '../lib/bookWorkspace';
import { Modal } from './Modal';
export function CharacterHealthModal({ root, dirName, chars, refs, onInspect, onClose }: {
  root: string; dirName: string; chars: Character[]; refs: RefIndexEntry[]; onInspect: (id: string) => void; onClose: () => void;
}) {
  const [ignored, setIgnored] = useState<string[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const hints = useMemo(() => characterHealth(chars, refs), [chars, refs]);
  useEffect(() => { let alive = true; void loadWorkspace(root, dirName).then(work => { if (alive) { setIgnored(work.ignoredHealth); setLoaded(true); } }).catch(reason => { if (alive) setError(String(reason)); }); return () => { alive = false; }; }, [root, dirName]);
  const visible = hints.filter(hint => !ignored.includes(hint.fingerprint));
  const change = async (fingerprint?: string) => {
    if (!loaded || busy) return; setBusy(true);
    try { const next = await updateWorkspace(root, dirName, work => ({ ...work, ignoredHealth: fingerprint ? [...new Set([...work.ignoredHealth, fingerprint])] : [] })); setIgnored(next.ignoredHealth); setError(''); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <Modal title="资料健康" width={640} onClose={onClose} busy={busy}>
    <p className="hint-text">沿用已有的五档人物层级；提示只说明资料状态，未关联不代表没出场，不会自动修改人物卡。</p>
    {error && <p role="alert">{error}</p>}
    {loaded && !visible.length && <p>没有需要显示的提示。</p>}
    <div className="health-list">{visible.map(hint => <article key={hint.fingerprint}>
      <b>{hint.message}</b><p>{hint.evidence}</p><button className="link-btn" onClick={() => { onClose(); onInspect(hint.characterId); }}>打开人物卡</button>
      <button className="link-btn" disabled={busy || !loaded} onClick={() => void change(hint.fingerprint)}>忽略这条依据</button>
    </article>)}</div>
    {!!ignored.length && <button className="ghost-btn small" disabled={busy || !loaded} onClick={() => void change()}>恢复已忽略提示（{ignored.length}）</button>}
  </Modal>;
}
