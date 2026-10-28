import { useEffect, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Book } from '../types';
import { editorWordCount } from './LiveEditorState';
import { bookTotal, sessionProgress, type WritingSession as Session } from '../lib/writingMetrics';
export function WritingSession({ editor, book, activeId, onHide }: { editor: Editor | null; book: Book; activeId: string | null; onHide: () => void }) {
  const live = useEditorState({ editor, selector: ({ editor }) => editorWordCount(editor) }) ?? 0;
  const [session, setSession] = useState<Session | null>(null), [target, setTarget] = useState('500'), [now, setNow] = useState(Date.now());
  useEffect(() => { if (!session) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [session]);
  const total = bookTotal(book.chapters, activeId, live);
  const start = () => { const amount = Number(target); if (!Number.isFinite(amount) || amount < 0) return; const time = Date.now(); setNow(time); setSession({ startedAt: time, target: Math.floor(amount), baseline: total }); };
  const progress = session ? sessionProgress(session, total) : null;
  return <div className="writing-session">
    {session && progress ? <>
      <span>本次净增 <b>{progress.net}</b> 字{session.target > 0 ? ' / ' + session.target : ''} · {Math.floor((now - session.startedAt) / 60000)}分{Math.floor((now - session.startedAt) / 1000) % 60}秒</span>
      {session.target > 0 && <progress max={1} value={progress.ratio} aria-label="本次写作目标进度" />}
      <button className="link-btn" onClick={() => setSession(null)}>结束本次</button><button className="link-btn" onClick={start}>重新计时</button>
    </> : <><span>本次目标</span><input aria-label="本次目标字数" type="number" min={0} value={target} onChange={event => setTarget(event.target.value)} />
      <button className="ghost-btn small" onClick={start}>开始本次写作</button><button className="link-btn" onClick={onHide}>收起</button></>}
    <small>含采纳后的 AI 文字；仅本次打开期间记录，重启结束。</small>
  </div>;
}
