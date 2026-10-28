import { UiSelect } from './Controls';
import { useEffect, useState } from 'react';
import type { Book } from '../types';
import { readChapter } from '../lib/library';
import { docToPlainText } from '../lib/words';
import { scenesFromDocJson } from '../lib/scenes';
import { movingAverage, quotedRatio } from '../lib/writingMetrics';
import { loadWorkspace, updateWorkspace, type ObservationNote } from '../lib/bookWorkspace';
import { Modal } from './Modal';
interface Detail { scenes: number; quoted: number | null }
export function ObservationModal({ root, dirName, book, onJump, onClose }: {
  root: string; dirName: string; book: Book; onJump: (id: string) => void; onClose: () => void;
}) {
  const [volume, setVolume] = useState('all'), [details, setDetails] = useState<Record<string, Detail>>({}), [error, setError] = useState('');
  const [progress, setProgress] = useState(0), [notes, setNotes] = useState<ObservationNote[]>([]), [ready, setReady] = useState(false);
  const [from, setFrom] = useState(book.chapters[0]?.id ?? ''), [to, setTo] = useState(book.chapters.at(-1)?.id ?? ''), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true; const results: Record<string, Detail> = {}; let next = 0, count = 0;
    void Promise.all(Array.from({ length: 4 }, async () => {
      while (alive && next < book.chapters.length) {
        const meta = book.chapters[next++]; const file = await readChapter(root, dirName, meta.id);
        if (!file) throw Error('无法读取章节：' + meta.title);
        results[meta.id] = { scenes: scenesFromDocJson(file.doc).length, quoted: quotedRatio(docToPlainText(file.doc)) };
        if (alive) { count++; setProgress(count); }
      }
    })).then(() => { if (alive) setDetails(results); }).catch(reason => { if (alive) setError(String(reason)); });
    void loadWorkspace(root, dirName).then(work => { if (alive) { setNotes(work.observationNotes); setReady(true); } }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [root, dirName, book.chapters]);
  const chapters = book.chapters.filter(chapter => volume === 'all' || (volume === 'none' ? !chapter.volumeId : chapter.volumeId === volume));
  const average = movingAverage(chapters.map(chapter => chapter.wordCount));
  const max = Math.max(1, ...chapters.map(chapter => chapter.wordCount));
  const saveNote = async () => {
    if (!text.trim() || !ready || busy) return;
    const a = book.chapters.find(chapter => chapter.id === from), b = book.chapters.find(chapter => chapter.id === to);
    if (!a || !b || a.index > b.index) { setError('请选择从前到后的章节区间'); return; }
    setBusy(true);
    try { const next = await updateWorkspace(root, dirName, work => ({ ...work, observationNotes: [...work.observationNotes, { id: crypto.randomUUID(), fromId: from, toId: to, text: text.trim() }] })); setNotes(next.observationNotes); setText(''); setError(''); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <Modal title="篇幅分布观察" width={900} onClose={onClose} busy={busy}>
    <p className="hint-text">字数、场景数与引号内文字比例只供观察；引号不等于对话，不代表节奏或质量评分。5 章均值在当前分卷内计算。</p>
    <label className="field">范围<UiSelect value={volume} onChange={event => setVolume(event.target.value)}><option value="all">全书</option><option value="none">未分卷</option>{book.volumes?.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</UiSelect></label>
    {error && <p role="alert">{error}</p>}{progress < book.chapters.length && <p>读取已保存正文 {progress}/{book.chapters.length}</p>}
    <div className="observation-table"><table><thead><tr><th>章节（点击跳转）</th><th>字数分布</th><th>5章均值</th><th>场景</th><th>引号比例</th></tr></thead><tbody>{chapters.map((chapter, index) => <tr key={chapter.id}>
      <td><button className="link-btn" onClick={() => { onClose(); onJump(chapter.id); }}>{chapter.index + 1}. {chapter.title}</button></td>
      <td><meter min={0} max={max} value={chapter.wordCount} /> {chapter.wordCount}</td><td>{average[index] === null ? '—' : Math.round(average[index]!)}</td>
      <td>{details[chapter.id]?.scenes ?? '…'}</td><td>{details[chapter.id] ? details[chapter.id].quoted === null ? '—' : Math.round(details[chapter.id].quoted! * 100) + '%' : '…'}</td>
    </tr>)}</tbody></table></div>
    <details><summary>作者的区间笔记（可选）</summary><div className="form-grid">{[ ['从', from, setFrom], ['到', to, setTo] ].map(([label, value, setter]) => <label className="field" key={String(label)}>{String(label)}<UiSelect value={String(value)} onChange={event => (setter as (value: string) => void)(event.target.value)}>{book.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.index + 1}. {chapter.title}</option>)}</UiSelect></label>)}</div>
      <textarea aria-label="区间笔记" value={text} onChange={event => setText(event.target.value)} /><button className="ghost-btn" disabled={!ready || busy || !text.trim()} onClick={() => void saveNote()}>保存笔记</button>
      {notes.map(note => <p key={note.id}>{book.chapters.find(chapter => chapter.id === note.fromId)?.title ?? '已删章节'} 至 {book.chapters.find(chapter => chapter.id === note.toId)?.title ?? '已删章节'}：{note.text}</p>)}
    </details>
  </Modal>;
}
