import { useEffect, useRef, useState } from 'react';
import type { ChapterMeta } from '../types';
import { fmtNum } from '../lib/library';

export default function ChapterList(props: {
  chapters: ChapterMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (meta: ChapterMeta) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.focus();
  }, [renamingId]);

  const commit = () => {
    if (renamingId && draft.trim()) props.onRename(renamingId, draft.trim());
    setRenamingId(null);
  };

  return (
    <div className="chapter-list">
      <div className="chapter-list-head">
        章节 <span className="count">{props.chapters.length}</span>
      </div>
      <div className="chapter-items">
        {props.chapters.map((c) => (
          <div
            key={c.id}
            className={`chapter-item ${c.id === props.activeId ? 'active' : ''}`}
            onClick={() => renamingId !== c.id && props.onSelect(c.id)}
          >
            {renamingId === c.id ? (
              <input
                ref={inputRef}
                className="rename-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="chapter-no">{String(c.index + 1).padStart(2, '0')}</span>
                <span className="chapter-title" title={c.title}>
                  {c.title}
                </span>
                <span className="chapter-words">{c.wordCount ? fmtNum(c.wordCount) : ''}</span>
                <span className="chapter-ops" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="op"
                    title="上移"
                    disabled={c.index === 0}
                    onClick={() => props.onMove(c.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="op"
                    title="下移"
                    disabled={c.index === props.chapters.length - 1}
                    onClick={() => props.onMove(c.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="op"
                    title="重命名"
                    onClick={() => {
                      setRenamingId(c.id);
                      setDraft(c.title);
                    }}
                  >
                    改
                  </button>
                  <button className="op danger" title="删除本章" onClick={() => props.onDelete(c)}>
                    删
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <button className="add-chapter" onClick={props.onAdd}>
        ＋ 新章节
      </button>
    </div>
  );
}
