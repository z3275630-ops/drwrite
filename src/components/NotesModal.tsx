import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import * as notes from '../lib/notes';
import type { Note } from '../lib/notes';
import { relTime } from '../lib/library';
import { toast } from './Toast';

/**
 * 素材箱（P5）：灵感速记。想到什么先扔进来，要用时一键插入到光标处。
 * 存在书文件夹的 entities/notes.json，不进 AI 上下文（要进正文由你决定）。
 */
export default function NotesModal(props: {
  root: string;
  dirName: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void notes.loadNotes(props.root, props.dirName).then(setList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    const t = draft.trim();
    if (!t) return;
    setList(await notes.addNote(props.root, props.dirName, t));
    setDraft('');
  };

  const del = async (id: string) => {
    setList(await notes.deleteNote(props.root, props.dirName, id));
  };

  const shown = (list ?? []).filter((n) => !query.trim() || n.text.includes(query.trim()));

  return (
    <Modal title="素材箱" width={560} onClose={props.onClose}>
      <p className="hint-text">闪念、金句、待查资料……先存着，写作时「插入到光标处」直接用。存在这本书的文件夹里。</p>
      <div className="note-input-row">
        <textarea
          className="syn-area"
          rows={2}
          placeholder="想到什么写什么，回车即保存"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <button className="primary-btn slim" disabled={!draft.trim()} onClick={() => void add()}>
          存入
        </button>
      </div>
      {list && list.length > 3 && (
        <input
          className="entity-search note-search"
          placeholder="搜素材"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="note-list">
        {!list && <div className="entity-empty">读取中…</div>}
        {list && !shown.length && (
          <div className="entity-empty">{list.length ? '没搜到' : '素材箱还是空的'}</div>
        )}
        {shown.map((n) => (
          <div key={n.id} className="note-item">
            <div className="note-text">{n.text}</div>
            <div className="note-meta">
              <span className="entity-sub">{relTime(n.at)}</span>
              <span className="note-ops">
                <button
                  className="ghost-btn small"
                  onClick={() => {
                    props.onInsert(n.text);
                  }}
                >
                  插入到光标处
                </button>
                <button className="icon-btn" title="删除" onClick={() => void del(n.id)}>
                  ✕
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="ghost-btn" onClick={props.onClose}>
          关闭
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            if (!list?.length) {
              toast('素材箱是空的');
              return;
            }
            const all = list.map((n) => n.text).join('\n');
            props.onInsert(all);
          }}
        >
          全部插入
        </button>
      </div>
    </Modal>
  );
}
