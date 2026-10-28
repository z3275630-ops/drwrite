import { UiSelect } from './Controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, Character, Foreshadow, LoreEntry, Prop, RefIndexEntry } from '../types';
import { chatAi } from '../lib/ai';
import type { AiConfig, AiMessage } from '../lib/ai';
import { entityCardLines } from '../lib/assembler';
import * as st from '../lib/structure';
import { listSessions, newChatSession, readSession, saveSession, uniqueSessionTitle, type ChatSession } from '../lib/chatSessions';
import { Modal } from './Modal';
import { ContextReviewModal, type ContextReview } from './ContextReviewModal';
import { DEFAULT_CONTEXT_POLICY, type BudgetSource } from '../lib/contextBudget';
import type { ChatMsg } from '../lib/chat';
import { toast } from './Toast';
import { SaveCoordinator } from '../lib/saveCoordinator';
import { safeName, saveExportFile } from '../lib/library';

type CtxKey = 'body' | 'cards' | 'fores' | 'summary';

const CTX_PILLS: { key: CtxKey; label: string; title: string }[] = [
  { key: 'body', label: '本章正文', title: '带上当前章结尾，让回答贴着正文' },
  { key: 'cards', label: '资料卡', title: '带上本章涉及的人物、设定、道具卡' },
  { key: 'fores', label: '伏笔', title: '带上伏笔清单与收束状态' },
  { key: 'summary', label: '剧情总览', title: '带上全书滚动摘要，谈长线情节时打开' },
];

const STARTERS = [
  {
    title: '情节卡住了',
    desc: '给我三个可行走向，各说利弊',
    prompt: '我卡在情节推进上了。请结合当前章和剧情总览，给我三个可行走向，每个用两三句话说清怎么走、利弊是什么。',
  },
  {
    title: '人物弧光',
    desc: '这一卷主角该怎么变',
    prompt: '结合人物卡和当前进度，说说主角这一卷的人物弧光应该怎么走，哪里最容易写崩，可以怎么避免。',
  },
  {
    title: '埋与收',
    desc: '待收伏笔先动哪一条',
    prompt: '帮我看一遍待收伏笔：哪些适合在本卷收、哪些还要再压，分别怎么落地？请按优先级排一下。',
  },
  {
    title: '本章节奏',
    desc: '哪里拖沓、哪里跳得太快',
    prompt: '读一下本章正文结尾，指出节奏上拖沓、跳跃或信息过密的地方，给出具体的删改建议。',
  },
];

/**
 * AI 写作顾问（学织境 Quill 的安排：品牌头 + 上下文胶囊 + 快捷起手卡 + 底部输入坞）。
 * 上下文每次发送时按开关重建；对话存在书文件夹里；永远不改正文。
 */
export default function ChatPanel(props: {
  root: string;
  dirName: string;
  book: Book;
  chars: Character[];
  lore: LoreEntry[];
  propEnts: Prop[];
  foreshadows: Foreshadow[];
  refs: RefIndexEntry[];
  aiCfg: AiConfig | null;
  activeChapterId: string | null;
  getChapterTail: () => string;
  onNeedSettings: () => void;
  onBusyChange: (busy: boolean) => void;
  onRegisterFlush: (flush: () => Promise<boolean>) => void;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const sessionRef = useRef<ChatSession | null>(null);
  const draftRef = useRef('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [review, setReview] = useState<ContextReview | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [leaveNotice, setLeaveNotice] = useState('');
  const messageRef = useRef<ChatMsg[]>([]);
  const streamRef = useRef('');
  const sendingRef = useRef(false);
  const saver = useRef(new SaveCoordinator()).current;
  const [ctx, setCtx] = useState<Record<CtxKey, boolean>>({
    body: true,
    cards: true,
    fores: true,
    summary: true,
  });
  const contextRef = useRef(ctx); contextRef.current = ctx;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadedRef = useRef(false);
  const updateMessages = useCallback((next: ChatMsg[]) => {
    messageRef.current = next;
    saver.markDirty();
    setMsgs(next);
  }, [saver]);
  const persist = useCallback(async () => {
    if (!loadedRef.current) return true;
    const ok = await saver.flush(async () => {
      if (!sessionRef.current) throw Error('会话尚未就绪');
      const snapshot = { ...sessionRef.current, messages: [...messageRef.current], draft: draftRef.current, context: { ...contextRef.current } };
      await saveSession(props.root, props.dirName, snapshot);
      sessionRef.current = { ...sessionRef.current, messages: snapshot.messages, draft: snapshot.draft, context: snapshot.context };
      setSessions(previous => previous.map(session => session.id === snapshot.id ? snapshot : session));
    });
    setSaveError(ok ? '' : '对话未保存，内容仍在本书界面。' + String(saver.error));
    return ok;
  }, [props.root, props.dirName, saver]);
  const flushBeforeLeave = useCallback(async () => {
    if (sessionBusy) { setLeaveNotice('会话正在保存或切换，请稍候再离开。'); return false; }
    if (sendingRef.current) { setLeaveNotice('顾问仍在生成，已取消离开；请等回复完成。正文可以继续写。'); return false; }
    return persist();
  }, [persist, sessionBusy]);
  useEffect(() => {
    props.onRegisterFlush(flushBeforeLeave);
    return () => props.onRegisterFlush(async () => true);
  }, [props.onRegisterFlush, flushBeforeLeave]);
  useEffect(() => {
    props.onBusyChange(sending);
    return () => props.onBusyChange(false);
  }, [sending, props.onBusyChange]);

  const installSession = (session: ChatSession) => {
    sessionRef.current = session; messageRef.current = session.messages; draftRef.current = session.draft;
    contextRef.current = session.context; setCtx(session.context); setMsgs(session.messages); setInput(session.draft);
    saver.reset(); setSaveError(''); setRequestError(''); setLeaveNotice('');
    loadedRef.current = true; setLoaded(true);
  };
  useEffect(() => {
    let alive = true;
    void listSessions(props.root, props.dirName).then(result => {
      if (!alive) return; setSessions(result.sessions); setLoadError(result.warnings.join('\n'));
      if (result.sessions[0]) installSession(result.sessions[0]);
    }).catch(error => { if (alive) setLoadError(String(error)); });
    return () => { alive = false; };
  }, [props.root, props.dirName]);
  const changeSession = async (id?: string) => {
    if (sendingRef.current || sessionBusy) return;
    setSessionBusy(true);
    try {
      if (!(await persist())) return;
      const session = id ? await readSession(props.root, props.dirName, id) : newChatSession(uniqueSessionTitle(sessions));
      if (!id) { await saveSession(props.root, props.dirName, session); setSessions(previous => [session, ...previous]); }
      installSession(session);
    } catch (error) { setSaveError('未切换会话，当前内容仍保留：' + String(error)); }
    finally { setSessionBusy(false); }
  };
  const renameSession = async () => {
    if (!rename?.trim() || !sessionRef.current) return;
    sessionRef.current = { ...sessionRef.current, title: rename.trim() }; saver.markDirty();
    if (await persist()) setRename(null);
  };
  const archiveSession = async () => {
    if (!sessionRef.current || sendingRef.current || sessionBusy) return;
    setSessionBusy(true);
    try {
      if (!(await persist())) return;
      const old = sessionRef.current;
      const remaining = sessions.filter(session => session.id !== old.id);
      const next = remaining[0] ? await readSession(props.root, props.dirName, remaining[0].id) : newChatSession();
      if (!remaining.length) await saveSession(props.root, props.dirName, next);
      await saveSession(props.root, props.dirName, { ...old, archived: true });
      setSessions(remaining.length ? remaining : [next]); installSession(next); setArchiveOpen(false);
    } catch (error) { setSaveError('会话未移除：' + String(error)); }
    finally { setSessionBusy(false); }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, sending, streamText]);
  useEffect(() => {
    if (!loaded || sending || sessionBusy) return;
    const timer = window.setTimeout(() => void persist(), 1000);
    return () => window.clearTimeout(timer);
  }, [input, ctx, loaded, sending, sessionBusy, persist]);

  const buildContext = (): { base: AiMessage; sources: BudgetSource[] } => {
    const chapterTail = props.getChapterTail();
    const meta = props.book.chapters.find((c) => c.id === props.activeChapterId);
    const relatedIds = [
      ...new Set(props.refs.filter((r) => r.chapterId === props.activeChapterId).map((r) => r.targetId)),
    ];
    const cards = entityCardLines(props.chars, props.lore, relatedIds, props.propEnts, meta?.index).slice(0, 10);
    const allCards = cards.length
      ? cards
      : entityCardLines(
          props.chars,
          props.lore,
          props.chars.slice(0, 6).map((c) => c.id),
          props.propEnts,
          meta?.index
        );
    const fores = props.foreshadows
      .slice(0, 12)
      .map((f) => `· ${f.title}（${st.foreshadowStateOf(f, props.book.chapters)}）`);
    const sources: BudgetSource[] = [
      { key: 'summary', label: '剧情总览', text: ctx.summary ? props.book.plotSummary ?? '' : '', priority: 30, tail: true },
      { key: 'cards', label: '相关资料', text: ctx.cards ? allCards.join('\n') : '', priority: 70 },
      { key: 'fores', label: '伏笔清单', text: ctx.fores ? fores.join('\n') : '', priority: 40 },
      { key: 'body', label: '当前章正文结尾', text: ctx.body ? chapterTail.slice(-2000) : '', priority: 100, tail: true },
    ];
    return { sources: sources.filter(source => source.text), base: {
      role: 'system',
      content:
        '你是一位中文长篇小说的写作顾问，正在陪作者讨论《' +
        props.book.title +
        '》。规则：\n' +
        '1. 回答简洁、具体、可执行；能引用设定资料时引用，发现设定矛盾要指出。\n' +
        '2. 可以讨论情节走向、人物弧光、伏笔回收、文风节奏；需要时给 2-3 个方案并说明取舍。\n' +
        '3. 你不能直接修改正文；如果作者要求代写，给出文字建议让他自己采纳。\n' +
        '4. 不确定的事实先问清楚再回答，不要编造设定。\n\n' +
        (meta ? `当前在第${meta.index + 1}章「${meta.title}」` : ''),
    } };
  };

  const requestSend = async (text: string, messages: AiMessage[]) => {
    if (!text || sendingRef.current || !loadedRef.current) return;
    if (!props.aiCfg) {
      props.onNeedSettings();
      return;
    }
    const userMsg: ChatMsg = { role: 'user', content: text, at: new Date().toISOString() };
    const next = [...messageRef.current, userMsg];
    updateMessages(next);
    void persist();
    draftRef.current = ''; setInput(''); saver.markDirty();
    sendingRef.current = true;
    setSending(true);
    setRequestError('');
    setLeaveNotice('');
    streamRef.current = '';
    setStreamText('');
    try {
      const r = await chatAi(
        props.aiCfg,
        messages,
        { maxTokens: 1400, temperature: 0.7 },
        { onContent: (full) => { streamRef.current = full; setStreamText(full); } }
      );
      const done = [...next, { role: 'assistant' as const, content: r.text, at: new Date().toISOString() }];
      updateMessages(done);
    } catch (e) {
      if (streamRef.current) updateMessages([...next, { role: 'assistant', content: streamRef.current,
        at: new Date().toISOString(), incomplete: true }]);
      setRequestError('请求未完成：' + String(e instanceof Error ? e.message : e));
    } finally {
      sendingRef.current = false;
      setSending(false);
      setLeaveNotice('');
      streamRef.current = '';
      setStreamText('');
      await persist();
    }
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sendingRef.current || !loadedRef.current || sessionBusy) return;
    if (!props.aiCfg) { props.onNeedSettings(); return; }
    const context = buildContext();
    const history: AiMessage[] = [...messageRef.current, { role: 'user' as const, content: text }].slice(-12).map(message => ({ role: message.role, content: message.content }));
    const sessionId = sessionRef.current?.id;
    setReview({ base: [context.base, ...history], sources: context.sources, initial: sessionRef.current?.budget ?? DEFAULT_CONTEXT_POLICY,
      onCancel: () => setReview(null), onSend: (messages, policy) => {
        if (sessionRef.current?.id !== sessionId) { setReview(null); return; }
        sessionRef.current = { ...sessionRef.current!, budget: policy }; saver.markDirty();
        setReview(null); void requestSend(text, messages);
      },
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch {
      toast('复制失败，请手动选中文字', 'err');
    }
  };

  const cardCount = props.chars.length + props.lore.length + props.propEnts.length;

  return (
    <aside className="inspector chat-panel">
      <header className="chat-header">
        <div className="chat-brand">
          <span className="chat-brand-mark">✦</span>
          <span className="chat-brand-name">写作顾问</span>
          <span className={'chat-status' + (props.aiCfg ? ' on' : '')}>{props.aiCfg ? '已配置' : '未配置'}</span>
        </div>
        <div className="chat-header-actions">
          <button className="icon-btn" title="清空对话" disabled={sending || !loaded} onClick={() => setConfirmClear(true)}>
            🗑
          </button>
        </div>
      </header>

      {(loadError || saveError || leaveNotice || requestError) && <div className="chat-persistence-error" role="alert">
        {loadError || saveError || leaveNotice || requestError}
        {saveError && <>
          <button className="link-btn" onClick={() => void persist()}>重试保存</button>
          <button className="link-btn" onClick={() => void saveExportFile(safeName(props.book.title) + '-对话救援.txt',
            messageRef.current.map(m => `${m.role === 'user' ? '我' : 'AI'}${m.incomplete ? '（未完成）' : ''}：\n${m.content}`).join('\n\n')
              + (streamRef.current ? '\n\n正在生成的片段：\n' + streamRef.current : ''), props.root).catch(error => toast(String(error), 'err'))}>另存对话 TXT</button>
        </>}
        {requestError && !saveError && <button className="link-btn" disabled={sending} onClick={() => {
          const last = [...messageRef.current].reverse().find(m => m.role === 'user');
          if (last) void send(last.content);
        }}>重新请求</button>}
      </div>}

      <div className="chat-session-tools">
        <UiSelect aria-label="本地对话会话" disabled={sending || sessionBusy || !loaded} value={sessionRef.current?.id ?? ''} onChange={event => void changeSession(event.target.value)}>
          {sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
        </UiSelect>
        <button className="link-btn" disabled={sending || sessionBusy} onClick={() => void changeSession()}>新建</button>
        <button className="link-btn" disabled={sending || sessionBusy || !loaded} onClick={() => setRename(sessionRef.current?.title ?? '')}>改名</button>
        <button className="link-btn" disabled={sending || sessionBusy || !loaded} onClick={() => setArchiveOpen(true)}>移除</button>
      </div>
      {rename !== null && <Modal title="会话改名" onClose={() => setRename(null)}><input aria-label="会话名称" value={rename} onChange={event => setRename(event.target.value)} /><button className="primary-btn" onClick={() => void renameSession()}>保存名称</button></Modal>}
      {archiveOpen && <Modal title="移除当前会话" onClose={() => setArchiveOpen(false)} busy={sessionBusy}><p>从会话列表移除“{sessionRef.current?.title}”？磁盘上的原记录保留为归档，其他会话不受影响。</p><button className="danger-btn" onClick={() => void archiveSession()}>移除当前会话</button></Modal>}
      <p className="chat-history-note">本地保留完整记录；本次模型只带最近 12 条消息，发送前可查看。</p>
      <div className="chat-context-bar" role="group" aria-label="本次对话带上的上下文">
        <span className="chat-context-label">带上</span>
        {CTX_PILLS.map((p) => (
          <button
            key={p.key}
            className={'chat-ctx-pill' + (ctx[p.key] ? ' on' : '')}
            title={p.title}
            aria-pressed={ctx[p.key]}
            onClick={() => { const next = { ...ctx, [p.key]: !ctx[p.key] }; contextRef.current = next; setCtx(next); saver.markDirty(); }}
          >
            {p.label}
          </button>
        ))}
        <span className="chat-context-label" title="人物 + 设定 + 道具卡总数">
          {cardCount} 卡
        </span>
      </div>

      <div className="chat-list" ref={listRef}>
        {!msgs.length && !sending && (
          <div className="chat-empty">
            <div className="chat-empty-hero">
              <h3>故事先聊清楚，写起来就顺了</h3>
              <p>它看得到这本书的设定、伏笔和本章正文；只给建议，不动你的稿子。</p>
            </div>
            <div className="chat-starters">
              {STARTERS.map((s, i) => (
                <button
                  key={s.title}
                  className="chat-starter"
                  disabled={sending}
                  onClick={() => void send(s.prompt)}
                >
                  <span className="chat-starter-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="chat-starter-body">
                    <span className="chat-starter-title">{s.title}</span>
                    <span className="chat-starter-desc">{s.desc}</span>
                  </span>
                  <span className="chat-starter-arrow">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={'chat-msg ' + m.role}>
            {m.role === 'assistant' && <span className="chat-avatar">✦</span>}
            <div className="chat-bubble-wrap">
              <div className="chat-bubble">{m.incomplete && <small className="chat-incomplete">回复中断，以下为已保留的片段</small>}{m.content}</div>
              {m.role === 'assistant' && (
                <button className="chat-copy" onClick={() => void copy(m.content)}>
                  复制
                </button>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="chat-msg assistant">
            <span className="chat-avatar">✦</span>
            <div className="chat-bubble-wrap">
              <div className="chat-bubble typing">
                {streamText ? (
                  <>
                    {streamText}
                    <span className="chat-caret" />
                  </>
                ) : (
                  <span className="typing-dots">正在想…</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {!props.aiCfg && (
        <button className="chat-setup" onClick={props.onNeedSettings}>
          还没配置 AI · 点这里填接口地址、模型名和密钥
        </button>
      )}

      <div className="chat-composer">
        <div className="chat-composer-inner">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            disabled={!loaded}
            placeholder="问情节、人物、伏笔……"
            onChange={(e) => { draftRef.current = e.target.value; setInput(e.target.value); saver.markDirty(); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="chat-send"
            title="发送（Enter）"
            aria-label="发送"
            disabled={!input.trim() || sending || !loaded}
            onClick={() => void send()}
          >
            ↑
          </button>
        </div>
        <div className="chat-composer-hint">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span>不会改动正文</span>
        </div>
      </div>

      {review && <ContextReviewModal request={review} />}
      {confirmClear && <Modal title="清空当前会话" onClose={() => setConfirmClear(false)}>
        <p>清空“{sessionRef.current?.title}”中的消息？其他会话、正文与资料不受影响。</p>
        <button className="ghost-btn" onClick={() => setConfirmClear(false)}>取消</button>
        <button className="danger-btn" onClick={async () => { updateMessages([]); if (await persist()) setConfirmClear(false); }}>清空本会话</button>
      </Modal>}

    </aside>
  );
}
