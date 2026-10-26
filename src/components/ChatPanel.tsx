import { useEffect, useRef, useState } from 'react';
import type { Book, Character, Foreshadow, LoreEntry, Prop, RefIndexEntry } from '../types';
import { chatAi } from '../lib/ai';
import type { AiConfig, AiMessage } from '../lib/ai';
import { entityCardLines } from '../lib/assembler';
import * as st from '../lib/structure';
import { loadChat, saveChat } from '../lib/chat';
import type { ChatMsg } from '../lib/chat';
import { toast } from './Toast';

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
  chapterTail: string;
  onNeedSettings: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [ctx, setCtx] = useState<Record<CtxKey, boolean>>({
    body: true,
    cards: true,
    fores: true,
    summary: true,
  });
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadedRef = useRef(false);
  useEffect(() => {
    props.onBusyChange(sending);
    return () => props.onBusyChange(false);
  }, [sending, props.onBusyChange]);

  useEffect(() => {
    void loadChat(props.root, props.dirName).then((m) => {
      setMsgs(m);
      loadedRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.root, props.dirName]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, sending, streamText]);

  const buildContext = (): AiMessage => {
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
    const blocks = [
      `作品：《${props.book.title}》`,
      ctx.summary && props.book.plotSummary ? '剧情总览：\n' + props.book.plotSummary : '',
      ctx.cards && allCards.length ? '设定资料：\n' + allCards.join('\n') : '',
      ctx.fores && fores.length ? '伏笔清单：\n' + fores.join('\n') : '',
      meta
        ? `当前在第${meta.index + 1}章「${meta.title}」${meta.synopsis ? '，梗概：' + meta.synopsis : ''}`
        : '',
      ctx.body && props.chapterTail ? '当前章正文结尾：\n…' + props.chapterTail.slice(-800) : '',
    ].filter(Boolean);
    return {
      role: 'system',
      content:
        '你是一位中文长篇小说的写作顾问，正在陪作者讨论《' +
        props.book.title +
        '》。规则：\n' +
        '1. 回答简洁、具体、可执行；能引用设定资料时引用，发现设定矛盾要指出。\n' +
        '2. 可以讨论情节走向、人物弧光、伏笔回收、文风节奏；需要时给 2-3 个方案并说明取舍。\n' +
        '3. 你不能直接修改正文；如果作者要求代写，给出文字建议让他自己采纳。\n' +
        '4. 不确定的事实先问清楚再回答，不要编造设定。\n\n' +
        blocks.join('\n\n'),
    };
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    if (!props.aiCfg) {
      props.onNeedSettings();
      return;
    }
    const userMsg: ChatMsg = { role: 'user', content: text, at: new Date().toISOString() };
    const next = [...msgs, userMsg];
    setMsgs(next);
    setInput('');
    setSending(true);
    setStreamText('');
    try {
      const history: AiMessage[] = next.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const r = await chatAi(
        props.aiCfg,
        [buildContext(), ...history],
        { maxTokens: 1400, temperature: 0.7 },
        { onContent: (full) => setStreamText(full) }
      );
      const done = [...next, { role: 'assistant' as const, content: r.text, at: new Date().toISOString() }];
      setMsgs(done);
      await saveChat(props.root, props.dirName, done);
    } catch (e) {
      setMsgs(next); // 保留用户消息，可重发
      toast(String(e instanceof Error ? e.message : e), 'err');
    } finally {
      setSending(false);
      setStreamText('');
    }
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
          <button className="icon-btn" title="清空对话" onClick={() => setConfirmClear(true)}>
            🗑
          </button>
        </div>
      </header>

      <div className="chat-context-bar" role="group" aria-label="本次对话带上的上下文">
        <span className="chat-context-label">带上</span>
        {CTX_PILLS.map((p) => (
          <button
            key={p.key}
            className={'chat-ctx-pill' + (ctx[p.key] ? ' on' : '')}
            title={p.title}
            aria-pressed={ctx[p.key]}
            onClick={() => setCtx((c) => ({ ...c, [p.key]: !c[p.key] }))}
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
              <div className="chat-bubble">{m.content}</div>
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
            placeholder="问情节、人物、伏笔……"
            onChange={(e) => setInput(e.target.value)}
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
            disabled={!input.trim() || sending}
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

      {confirmClear && (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirmClear(false)}>
          <div className="modal-card small">
            <div className="modal-head">
              <span>清空对话</span>
            </div>
            <div className="modal-body">
              <p className="confirm-text">清空这本书的 AI 对话记录？正文与资料不受影响。</p>
              <div className="modal-actions">
                <button className="ghost-btn" onClick={() => setConfirmClear(false)}>
                  取消
                </button>
                <button
                  className="danger-btn"
                  onClick={() => {
                    setMsgs([]);
                    void saveChat(props.root, props.dirName, []);
                    setConfirmClear(false);
                  }}
                >
                  清空
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
