import { useEffect, useRef, useState } from 'react';
import type { Book, Character, Foreshadow, LoreEntry, RefIndexEntry } from '../types';
import { callAi } from '../lib/ai';
import type { AiConfig, AiMessage } from '../lib/ai';
import { entityCardLines } from '../lib/assembler';
import * as st from '../lib/structure';
import { loadChat, saveChat } from '../lib/chat';
import type { ChatMsg } from '../lib/chat';
import { toast } from './Toast';

/**
 * AI 写作顾问（学织境的 Quill 定位，但永远不改正文）：
 * 上下文 = 实体卡 + 伏笔清单 + 当前章信息，每次发送时重建；对话本身存在书文件夹里。
 */
export default function ChatPanel(props: {
  root: string;
  dirName: string;
  book: Book;
  chars: Character[];
  lore: LoreEntry[];
  foreshadows: Foreshadow[];
  refs: RefIndexEntry[];
  aiCfg: AiConfig | null;
  activeChapterId: string | null;
  chapterTail: string;
  onClose: () => void;
  onNeedSettings: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    void loadChat(props.root, props.dirName).then((m) => {
      setMsgs(m);
      loadedRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.root, props.dirName]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, sending]);

  const buildContext = (): AiMessage => {
    const relatedIds = [...new Set(props.refs.filter((r) => r.chapterId === props.activeChapterId).map((r) => r.targetId))];
    const cards = entityCardLines(props.chars, props.lore, relatedIds).slice(0, 10);
    const allCards = cards.length ? cards : entityCardLines(props.chars, props.lore, props.chars.slice(0, 6).map((c) => c.id));
    const meta = props.book.chapters.find((c) => c.id === props.activeChapterId);
    const fores = props.foreshadows
      .slice(0, 12)
      .map((f) => `· ${f.title}（${st.foreshadowStateOf(f, props.book.chapters)}）`);
    const blocks = [
      `作品：《${props.book.title}》`,
      allCards.length ? '设定资料：\n' + allCards.join('\n') : '',
      fores.length ? '伏笔清单：\n' + fores.join('\n') : '',
      meta ? `当前在第${meta.index + 1}章「${meta.title}」${meta.synopsis ? '，梗概：' + meta.synopsis : ''}` : '',
      props.chapterTail ? '当前章正文结尾：\n…' + props.chapterTail.slice(-800) : '',
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

  const send = async () => {
    const text = input.trim();
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
    try {
      const history: AiMessage[] = next.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const r = await callAi(props.aiCfg, [buildContext(), ...history], { maxTokens: 1400, temperature: 0.7 });
      const done = [...next, { role: 'assistant' as const, content: r.text, at: new Date().toISOString() }];
      setMsgs(done);
      await saveChat(props.root, props.dirName, done);
    } catch (e) {
      setMsgs(next); // 保留用户消息，可重发
      toast(String(e instanceof Error ? e.message : e), 'err');
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="inspector chat-panel">
      <div className="inspector-head">
        <span className="inspector-title">AI 写作顾问{props.aiCfg ? '' : ' · 未配置'}</span>
        <span>
          <button className="icon-btn" title="清空对话" onClick={() => setConfirmClear(true)}>
            🗑
          </button>
          <button className="icon-btn" onClick={props.onClose} aria-label="关闭对话">
            ✕
          </button>
        </span>
      </div>
      <div className="chat-list" ref={listRef}>
        {!msgs.length && (
          <div className="chat-empty">
            和 AI 聊这本书：情节卡住了？人物弧光怎么走？伏笔什么时候收？
            <br />
            它能看到你的设定卡、伏笔清单和当前章正文。
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'chat-msg ' + m.role}>
            <div className="chat-bubble">{m.content}</div>
          </div>
        ))}
        {sending && (
          <div className="chat-msg assistant">
            <div className="chat-bubble typing">正在想…</div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="primary-btn slim" disabled={!input.trim() || sending} onClick={() => void send()}>
          发送
        </button>
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
