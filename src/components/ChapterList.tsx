import { useEffect, useRef, useState } from 'react';
import type { ChapterMeta, Volume } from '../types';
import { fmtNum } from '../lib/library';

const DND_TYPE = 'text/drwrite-chapter';
const NONE_VOL = '__none__';

interface Group {
  key: string;
  vol: Volume | null;
  items: ChapterMeta[];
}

export default function ChapterList(props: {
  chapters: ChapterMeta[];
  volumes: Volume[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (meta: ChapterMeta) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onSynopsis: (meta: ChapterMeta) => void;
  onOutline: (meta: ChapterMeta) => void;
  /** 拖拽排序：把 dragId 挪到 targetId 的前/后 */
  onReorder: (dragId: string, targetId: string, pos: 'before' | 'after') => void;
  /** 把章节拖进某卷（null = 移回未分卷） */
  onDropToVolume: (chapterId: string, volumeId: string | null) => void;
  onAddVolume: (title: string) => void;
  onRenameVolume: (id: string, title: string) => void;
  onDeleteVolume: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropMark, setDropMark] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const [volOver, setVolOver] = useState<string | null>(null);
  const [renamingVol, setRenamingVol] = useState<string | null>(null);
  const [volDraft, setVolDraft] = useState('');
  const [addingVol, setAddingVol] = useState(false);
  const [newVol, setNewVol] = useState('');

  useEffect(() => {
    if (renamingId) inputRef.current?.focus();
  }, [renamingId]);

  const commit = () => {
    if (renamingId && draft.trim()) props.onRename(renamingId, draft.trim());
    setRenamingId(null);
  };

  const commitVol = () => {
    if (renamingVol && volDraft.trim()) props.onRenameVolume(renamingVol, volDraft.trim());
    setRenamingVol(null);
  };

  const commitNewVol = () => {
    if (newVol.trim()) props.onAddVolume(newVol.trim());
    setNewVol('');
    setAddingVol(false);
  };

  const volIds = new Set(props.volumes.map((v) => v.id));
  const groups: Group[] = props.volumes.map((v) => ({
    key: v.id,
    vol: v,
    items: props.chapters.filter((c) => c.volumeId === v.id),
  }));
  const unvol = props.chapters.filter((c) => !c.volumeId || !volIds.has(c.volumeId));
  if (unvol.length || !props.volumes.length) {
    groups.push({ key: NONE_VOL, vol: null, items: unvol });
  }
  const showHeaders = props.volumes.length > 0;

  const itemDnd = (c: ChapterMeta) => ({
    draggable: renamingId !== c.id,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DND_TYPE, c.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      setDropMark(null);
      setVolOver(null);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DND_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      setDropMark((m) => (m && m.id === c.id && m.pos === pos ? m : { id: c.id, pos }));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData(DND_TYPE);
      setDropMark(null);
      if (!id || id === c.id) return;
      const r = e.currentTarget.getBoundingClientRect();
      const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      props.onReorder(id, c.id, pos);
    },
  });

  const headerDnd = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DND_TYPE)) return;
      e.preventDefault();
      setVolOver(key);
    },
    onDragLeave: () => setVolOver((v) => (v === key ? null : v)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData(DND_TYPE);
      setVolOver(null);
      if (id) props.onDropToVolume(id, key === NONE_VOL ? null : key);
    },
  });

  return (
    <div className="chapter-list">
      <div className="chapter-list-head">
        章节 <span className="count">{props.chapters.length}</span>
        {showHeaders && <span className="vol-hint">拖章节排序 / 拖进卷名分组</span>}
      </div>
      <div className="chapter-items">
        {groups.map((g) => (
          <div key={g.key} className="vol-group">
            {showHeaders && (
              <div
                className={'vol-head' + (volOver === g.key ? ' drag-over' : '')}
                {...headerDnd(g.key)}
              >
                {g.vol && renamingVol === g.vol.id ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={volDraft}
                    onChange={(e) => setVolDraft(e.target.value)}
                    onBlur={commitVol}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitVol();
                      if (e.key === 'Escape') setRenamingVol(null);
                    }}
                  />
                ) : (
                  <span
                    className="vol-title"
                    title={g.vol ? '双击重命名；把章节拖到这里分入此卷' : '把章节拖到这里移回未分卷'}
                    onDoubleClick={
                      g.vol
                        ? () => {
                            setRenamingVol(g.vol!.id);
                            setVolDraft(g.vol!.title);
                          }
                        : undefined
                    }
                  >
                    {g.vol ? g.vol.title : '未分卷'}
                  </span>
                )}
                <span className="vol-count">{g.items.length} 章</span>
                {g.vol && (
                  <span className="vol-ops">
                    <button
                      className="op"
                      title="重命名卷"
                      onClick={() => {
                        setRenamingVol(g.vol!.id);
                        setVolDraft(g.vol!.title);
                      }}
                    >
                      改
                    </button>
                    <button
                      className="op danger"
                      title="删除卷（章节保留，回到未分卷）"
                      onClick={() => props.onDeleteVolume(g.vol!.id)}
                    >
                      删
                    </button>
                  </span>
                )}
              </div>
            )}
            {g.items.map((c) => {
              const mark =
                dropMark && dropMark.id === c.id
                  ? dropMark.pos === 'before'
                    ? ' drop-before'
                    : ' drop-after'
                  : '';
              return (
                <div
                  key={c.id}
                  className={`chapter-item ${c.id === props.activeId ? 'active' : ''} ${c.synopsis ? 'has-syn' : ''}${mark}`}
                  onClick={() => renamingId !== c.id && props.onSelect(c.id)}
                  {...itemDnd(c)}
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
                        {c.outline ? <span className="has-outline" title="已有章纲">纲</span> : null}
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
                        <button className="op" title="梗概" onClick={() => props.onSynopsis(c)}>
                          概
                        </button>
                        <button className="op" title="章纲" onClick={() => props.onOutline(c)}>
                          纲
                        </button>
                        <button className="op danger" title="删除本章" onClick={() => props.onDelete(c)}>
                          删
                        </button>
                      </span>
                      {c.synopsis && (
                        <div
                          className="chapter-syn"
                          title={c.synopsis}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onSynopsis(c);
                          }}
                        >
                          {c.synopsis}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {showHeaders && !g.items.length && (
              <div className="vol-empty">（空卷，把章节拖进来）</div>
            )}
          </div>
        ))}
      </div>
      <button className="add-chapter" onClick={props.onAdd}>
        ＋ 新章节
      </button>
      {addingVol ? (
        <input
          className="vol-new-input"
          autoFocus
          value={newVol}
          placeholder="卷名，如：第一卷 风起，回车确认"
          onChange={(e) => setNewVol(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitNewVol();
            if (e.key === 'Escape') {
              setNewVol('');
              setAddingVol(false);
            }
          }}
          onBlur={commitNewVol}
        />
      ) : (
        <button className="add-vol" onClick={() => setAddingVol(true)}>
          ＋ 新建卷（长篇分卷管理）
        </button>
      )}
    </div>
  );
}
