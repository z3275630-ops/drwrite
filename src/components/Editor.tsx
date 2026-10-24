import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { Editor as TipTapEditor } from '@tiptap/react';
import type { Book, ChapterFile, ChapterMeta, Character, LoreEntry, RefIndexEntry } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from '../lib/json';
import { countWords } from '../lib/words';
import * as lib from '../lib/library';
import { cnNum } from '../lib/cnnum';
import {
  EntityRefMark,
  EntityHintExtension,
  entityRefMarkName,
  type HintEntity,
} from '../extensions/entityRef';
import * as ent from '../lib/entities';
import { toast } from './Toast';
import { Modal } from './Modal';
import Sidebar from './Sidebar';
import Inspector from './Inspector';
import { CharacterFormModal, LoreFormModal } from './EntityForms';
import SearchModal from './SearchModal';
import GraphModal from './GraphModal';
import type { EntityTarget } from './types';

const p2 = (n: number) => String(n).padStart(2, '0');

interface QuickItem {
  kind: 'character' | 'lore';
  id: string;
  name: string;
  sub: string;
}

interface AtPopup {
  anchor: number;
  query: string;
  items: QuickItem[];
  idx: number;
}

interface HintPop {
  x: number;
  y: number;
  from: number;
  to: number;
  entity: HintEntity;
}

export default function Editor(props: {
  root: string;
  dirName: string;
  onExit: () => void;
}) {
  const { root, dirName } = props;
  const [book, setBook] = useState<Book | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [lastSaved, setLastSaved] = useState('');
  const [liveWords, setLiveWords] = useState(0);
  const [editorEmpty, setEditorEmpty] = useState(true);
  const [renamingBook, setRenamingBook] = useState(false);
  const [bookTitleDraft, setBookTitleDraft] = useState('');
  const [menu, setMenu] = useState<'export' | null>(null);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [snapPanelOpen, setSnapPanelOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChapterMeta | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* ---------- 资料库状态 ---------- */
  const [chars, setChars] = useState<Character[]>([]);
  const [lore, setLore] = useState<LoreEntry[]>([]);
  const [refs, setRefs] = useState<RefIndexEntry[]>([]);
  const [inspector, setInspector] = useState<EntityTarget | null>(null);
  const [editing, setEditing] = useState<{ entity: Character | LoreEntry } | null>(null);
  const [atPopup, setAtPopup] = useState<AtPopup | null>(null);
  const [hintPop, setHintPop] = useState<HintPop | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const dirtyRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const switchingRef = useRef(false);
  const hintRef = useRef<HintEntity[]>([]);
  const atRef = useRef<AtPopup | null>(null);
  atRef.current = atPopup;
  const paperRef = useRef<HTMLDivElement>(null);
  /** 编辑器事件处理器走 ref 转发，永远拿到最新闭包 */
  const handlersRef = useRef<{
    onUpdate?: (ed: TipTapEditor) => void;
    onKey?: (e: KeyboardEvent) => boolean;
    onClick?: () => void;
  }>({});

  const editor = useEditor({
    extensions: [
      StarterKit,
      EntityRefMark,
      EntityHintExtension.configure({
        getEntities: () => hintRef.current,
        onHintClick: (info) =>
          setHintPop({ x: info.clientX, y: info.clientY, from: info.from, to: info.to, entity: info.entity }),
        onRefClick: (info) =>
          setInspector({ kind: info.targetType === 'lore' ? 'lore' : 'character', id: info.targetId }),
      }),
    ],
    content: lib.emptyDoc() as never,
    editorProps: {
      attributes: { class: 'novel-doc', spellcheck: 'false' },
      handleKeyDown: (_v, e) => handlersRef.current.onKey?.(e) ?? false,
      handleClick: () => {
        handlersRef.current.onClick?.();
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => handlersRef.current.onUpdate?.(ed),
  });

  /* ---------- 保存 ---------- */

  const refreshRefs = useCallback(async () => {
    try {
      setRefs(await ent.readRefs(root, dirName));
    } catch {
      // 索引读取失败不致命
    }
  }, [root, dirName]);

  const flushSave = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    if (!dirtyRef.current || !book || !activeId || !editor) return;
    dirtyRef.current = false;
    setSaveState('saving');
    const meta = book.chapters.find((c) => c.id === activeId);
    if (!meta) {
      setSaveState('saved');
      return;
    }
    const file: ChapterFile = {
      protocolVersion: MODEL_VERSION,
      meta: { ...meta },
      doc: editor.getJSON() as unknown as JsonValue,
    };
    try {
      const next = await lib.saveChapterWithStats(root, dirName, book, file);
      setBook(next);
      setSaveState('saved');
      void refreshRefs();
      const d = new Date();
      setLastSaved(`${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`);
    } catch (e) {
      dirtyRef.current = true;
      setSaveState('dirty');
      toast('保存失败：' + String(e), 'err');
    }
  }, [book, activeId, editor, root, dirName, refreshRefs]);

  /** 把一份文档载入编辑器（不计为修改，不触发自动保存） */
  const loadChapterInto = useCallback(
    (doc: JsonValue, words: number) => {
      if (!editor) return;
      switchingRef.current = true;
      try {
        editor.chain().setContent(doc as never).run();
      } finally {
        switchingRef.current = false;
      }
      setLiveWords(words);
      setEditorEmpty(editor.isEmpty);
      setSaveState('saved');
      dirtyRef.current = false;
      setAtPopup(null);
      setHintPop(null);
    },
    [editor]
  );

  /* ---------- @ 引用弹层 ---------- */

  const quickFilter = useCallback(
    (q: string): QuickItem[] => {
      const ql = q.trim().toLowerCase();
      const pool: QuickItem[] = [
        ...chars.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, sub: `人物 · ${c.tier}` })),
        ...lore.map((l) => ({ kind: 'lore' as const, id: l.id, name: l.name, sub: `设定 · ${l.category}` })),
      ];
      const hit = pool.filter((x) => ent.aliasMatch(x.name, undefined, ql) || (ql && x.name.toLowerCase().includes(ql)));
      hit.sort((a, b) => {
        const as = ql && a.name.toLowerCase().startsWith(ql) ? 0 : 1;
        const bs = ql && b.name.toLowerCase().startsWith(ql) ? 0 : 1;
        return as - bs || (a.kind === 'character' ? -1 : 1);
      });
      return hit.slice(0, 8);
    },
    [chars, lore]
  );

  const insertAtRef = useCallback(
    (item: QuickItem, anchor: number) => {
      if (!editor) return;
      const to = editor.state.selection.from;
      if (to < anchor) {
        setAtPopup(null);
        return;
      }
      editor
        .chain()
        .focus()
        .insertContentAt({ from: anchor, to }, {
          type: 'text',
          text: item.name,
          marks: [
            {
              type: entityRefMarkName,
              attrs: { targetType: item.kind, targetId: item.id, displayText: item.name },
            },
          ],
        } as never)
        .run();
      setAtPopup(null);
    },
    [editor]
  );

  const updateAtPopup = useCallback(
    (ed: TipTapEditor) => {
      const sel = ed.state.selection;
      if (!sel.empty) {
        if (atRef.current) setAtPopup(null);
        return;
      }
      const $from = sel.$from;
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC');
      const m = before.match(/[@＠]([^@\s，。！？；：、,.!?;:\[\]()（）"'"']{0,24})$/);
      if (!m) {
        if (atRef.current) setAtPopup(null);
        return;
      }
      const anchor = $from.pos - m[0].length;
      const query = m[1];
      const items = quickFilter(query);
      if (!items.length) {
        if (atRef.current) setAtPopup(null);
        return;
      }
      setAtPopup((p) => (p && p.anchor === anchor && p.query === query ? p : { anchor, query, items, idx: 0 }));
    },
    [quickFilter]
  );

  handlersRef.current.onUpdate = (ed: TipTapEditor) => {
    if (switchingRef.current) return;
    dirtyRef.current = true;
    setSaveState('dirty');
    setLiveWords(countWords(ed.getText()));
    setEditorEmpty(ed.isEmpty);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushSave(), 800);
    updateAtPopup(ed);
  };

  handlersRef.current.onKey = (e: KeyboardEvent) => {
    const pop = atRef.current;
    if (!pop) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setAtPopup({ ...pop, idx: (pop.idx + d + pop.items.length) % pop.items.length });
      return true;
    }
    if (e.key === 'Enter') {
      insertAtRef(pop.items[pop.idx], pop.anchor);
      return true;
    }
    if (e.key === 'Escape') {
      setAtPopup(null);
      return true;
    }
    return false;
  };

  handlersRef.current.onClick = () => {
    if (atRef.current) setAtPopup(null);
    if (hintPop) setHintPop(null);
  };

  /* ---------- 淡提示 → 转为关联 ---------- */

  const convertHint = useCallback(() => {
    if (!editor || !hintPop) return;
    const text = editor.state.doc.textBetween(hintPop.from, hintPop.to);
    const mark = editor.schema.mark(entityRefMarkName, {
      targetType: hintPop.entity.kind,
      targetId: hintPop.entity.id,
      displayText: text,
    });
    editor.view.dispatch(editor.state.tr.addMark(hintPop.from, hintPop.to, mark));
    setHintPop(null);
  }, [editor, hintPop]);

  /* ---------- 初始化 ---------- */

  const reloadEntities = useCallback(async () => {
    const [cs, ls] = await Promise.all([
      ent.listCharacters(root, dirName),
      ent.listLore(root, dirName),
    ]);
    setChars(cs);
    setLore(ls);
  }, [root, dirName]);

  useEffect(() => {
    void (async () => {
      const b = await lib.loadBook(root, dirName);
      if (!b) {
        toast('打开失败：找不到这本书的数据', 'err');
        props.onExit();
        return;
      }
      setBook(b);
      void reloadEntities();
      void refreshRefs();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, dirName]);

  // 编辑器实例就绪后载入第一章
  useEffect(() => {
    if (!editor || !book || activeId || !book.chapters.length) return;
    const first = book.chapters[0];
    void (async () => {
      const f = await lib.readChapter(root, dirName, first.id);
      loadChapterInto(f?.doc ?? lib.emptyDoc(), first.wordCount);
      setActiveId(first.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, book, activeId]);

  // 实体表变化 → 刷新淡提示 + 失效引用样式
  useEffect(() => {
    hintRef.current = [
      ...chars.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, aliases: c.aliases })),
      ...lore.map((l) => ({ kind: 'lore' as const, id: l.id, name: l.name, aliases: l.aliases })),
    ];
    if (editor) editor.view.dispatch(editor.state.tr.setMeta('drwriteHintRefresh', true));
    if (editor) {
      const known = new Set([...chars.map((c) => c.id), ...lore.map((l) => l.id)]);
      editor.view.dom.querySelectorAll<HTMLElement>('[data-entity-id]').forEach((el) => {
        el.classList.toggle('dangling', !known.has(el.getAttribute('data-entity-id') ?? ''));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars, lore, editor, activeId, liveWords]);

  /* ---------- 全局保存钩子 ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flushSave();
      }
      if (e.key === 'Escape') setHintPop(null);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSave();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushSave]);

  /* ---------- 章节操作 ---------- */

  const switchChapter = async (id: string) => {
    if (id === activeId) return;
    await flushSave();
    const f = await lib.readChapter(root, dirName, id);
    loadChapterInto(f?.doc ?? lib.emptyDoc(), f?.meta.wordCount ?? 0);
    setActiveId(id);
  };

  const persistBook = async (next: Book) => {
    await lib.saveBook(root, dirName, next);
    setBook({ ...next });
  };

  const addChapter = async () => {
    if (!book) return;
    await flushSave();
    const meta: ChapterMeta = {
      id: lib.genId(),
      index: book.chapters.length,
      title: `第${cnNum(book.chapters.length + 1)}章`,
      wordCount: 0,
      createdAt: lib.nowIso(),
      updatedAt: lib.nowIso(),
    };
    await lib.writeChapter(root, dirName, lib.newChapterFile(meta));
    await persistBook({ ...book, chapters: [...book.chapters, meta] });
    loadChapterInto(lib.emptyDoc(), 0);
    setActiveId(meta.id);
  };

  const renameChapter = async (id: string, title: string) => {
    if (!book) return;
    await flushSave();
    await persistBook({
      ...book,
      chapters: book.chapters.map((c) => (c.id === id ? { ...c, title } : c)),
    });
  };

  const moveChapter = async (id: string, dir: -1 | 1) => {
    if (!book) return;
    await flushSave();
    const i = book.chapters.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= book.chapters.length) return;
    const arr = [...book.chapters];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await persistBook({ ...book, chapters: arr.map((c, idx) => ({ ...c, index: idx })) });
  };

  const doDeleteChapter = async () => {
    const meta = deleteTarget;
    if (!meta || !book) return;
    setDeleteTarget(null);
    await flushSave();
    const rest = book.chapters.filter((c) => c.id !== meta.id).map((c, idx) => ({ ...c, index: idx }));
    const next: Book = {
      ...book,
      chapters: rest,
      stats: { ...book.stats, totalWords: rest.reduce((s, c) => s + c.wordCount, 0) },
    };
    await lib.deleteChapterFile(root, dirName, meta.id);
    await ent.updateRefsForChapter(root, dirName, meta.id, null);
    void refreshRefs();
    await persistBook(next);
    if (activeId === meta.id && rest.length) {
      const idx = Math.min(meta.index, rest.length - 1);
      const target = rest[idx];
      const f = await lib.readChapter(root, dirName, target.id);
      loadChapterInto(f?.doc ?? lib.emptyDoc(), target.wordCount);
      setActiveId(target.id);
    }
    toast('已删除该章');
  };

  /* ---------- 书名 ---------- */

  const commitBookTitle = async () => {
    if (book && bookTitleDraft.trim() && bookTitleDraft.trim() !== book.title) {
      await flushSave();
      await persistBook({ ...book, title: bookTitleDraft.trim() });
    }
    setRenamingBook(false);
  };

  /* ---------- 资料库操作 ---------- */

  const saveEntity = async (entity: Character | LoreEntry) => {
    try {
      if (entity.type === 'character') await ent.saveCharacter(root, dirName, entity);
      else await ent.saveLore(root, dirName, entity);
      setEditing(null);
      await reloadEntities();
      toast('已保存：' + entity.name);
    } catch (e) {
      toast('保存失败：' + String(e), 'err');
    }
  };

  const removeEntity = async (t: EntityTarget) => {
    try {
      await ent.deleteEntity(root, dirName, t.kind, t.id);
      setInspector(null);
      await reloadEntities();
      void refreshRefs();
      toast('已删除条目');
    } catch (e) {
      toast('删除失败：' + String(e), 'err');
    }
  };

  const jumpToChapter = async (id: string) => {
    setInspector(null);
    setSearchOpen(false);
    await switchChapter(id);
  };

  /* ---------- 导出 ---------- */

  const doExport = async (format: 'md' | 'txt', scope: 'all' | 'current') => {
    if (!book) return;
    setMenu(null);
    await flushSave();
    if (scope === 'current' && !activeId) return;
    try {
      const { filename, content } = await lib.composeExport(root, dirName, book, {
        format,
        scope,
        chapterId: activeId ?? undefined,
      });
      const ok = await lib.saveExportFile(filename, content);
      if (ok) toast('已导出：' + filename);
    } catch (e) {
      toast('导出失败：' + String(e), 'err');
    }
  };

  /* ---------- 快照 ---------- */

  const openSnapshotPanel = async () => {
    setBusy(true);
    try {
      setSnapshots(await lib.listSnapshots(root, dirName));
    } finally {
      setBusy(false);
    }
    setSnapPanelOpen(true);
  };

  const doSnapshot = async () => {
    setBusy(true);
    try {
      await flushSave();
      const name = await lib.createSnapshot(root, dirName);
      setSnapshots(await lib.listSnapshots(root, dirName));
      toast('已备份（' + name + '）');
    } catch (e) {
      toast('备份失败：' + String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (name: string) => {
    setRestoreTarget(null);
    setSnapPanelOpen(false);
    setBusy(true);
    try {
      await flushSave();
      await lib.restoreSnapshot(root, dirName, name);
      const b = await lib.loadBook(root, dirName);
      if (b) {
        setBook(b);
        const first = b.chapters[0];
        if (first) {
          const f = await lib.readChapter(root, dirName, first.id);
          loadChapterInto(f?.doc ?? lib.emptyDoc(), first.wordCount);
          setActiveId(first.id);
        }
      }
      void refreshRefs();
      toast('已恢复；恢复前的内容自动另存了一份快照');
    } catch (e) {
      toast('恢复失败：' + String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 顶栏渲染 ---------- */

  const today = book ? lib.todayWords(book) : 0;
  const goal = book?.dailyGoal ?? 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((today / goal) * 100)) : 0;
  const activeMeta = book?.chapters.find((c) => c.id === activeId) ?? null;

  const saveLabel =
    saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : lastSaved ? '已保存 ' + lastSaved : '已保存';

  // @ 弹层坐标（相对 .paper）
  let atStyle: React.CSSProperties | undefined;
  if (atPopup && editor && paperRef.current) {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const rect = paperRef.current.getBoundingClientRect();
    atStyle = {
      left: Math.max(8, Math.min(rect.width - 240, coords.left - rect.left)),
      top: coords.bottom - rect.top + 6,
    };
  }

  return (
    <div className="editor-root">
      <header className="topbar">
        <button
          className="back-btn"
          onClick={() => void flushSave().then(props.onExit)}
        >
          ← 书架
        </button>
        <div className="topbar-title">
          {renamingBook ? (
            <input
              className="rename-input wide"
              autoFocus
              value={bookTitleDraft}
              onChange={(e) => setBookTitleDraft(e.target.value)}
              onBlur={() => void commitBookTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitBookTitle();
                if (e.key === 'Escape') setRenamingBook(false);
              }}
            />
          ) : (
            <span
              className="book-title"
              title="点击重命名"
              onClick={() => {
                if (book) {
                  setBookTitleDraft(book.title);
                  setRenamingBook(true);
                }
              }}
            >
              {book?.title ?? '…'}
            </span>
          )}
          {activeMeta && <span className="chapter-crumb">· {activeMeta.title}</span>}
        </div>
        <div className="topbar-stats">
          <span className={'save-state ' + saveState}>{saveLabel}</span>
          <span className="stat">
            今日 <b>{lib.fmtNum(today)}</b>
            {goal ? <span className="muted">/{lib.fmtNum(goal)}</span> : ''} 字
          </span>
          <span className="stat">
            全书 <b>{lib.fmtNum(book?.stats.totalWords ?? 0)}</b> 字
          </span>
          <span className="stat">
            连更 <b>{book?.stats.streakDays ?? 0}</b> 天
          </span>
        </div>
        <div className="topbar-actions">
          <button className="ghost-btn" onClick={() => setSearchOpen(true)}>
            🔍 搜索
          </button>
          <div className="menu-anchor">
            <button
              className="ghost-btn"
              onClick={() => setMenu(menu === 'export' ? null : 'export')}
            >
              导出 ▾
            </button>
            {menu === 'export' && (
              <>
                <div className="menu-overlay" onClick={() => setMenu(null)} />
                <div className="menu-panel">
                  <button onClick={() => void doExport('md', 'all')}>全书 · Markdown</button>
                  <button onClick={() => void doExport('txt', 'all')}>全书 · 纯文本 TXT</button>
                  <div className="menu-sep" />
                  <button onClick={() => void doExport('md', 'current')} disabled={!activeId}>
                    本章 · Markdown
                  </button>
                  <button onClick={() => void doExport('txt', 'current')} disabled={!activeId}>
                    本章 · 纯文本 TXT
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="ghost-btn" onClick={() => void openSnapshotPanel()}>
            备份 / 快照
          </button>
        </div>
      </header>
      {goal > 0 && (
        <div className="goal-bar">
          <div className="goal-fill" style={{ width: goalPct + '%' }} />
        </div>
      )}

      <div className="editor-body">
        <Sidebar
          book={book}
          activeId={activeId}
          onSelect={(id) => void switchChapter(id)}
          onAdd={() => void addChapter()}
          onRename={(id, t) => void renameChapter(id, t)}
          onDelete={(m) => setDeleteTarget(m)}
          onMove={(id, d) => void moveChapter(id, d)}
          chars={chars}
          lore={lore}
          refs={refs}
          onInspect={setInspector}
          onNew={(kind) =>
            setEditing({ entity: kind === 'character' ? ent.newCharacter('') : ent.newLore('') })
          }
          onOpenGraph={() => setGraphOpen(true)}
        />
        <main className="editor-main">
          <div className="paper" ref={paperRef}>
            {editorEmpty && <div className="placeholder-hint">落笔无需完美，先写下第一句……</div>}
            <EditorContent editor={editor} />
            {atPopup && (
              <div className="at-popup" style={atStyle}>
                {atPopup.items.map((it, i) => (
                  <button
                    key={it.id}
                    className={'at-item' + (i === atPopup.idx ? ' on' : '')}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertAtRef(it, atPopup.anchor);
                    }}
                  >
                    <span className={it.kind === 'character' ? 'tier-badge t-配角' : 'cat-badge c-术语'}>
                      {it.kind === 'character' ? '人物' : '设定'}
                    </span>
                    {it.name}
                    <span className="entity-sub">{it.sub}</span>
                  </button>
                ))}
                <div className="at-tip">↑↓ 选择 · 回车插入 · Esc 关闭</div>
              </div>
            )}
          </div>
          <div className="editor-footer">
            本章 {lib.fmtNum(liveWords)} 字
            {activeMeta && liveWords !== activeMeta.wordCount
              ? '（已存 ' + lib.fmtNum(activeMeta.wordCount) + '）'
              : ''}
            <span className="footer-hint">正文输入 @ 引用人物/设定 · 点击虚线下划线可转为关联</span>
          </div>
        </main>
        {inspector && book && (
          <Inspector
            target={inspector}
            chars={chars}
            lore={lore}
            refs={refs}
            book={book}
            onClose={() => setInspector(null)}
            onEdit={(e) => setEditing({ entity: e })}
            onDelete={(t) => void removeEntity(t)}
            onJumpChapter={(id) => void jumpToChapter(id)}
            onJumpEntity={setInspector}
          />
        )}
      </div>

      {/* 淡提示 → 转关联确认气泡 */}
      {hintPop && (
        <>
          <div className="menu-overlay" onClick={() => setHintPop(null)} />
          <div className="hint-pop" style={{ left: hintPop.x, top: hintPop.y + 10 }}>
            <div className="hint-pop-text">
              识别到「{hintPop.entity.name}」
              <span className="entity-sub">
                {(() => {
                  const e =
                    hintPop.entity.kind === 'character'
                      ? chars.find((c) => c.id === hintPop.entity.id)
                      : lore.find((l) => l.id === hintPop.entity.id);
                  return e ? ` · 关联到《${e.name}》` : '';
                })()}
              </span>
            </div>
            <div className="hint-pop-actions">
              <button className="primary-btn slim" onClick={convertHint}>
                转为关联
              </button>
              <button className="ghost-btn small" onClick={() => setHintPop(null)}>
                忽略
              </button>
            </div>
          </div>
        </>
      )}

      {deleteTarget && (
        <Modal title="删除章节" onClose={() => setDeleteTarget(null)}>
          <p className="confirm-text">
            确定删除「{deleteTarget.title}」？
            {deleteTarget.wordCount > 0 && (
              <>
                <br />
                本章有 <b>{lib.fmtNum(deleteTarget.wordCount)}</b> 字，删除后不可恢复（可先做一份快照备份）。
              </>
            )}
          </p>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button className="danger-btn" onClick={() => void doDeleteChapter()}>
              删除
            </button>
          </div>
        </Modal>
      )}

      {restoreTarget && (
        <Modal title="恢复快照" onClose={() => setRestoreTarget(null)}>
          <p className="confirm-text">
            用快照「{formatSnapName(restoreTarget)}」覆盖当前全部内容？
            <br />
            当前内容会先自动另存一份快照，不会丢失。
          </p>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setRestoreTarget(null)}>
              取消
            </button>
            <button className="primary-btn" onClick={() => void doRestore(restoreTarget)}>
              恢复
            </button>
          </div>
        </Modal>
      )}

      {snapPanelOpen && (
        <Modal title="备份与快照" width={520} onClose={() => setSnapPanelOpen(false)}>
          <p className="hint-text">
            快照 = 当前「全书目录 + 全部章节」的完整拷贝，存在这本书的文件夹里。建议每写完一章备份一次。
          </p>
          <div className="snap-list">
            {snapshots.length === 0 && <div className="snap-empty">还没有快照</div>}
            {snapshots.map((name) => (
              <div key={name} className="snap-item">
                <span className="snap-name">{formatSnapName(name)}</span>
                <button
                  className="ghost-btn small"
                  onClick={() => {
                    setSnapPanelOpen(false);
                    setRestoreTarget(name);
                  }}
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setSnapPanelOpen(false)}>
              关闭
            </button>
            <button className="primary-btn" disabled={busy} onClick={() => void doSnapshot()}>
              {busy ? '处理中…' : '立即备份'}
            </button>
          </div>
        </Modal>
      )}

      {editing && editing.entity.type === 'character' && (
        <CharacterFormModal
          initial={editing.entity as Character}
          chars={chars}
          lore={lore}
          onSave={(c) => void saveEntity(c)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && editing.entity.type === 'lore' && (
        <LoreFormModal
          initial={editing.entity as LoreEntry}
          onSave={(l) => void saveEntity(l)}
          onClose={() => setEditing(null)}
        />
      )}

      {searchOpen && book && (
        <SearchModal
          root={root}
          dirName={dirName}
          book={book}
          chars={chars}
          lore={lore}
          onClose={() => setSearchOpen(false)}
          onJumpChapter={(id) => void jumpToChapter(id)}
          onInspect={(t) => {
            setSearchOpen(false);
            setInspector(t);
          }}
        />
      )}

      {graphOpen && (
        <GraphModal
          chars={chars}
          onClose={() => setGraphOpen(false)}
          onSelect={(id) => {
            setGraphOpen(false);
            setInspector({ kind: 'character', id });
          }}
        />
      )}
    </div>
  );
}

/** 20261024-153001 → 2026-10-24 15:30:01 */
function formatSnapName(name: string): string {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return name;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}
