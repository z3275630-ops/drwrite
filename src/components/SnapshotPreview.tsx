import { UiSelect } from './Controls';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Book, ChapterFile } from '../types';
import { joinPath } from '../lib/fs';
import { readChapter } from '../lib/library';
import { docToPlainText } from '../lib/words';
import { proposalDiff } from '../lib/proposalDiff';
import { Modal } from './Modal';
interface SnapshotView { book: Book; legacy: boolean; changes: { path: string; state: string }[] }
export function SnapshotPreview({ root, dirName, name, current, onClose }: { root: string; dirName: string; name: string; current: Book | null; onClose: () => void }) {
  const [view, setView] = useState<SnapshotView | null>(null), [error, setError] = useState(''), [selected, setSelected] = useState('');
  const [before, setBefore] = useState(''), [after, setAfter] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const [canCompare, setCanCompare] = useState(false);
  useEffect(() => { let alive = true; setView(null); setError('');
    void invoke<SnapshotView>('preview_book_snapshot', { bookDir: joinPath(root, dirName), name }).then(value => { if (alive) { setView(value); setSelected(value.book.chapters[0]?.id ?? ''); } }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [root, dirName, name, retry]);
  useEffect(() => {
    if (!selected || !view) return; let alive = true; setLoading(true); setBefore(''); setAfter(''); setError(''); setCanCompare(false);
    void Promise.all([
      view.book.chapters.some(chapter => chapter.id === selected) ? invoke<ChapterFile>('read_snapshot_chapter', { bookDir: joinPath(root, dirName), name, chapterId: selected }) : Promise.resolve(null),
      current?.chapters.some(chapter => chapter.id === selected) ? readChapter(root, dirName, selected).catch(reason => { if (alive) setError('当前章节无法读取，快照仍可查看：' + String(reason)); return null; }) : Promise.resolve(null),
    ]).then(([old, latest]) => { if (alive) { setCanCompare(!!old && !!latest); setBefore(old ? docToPlainText(old.doc) : '（快照中没有此章）'); setAfter(!current ? '（当前作品目录无法读取，仍可查看快照）' : latest ? docToPlainText(latest.doc) : current.chapters.some(chapter => chapter.id === selected) ? '（当前章节无法读取）' : '（当前目录没有此章）'); } }).catch(reason => { if (alive) setError(String(reason)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [root, dirName, name, selected, view, current?.chapters]);
  const differences = useMemo(() => canCompare ? proposalDiff(before, after) : null, [before, after, canCompare]);
  const chapters = view ? [...view.book.chapters, ...(current?.chapters ?? []).filter(chapter => !view.book.chapters.some(old => old.id === chapter.id))] : [];
  return <Modal title="快照预览" description="只读对照，不恢复或改动当前作品。" className="snapshot-preview-modal" width={1000} layer={240} onClose={onClose}>
    <p className="hint-text">预览不保存正文、不创建快照、不恢复文件。“当前”显示磁盘上已保存的版本；尚未保存的编辑仍留在原编辑器。</p>
    {error && <p className="draft-error" role="alert">{error} <button className="link-btn" onClick={() => setRetry(value => value + 1)}>重试读取</button></p>}
    {!view && !error && <p>校验并读取快照…</p>}
    {view && <><label className="field">选择章节<UiSelect value={selected} onChange={event => setSelected(event.target.value)}>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.index + 1}. {chapter.title}{!current ? '' : !view.book.chapters.some(old => old.id === chapter.id) ? ' · 当前新增' : !current.chapters.some(latest => latest.id === chapter.id) ? ' · 当前已移除' : ''}</option>)}</UiSelect></label>
      {loading ? <p>读取所选章节…</p> : <><div className="prop-cols"><section className="prop-pane"><h3>快照正文</h3><pre className="preview-body">{before}</pre></section><section className="prop-pane"><h3>当前已保存正文</h3><pre className="preview-body">{after}</pre></section></div>
        {canCompare && <details className="proposal-diff"><summary>快照 → 当前的段落差异</summary>{differences ? differences.map((part, index) => <div key={index} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-same'}><b>{part.added ? '当前新增' : part.removed ? '当前移除' : '相同'}</b><pre>{part.value.join('\n')}</pre></div>) : <p>文本或差异较长，请使用上方双栏对照。</p>}</details>}</>}
      <details><summary>资料文件变化 · {view.legacy ? '旧快照不包含资料，不能用于比较' : view.changes.length + ' 项'}</summary>{!view.legacy && (view.changes.length ? view.changes.map(change => <p key={change.path}>{change.state} · {change.path}</p>) : <p>资料文件内容一致。</p>)}</details>
    </>}
  </Modal>;
}
