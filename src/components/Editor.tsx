import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Editor as TipTapEditor } from '@tiptap/react';
import type { Book, ChapterFile, ChapterMeta, Character, LoreEntry, Prop, RefIndexEntry, Volume } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from '../lib/json';
import { countWords, docToPlainText } from '../lib/words';
import { loadAiConfig, chatAi } from '../lib/ai';
import type { AiConfig } from '../lib/ai';
import { buildAiMessages, buildContextSources, TASK_LABELS } from '../lib/assembler';
import type { AiTaskKind } from '../lib/assembler';
import * as lib from '../lib/library';
import { cnNum } from '../lib/cnnum';
import {
  EntityRefMark,
  EntityHintExtension,
  entityRefMarkName,
  type HintEntity,
} from '../extensions/entityRef';
import { TypewriterExtension } from '../extensions/typewriter';
import { SceneMark } from '../extensions/sceneMark';
import { HistoryKeys } from '../extensions/historyKeys';
import * as ent from '../lib/entities';
import * as propl from '../lib/props';
import { scenesFromDocJson, scenesFromEditor, sceneKey, updateScene } from '../lib/scenes';
import type { SceneInfo } from '../lib/scenes';
import { addNote } from '../lib/notes';
import { toast } from './Toast';
import { Modal } from './Modal';
import Sidebar from './Sidebar';
import Inspector from './Inspector';
import ChapterPanel from './ChapterPanel';
import type { DraftRegistrar, DraftFlush } from './InlineDraft';
import { WritingSession } from './WritingSession';
import { CharacterHealthModal } from './CharacterHealthModal';
import { OnboardingGuide } from './OnboardingGuide';
import { ObservationModal } from './ObservationModal';
import { StoryCalendarModal } from './StoryCalendarModal';
import { completeGuide, setGuideDismissed, type GuideStep } from '../lib/onboarding';
import { CharacterFormModal, LoreFormModal, PropFormModal } from './EntityForms';
import SearchModal from './SearchModal';
import GraphModal from './GraphModal';
import AiSettingsModal from './AiSettingsModal';
import ProposalModal from './ProposalModal';
import { AiTaskCenter } from './AiTaskCenter';
import { SnapshotPreview } from './SnapshotPreview';
import { ExportModal } from './ExportModal';
import type { ExportOptions } from '../lib/exportPlan';
import { acquireBookLease } from '../lib/bookLease';
import type { JobKind } from '../lib/batchJobs';
import type { ProposalState, ProposalVersion } from './ProposalModal';
import StructureTab from './StructureTab';
import ChatPanel from './ChatPanel';
import FontModal, { fontStackOf } from './FontModal';
import NotesModal from './NotesModal';
import OutlineModal from './OutlineModal';
import type { EntityTarget } from './types';
import type { Foreshadow } from '../types';
import type { TimelineData } from '../lib/structure';
import * as st from '../lib/structure';
import { entityCardLines } from '../lib/assembler';
import { writeText, joinPath, isDesktop } from '../lib/fs';
import { SaveCoordinator, SerialQueue } from '../lib/saveCoordinator';
import { profileCount, profileStart, profileEnd } from '../lib/performanceProbe';
import { BackupCoordinator } from '../lib/backupCoordinator';
import { LiveWordCount, EmptyEditorHint, UndoRedoControls } from './LiveEditorState';
import { CommandPalette, useCommandPalette, type CommandItem } from './CommandPalette';
import { ContextReviewModal, type ContextReview } from './ContextReviewModal';
import { DEFAULT_CONTEXT_POLICY, type ContextPolicy, type BudgetSource } from '../lib/contextBudget';
import { readPreference, writePreference, type WorkspacePreference } from '../lib/preferences';

const p2 = (n: number) => String(n).padStart(2, '0');

interface QuickItem {
  kind: 'character' | 'lore' | 'prop';
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
  profileCount('editor-render');
  const bookRef = useRef<Book | null>(null);
  const [book, setBookState] = useState<Book | null>(null);
  const setBook = useCallback((value: Book | null) => { bookRef.current = value; setBookState(value); }, []);
  const activeIdRef = useRef<string | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const setActiveId = useCallback((value: string | null) => { activeIdRef.current = value; setActiveIdState(value); }, []);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [openingError, setOpeningError] = useState('');
  const [openingRetry, setOpeningRetry] = useState(0);
  const [storageWarning, setStorageWarning] = useState('');
  const [backupWarning, setBackupWarning] = useState('');
  const [lastSaved, setLastSaved] = useState('');
  const [renamingBook, setRenamingBook] = useState(false);
  const [bookTitleDraft, setBookTitleDraft] = useState('');
  const [menu, setMenu] = useState<'export' | null>(null);
  const [snapshots, setSnapshots] = useState<lib.SnapshotInfo[]>([]);
  const [snapPanelOpen, setSnapPanelOpen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null);
  const [exportOptions, setExportOptions] = useState<Partial<ExportOptions> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChapterMeta | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<lib.SnapshotInfo | null>(null);
  const busyRef = useRef(false);
  const fileOperationBusyRef = useRef(false);
  const [busy, setBusyState] = useState(false);
  const setBusy = useCallback((value: boolean) => { busyRef.current = value; setBusyState(value); }, []);
  const [restoredEpoch, setRestoredEpoch] = useState(0);
  const [chatSending, setChatSending] = useState(false);
  const palette = useCommandPalette();
  const [viewOpen, setViewOpen] = useState(false);
  const [sessionVisible, setSessionVisible] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [observationOpen, setObservationOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [guideRevision, setGuideRevision] = useState(0);
  const guide = useCallback((step: GuideStep) => {
    if (!bookRef.current?.sampleKey) return;
    void completeGuide(step).then(() => setGuideRevision(value => value + 1)).catch(error => toast('引导记录未保存：' + String(error), 'err'));
  }, []);
  const draftFlushes = useRef(new Map<string, DraftFlush>());
  const registerDraft: DraftRegistrar = useCallback((id, flush) => { if (flush) draftFlushes.current.set(id, flush); else draftFlushes.current.delete(id); }, []);
  const layoutReady = useRef(false);
  const expandedWidths = useRef({ left: 250, right: 300 });
  const navigationPanel = usePanelRef();
  const assistantPanel = usePanelRef();
  const [navigationVisible, setNavigationVisible] = useState(true);
  const [assistantVisible, setAssistantVisible] = useState(true);
  const sidesBeforeZen = useRef<{ left: boolean; right: boolean } | null>(null);

  /* ---------- P5：排版 / 专注 / 素材箱 / 章纲 / 分卷 ---------- */
  const [prefs, setPrefs] = useState<lib.EditorPrefs>(lib.DEFAULT_PREFS);
  const [fontOpen, setFontOpen] = useState(false);
  const [zen, setZen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [outlineModal, setOutlineModal] = useState<{ meta: ChapterMeta; draft: string; busy: boolean } | null>(null);
  const [deleteVol, setDeleteVol] = useState<Volume | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [unfinishedTasks, setUnfinishedTasks] = useState(0);
  const [taskRequest, setTaskRequest] = useState<{ kind: JobKind; revision: number; chapterId?: string }>({ kind: 'reader', revision: 0 });
  const taskFlushRef = useRef<() => Promise<boolean>>(async () => true);
  const registerTaskFlush = useCallback((flush: () => Promise<boolean>) => { taskFlushRef.current = flush; }, []);
  const showTasks = useCallback(() => setTasksOpen(true), []);
  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [sceneEdit, setSceneEdit] = useState<{ key: string; title: string } | null>(null);
  const [titleEdit, setTitleEdit] = useState<{ id: string; draft: string } | null>(null);

  // 切章时放弃正在编辑的标题，避免把旧草稿写到新章
  useEffect(() => {
    setTitleEdit(null);
  }, [activeId]);

  /* ---------- 资料库状态 ---------- */
  const [chars, setChars] = useState<Character[]>([]);
  const [lore, setLore] = useState<LoreEntry[]>([]);
  const [propEnts, setPropEnts] = useState<Prop[]>([]);
  const [refs, setRefs] = useState<RefIndexEntry[]>([]);
  const [inspector, setInspector] = useState<EntityTarget | null>(null);
  const [editing, setEditing] = useState<{ entity: Character | LoreEntry | Prop } | null>(null);
  const [atPopup, setAtPopup] = useState<AtPopup | null>(null);
  const [hintPop, setHintPop] = useState<HintPop | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  /* ---------- AI 状态 ---------- */
  const [aiCfg, setAiCfg] = useState<AiConfig | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [selCustom, setSelCustom] = useState('');
  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const proposalStateRef = useRef(proposal); proposalStateRef.current = proposal;
  const [contextReview, setContextReview] = useState<ContextReview | null>(null);
  const contextPolicyRef = useRef<ContextPolicy>(DEFAULT_CONTEXT_POLICY);
  const auxAiBusy = useRef(false);
  const [auxProposal, setAuxProposal] = useState<{ kind: 'outline' | 'plot'; text: string; expected: string; chapterId?: string; upto?: number } | null>(null);
  const confirmAiRequest = (base: import('../lib/ai').AiMessage[], sources: BudgetSource[]) => new Promise<import('../lib/ai').AiMessage[] | null>(resolve => {
    setContextReview({ base, sources, initial: contextPolicyRef.current,
      onCancel: () => { setContextReview(null); resolve(null); },
      onSend: (messages, policy) => { contextPolicyRef.current = policy; setContextReview(null); resolve(messages); },
    });
  });
  const pendingAiRef = useRef<{ kind: AiTaskKind; custom?: string; range?: { from: number; to: number }; chapterId: string; originalDoc: string } | null>(null);
  const rerunAiRef = useRef<((feedback?: string) => void) | null>(null);
  const aiRequestRef = useRef(0);
  const closeProposal = () => { aiRequestRef.current++; setContextReview(null); setProposal(null); };

  /* ---------- P3：时间线 / 伏笔 / AI 巡检 ---------- */
  const [timeline, setTimeline] = useState<TimelineData>({ lanes: [], events: [] });
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  const [synModal, setSynModal] = useState<{ meta: ChapterMeta; draft: string; busy: boolean } | null>(null);
  const [theme, setThemeState] = useState<'light' | 'dark'>(
    (document.body.dataset.theme as 'light' | 'dark') ?? 'light'
  );

  const saver = useRef(new SaveCoordinator()).current;
  const navigatingRef = useRef(false);
  const diskQueue = useRef(new SerialQueue()).current;
  const backupGate = useRef(new BackupCoordinator()).current;
  const chatFlushRef = useRef<() => Promise<boolean>>(async () => true);
  const chatFlushFailedRef = useRef(false);
  const pendingBookEdit = useRef<((current: Book) => Book) | null>(null);
  const modalDraftFlushRef = useRef<() => Promise<boolean>>(async () => true);
  const timerRef = useRef<number | undefined>(undefined);
  const switchingRef = useRef(false);
  const hintRef = useRef<HintEntity[]>([]);
  const atRef = useRef<AtPopup | null>(null);
  atRef.current = atPopup;
  const paperRef = useRef<HTMLDivElement>(null);
  const zenRef = useRef(false);
  zenRef.current = zen;
  const rememberWorkspace = useCallback((rightView?: 'chapter' | 'chat') => {
    if (!layoutReady.current || zenRef.current || !bookRef.current) return;
    const left = navigationPanel.current?.getSize().inPixels ?? 250;
    const right = assistantPanel.current?.getSize().inPixels ?? 300;
    if (left > 1) expandedWidths.current.left = left;
    if (right > 1) expandedWidths.current.right = right;
    void writePreference('workspaceByBook', bookRef.current.id, { ...expandedWidths.current,
      leftOpen: left > 1, rightOpen: right > 1, rightView: rightView ?? (chatOpen ? 'chat' : 'chapter') })
      .catch(error => toast('布局未记住：' + String(error), 'err'));
  }, [chatOpen, navigationPanel, assistantPanel]);
  useEffect(() => {
    layoutReady.current = false;
    if (!book?.id) return;
    let alive = true;
    void readPreference<WorkspacePreference>('workspaceByBook', book.id).then(preference => {
      if (!alive) return;
      requestAnimationFrame(() => {
        if (!alive) return;
        if (preference) {
          const left = Math.max(220, Math.min(600, Number(preference.left) || 250));
          const right = Math.max(280, Math.min(700, Number(preference.right) || 300));
          expandedWidths.current = { left, right };
          navigationPanel.current?.resize(left); assistantPanel.current?.resize(right);
          if (preference.leftOpen === false) navigationPanel.current?.collapse();
          if (preference.rightOpen === false) assistantPanel.current?.collapse();
          setChatOpen(preference.rightView === 'chat');
        }
        requestAnimationFrame(() => { if (alive) layoutReady.current = true; });
      });
    }).catch(error => { if (alive) toast('读取布局失败：' + String(error), 'err'); });
    return () => { alive = false; layoutReady.current = false; };
  }, [book?.id, navigationPanel, assistantPanel]);
  const applyWorkspace = (review: boolean) => {
    setViewOpen(false); setZen(false); setInspector(null);
    requestAnimationFrame(() => {
      if (review) { navigationPanel.current?.collapse(); assistantPanel.current?.expand(); assistantPanel.current?.resize(380); setChatOpen(true); }
      else { navigationPanel.current?.expand(); navigationPanel.current?.resize(250); assistantPanel.current?.expand(); assistantPanel.current?.resize(300); setChatOpen(false); }
      requestAnimationFrame(() => rememberWorkspace(review ? 'chat' : 'chapter'));
    });
  };
  const typewriterRef = useRef(false);
  useEffect(() => {
    if (chatOpen) setChatMounted(true);
  }, [chatOpen]);
  useEffect(() => {
    if (zen) {
      sidesBeforeZen.current = {
        left: !navigationPanel.current?.isCollapsed(),
        right: !assistantPanel.current?.isCollapsed(),
      };
      navigationPanel.current?.collapse();
      assistantPanel.current?.collapse();
    } else if (sidesBeforeZen.current) {
      const previous = sidesBeforeZen.current;
      sidesBeforeZen.current = null;
      if (previous.left) navigationPanel.current?.expand();
      if (previous.right) assistantPanel.current?.expand();
    }
  }, [zen, navigationPanel, assistantPanel]);
  useEffect(() => {
    if (!inspector) return;
    setChatOpen(false);
    if (sidesBeforeZen.current) sidesBeforeZen.current.right = true;
    setZen(false);
    assistantPanel.current?.expand();
  }, [inspector, assistantPanel]);
  /** 关窗钩子随时要拿到最新的 flushSave */
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  /** 编辑器事件处理器走 ref 转发，永远拿到最新闭包 */
  const handlersRef = useRef<{
    onUpdate?: (ed: TipTapEditor) => void;
    onKey?: (e: KeyboardEvent) => boolean;
    onClick?: () => void;
  }>({});

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit,
      EntityRefMark,
      SceneMark,
      HistoryKeys,
      TypewriterExtension.configure({ isEnabled: () => typewriterRef.current }),
      EntityHintExtension.configure({
        getEntities: () => hintRef.current,
        onHintClick: (info) =>
          setHintPop({ x: info.clientX, y: info.clientY, from: info.from, to: info.to, entity: info.entity }),
        onRefClick: (info) =>
          setInspector({
            kind: info.targetType === 'lore' ? 'lore' : info.targetType === 'prop' ? 'prop' : 'character',
            id: info.targetId,
          }),
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
      handleDOMEvents: {
        dblclick: (view, e) => {
          const el = (e.target as HTMLElement).closest('.scene-mark');
          if (!el) return false;
          try {
            const pos = view.posAtDOM(el as Node, 0);
            const node = view.state.doc.nodeAt(pos);
            if (node?.type.name === 'sceneMark') {
              setSceneEdit({ key: sceneKey(node), title: (node.attrs.title as string) ?? '' });
              return true;
            }
          } catch {
            /* 定位失败就算了 */
          }
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => handlersRef.current.onUpdate?.(ed),
  });
  const editorInstanceRef = useRef(editor);
  editorInstanceRef.current = editor;

  useEffect(() => { editor?.setEditable(!!activeId && !busy, false); }, [editor, activeId, busy]);

  /* ---------- 保存 ---------- */

  const refreshRefs = useCallback(async () => {
    try {
      setRefs(await ent.readRefs(root, dirName));
    } catch {
      // 索引读取失败不致命
    }
  }, [root, dirName]);

  const registerChatFlush = useCallback((flush: () => Promise<boolean>) => { chatFlushRef.current = flush; }, []);
  const finishChatSave = useCallback(async () => {
    if (auxAiBusy.current) { toast('AI 正在生成，已取消离开；请等结果完成。', 'err'); return false; }
    if (!(await taskFlushRef.current())) return false;
    for (const flush of [...draftFlushes.current.values()]) {
      if (!(await flush())) { setZen(false); setChatOpen(false); setInspector(null); assistantPanel.current?.expand(); return false; }
    }
    if (!(await modalDraftFlushRef.current())) return false;
    const ok = await chatFlushRef.current();
    chatFlushFailedRef.current = !ok;
    if (!ok) {
      if (sidesBeforeZen.current) sidesBeforeZen.current.right = true;
      setZen(false);
      setChatOpen(true);
      assistantPanel.current?.expand();
    }
    return ok;
  }, [assistantPanel]);
  const performBackup = useCallback((auto: boolean) => diskQueue.run(async () => {
    const name = await lib.createSnapshot(root, dirName, auto);
    const current = bookRef.current;
    if (current) {
      const next = { ...current, lastAutoSnapshot: lib.todayStr() };
      await lib.saveBook(root, dirName, next);
      setBook(next);
    }
    setBackupWarning('');
    return name;
  }, true), [root, dirName, diskQueue, setBook]);
  const backupFailed = useCallback((error: unknown) => {
    setBackupWarning('正文已保存，但备份未成功。稍后会限频重试，也可立即重试：' + String(error));
  }, []);
  useEffect(() => () => backupGate.cancelScheduled(), [backupGate]);

  const flushSave = useCallback(async (includeChat = true): Promise<boolean> => {
    window.clearTimeout(timerRef.current);
    if (saver.dirty || saver.saving || pendingBookEdit.current || diskQueue.hasPendingWrites) await diskQueue.idle();
    if (!saver.dirty && !saver.saving && !pendingBookEdit.current) return includeChat ? finishChatSave() : true;
    setSaveState('saving');
    let success = await saver.flush(() => diskQueue.run(async () => {
      const current = bookRef.current;
      const id = activeIdRef.current;
      const meta = current?.chapters.find((c) => c.id === id);
      if (!current || !meta || !editor) throw new Error('当前章节未就绪，稿件仍保留在编辑器中');
      const file: ChapterFile = {
        protocolVersion: MODEL_VERSION, meta: { ...meta },
        doc: editor.getJSON() as unknown as JsonValue,
      };
      setStorageWarning('');
      const next = await lib.saveChapterWithStats(root, dirName, current, file, setStorageWarning);
      setBook(next);
    }));
    if (success && pendingBookEdit.current) {
      try {
        await diskQueue.run(async () => {
          const update = pendingBookEdit.current;
          if (!update || !bookRef.current) return;
          const next = update(bookRef.current);
          next.stats = { ...next.stats, totalWords: next.chapters.reduce((n, c) => n + c.wordCount, 0) };
          await lib.saveBook(root, dirName, next);
          setBook(next);
          pendingBookEdit.current = null;
        });
      } catch (error) { saver.error = error; success = false; }
    }
    if (success) {
      setSaveError('');
      setSaveState('saved');
      void refreshRefs();
      guide('save');
      const d = new Date();
      setLastSaved(`${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`);
      if (isDesktop && bookRef.current) backupGate.schedule(lib.todayStr(), bookRef.current.lastAutoSnapshot,
        async () => { await performBackup(true); }, backupFailed);
    } else {
      const detail = String(saver.error instanceof Error ? saver.error.message : saver.error);
      setSaveError('保存失败，稿件仍留在当前章。' + detail);
      setSaveState('error');
    }
    return success && (!includeChat || await finishChatSave());
  }, [editor, root, dirName, refreshRefs, saver, setBook, diskQueue, finishChatSave, backupGate, performBackup, backupFailed]);
  flushRef.current = flushSave;

  /**
   * 把一份文档载入编辑器（不计为修改，不触发自动保存）。
   * 用全新的 EditorState 替换，顺带清空撤销历史——否则 Ctrl+Z 会把上一章的内容倒灌进当前章。
   */
  const loadChapterInto = useCallback(
    (doc: JsonValue, words: number) => {
      if (!editor) return;
      switchingRef.current = true;
      try {
        const node = editor.schema.nodeFromJSON(doc as never);
        editor.view.updateState(
          EditorState.create({ schema: editor.schema, doc: node, plugins: editor.state.plugins })
        );
      } finally {
        switchingRef.current = false;
      }
      setSaveState('saved');
      saver.reset();
      setSaveError('');
      setAtPopup(null);
      setHintPop(null);
      setScenes(scenesFromEditor(editor));
    },
    [editor, saver]
  );

  /* ---------- 场景层（P6） ---------- */

  const scenesOfEditor = useCallback((): SceneInfo[] => {
    if (!editor) return [];
    return scenesFromEditor(editor);
  }, [editor]);

  const refreshScenes = useCallback(() => setScenes(scenesOfEditor()), [scenesOfEditor]);

  const jumpToScene = (blockIndex: number) => {
    if (!editor) return;
    try {
      const blocks = editor.state.doc.content;
      if (blockIndex < 0 || blockIndex >= blocks.childCount) return;
      let offset = 0;
      for (let i = 0; i < blockIndex; i++) offset += blocks.child(i).nodeSize;
      editor.chain().focus().setTextSelection(offset + 1).scrollIntoView().run();
    } catch {
      /* 越界就算了 */
    }
  };

  const insertScene = () => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: 'sceneMark', attrs: { title: '', id: crypto.randomUUID(), summary: '' } } as never).run();
    toast('已插入场景分隔线，双击它可以命名');
  };

  const commitSceneTitle = () => {
    const s = sceneEdit;
    if (!s || !editor) return;
    if (!updateScene(editor, s.key, { title: s.title.trim() })) { toast('场景已变化，请重新选择', 'err'); return; }
    setSceneEdit(null);
    refreshScenes();
  };

  /** 给结构页读某一章的场景（活动章直接用编辑器，别的章读文件） */
  const loadScenesFor = useCallback(
    async (chapterId: string): Promise<SceneInfo[]> => {
      if (chapterId === activeId && editor) return scenesOfEditor();
      const f = await lib.readChapter(root, dirName, chapterId);
      return f ? scenesFromDocJson(f.doc as JsonValue) : [];
    },
    [activeId, editor, scenesOfEditor, root, dirName]
  );

  /* ---------- @ 引用弹层 ---------- */

  const quickFilter = useCallback(
    (q: string): QuickItem[] => {
      const ql = q.trim().toLowerCase();
      const pool: QuickItem[] = [
        ...chars.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, sub: `人物 · ${c.tier}` })),
        ...lore.map((l) => ({ kind: 'lore' as const, id: l.id, name: l.name, sub: `设定 · ${l.category}` })),
        ...propEnts.map((p) => ({ kind: 'prop' as const, id: p.id, name: p.name, sub: '道具' })),
      ];
      const hit = pool.filter((x) => ent.aliasMatch(x.name, undefined, ql) || (ql && x.name.toLowerCase().includes(ql)));
      hit.sort((a, b) => {
        const as = ql && a.name.toLowerCase().startsWith(ql) ? 0 : 1;
        const bs = ql && b.name.toLowerCase().startsWith(ql) ? 0 : 1;
        return as - bs || (a.kind === 'character' ? -1 : 1);
      });
      return hit.slice(0, 8);
    },
    [chars, lore, propEnts]
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
    const measuring = profileStart();
    saver.markDirty();
    setSaveState('dirty');
    // 场景列表跟着正文走（很便宜的一次遍历）
    const sc = scenesFromEditor(ed);
    setScenes(previous => {
      const retained = previous.filter(scene => !sc.some(current => current.key === scene.key) && draftFlushes.current.get(`scene:${activeIdRef.current}:${scene.key ?? scene.id}`)?.isDirty?.()).map(scene => ({ ...scene, missing: true }));
      const next = [...sc, ...retained];
      return previous.length === next.length && previous.every((scene, index) =>
        scene.blockIndex === next[index].blockIndex && scene.title === next[index].title && scene.summary === next[index].summary && scene.key === next[index].key && scene.missing === next[index].missing) ? previous : next;
    });
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushSave(false), 800);
    updateAtPopup(ed);
    profileEnd('update-handler-ms', measuring);
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
    const [cs, ls, ps] = await Promise.all([
      ent.listCharacters(root, dirName),
      ent.listLore(root, dirName),
      propl.listProps(root, dirName),
    ]);
    setChars(cs);
    setLore(ls);
    setPropEnts(ps);
    setTimeline(await st.loadTimeline(root, dirName));
    setForeshadows(await st.loadForeshadows(root, dirName));
  }, [root, dirName]);

  const persistTimeline = useCallback(
    async (t: TimelineData) => {
      await st.saveTimeline(root, dirName, t);
      setTimeline(t);
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
  const openTasks = async (kind: JobKind, chapterId?: string) => {
    if (!(await flushSave())) return;
    setTaskRequest(previous => ({ kind, chapterId, revision: previous.revision + 1 })); setTasksOpen(true);
  };
  const runConsistencyCheck = () => openTasks('consistency');

  /** 分章导出：每章一个 TXT，存进所选文件夹（网文平台连载用） */
  const exportChaptersToFolder = async () => { setMenu(null); setExportOptions({ format: 'txt', scope: 'all', split: true }); };

  useEffect(() => {
    let alive = true; setOpeningError('');
    let release: (() => Promise<void>) | undefined;
    void (async () => {
      release = await acquireBookLease(root, dirName);
      if (!alive) { await release(); return; }
      const b = await lib.loadBook(root, dirName);
      if (!alive) return;
      if (!b) {
        toast('打开失败：找不到这本书的数据', 'err');
        props.onExit();
        return;
      }
      setBook(b);
      await reloadEntities();
      await refreshRefs();
    })().catch((error) => { if (alive) setOpeningError('作品尚未打开，未写入：' + String(error)); });
    return () => { alive = false; if (release) void diskQueue.idle().then(release).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, dirName, openingRetry]);

  // 编辑器实例就绪后载入第一章
  useEffect(() => {
    if (!editor || !book || activeId || !book.chapters.length) return;
    const first = book.chapters[0];
    void (async () => {
      const f = await lib.readChapter(root, dirName, first.id);
      if (!f) throw new Error('章节文件缺失，请从快照恢复；不会以空白覆盖');
      loadChapterInto(f.doc, f.meta.wordCount);
      setActiveId(first.id);
    })().catch((error) => setSaveError('章节读取失败：' + String(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, book, activeId]);

  // 实体表变化 → 刷新淡提示 + 失效引用样式
  useEffect(() => {
    hintRef.current = [
      ...chars.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, aliases: c.aliases })),
      ...lore.map((l) => ({ kind: 'lore' as const, id: l.id, name: l.name, aliases: l.aliases })),
      ...propEnts.map((p) => ({ kind: 'prop' as const, id: p.id, name: p.name, aliases: p.aliases })),
    ];
    if (editor) editor.view.dispatch(editor.state.tr.setMeta('drwriteHintRefresh', true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars, lore, propEnts, editor, activeId]);

  /* ---------- 全局保存钩子 ---------- */

  // 载入排版偏好（字号/行距/字体/打字机）
  useEffect(() => {
    void lib.loadEditorPrefs().then((p) => {
      setPrefs(p);
      typewriterRef.current = p.typewriter;
    });
  }, []);

  // 关窗前把防抖挂着的最后一次修改落盘（桌面端；800ms 防抖窗口内直接关窗会丢最后一拨字）
  useEffect(() => {
    if (!isDesktop) return;
    let un: (() => void) | undefined;
    let dead = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        let closing = false;
        const off = await win.onCloseRequested(async (e) => {
          e.preventDefault();
          if (closing) return;
          closing = true;
          if (busyRef.current || fileOperationBusyRef.current) {
            closing = false;
            setSaveError('文件操作尚未完成，已取消关闭。请稍后重试。');
            return;
          }
          editorInstanceRef.current?.setEditable(false, false);
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const saved = await Promise.race([
            flushRef.current(),
            new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 10000); }),
          ]);
          clearTimeout(timeout);
          if (!saved) {
            closing = false;
            editorInstanceRef.current?.setEditable(activeIdRef.current != null, false);
            if (!chatFlushFailedRef.current) setSaveError((previous) => previous || '保存尚未完成，已取消关闭。请重试保存或另存正文。');
            return;
          }
          try {
            backupGate.cancelScheduled();
            await win.destroy();
          } catch {
            // destroy 需要 core:window:allow-destroy（已加）；万一权限再出问题，走进程退出兜底
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('quit_app');
            } catch {
              closing = false;
              editorInstanceRef.current?.setEditable(activeIdRef.current != null, false);
            }
          }
        });
        if (dead) off();
        else un = off;
      } catch {
        /* 拿不到窗口就算了 */
      }
    })();
    return () => {
      dead = true;
      un?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flushSave();
      }
      if (e.key === 'Escape') {
        if (atRef.current) return; // 先让 @ 弹层自己吃掉
        if (zenRef.current) setZen(false);
        else setHintPop(null);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSave(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushSave]);

  /* ---------- 章节操作 ---------- */

  const switchChapter = async (id: string): Promise<boolean> => {
    if (id === activeIdRef.current) return true;
    if (navigatingRef.current) return false;
    navigatingRef.current = true;
    editor?.setEditable(false, false);
    try {
      if (!(await flushSave())) return false;
      const file = await lib.readChapter(root, dirName, id);
      if (!file) throw new Error('章节文件缺失，已保留当前稿件');
      loadChapterInto(file.doc, file.meta.wordCount);
      setActiveId(id);
      return true;
    } catch (error) {
      setSaveError('无法切章：' + String(error));
      return false;
    } finally {
      navigatingRef.current = false;
      editor?.setEditable(activeIdRef.current != null, false);
    }
  };

  const jumpToChapter = async (id: string, blockIndex?: number, sceneId?: string) => {
    if (!(await switchChapter(id))) return;
    setInspector(null);
    setSearchOpen(false);
    if (sceneId && editor) {
      const scene = scenesFromEditor(editor).find(item => item.id === sceneId);
      if (!scene) { toast('原场景已不存在，已打开章节；未跳到其他场景', 'err'); return; }
      blockIndex = scene.blockIndex;
    }
    if (blockIndex != null) requestAnimationFrame(() => jumpToScene(blockIndex));
  };

  const persistBook = async (update: (current: Book) => Book): Promise<boolean> => {
    if (!(await flushSave())) return false;
    try {
      await diskQueue.run(async () => {
        const current = bookRef.current;
        if (!current) throw new Error('作品尚未加载');
        const next = update(current);
        next.stats = { ...next.stats, totalWords: next.chapters.reduce((n, c) => n + c.wordCount, 0) };
        await lib.saveBook(root, dirName, next);
        setBook(next);
      });
      return true;
    } catch (error) {
      pendingBookEdit.current = update;
      setSaveError('作品目录未保存：' + String(error));
      return false;
    }
  };

  const addChapter = async () => {
    if (!book || navigatingRef.current) return;
    navigatingRef.current = true;
    editor?.setEditable(false, false);
    try {
      if (!(await flushSave())) return;
      const current = bookRef.current!;
      const meta: ChapterMeta = {
        id: lib.genId(), index: current.chapters.length,
        title: `第${cnNum(current.chapters.length + 1)}章`, wordCount: 0,
        createdAt: lib.nowIso(), updatedAt: lib.nowIso(),
      };
      await lib.writeChapter(root, dirName, lib.newChapterFile(meta));
      if (!(await persistBook((b) => ({ ...b, chapters: [...b.chapters, meta] })))) return;
      loadChapterInto(lib.emptyDoc(), 0);
      setActiveId(meta.id);
    } catch (error) { setSaveError('新建章节失败：' + String(error)); }
    finally { navigatingRef.current = false; editor?.setEditable(activeIdRef.current != null, false); }
  };

  const renameChapter = async (id: string, title: string) => {
    if (!book) return;
    if (!(await flushSave())) return;
    await persistBook((b) => ({ ...b, chapters: b.chapters.map((c) => (c.id === id ? { ...c, title } : c)) }));
  };

  /* ---------- 正文顶栏：章节名 / 翻页 / 撤销重做 ---------- */

  const startEditChapterTitle = () => {
    const meta = book?.chapters.find((c) => c.id === activeId);
    if (!meta) return;
    setTitleEdit({ id: meta.id, draft: meta.title });
  };

  const commitChapterTitle = async () => {
    if (!titleEdit || !book) {
      setTitleEdit(null);
      return;
    }
    const t = titleEdit.draft.trim();
    const meta = book.chapters.find((c) => c.id === titleEdit.id);
    if (t && meta && t !== meta.title) await renameChapter(titleEdit.id, t);
    setTitleEdit(null);
  };

  const goChapter = (dir: -1 | 1) => {
    if (!book || !activeId) return;
    const i = book.chapters.findIndex((c) => c.id === activeId);
    const j = i + dir;
    if (i >= 0 && j >= 0 && j < book.chapters.length) void jumpToChapter(book.chapters[j].id);
  };

  const moveChapter = async (id: string, dir: -1 | 1) => {
    if (!book) return;
    if (!(await flushSave())) return;
    const i = book.chapters.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= book.chapters.length) return;
    const arr = [...book.chapters];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await persistBook((b) => ({ ...b, chapters: arr.map((c, idx) => ({ ...b.chapters.find((x) => x.id === c.id)!, volumeId: c.volumeId, index: idx })) }));
  };

  /* ---------- 分卷（P5） ---------- */

  const addVolume = async (title: string) => {
    if (!book) return;
    await persistBook((b) => ({ ...b, volumes: [...(b.volumes ?? []), { id: lib.genId(), title }] }));
  };

  const renameVolume = async (id: string, title: string) => {
    if (!book) return;
    await persistBook((b) => ({ ...b, volumes: (b.volumes ?? []).map((v) => (v.id === id ? { ...v, title } : v)) }));
  };

  const doDeleteVolume = async () => {
    const v = deleteVol;
    if (!v || !book) return;
    setDeleteVol(null);
    if (!(await persistBook((b) => ({ ...b, volumes: (b.volumes ?? []).filter((x) => x.id !== v.id), chapters: b.chapters.map((c) => (c.volumeId === v.id ? { ...c, volumeId: undefined } : c)) })))) return;
    toast(`已删除卷「${v.title}」，章节保留在未分卷`);
  };

  /** 拖到卷头：只改归属，不动顺序 */
  const dropToVolume = async (chapterId: string, volumeId: string | null) => {
    if (!book) return;
    await persistBook((b) => ({ ...b, chapters: b.chapters.map((c) => c.id === chapterId ? { ...c, volumeId: volumeId ?? undefined } : c) }));
  };

  /** 拖拽排序：挪到目标章前/后；跨卷拖拽顺带改卷归属 */
  const reorderChapter = async (dragId: string, targetId: string, pos: 'before' | 'after') => {
    if (!book || dragId === targetId) return;
    if (!(await flushSave())) return;
    const dragged = book.chapters.find((c) => c.id === dragId);
    const target = book.chapters.find((c) => c.id === targetId);
    if (!dragged || !target) return;
    const arr = book.chapters.filter((c) => c.id !== dragId);
    const ti = arr.findIndex((c) => c.id === targetId);
    const at = pos === 'before' ? ti : ti + 1;
    arr.splice(at, 0, { ...dragged, volumeId: target.volumeId });
    await persistBook((b) => ({ ...b, chapters: arr.map((c, idx) => ({ ...b.chapters.find((x) => x.id === c.id)!, volumeId: c.volumeId, index: idx })) }));
  };

  const doDeleteChapter = async () => {
    const meta = deleteTarget;
    if (!meta || !book || navigatingRef.current) return;
    navigatingRef.current = true;
    editor?.setEditable(false, false);
    try {
      if (!(await flushSave())) return;
      const rest = bookRef.current!.chapters.filter((c) => c.id !== meta.id).map((c, index) => ({ ...c, index }));
      const target = rest[Math.min(meta.index, rest.length - 1)];
      const targetFile = activeIdRef.current === meta.id && target ? await lib.readChapter(root, dirName, target.id) : null;
      if (activeIdRef.current === meta.id && target && !targetFile) throw new Error('下一章文件缺失');
      // Make a verified recovery point; update the directory before removing the old file.
      await lib.createSnapshot(root, dirName);
      if (!(await persistBook((b) => ({ ...b, chapters: rest.map((c) => ({ ...b.chapters.find((x) => x.id === c.id)!, index: c.index })) })))) return;
      setDeleteTarget(null);
      if (activeIdRef.current === meta.id) {
        loadChapterInto(targetFile?.doc ?? lib.emptyDoc(), targetFile?.meta.wordCount ?? 0);
        setActiveId(target?.id ?? null);
      }
      await lib.deleteChapterFile(root, dirName, meta.id);
      await ent.updateRefsForChapter(root, dirName, meta.id, null);
      void refreshRefs();
      toast('已删除该章，删除前已留快照');
    } catch (error) { setSaveError('删除未完成：' + String(error)); }
    finally { navigatingRef.current = false; editor?.setEditable(activeIdRef.current != null, false); }
  };

  /* ---------- 书名 ---------- */

  const commitBookTitle = async () => {
    if (book && bookTitleDraft.trim() && bookTitleDraft.trim() !== book.title) {
      if (!(await flushSave())) return;
      if (!(await persistBook((b) => ({ ...b, title: bookTitleDraft.trim() })))) return;
    }
    setRenamingBook(false);
  };

  /* ---------- 资料库操作 ---------- */

  const saveEntity = async (entity: Character | LoreEntry | Prop) => {
    try {
      if (entity.type === 'character') await ent.saveCharacter(root, dirName, entity);
      else if (entity.type === 'lore') await ent.saveLore(root, dirName, entity);
      else await propl.saveProp(root, dirName, entity);
      if (entity.type === 'character' && !chars.some(item => item.id === entity.id)) guide('card');
      setEditing(null);
      await reloadEntities();
      toast('已保存：' + entity.name);
    } catch (e) {
      toast('保存失败：' + String(e), 'err');
    }
  };

  const removeEntity = async (t: EntityTarget) => {
    try {
      if (t.kind === 'character') await ent.deleteEntity(root, dirName, 'character', t.id);
      else if (t.kind === 'lore') await ent.deleteEntity(root, dirName, 'lore', t.id);
      else await propl.deleteProp(root, dirName, t.id);
      setInspector(null);
      await reloadEntities();
      void refreshRefs();
      toast('已删除条目');
    } catch (e) {
      toast('删除失败：' + String(e), 'err');
    }
  };

  /* ---------- 导出 ---------- */

  const doExport = async (format: 'md' | 'txt', scope: 'all' | 'current') => {
    if (!book) return;
    setMenu(null);
    if (isDesktop) { setExportOptions({ format, scope }); return; }
    if (!(await flushSave())) return;
    if (scope === 'current' && !activeId) return;
    try {
      const { filename, content } = await lib.composeExport(root, dirName, bookRef.current!, {
        format,
        scope,
        chapterId: activeId ?? undefined,
      });
      const ok = await lib.saveExportFile(filename, content, root);
      if (ok) { toast('已导出：' + filename); if (format === 'md' && scope === 'current') guide('export'); }
    } catch (e) {
      toast('导出失败：' + String(e), 'err');
    }
  };

  // Intentionally bypasses the normal-save gate: this is a rescue copy of live text.
  const rescueDraft = async () => {
    if (!editor || !bookRef.current) return;
    try {
      const chapter = bookRef.current.chapters.find((c) => c.id === activeIdRef.current);
      const filename = `${lib.safeName(bookRef.current.title)}-${lib.safeName(chapter?.title ?? '当前稿件')}-救援副本.txt`;
      const text = editor.getText({ blockSeparator: '\n\n' });
      if (await lib.saveExportFile(filename, text, root)) toast('当前正文已另存为救援副本；原章仍保留，确认后再关闭。');
    } catch (error) { setSaveError('救援副本未写出：' + String(error)); }
  };

  /* ---------- 快照 ---------- */

  const openSnapshotPanel = async () => {
    setBusy(true);
    try {
      setSnapshots(await lib.listSnapshots(root, dirName));
    } catch (error) {
      toast('无法读取快照：' + String(error), 'err');
      return;
    } finally {
      setBusy(false);
    }
    setSnapPanelOpen(true);
  };

  const doSnapshot = async () => {
    if (chatSending) { toast('顾问正在生成，请等完成后再备份。', 'err'); return; }
    setBusy(true);
    try {
      if (!(await flushSave())) return;
      let name = '';
      const ok = await backupGate.attempt(lib.todayStr(), async () => { name = await performBackup(false); }, backupFailed);
      if (!ok) return;
      setSnapshots(await lib.listSnapshots(root, dirName));
      toast(name ? '已备份正文与资料（' + name + '）' : '备份已完成');
    } catch (e) {
      toast('备份失败：' + String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (name: string) => {
    if (chatSending) { toast('顾问正在生成，请等完成后再恢复。', 'err'); return; }
    setRestoreTarget(null);
    setSnapPanelOpen(false);
    setBusy(true);
    try {
      if (!(await flushSave())) return;
      backupGate.cancelScheduled();
      await diskQueue.idle();
      await lib.restoreSnapshot(root, dirName, name);
      backupGate.resetAfterRestore();
      setBackupWarning('');
      setChatOpen(false);
      setNotesOpen(false);
      setInspector(null);
      setEditing(null);
      setRestoredEpoch((epoch) => epoch + 1);
      await reloadEntities();
      const b = await lib.loadBook(root, dirName);
      if (b) {
        setBook(b);
        const first = b.chapters[0];
        if (first) {
          const f = await lib.readChapter(root, dirName, first.id);
          if (!f) throw new Error('恢复后的章节缺失');
          loadChapterInto(f.doc, f.meta.wordCount);
          setActiveId(first.id);
        } else {
          loadChapterInto(lib.emptyDoc(), 0);
          setActiveId(null);
        }
        await ent.rebuildAllRefs(root, dirName, b.chapters, async (id) => (await lib.readChapter(root, dirName, id))?.doc ?? null);
      }
      await refreshRefs();
      setStorageWarning('');
      toast('已恢复；恢复前的完整作品已另存快照');
    } catch (e) {
      setSaveError('恢复未完成：' + String(e));
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
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setSelMenu(null);
      return;
    }
    e.preventDefault();
    setSelCustom('');
    setSelMenu({ x: e.clientX, y: e.clientY, text: editor.state.doc.textBetween(from, to, '\n') });
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

    pendingAiRef.current = { kind, custom, range, chapterId: activeId, originalDoc: JSON.stringify(editor.getJSON()) };
    const cfg = aiCfg;

    const versions: ProposalVersion[] = [];
    const chapterAfter = range ? editor.state.doc.textBetween(range.to, editor.state.doc.content.size, '\n') : undefined;
    const runOnce = (feedback?: string) => {
      const requestId = ++aiRequestRef.current;
      const currentRequest = () => aiRequestRef.current === requestId && activeIdRef.current === activeId;
      const previousText = proposalStateRef.current?.aiText;
      const state: ProposalState = {
        phase: 'preparing', title: TASK_LABELS[kind] + (kind === 'custom' && custom ? '：' + clipText(custom, 12) : ''),
        modelTag: cfg.model + ' @ ' + hostOf(cfg.baseUrl), startedAt: Date.now(), original: selection,
        versions: [...versions], selectedVersion: proposalStateRef.current?.selectedVersion, aiText: previousText,
        contextSources: proposalStateRef.current?.contextSources,
      };
      setProposal(state);
      void (async () => {
        try {
          let prevTail: string | undefined, prevSynopsis: string | undefined;
          if (meta.index > 0) {
            const prev = book.chapters[meta.index - 1]; prevSynopsis = prev.synopsis;
            if (kind === 'continue') {
              const pf = await lib.readChapter(root, dirName, prev.id);
              prevTail = pf ? docToPlainText(pf.doc).slice(-500) : undefined;
            }
          }
          if (!currentRequest()) return;
          const input = { book, chapter: meta, chapterTail, chapterAfter, prevChapterTail: prevTail, prevSynopsis,
            plotSummary: kind === 'continue' ? book.plotSummary : undefined,
            outline: kind === 'continue' ? meta.outline : undefined, scenes: kind === 'continue' ? scenes : undefined,
            foreshadows: kind === 'continue' ? foreshadows : undefined, selection, relatedIds, kind, custom };
          const sources = buildContextSources(input, chars, lore, propEnts, true);
          const base = buildAiMessages(input, chars, lore, propEnts, []);
          if (feedback) {
            if (previousText) base.push({ role: 'assistant', content: previousText });
            base.push({ role: 'user', content: '在遵守原任务与事实的前提下，按以下反馈调整，输出完整的新版本：\n' + feedback });
          }
          setContextReview({ base, sources: sources.map((source, index) => ({ key: source.label, ...source,
            required: source.label === '本章前文（最新结尾）', tail: /结尾|前文/.test(source.label),
            priority: source.label === '本章章纲' ? 100 : source.label === '相关资料' ? 80 : 50 - index })), initial: contextPolicyRef.current,
            onCancel: () => {
              aiRequestRef.current++; setContextReview(null);
              if (versions.length) setProposal({ ...state, phase: 'done', aiText: previousText ?? versions.at(-1)!.text }); else setProposal(null);
            },
            onSend: (messages, policy) => {
              if (!currentRequest()) return;
              contextPolicyRef.current = policy; setContextReview(null);
              setProposal({ ...state, phase: 'streaming', startedAt: Date.now(), streamingText: '', reasoningChars: 0,
                contextSources: messages.map(message => ({ label: message.role, text: message.content })) });
              void (async () => {
                try {
                  const maxTokens = kind === 'continue' ? 1500 : Math.min(2200, Math.max(400, Math.round((selection?.length ?? 200) * 3)));
                  const result = await chatAi(cfg, messages, { maxTokens, temperature: kind === 'continue' ? 0.9 : 0.7 }, {
                    onContent: full => { if (currentRequest()) setProposal(value => value ? { ...value, streamingText: full } : value); },
                    onReasoning: count => { if (currentRequest()) setProposal(value => value ? { ...value, reasoningChars: count } : value); },
                  });
                  if (!currentRequest()) return;
                  versions.push({ text: result.text, promptTokens: result.promptTokens, completionTokens: result.completionTokens, feedback, at: Date.now(), contextSources: messages.map(message => ({ label: message.role, text: message.content })) });
                  setProposal(value => value ? { ...value, phase: 'done', aiText: result.text, versions: [...versions], selectedVersion: versions.length - 1,
                    usage: `输入 ${result.promptTokens ?? '未报告'} / 输出 ${result.completionTokens ?? '未报告'} tokens` } : value);
                } catch (error) {
                  if (currentRequest()) setProposal(value => value ? { ...value, phase: 'error', error: String(error instanceof Error ? error.message : error) } : value);
                }
              })();
            },
          });
        } catch (error) {
          if (currentRequest()) setProposal(value => value ? { ...value, phase: 'error', error: String(error) } : value);
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
    if (t.chapterId !== activeIdRef.current || JSON.stringify(editor.getJSON()) !== t.originalDoc) {
      toast('正文已变动，请重新生成提案，避免覆盖新写的内容。', 'err'); return;
    }
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
    const { meta, draft } = synModal;
    if (!(await persistBook((b) => ({ ...b, chapters: b.chapters.map((c) => c.id === meta.id ? { ...c, synopsis: draft.trim() || undefined } : c) })))) return;
    setSynModal(null);
    toast('梗概已保存');
  };

  /** 生成一章梗概（流式落字），弹窗单章与批量补全共用 */
  const generateSynopsis = async () => {
    if (synModal) await openTasks('synopsis', synModal.meta.id);
  };

  /* ---------- P5：素材箱 ---------- */

  const insertNoteToCursor = (text: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(text + '\n').run();
    setNotesOpen(false);
    toast('已插入到光标处');
  };

  const saveSelectionAsNote = async () => {
    const t = selMenu?.text?.trim();
    setSelMenu(null);
    if (!t) return;
    try {
      await addNote(root, dirName, t);
      toast('已存入素材箱（顶栏「素材」可查看）');
    } catch (e) {
      toast('存入失败：' + String(e), 'err');
    }
  };

  /* ---------- P5：章纲 ---------- */

  const saveOutline = async () => {
    if (!outlineModal || !book) return;
    const { meta, draft } = outlineModal;
    if (!(await persistBook((b) => ({ ...b, chapters: b.chapters.map((c) => c.id === meta.id ? { ...c, outline: draft.trim() || undefined } : c) })))) return;
    setOutlineModal(null);
    toast('章纲已保存，续写时 AI 会按纲推进');
  };

  const generateOutline = async () => {
    if (!outlineModal || !aiCfg || !book || auxAiBusy.current) return;
    const meta = outlineModal.meta, expected = outlineModal.draft;
    setOutlineModal({ ...outlineModal, busy: true }); auxAiBusy.current = true;
    try {
      const previous = book.chapters.find(chapter => chapter.index === meta.index - 1);
      const sources: BudgetSource[] = [
        { key: 'summary', label: '剧情总览', text: book.plotSummary ?? '', tail: true, priority: 50 },
        { key: 'previous', label: '上一章梗概', text: previous?.synopsis ?? '', priority: 80 },
        { key: 'intent', label: '本章意图', text: meta.synopsis ?? '', required: true },
        { key: 'outline', label: '当前章纲草稿', text: expected, priority: 100 },
        { key: 'fores', label: '待收伏笔', text: foreshadows.filter(item => !item.payoffAnchor).map(item => item.title).join('\n'), priority: 40 },
      ].filter(source => source.text);
      const messages = await confirmAiRequest([
        { role: 'system', content: '为中文长篇小说拟章节章纲，尊重已知事实与作者意图，不编造资料中不存在的关键设定。只列可执行要点。' },
        { role: 'user', content: `为《${book.title}》第${meta.index + 1}章《${meta.title}》拟 5～8 个要点，覆盖承接、推进、冲突和结尾钩子。每点 30～80 字，只输出章纲。` },
      ], sources);
      if (!messages) return;
      const result = await chatAi(aiCfg, messages, { maxTokens: 1600, temperature: 0.7 });
      setAuxProposal({ kind: 'outline', chapterId: meta.id, expected, text: result.text });
    } catch (error) { toast(String(error), 'err'); }
    finally { auxAiBusy.current = false; setOutlineModal(value => value ? { ...value, busy: false } : value); }
  };

  /* ---------- P5：剧情总览 ---------- */

  const generatePlotSummary = async () => {
    if (!aiCfg || !book || auxAiBusy.current) return;
    const upto = book.plotSummaryUpto ?? 0, expected = book.plotSummary ?? '';
    const targets = book.chapters.filter(chapter => chapter.index >= upto);
    if (!targets.length) { toast('没有需要并入的新章节'); return; }
    auxAiBusy.current = true;
    try {
      const messages = await confirmAiRequest([
        { role: 'system', content: '维护长篇小说剧情总览，只依据提供的梗概与原有总览，不编造事实。输出 500～800 字完整新总览，保留主线、人物状态与未收伏笔。' },
        { role: 'user', content: `作品：《${book.title}》。将新章节梗概并入原有总览，只输出更新后的总览。` },
      ], [
        { key: 'summary', label: '原有总览', text: expected, required: true },
        { key: 'synopses', label: '本次并入的章节梗概', text: targets.map(chapter => `第${chapter.index + 1}章《${chapter.title}》：${chapter.synopsis || '（无梗概，不可据此编造）'}`).join('\n'), required: true },
      ]);
      if (!messages) return;
      const result = await chatAi(aiCfg, messages, { maxTokens: 2000, temperature: 0.4 });
      setAuxProposal({ kind: 'plot', text: result.text, expected, upto: targets.at(-1)!.index + 1 });
    } catch (error) { toast(String(error), 'err'); } finally { auxAiBusy.current = false; }
  };

  const savePlotSummary = (text: string) => {
    if (!book) return;
    void persistBook((b) => ({ ...b, plotSummary: text || undefined }));
  };

  const fillMissingSynopses = async (_onProgress: (done: number, total: number) => void) => { await openTasks('synopsis'); };

  const openChapterModal = async (field: 'outline' | 'synopsis', id: string) => {
    if (!(await flushSave())) return;
    const meta = bookRef.current?.chapters.find(chapter => chapter.id === id);
    if (!meta) { toast('章节已不存在', 'err'); return; }
    const value = { meta, draft: meta[field] ?? '', busy: false };
    if (field === 'outline') setOutlineModal(value); else setSynModal(value);
  };
  const saveChapterField = async (id: string, field: 'outline' | 'synopsis', text: string) => {
    if (!(await flushSave(false))) throw Error('正文尚未保存');
    await diskQueue.run(async () => {
      const current = bookRef.current;
      if (!current?.chapters.some(chapter => chapter.id === id)) throw Error('原章节已不存在');
      const next = { ...current, chapters: current.chapters.map(chapter => chapter.id === id ? { ...chapter, [field]: text.trim() || undefined } : chapter) };
      await lib.saveBook(root, dirName, next); setBook(next);
    });
  };
  const saveSceneSummary = async (identity: string, text: string) => {
    if (!editor || !updateScene(editor, identity, { summary: text })) throw Error('场景已变化，请保留草稿后重新选择');
    if (!(await flushSave(false))) throw Error('场景摘要尚未写入磁盘');
  };
  modalDraftFlushRef.current = async () => {
    try {
      for (const [modal, field] of [[outlineModal, 'outline'], [synModal, 'synopsis']] as const) {
        if (!modal) continue;
        if (modal.busy) { toast('编辑内容正在处理，已取消离开。', 'err'); return false; }
        const current = bookRef.current?.chapters.find(chapter => chapter.id === modal.meta.id);
        if (!current) throw Error('原章节已不存在，编辑草稿仍保留');
        if ((current[field] ?? '') !== modal.draft.trim()) await saveChapterField(modal.meta.id, field, modal.draft);
      }
      return true;
    } catch (reason) { toast('章纲／梗概草稿未保存，已取消离开：' + String(reason), 'err'); return false; }
  };

  /* ---------- 顶栏渲染 ---------- */

  const today = book ? lib.todayWords(book) : 0;
  const goal = book?.dailyGoal ?? 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((today / goal) * 100)) : 0;
  const activeMeta = book?.chapters.find((c) => c.id === activeId) ?? null;
  const activePos = book && activeId ? book.chapters.findIndex((c) => c.id === activeId) : -1;

  const saveLabel =
    saveError ? '保存需处理' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : lastSaved ? '已保存 ' + lastSaved : '已保存';
  const commands: CommandItem[] = [
    { id: 'tasks', title: 'AI 任务、结果与断点续跑', run: () => openTasks('reader') },
    { id: 'observation', title: '篇幅分布观察', run: async () => { if (await flushSave()) setObservationOpen(true); } },
    { id: 'story-time', title: '故事时间轴与虚构历法', run: () => setStoryOpen(true) },
    { id: 'session', title: '本次写作目标与计时', run: () => setSessionVisible(true) },
    { id: 'health', title: '人物资料健康检查', run: () => setHealthOpen(true) },
    { id: 'guide', title: '重新显示示例引导', run: async () => { await setGuideDismissed(false); setGuideRevision(value => value + 1); } },
    { id: 'save', title: '保存当前作品', keywords: ['save', 'bc'], run: async () => { await flushSave(); } },
    { id: 'backup', title: '立即备份完整作品', keywords: ['snapshot', 'bf', 'kj'], run: doSnapshot, disabled: !book ? '作品未就绪' : undefined },
    { id: 'snapshots', title: '查看备份与快照', run: openSnapshotPanel },
    { id: 'search', title: '全书搜索', keywords: ['ss'], run: async () => { if (await flushSave()) setSearchOpen(true); } },
    { id: 'chapter', title: '新建章节', run: addChapter },
    { id: 'outline', title: '编辑当前章章纲', run: () => activeMeta ? openChapterModal('outline', activeMeta.id) : undefined, disabled: !activeMeta ? '请先选择章节' : undefined },
    { id: 'synopsis', title: '编辑当前章梗概', run: () => activeMeta ? openChapterModal('synopsis', activeMeta.id) : undefined, disabled: !activeMeta ? '请先选择章节' : undefined },
    { id: 'chat', title: '打开 AI 写作顾问', run: () => { setInspector(null); setChatOpen(true); setZen(false); assistantPanel.current?.expand(); rememberWorkspace('chat'); } },
    { id: 'settings', title: 'AI 连接设置', run: () => setAiSettingsOpen(true) },
    { id: 'graph', title: '人物关系图', run: () => setGraphOpen(true) },
    { id: 'notes', title: '素材箱', run: () => setNotesOpen(true) },
    { id: 'view', title: '布局与视图', run: () => setViewOpen(true) },
    { id: 'focus', title: zen ? '退出专注' : '进入专注', run: () => setZen(!zen) },
    { id: 'font', title: '字号与排版', run: () => setFontOpen(true) },
    { id: 'export-current', title: '导出本章 Markdown', run: () => doExport('md', 'current'), disabled: !activeMeta ? '请先选择章节' : undefined },
  ];

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

  // 排版偏好 → CSS 变量（novel-doc 读取 --doc-fs / --doc-lh）
  const paperStyle = {
    fontFamily: fontStackOf(prefs.fontFamily),
    ['--doc-fs' as string]: `${prefs.fontSize}px`,
    ['--doc-lh' as string]: `${prefs.lineHeight}`,
  } as React.CSSProperties;

  return (
    <div className={'editor-root' + (zen ? ' zen' : '')}>
      {busy && <div className="work-lock" role="status">正在校验或处理作品文件，请稍候……</div>}
      <header className="topbar">
        <button
          className="back-btn"
          onClick={() => void (async () => {
            if (!(await flushSave())) return;
            backupGate.cancelScheduled();
            setBusy(true);
            await diskQueue.idle();
            props.onExit();
          })()}
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
          <button className="ghost-btn" title="查找功能（Ctrl+K）" onClick={() => palette.setOpen(true)}>功能</button>
          <button className="ghost-btn" onClick={() => setViewOpen(true)}>视图</button>
          <button className="ghost-btn" onClick={() => void openTasks('reader')}>AI任务{unfinishedTasks ? `·${unfinishedTasks}` : ''}</button>
          <UndoRedoControls key={`${activeId}:${restoredEpoch}`} editor={editor} />
          <button className="ghost-btn icon-only" title="排版与手感（字号 / 行距 / 字体 / 打字机滚动）" onClick={() => setFontOpen(true)}>
            Aa
          </button>
          <button
            className={'ghost-btn' + (zen ? ' on' : '')}
            title="专注模式：隐藏两侧面板，只留正文（Esc 退出）"
            onClick={() => setZen(!zen)}
          >
            专注
          </button>
          <button className="ghost-btn" onClick={() => setNotesOpen(true)}>
            素材
          </button>
          <button className="ghost-btn icon-only" title={theme === 'dark' ? '切到浅色' : '切到深色'} onClick={() => void toggleTheme()}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className="ghost-btn" onClick={() => void flushSave().then(ok => { if (ok) setSearchOpen(true); })}>
            🔍 搜索
          </button>
          {!navigationVisible && !zen && <button className="ghost-btn" onClick={() => { navigationPanel.current?.expand(); rememberWorkspace(); }}>展开全书导航</button>}
          {!assistantVisible && !zen && <button className="ghost-btn" onClick={() => { assistantPanel.current?.expand(); rememberWorkspace(); }}>展开本章助手</button>}
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

      {openingError && <div className="save-error-banner" role="alert"><span>{openingError}</span>
        <button className="ghost-btn small" onClick={() => setOpeningRetry(value => value + 1)}>重试打开</button>
        <button className="ghost-btn small" onClick={props.onExit}>返回书架</button></div>}
      {saveError && (
        <div className="save-error-banner" role="alert">
          <span>{saveError}</span>
          <button className="ghost-btn small" onClick={() => void flushSave()}>重试保存</button>
          <button className="ghost-btn small" onClick={() => void rescueDraft()}>另存正文 TXT</button>
          <span>可继续编辑；保存成功前留在本章。</span>
        </div>
      )}
      {storageWarning && <div className="storage-warning" role="status">{storageWarning}<button className="link-btn" onClick={() => void openSnapshotPanel()}>查看备份</button></div>}
      {backupWarning && <div className="storage-warning" role="status">{backupWarning}<button className="link-btn" onClick={() => void doSnapshot()}>重试备份</button></div>}
      <Group className="editor-body" orientation="horizontal" id="writing-workspace" onLayoutChanged={(_layout, meta) => { if (meta.isUserInteraction) rememberWorkspace(); }}>
        <Panel id="book-navigation" className="workspace-panel" style={{ overflow: 'hidden' }} panelRef={navigationPanel}
          defaultSize={250} minSize={220} maxSize="30%" collapsible groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => setNavigationVisible(size.inPixels > 1)}>
        <Sidebar
          onCollapse={() => { navigationPanel.current?.collapse(); rememberWorkspace(); }}
          book={book}
          activeId={activeId}
          onSelect={(id) => void switchChapter(id)}
          onAdd={() => void addChapter()}
          onRename={(id, t) => void renameChapter(id, t)}
          onDelete={(m) => setDeleteTarget(m)}
          onMove={(id, d) => void moveChapter(id, d)}
          onSynopsis={(m) => void openChapterModal('synopsis', m.id)}
          onOutline={(m) => void openChapterModal('outline', m.id)}
          onWorkflow={(id, workflow) => void persistBook(current => ({ ...current, chapters: current.chapters.map(chapter => chapter.id === id ? { ...chapter, workflow: workflow === 'unmarked' ? undefined : workflow, workflowUpdatedAt: lib.nowIso() } : chapter) }))}
          onReorder={(d, t, p) => void reorderChapter(d, t, p)}
          onDropToVolume={(cid, vid) => void dropToVolume(cid, vid)}
          onAddVolume={(t) => void addVolume(t)}
          onRenameVolume={(id, t) => void renameVolume(id, t)}
          onDeleteVolume={(id) => {
            const v = book?.volumes?.find((x) => x.id === id);
            if (v) setDeleteVol(v);
          }}
          chars={chars}
          lore={lore}
          propEnts={propEnts}
          refs={refs}
          onInspect={setInspector}
          onNew={(kind) =>
            setEditing({ entity: kind === 'character' ? ent.newCharacter('') : ent.newLore('') })
          }
          onNewProp={() => setEditing({ entity: propl.newProp('') })}
          onReadAi={() => void openTasks('reader')}
          onOpenGraph={() => setGraphOpen(true)}
          structure={
            book ? (
              <StructureTab
                key={restoredEpoch}
                book={book}
                timeline={timeline}
                foreshadows={foreshadows}
                chars={chars}
                lore={lore}
                root={root}
                dirName={dirName}
                loadScenes={loadScenesFor}
                onTimelineChange={(t) => void persistTimeline(t)}
                onForeshadowsChange={(f) => void persistForeshadows(f)}
                onJumpChapter={(id, blockIndex, sceneId) => void jumpToChapter(id, blockIndex, sceneId)}
                onStoryCalendar={() => setStoryOpen(true)}
                onConsistencyCheck={() => void runConsistencyCheck()}
                onInspectEntity={setInspector}
                aiReady={!!aiCfg}
                onGenerateSummary={() => generatePlotSummary()}
                onSaveSummary={savePlotSummary}
                onFillSynopses={fillMissingSynopses}
              />
            ) : null
          }
        />
        </Panel>
        <Separator className={'workspace-separator' + (zen ? ' zen-hidden' : '')} aria-label="调整全书导航宽度" />
        <Panel id="manuscript" className="workspace-panel manuscript-panel" style={{ overflow: 'hidden' }} minSize={380}>
        <main className="editor-main">
          {book?.sampleKey && <OnboardingGuide revision={guideRevision} chapterVisible={assistantVisible && !chatOpen && !zen && !inspector} />}
          {book && sessionVisible && <WritingSession editor={editor} book={book} activeId={activeId} onHide={() => setSessionVisible(false)} />}
          <div className="doc-head">
            <div className="doc-pager">
              <button
                className="doc-pager-btn"
                title="上一章"
                disabled={activePos <= 0}
                onClick={() => goChapter(-1)}
              >
                ‹
              </button>
              <span className="doc-pager-index">
                {activePos >= 0 ? `${activePos + 1} / ${book?.chapters.length ?? 0}` : '—'}
              </span>
              <button
                className="doc-pager-btn"
                title="下一章"
                disabled={!book || activePos < 0 || activePos >= book.chapters.length - 1}
                onClick={() => goChapter(1)}
              >
                ›
              </button>
            </div>
            <div className="doc-title-slot">
              {titleEdit ? (
                <input
                  className="doc-title-input"
                  autoFocus
                  value={titleEdit.draft}
                  onChange={(e) => setTitleEdit({ ...titleEdit, draft: e.target.value })}
                  onBlur={() => void commitChapterTitle()}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setTitleEdit(null);
                  }}
                />
              ) : (
                <h2
                  className="doc-title"
                  title={(activeMeta?.title ?? '') + ' · 点击修改'}
                  onClick={startEditChapterTitle}
                >
                  {activeMeta?.title ?? '未选择章节'}
                </h2>
              )}
            </div>
            <div className="doc-meta"><span role="status" className={"doc-save-state " + (saveError ? "error" : saveState)}>{saveLabel}</span>{activeMeta && <LiveWordCount key={`${activeId}:${restoredEpoch}`} editor={editor} />}</div>
            {zen && (
              <button className="zen-exit" title="退出专注模式（Esc）" onClick={() => setZen(false)}>
                退出专注 · Esc
              </button>
            )}
          </div>
          <div className="document-scroll">
          <div className="paper" ref={paperRef} style={paperStyle} onContextMenu={onPaperContextMenu}>
            {activeId && <EmptyEditorHint key={`${activeId}:${restoredEpoch}`} editor={editor} />}
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
                    <span className={it.kind === 'character' ? 'tier-badge t-配角' : it.kind === 'prop' ? 'cat-badge c-道具' : 'cat-badge c-术语'}>
                      {it.kind === 'character' ? '人物' : it.kind === 'prop' ? '道具' : '设定'}
                    </span>
                    {it.name}
                    <span className="entity-sub">{it.sub}</span>
                  </button>
                ))}
                <div className="at-tip">↑↓ 选择 · 回车插入 · Esc 关闭</div>
              </div>
            )}
          </div>
          </div>
          <div className="editor-footer">
            <span>
              <LiveWordCount key={`${activeId}:${restoredEpoch}`} editor={editor} saved={activeMeta?.wordCount} footer />
              <span className="footer-hint">选中文字右键唤起 AI · 输入 @ 引用 · 点虚线转关联</span>
            </span>
            <span className="footer-actions">
              <button
                className="ghost-btn small"
                title="在此处插入场景分隔线（双击可命名）"
                disabled={!activeMeta}
                onClick={insertScene}
              >
                ◇ 场景
              </button>
              <button
                className="ghost-btn small"
                title="本章写作要点：动笔前定纲，AI 续写按纲推进"
                disabled={!activeMeta}
                onClick={() =>
                  activeMeta && void openChapterModal('outline', activeMeta.id)
                }
              >
                📋 章纲
              </button>
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
        </Panel>
        <Separator className={'workspace-separator' + (zen ? ' zen-hidden' : '')} aria-label="调整本章助手宽度" />
        <Panel id="chapter-workspace" className="workspace-panel" style={{ overflow: 'hidden' }} panelRef={assistantPanel}
          defaultSize={300} minSize={280} maxSize="38%" collapsible groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => setAssistantVisible(size.inPixels > 1)}>
        <aside className="chapter-workspace" aria-label="本章工作台">
          <div className="workbench-head">
            <div className="workbench-tabs" role="tablist" aria-label="本章工作台视图" onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const next = tabs[chatOpen ? 0 : 1];
              next?.focus();
              next?.click();
            }}>
              <button id="chapter-tab" role="tab" aria-selected={!chatOpen} aria-controls="chapter-view"
                onClick={() => { setChatOpen(false); setInspector(null); rememberWorkspace('chapter'); }}>本章</button>
              <button id="chat-tab" role="tab" aria-selected={chatOpen} aria-controls="chat-view"
                onClick={() => { setInspector(null); setChatOpen(true); rememberWorkspace('chat'); }}>AI 对话</button>
            </div>
            <button className="icon-btn" title="收起本章助手" aria-label="收起本章助手" onClick={() => { assistantPanel.current?.collapse(); rememberWorkspace(); }}>›</button>
          </div>
          <div className="workbench-view" id="chapter-view" role="tabpanel" aria-labelledby="chapter-tab" hidden={chatOpen}>
          {inspector && book ? (
          <>
          <button className="workbench-back" onClick={() => setInspector(null)}>‹ 返回本章概览</button>
          <Inspector
            target={inspector}
            chars={chars}
            lore={lore}
            propEnts={propEnts}
            refs={refs}
            book={book}
            activeChapterIndex={activeMeta?.index}
            onClose={() => setInspector(null)}
            onEdit={(e) => setEditing({ entity: e })}
            onDelete={(t) => void removeEntity(t)}
            onJumpChapter={(id) => void jumpToChapter(id)}
            onJumpEntity={setInspector}
          />
          </>
        ) : null}
          {book && activeMeta && <div hidden={!!inspector}><ChapterPanel
            key={activeMeta.id}
            onRegisterDraft={registerDraft}
            onSaveField={(field, text) => saveChapterField(activeMeta.id, field, text)}
            onSaveScene={saveSceneSummary}
            book={book}
            activeIndex={activeMeta.index}
            chars={chars}
            lore={lore}
            propEnts={propEnts}
            refs={refs}
            foreshadows={foreshadows}
            scenes={scenes}
            onJumpScene={jumpToScene}
            onAddScene={insertScene}
            onInspect={setInspector}
            onOpenOutline={() =>
              void openChapterModal('outline', activeMeta.id)
            }
            onOpenSynopsis={() => void openChapterModal('synopsis', activeMeta.id)}
            onJumpChapter={(id) => void jumpToChapter(id)}
          /></div>}
          </div>
          <div className="workbench-view" id="chat-view" role="tabpanel" aria-labelledby="chat-tab" hidden={!chatOpen}>
        {chatMounted && book && (
          <ChatPanel
            key={restoredEpoch}
            onRegisterFlush={registerChatFlush}
            onBusyChange={setChatSending}
            root={root}
            dirName={dirName}
            book={book}
            chars={chars}
            lore={lore}
            propEnts={propEnts}
            foreshadows={foreshadows}
            refs={refs}
            aiCfg={aiCfg}
            activeChapterId={activeId}
            getChapterTail={() => {
              const doc = editorInstanceRef.current?.state.doc;
              return doc ? doc.textBetween(Math.max(0, doc.content.size - 2000), doc.content.size, '\n') : '';
            }}
            onNeedSettings={() => {
              setChatOpen(false);
              setAiSettingsOpen(true);
            }}
          />
        )}
          </div>
        </aside>
        </Panel>
      </Group>

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

      {palette.open && !busy && <CommandPalette commands={commands} onClose={() => palette.setOpen(false)} />}
      {observationOpen && book && <ObservationModal root={root} dirName={dirName} book={book} onClose={() => setObservationOpen(false)} onJump={id => void jumpToChapter(id)} />}
      {storyOpen && <StoryCalendarModal events={timeline.events} onClose={() => setStoryOpen(false)} onJump={(id, index, sceneId) => void jumpToChapter(id, index, sceneId)} onSave={async event => {
        if (!timeline.events.some(current => current.id === event.id)) throw Error('事件已不存在');
        await persistTimeline({ ...timeline, events: timeline.events.map(current => current.id === event.id ? event : current) });
      }} />}
      {healthOpen && book && <CharacterHealthModal root={root} dirName={dirName} chars={chars} refs={refs} onClose={() => setHealthOpen(false)} onInspect={id => { setHealthOpen(false); setInspector({ kind: 'character', id }); }} />}
      {viewOpen && <Modal title="布局与视图" onClose={() => setViewOpen(false)}>
        <p className="hint-text">首次默认两侧展开；每本书会记住你调整的宽度和右栏标签。</p>
        <div className="view-options">
          <button className="ghost-btn" onClick={() => { setSessionVisible(true); setViewOpen(false); }}>本次写作目标与计时</button>
          <button className="ghost-btn" onClick={() => applyWorkspace(false)}>恢复默认双栏</button>
          <button className="ghost-btn" onClick={() => applyWorkspace(true)}>AI 对照（右栏加宽）</button>
          <button className="ghost-btn" onClick={() => { setViewOpen(false); setZen(!zen); }}>切换专注 · Esc 退出</button>
        </div>
      </Modal>}
      {deleteTarget && (
        <Modal title="删除章节" onClose={() => setDeleteTarget(null)}>
          <p className="confirm-text">
            确定删除「{deleteTarget.title}」？
            {deleteTarget.wordCount > 0 && (
              <>
                <br />
                本章有 <b>{lib.fmtNum(deleteTarget.wordCount)}</b> 字。删除前会自动建立完整作品快照，备份失败就停止删除。
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
            用快照「{formatSnapName(restoreTarget.name)}」恢复{restoreTarget.legacy ? '正文与目录' : '正文与全部作品资料'}？
            <br />
            当前完整作品会先另存并校验。
            {restoreTarget.legacy && <strong className="legacy-warning">旧版快照不含资料：人物、设定、伏笔、聊天等将保留当前版本，不随正文回退。</strong>}
          </p>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setRestoreTarget(null)}>
              取消
            </button>
            <button className="primary-btn" onClick={() => void doRestore(restoreTarget.name)}>
              恢复
            </button>
          </div>
        </Modal>
      )}

      {snapPanelOpen && (
        <Modal title="备份与快照" width={520} onClose={() => setSnapPanelOpen(false)}>
          <p className="hint-text">
            新快照包含全书目录、全部章节和作品资料（含人物、伏笔、素材、聊天），恢复前会校验并留底。不含全局设置与密钥。
          </p>
          <div className="snap-list">
            {snapshots.length === 0 && <div className="snap-empty">还没有快照</div>}
            {snapshots.map((snapshot) => (
              <div key={snapshot.name} className="snap-item">
                <span className="snap-name">{formatSnapName(snapshot.name)}<small>{!snapshot.valid ? "校验失败：" + snapshot.error : snapshot.legacy ? "旧版 · 仅正文与目录" : "完整作品"}</small></span>
                <button className="ghost-btn small" disabled={!snapshot.valid} onClick={() => setPreviewSnapshot(snapshot.name)}>预览</button>
                <button
                  className="ghost-btn small"
                  disabled={!snapshot.valid || busy}
                  onClick={() => {
                    setSnapPanelOpen(false);
                    setRestoreTarget(snapshot);
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

      {previewSnapshot && book && <SnapshotPreview root={root} dirName={dirName} name={previewSnapshot} current={book} onClose={() => setPreviewSnapshot(null)} />}
      {exportOptions && book && <ExportModal root={root} dirName={dirName} book={book} activeId={activeId} initial={exportOptions} onBusyChange={value => { fileOperationBusyRef.current = value; }} onClose={() => setExportOptions(null)}
        onPrepare={async () => { if (!(await flushSave())) throw Error('尚有内容未保存，已停止导出，请先处理保存提示'); if (!bookRef.current) throw Error('作品未就绪'); return bookRef.current; }}
        onDone={(ids, options) => { if (options.format === 'md' && ids.length === 1 && ids[0] === activeId) guide('export'); }} />}
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
      {editing && editing.entity.type === 'prop' && book && (
        <PropFormModal
          initial={editing.entity as Prop}
          chars={chars}
          chapters={book.chapters}
          activeChapterIndex={activeMeta?.index}
          onSave={(p) => void saveEntity(p)}
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
          refs={refs}
          onClose={() => setGraphOpen(false)}
          onSelect={(id) => {
            setGraphOpen(false);
            setInspector({ kind: 'character', id });
          }}
          onEditChar={(id) => {
            setGraphOpen(false);
            const c = chars.find((x) => x.id === id);
            if (c) setEditing({ entity: c });
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
            {selMenu.text.trim() && (
              <button className="sel-act" onClick={() => void saveSelectionAsNote()}>
                🗂 存为素材
              </button>
            )}
            {selMenu.text.trim() && <div className="menu-sep" />}
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
          onRefine={feedback => rerunAiRef.current?.(feedback)}
          onSelectVersion={index => setProposal(value => {
            const version = value?.versions?.[index]; return value && version ? { ...value, phase: 'done', aiText: version.text, selectedVersion: index, contextSources: version.contextSources,
              usage: `输入 ${version.promptTokens ?? '未报告'} / 输出 ${version.completionTokens ?? '未报告'} tokens` } : value;
          })}
          onClose={closeProposal}
        />
      )}

      {auxProposal && <Modal title={auxProposal.kind === 'outline' ? '章纲建议 · 确认后放入草稿' : '剧情总览建议 · 确认后保存'} width={760} layer={240} onClose={() => setAuxProposal(null)}>
        <pre className="preview-body">{auxProposal.text}</pre><p className="hint-text">建议尚未改动原有内容；请核对后决定是否采纳。</p>
        <div className="modal-actions"><button className="ghost-btn" onClick={() => setAuxProposal(null)}>放弃建议</button>
        <button className="primary-btn" onClick={async () => {
          if (auxProposal.kind === 'outline') {
            if (!outlineModal || outlineModal.meta.id !== auxProposal.chapterId || outlineModal.draft !== auxProposal.expected) { toast('原章纲草稿已变化，请复制建议后手工比较，未覆盖', 'err'); return; }
            setOutlineModal({ ...outlineModal, draft: auxProposal.text }); setAuxProposal(null);
          } else {
            if ((bookRef.current?.plotSummary ?? '') !== auxProposal.expected) { toast('总览已变化，建议仍保留，未覆盖', 'err'); return; }
            if (await persistBook(current => ({ ...current, plotSummary: auxProposal.text, plotSummaryUpto: auxProposal.upto, plotSummaryAt: lib.nowIso() }))) setAuxProposal(null);
          }
        }}>确认采纳</button></div>
      </Modal>}
      {contextReview && <ContextReviewModal request={contextReview} />}

      {/* P5：排版 / 素材箱 / 章纲 / 删卷 */}
      {fontOpen && (
        <FontModal
          prefs={prefs}
          onApply={(p) => {
            setPrefs(p);
            typewriterRef.current = p.typewriter;
            void lib.saveEditorPrefs(p);
          }}
          onClose={() => setFontOpen(false)}
        />
      )}

      {notesOpen && (
        <NotesModal
          root={root}
          dirName={dirName}
          onInsert={insertNoteToCursor}
          onClose={() => setNotesOpen(false)}
        />
      )}

          {outlineModal && (
        <OutlineModal
          meta={outlineModal.meta}
          draft={outlineModal.draft}
          busy={outlineModal.busy}
          aiReady={!!aiCfg}
          onChange={(v) => setOutlineModal((m) => (m ? { ...m, draft: v } : m))}
          onGenerate={() => void generateOutline()}
          onSave={() => void saveOutline()}
          onClose={() => setOutlineModal(null)}
        />
      )}

      {deleteVol && (
        <Modal title="删除卷" onClose={() => setDeleteVol(null)}>
          <p className="confirm-text">
            确定删除卷「{deleteVol.title}」？
            <br />
            卷里的章节全部保留，只是回到「未分卷」。
          </p>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setDeleteVol(null)}>
              取消
            </button>
            <button className="danger-btn" onClick={() => void doDeleteVolume()}>
              删除
            </button>
          </div>
        </Modal>
      )}

      {/* 场景命名（双击场景分隔线） */}
      {sceneEdit && (
        <Modal title="场景命名" onClose={() => setSceneEdit(null)}>
          <p className="hint-text">给这个场景起个名字（如「破庙夜话」）。时间线、伏笔、本章面板都会显示它。</p>
          <input
            className="rename-input wide"
            autoFocus
            value={sceneEdit.title}
            placeholder="场景名（可留空）"
            onChange={(e) => setSceneEdit({ ...sceneEdit, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSceneTitle();
              if (e.key === 'Escape') setSceneEdit(null);
            }}
          />
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setSceneEdit(null)}>
              取消
            </button>
            <button className="primary-btn" onClick={commitSceneTitle}>
              保存
            </button>
          </div>
        </Modal>
      )}

      {book && <AiTaskCenter key={restoredEpoch} root={root} dirName={dirName} book={book} config={aiCfg}
        chars={chars} lore={lore} propEnts={propEnts} activeId={activeId} open={tasksOpen} request={taskRequest}
        onOpen={showTasks} onClose={() => setTasksOpen(false)} onSettings={() => setAiSettingsOpen(true)}
        onRegisterFlush={registerTaskFlush} onCreated={reloadEntities} onUnfinishedCount={setUnfinishedTasks}
        onSynopsis={async (id, expected, value) => {
          const current = bookRef.current?.chapters.find(chapter => chapter.id === id);
          if (!current) throw Error('章节已不存在');
          if (current.synopsis === value) return;
          if ((current.synopsis ?? '') !== expected) throw Error('本章梗概已被修改，未覆盖；请手工比较任务结果');
          await saveChapterField(id, 'synopsis', value);
          setSynModal(previous => previous?.meta.id === id ? { ...previous, draft: value } : previous);
        }} />}

      {/* 章节梗概 */}
      {synModal && (        <Modal title={`第${synModal.meta.index + 1}章 · 梗概`} onClose={() => setSynModal(null)}>
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

    </div>
  );
}

/** auto-20261024-153001 → （每日自动）2026-10-24 15:30:01 */
function formatSnapName(name: string): string {
  if (name.startsWith('before-restore-')) {
    const date = new Date(Number(name.split('-')[2]));
    return '恢复前留底 · ' + (Number.isNaN(date.getTime()) ? name : date.toLocaleString('zh-CN', { hour12: false }));
  }
  const auto = name.startsWith('auto-') ? '（每日自动）' : '';
  const m = name.replace(/^auto-/, '').match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/);
  if (!m) return name;
  return auto + `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function clipText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
