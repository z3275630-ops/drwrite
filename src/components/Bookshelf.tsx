import { useEffect, useState } from 'react';
import type { BookEntry } from '../lib/library';
import * as lib from '../lib/library';
import { deleteDir, joinPath, isDesktop } from '../lib/fs';
import { GENRE_TEMPLATES } from '../lib/templates';
import { toast } from './Toast';
import { Modal } from './Modal';

function spineHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default function Bookshelf(props: { onOpen: (root: string, dirName: string) => void }) {
  const [root, setRoot] = useState('');
  const [books, setBooks] = useState<BookEntry[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGoal, setNewGoal] = useState('4000');
  const [newGenre, setNewGenre] = useState('');
  const [creating, setCreating] = useState(false);
  const [delTarget, setDelTarget] = useState<BookEntry | null>(null);
  const [delText, setDelText] = useState('');
  const [theme, setThemeState] = useState<'light' | 'dark'>((document.body.dataset.theme as 'light' | 'dark') ?? 'light');

  useEffect(() => {
    void (async () => {
      const r = await lib.getLibraryRoot();
      setRoot(r);
      setBooks(await lib.listBooks(r));
    })();
  }, []);

  const refresh = async (r = root) => {
    setBooks(await lib.listBooks(r));
  };

  const createBook = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const tpl = GENRE_TEMPLATES.find((t) => t.id === newGenre);
      const entry = await lib.createBook(
        root,
        title,
        Number(newGoal) > 0 ? Number(newGoal) : tpl?.goal,
        newGenre || undefined
      );
      setShowNew(false);
      setNewTitle('');
      toast('已创建《' + entry.book.title + '》');
      props.onOpen(root, entry.dirName);
    } catch (e) {
      toast('创建失败：' + String(e), 'err');
    } finally {
      setCreating(false);
    }
  };

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    setThemeState(next);
    await lib.setTheme(next);
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setDelTarget(null);
    try {
      await deleteDir(joinPath(root, delTarget.dirName));
      toast('已删除《' + delTarget.book.title + '》');
      await refresh();
    } catch (e) {
      toast('删除失败：' + String(e), 'err');
    }
  };

  const changeRoot = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, title: '选择书库文件夹（新书会建在这里）' });
    if (typeof dir !== 'string') return;
    await lib.setLibraryRoot(dir);
    setRoot(dir);
    await refresh(dir);
    toast('书库位置已切换');
  };

  const openInExplorer = async () => {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    try {
      await revealItemInDir(root);
    } catch (e) {
      toast('打开失败：' + String(e), 'err');
    }
  };

  return (
    <div className="shelf-root">
      <header className="shelf-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <div className="brand-name">Drwrite</div>
            <div className="brand-sub">本地优先的写作台 · 你的字只存在你自己的电脑里</div>
          </div>
        </div>
        {root && (
          <div className="shelf-loc">
            <button className="ghost-btn small icon-only" title={theme === 'dark' ? '切到浅色' : '切到深色'} onClick={() => void toggleTheme()}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <span className="loc-path" title={root}>
              书库：{root}
            </span>
            {isDesktop && (
              <>
                <button className="ghost-btn small" onClick={() => void openInExplorer()}>
                  打开文件夹
                </button>
                <button className="ghost-btn small" onClick={() => void changeRoot()}>
                  更改位置
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <main className="shelf-main">
        {books === null ? (
          <div className="shelf-loading">正在打开书库……</div>
        ) : (
          <>
            <div className="shelf-grid">
              {books.map((e) => (
                <div
                  key={e.dirName}
                  className="book-card"
                  onClick={() => props.onOpen(root, e.dirName)}
                >
                  <span
                    className="spine"
                    style={{ background: `hsl(${spineHue(e.book.id)}, 38%, 52%)` }}
                  />
                  <div className="book-card-body">
                    <div className="book-card-title" title={e.book.title}>
                      {e.book.title}
                    </div>
                    <div className="book-card-meta">
                      {e.book.chapters.length} 章 · {lib.fmtNum(e.book.stats.totalWords)} 字
                      {e.book.stats.streakDays > 0 && <> · 连更 {e.book.stats.streakDays} 天</>}
                    </div>
                    <div className="book-card-time">{lib.relTime(e.book.updatedAt)}编辑过</div>
                  </div>
                  <button
                    className="book-card-del icon-btn"
                    title="删除这本书"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setDelTarget(e);
                      setDelText('');
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className="book-card new" onClick={() => setShowNew(true)}>
                <div className="new-plus">＋</div>
                <div className="new-label">新建作品</div>
              </button>
            </div>
            {books.length === 0 && (
              <div className="shelf-empty">
                <div className="empty-title">从第一本书开始</div>
                <div className="empty-sub">
                  书会以普通文件夹的形式保存在上面的书库位置里，随时拷贝备份、随时带走。
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {showNew && (
        <Modal title="新建作品" onClose={() => setShowNew(false)}>
          <label className="field">
            <span>书名</span>
            <input
              autoFocus
              value={newTitle}
              placeholder="例如：风起陇西之外"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createBook()}
            />
          </label>
      <label className="field">
        <span>流派模板（可选：预置一组带引导问题的设定词条）</span>
        <select value={newGenre} onChange={(e) => setNewGenre(e.target.value)}>
          <option value="">不使用模板</option>
          {GENRE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>日更目标（字，可留空）</span>
        <input
          value={newGoal}
          inputMode="numeric"
          onChange={(e) => setNewGoal(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void createBook()}
        />
      </label>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setShowNew(false)}>
              取消
            </button>
            <button className="primary-btn" disabled={!newTitle.trim() || creating} onClick={() => void createBook()}>
              {creating ? '创建中…' : '创建并开始写作'}
            </button>
          </div>
        </Modal>
      )}

      {delTarget && (
        <Modal title="删除作品" onClose={() => setDelTarget(null)}>
          <p className="confirm-text">
            将永久删除《{delTarget.book.title}》的整个文件夹（含 {delTarget.book.chapters.length} 章、
            {lib.fmtNum(delTarget.book.stats.totalWords)} 字与全部快照），无法恢复。
            <br />
            输入书名 <b>{delTarget.book.title}</b> 确认：
          </p>
          <input className="danger-input" autoFocus value={delText} onChange={(e) => setDelText(e.target.value)} />
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setDelTarget(null)}>
              取消
            </button>
            <button className="danger-btn" disabled={delText !== delTarget.book.title} onClick={() => void doDelete()}>
              永久删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
