import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { Editor as TipTapEditor } from '@tiptap/react';
import type { Book, ChapterFile, ChapterMeta, Character, LoreEntry, RefIndexEntry } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from '../lib/json';
import { countWords, docToPlainText } from '../lib/words';
import { loadAiConfig, callAi } from '../lib/ai';
import type { AiConfig } from '../lib/ai';
import { buildAiMessages, TASK_LABELS } from '../lib/assembler';
import type { AiTaskKind } from '../lib/assembler';
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
import AiSettingsModal from './AiSettingsModal';
import ProposalModal from './ProposalModal';
import type { ProposalState } from './ProposalModal';
import StructureTab from './StructureTab';
import ChatPanel from './ChatPanel';
import type { EntityTarget } from './types';
import type { Foreshadow } from '../types';
import type { TimelineData } from '../lib/structure';
import * as st from '../lib/structure';
import { entityCardLines } from '../lib/assembler';
import { writeText, joinPath, isDesktop } from '../lib/fs';

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

  /* ---------- AI 状态 ---------- */
  const [aiCfg, setAiCfg] = useState<AiConfig | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null);
  const [selCustom, setSelCustom] = useState('');
  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const pendingAiRef = useRef<{ kind: AiTaskKind; custom?: string; range?: { from: number; to: number } } | null>(null);
  const rerunAiRef = useRef<(() => void) | null>(null);

  /* ---------- P3：时间线 / 伏笔 / AI 巡检 ---------- */
  const [timeline, setTimeline] = useState<TimelineData>({ lanes: [], events: [] });
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([]);
  const [aiReport, setAiReport] = useState<{ phase: 'loading' | 'done' | 'error'; text?: string; error?: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [synModal, setSynModal] = useState<{ meta: ChapterMeta; draft: string; busy: boolean } | null>(null);
  const [theme, setThemeState] = useState<'light' | 'dark'>(
    (document.body.dataset.theme as 'light' | 'dark') ?? 'light'
  );

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
    setTimeline(await st.loadTimeline(root, dirName));
    setForeshadows(await st.loadForeshadows(root, dirName));
  }, [root, dirName]);

  const persistTimeline = useCallback(
    async (t: TimelineData) => {
      setTimeline(t);
      await st.saveTimeline(root, dirName, t);
    },
    [root, dirName]
  );

  const persistForeshadows = useCallback(
    async (list: Foreshadow[]) => {
      setForeshadows(list);
      await st.saveForeshadows(root, dirName, list);
    },
    [root, dirName]
  );

  /** AI 巡检：把设定卡 + 伏笔清单 + 本章正文交给模型，找硬冲突与存疑项 */
  const runConsistencyCheck = async () => {
    if (!aiCfg) {
      setAiSettingsOpen(true);
      toast('先配置 AI 再巡检', 'err');
      return;
    }
    if (!book || !activeId || !editor) return;
    const meta = book.chapters.find((c) => c.id === activeId);
    if (!meta) return;
    setAiReport({ phase: 'loading' });
    try {
      const chapterText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n').slice(0, 8000);
      const cards = entityCardLines(chars, lore, [
        ...new Set(refs.filter((r) => r.chapterId === activeId).map((r) => r.targetId)),
      ]);
      const fores = foreshadows
        .map((f) => `· ${f.title}（${st.foreshadowStateOf(f, book.chapters)}；埋于${f.plantAnchors.map((a) => (book.chapters.find((c) => c.id === a.chapterId)?.index ?? 0) + 1).join('、')}章${f.payoffAnchor ? '，已回收' : ''}）`)
        .slice(0, 20);
      const parts = [
        `【作品】《${book.title}》第${meta.index + 1}章 ${meta.title}`,
        cards.length ? '【设定资料】\n' + cards.join('\n') : '',
        fores.length ? '【伏笔清单】\n' + fores.join('\n') : '',
        '【本章正文】\n' + chapterText,
        '【任务】你是连载小说的连续性审校。找出本章与设定资料、伏笔清单之间的硬冲突（时间线错乱、人物设定矛盾、地点/势力张冠李戴、已回收伏笔再次出现等）和存疑项（称呼不一致、疑似遗忘的伏笔）。只报告有依据的问题，每条格式：〔硬冲突/存疑〕问题描述（引用相关原文片段）。没有问题就明确说"未发现明显冲突"。不要改写正文。',
      ].filter(Boolean);
      const r = await callAi(aiCfg, [{ role: 'user', content: parts.join('\n\n') }], {
        maxTokens: 4000,
        temperature: 0.3,
      });
      setAiReport({ phase: 'done', text: r.text });
    } catch (e) {
      setAiReport({ phase: 'error', error: String(e instanceof Error ? e.message : e) });
    }
  };

  /** 分章导出：每章一个 TXT，存进所选文件夹（网文平台连载用） */
  const exportChaptersToFolder = async () => {
    setMenu(null);
    if (!book) return;
    if (!isDesktop) {
      toast('浏览器预览模式不支持选文件夹，请用桌面版', 'err');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, title: '选择导出位置（每章一个 TXT）' });
    if (typeof dir !== 'string') return;
    try {
      await flushSave();
      let n = 0;
      for (const m of book.chapters) {
        const f = await lib.readChapter(root, dirName, m.id);
        if (!f) continue;
        const body = docToPlainText(f.doc as never);
        const name = `第${m.index + 1}章 ${lib.safeName(m.title)}.txt`;
        await writeText(joinPath(dir, name), `第${m.index + 1}章 ${m.title}\n\n${body}\n`);
        n++;
      }
      toast(`已导出 ${n} 个 TXT 文件`);
    } catch (e) {
      toast('导出失败：' + String(e), 'err');
    }
  };

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

  /* ---------- AI：任务执行 / 提案应用 ---------- */

  useEffect(() => {
    void loadAiConfig().then(setAiCfg);
  }, []);

  /** 正文右键：有选区才弹 AI 菜单，没有就放行系统菜单（拼写/粘贴） */
  const onPaperContextMenu = (e: React.MouseEvent) => {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty) {
      setSelMenu(null);
      return;
    }
    e.preventDefault();
    setSelCustom('');
    setSelMenu({ x: e.clientX, y: e.clientY });
  };

  const hostOf = (url: string): string => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  const runAiTask = (kind: AiTaskKind, custom?: string) => {
    setSelMenu(null);
    if (!aiCfg) {
      setAiSettingsOpen(true);
      toast('先把 AI 配置好（填你自己的密钥）', 'err');
      return;
    }
    if (!editor || !book || !activeId) return;
    const meta = book.chapters.find((c) => c.id === activeId);
    if (!meta) return;

    let range: { from: number; to: number } | undefined;
    let selection: string | undefined;
    if (kind !== 'continue') {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        toast('先选中一段文字再操作', 'err');
        return;
      }
      range = { from, to };
      selection = editor.state.doc.textBetween(from, to, '\n');
    }
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
    const chapterTail = range
      ? editor.state.doc.textBetween(0, range.from, '\n')
      : fullText;
    const relatedIds = [...new Set(refs.filter((r) => r.chapterId === activeId).map((r) => r.targetId))];

    pendingAiRef.current = { kind, custom, range };
    const cfg = aiCfg;

      const runOnce = () => {
      setProposal({
        phase: 'loading',
        title: TASK_LABELS[kind] + (kind === 'custom' && custom ? '：' + clipText(custom, 12) : ''),
        modelTag: cfg.model + ' @ ' + hostOf(cfg.baseUrl),
        startedAt: Date.now(),
        original: selection,
      });
      void (async () => {
        try {
          let prevTail: string | undefined;
          let prevSynopsis: string | undefined;
          if (meta.index > 0) {
            const prev = book.chapters[meta.index - 1];
            prevSynopsis = prev.synopsis;
            if (kind === 'continue') {
              const pf = await lib.readChapter(root, dirName, prev.id);
              prevTail = pf ? docToPlainText(pf.doc as never).slice(-500) : undefined;
            }
          }
          const messages = buildAiMessages(
            { book, chapter: meta, chapterTail, prevChapterTail: prevTail, prevSynopsis, selection, relatedIds, kind, custom },
            chars,
            lore
          );
          const maxTokens =
            kind === 'continue' ? 1500 : Math.min(2200, Math.max(400, Math.round((selection?.length ?? 200) * 3)));
          const r = await callAi(cfg, messages, { maxTokens, temperature: kind === 'continue' ? 0.9 : 0.7 });
          setProposal((p) =>
            p
              ? {
                  ...p,
                  phase: 'done',
                  aiText: r.text,
                  usage: `输入约 ${r.promptTokens ?? '?'} / 输出 ${r.completionTokens ?? '?'} tokens`,
                }
              : p
          );
        } catch (e) {
          setProposal((p) =>
            p ? { ...p, phase: 'error', error: String(e instanceof Error ? e.message : e) } : p
          );
        }
      })();
    };
    rerunAiRef.current = runOnce;
    runOnce();
  };

  const applyProposal = () => {
    const p = proposal;
    const t = pendingAiRef.current;
    if (!p?.aiText || !editor || !t) return;
    const paras = p.aiText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ type: 'paragraph', content: [{ type: 'text', text: s }] }));
    if (!paras.length) {
      toast('AI 没有产出可用文字', 'err');
      return;
    }
    if (t.kind === 'continue') {
      editor.chain().focus('end').insertContentAt(editor.state.doc.content.size, paras as never).run();
    } else if (t.range) {
      editor.chain().focus().insertContentAt({ from: t.range.from, to: t.range.to }, paras as never).run();
    }
    setProposal(null);
    toast('已应用到正文，Ctrl+Z 可整段撤销');
  };

  /* ---------- P4：梗概 / 对话 / 主题 ---------- */

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    setThemeState(next);
    await lib.setTheme(next);
  };

  const saveSynopsis = async () => {
    if (!synModal || !book) return;
    const chapters = book.chapters.map((c) =>
      c.id === synModal.meta.id ? { ...c, synopsis: synModal.draft.trim() || undefined } : c
    );
    await persistBook({ ...book, chapters });
    setSynModal(null);
    toast('梗概已保存');
  };

  const generateSynopsis = async () => {
    if (!synModal || !aiCfg || !book) return;
    const meta = synModal.meta;
    const f = await lib.readChapter(root, dirName, meta.id);
    if (!f) {
      toast('读不到这一章', 'err');
      return;
    }
    setSynModal({ ...synModal, busy: true });
    try {
      const text = docToPlainText(f.doc as never).slice(0, 8000);
      const cards = entityCardLines(chars, lore, [...new Set(refs.filter((r) => r.chapterId === meta.id).map((r) => r.targetId))]);
      const r = await callAi(
        aiCfg,
        [
          { role: 'system', content: '你负责为长篇小说生成章节梗概。只输出梗概本身，不解释。' },
          {
            role: 'user',
            content:
              `《${book.title}》第${meta.index + 1}章 ${meta.title}\n` +
              (cards.length ? '设定资料：\n' + cards.join('\n') + '\n\n' : '') +
              '本章正文：\n' +
              text +
              '\n\n任务：用 50～80 字概括本章剧情要点（谁、在哪、发生了什么、结果/悬念）。只输出概括。',
          },
        ],
        { maxTokens: 600, temperature: 0.4 }
      );
      setSynModal((m) => (m ? { ...m, draft: r.text, busy: false } : m));
    } catch (e) {
      setSynModal((m) => (m ? { ...m, busy: false } : m));
      toast(String(e instanceof Error ? e.message : e), 'err');
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
          <button className="ghost-btn icon-only" title={theme === 'dark' ? '切到浅色' : '切到深色'} onClick={() => void toggleTheme()}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className="ghost-btn" onClick={() => setSearchOpen(true)}>
            🔍 搜索
          </button>
          <button className={'ghost-btn' + (chatOpen ? ' on' : '')} onClick={() => setChatOpen(!chatOpen)}>
            AI 对话
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
                  <button onClick={() => void exportChaptersToFolder()}>分章 TXT（每章一个文件）</button>
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
          onSynopsis={(m) => setSynModal({ meta: m, draft: m.synopsis ?? '', busy: false })}
          chars={chars}
          lore={lore}
          refs={refs}
          onInspect={setInspector}
          onNew={(kind) =>
            setEditing({ entity: kind === 'character' ? ent.newCharacter('') : ent.newLore('') })
          }
          onOpenGraph={() => setGraphOpen(true)}
          structure={
            book ? (
              <StructureTab
                book={book}
                timeline={timeline}
                foreshadows={foreshadows}
                chars={chars}
                lore={lore}
                onTimelineChange={(t) => void persistTimeline(t)}
                onForeshadowsChange={(f) => void persistForeshadows(f)}
                onJumpChapter={(id) => void jumpToChapter(id)}
                onConsistencyCheck={() => void runConsistencyCheck()}
              />
            ) : null
          }
        />
        <main className="editor-main">
          <div className="paper" ref={paperRef} onContextMenu={onPaperContextMenu}>
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
            <span>
              本章 {lib.fmtNum(liveWords)} 字
              {activeMeta && liveWords !== activeMeta.wordCount
                ? '（已存 ' + lib.fmtNum(activeMeta.wordCount) + '）'
                : ''}
              <span className="footer-hint">选中文字右键唤起 AI · 输入 @ 引用 · 点虚线转关联</span>
            </span>
            <span className="footer-actions">
              <button
                className={'ghost-btn small' + (aiCfg ? '' : ' off')}
                title={aiCfg ? '接着本章结尾继续写' : '先配置 AI'}
                onClick={() => runAiTask('continue')}
              >
                ✦ AI 续写
              </button>
              <button className="ghost-btn small" onClick={() => setAiSettingsOpen(true)}>
                ⚙ AI{aiCfg ? '' : '·未配置'}
              </button>
            </span>
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
        {chatOpen && book && (
          <ChatPanel
            root={root}
            dirName={dirName}
            book={book}
            chars={chars}
            lore={lore}
            foreshadows={foreshadows}
            refs={refs}
            aiCfg={aiCfg}
            activeChapterId={activeId}
            chapterTail={editor ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n') : ''}
            onClose={() => setChatOpen(false)}
            onNeedSettings={() => {
              setChatOpen(false);
              setAiSettingsOpen(true);
            }}
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

      {aiSettingsOpen && (
        <AiSettingsModal
          initial={aiCfg}
          onClose={() => setAiSettingsOpen(false)}
          onSaved={(cfg) => {
            setAiCfg(cfg);
            setAiSettingsOpen(false);
          }}
        />
      )}

      {/* 选中文字后的 AI 右键菜单 */}
      {selMenu && (
        <>
          <div className="menu-overlay" onClick={() => setSelMenu(null)} />
          <div
            className="sel-menu"
            style={{ left: Math.min(selMenu.x, window.innerWidth - 260), top: Math.min(selMenu.y, window.innerHeight - 240) }}
          >
            <button className="sel-act" onClick={() => runAiTask('rewrite')}>
              ✎ 改写
            </button>
            <button className="sel-act" onClick={() => runAiTask('expand')}>
              ⇱ 扩写
            </button>
            <button className="sel-act" onClick={() => runAiTask('shorten')}>
              ⇲ 缩写
            </button>
            <button className="sel-act" onClick={() => runAiTask('polish')}>
              ✧ 润色
            </button>
            <div className="menu-sep" />
            <input
              className="sel-custom"
              placeholder="自定义要求，如：改成第一人称"
              value={selCustom}
              autoFocus
              onChange={(e) => setSelCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && selCustom.trim()) runAiTask('custom', selCustom.trim());
              }}
            />
            <button
              className="sel-act custom-go"
              disabled={!selCustom.trim()}
              onClick={() => runAiTask('custom', selCustom.trim())}
            >
              按要求处理 →
            </button>
          </div>
        </>
      )}

      {/* AI 提案确认卡 */}
      {proposal && (
        <ProposalModal
          state={proposal}
          onApply={applyProposal}
          onRegenerate={() => rerunAiRef.current?.()}
          onClose={() => setProposal(null)}
        />
      )}

      {/* 章节梗概 */}
      {synModal && (
        <Modal title={`第${synModal.meta.index + 1}章 · 梗概`} onClose={() => setSynModal(null)}>
          <p className="hint-text">本章的剧情要点。手写的优先；也可以让 AI 读完本章帮你概括。续写、巡检、AI 对话都会带着它。</p>
          <textarea
            className="syn-area"
            rows={4}
            autoFocus
            value={synModal.draft}
            placeholder="50～80 字：谁、在哪、发生了什么、结果或悬念"
            onChange={(e) => setSynModal({ ...synModal, draft: e.target.value })}
          />
          <div className="modal-actions">
            <button
              className="ghost-btn"
              disabled={!aiCfg || synModal.busy || !synModal.meta.wordCount}
              title={!aiCfg ? '先配置 AI' : !synModal.meta.wordCount ? '这章还没写内容' : ''}
              onClick={() => void generateSynopsis()}
            >
              {synModal.busy ? 'AI 概括中…' : '✦ AI 概括本章'}
            </button>
            <button className="ghost-btn" onClick={() => setSynModal(null)}>
              取消
            </button>
            <button className="primary-btn" onClick={() => void saveSynopsis()}>
              保存
            </button>
          </div>
        </Modal>
      )}

      {/* AI 巡检报告 */}
      {aiReport && (
        <Modal title="AI 一致性巡检" width={640} onClose={() => setAiReport(null)}>
          {aiReport.phase === 'loading' && (
            <div className="prop-loading">
              <div className="prop-shimmer" />
              <div className="prop-shimmer short" />
              <p className="hint-text">正在通读本章与设定资料……</p>
            </div>
          )}
          {aiReport.phase === 'error' && (
            <div className="prop-error">
              <p>{aiReport.error}</p>
            </div>
          )}
          {aiReport.phase === 'done' && <div className="report-text">{aiReport.text}</div>}
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setAiReport(null)}>
              关闭
            </button>
            {aiReport.phase === 'error' && (
              <button className="primary-btn" onClick={() => void runConsistencyCheck()}>
                重试
              </button>
            )}
          </div>
        </Modal>
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

function clipText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
