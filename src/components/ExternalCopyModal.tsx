import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BookEntry } from '../lib/library';
import { joinPath } from '../lib/fs';
import { Modal } from './Modal';
export function ExternalCopyModal({ root, entry, onClose }: { root: string; entry: BookEntry; onClose: () => void }) {
  const [parent, setParent] = useState(''), [name, setName] = useState(entry.dirName + '-完整副本'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; bytes: number } | null>(null), [result, setResult] = useState<{ path: string; files: number; bytes: number } | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    let dead = false, stop: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const off = await getCurrentWindow().onCloseRequested(event => {
        if (busyRef.current) { event.preventDefault(); setError('完整副本尚未完成，已取消关闭。请稍后重试。'); }
      });
      if (dead) off(); else stop = off;
    });
    return () => { dead = true; stop?.(); };
  }, []);
  const choose = async () => {
    try { const { open } = await import('@tauri-apps/plugin-dialog'); const path = await open({ directory: true, title: '选择完整副本的目标父目录', defaultPath: parent || root }); if (typeof path === 'string') setParent(path); setResult(null); }
    catch (reason) { setError(String(reason)); }
  };
  const copy = async () => {
    if (busy || !parent || !name.trim()) return; setBusy(true); busyRef.current = true; setError(''); setProgress(null); setResult(null);
    const requestId = crypto.randomUUID(); let stop: (() => void) | undefined;
    try {
      stop = await listen<{ requestId: string; done: number; total: number; bytes: number }>('book-copy-progress', event => { if (event.payload.requestId === requestId) setProgress(event.payload); });
      setResult(await invoke('copy_book_external', { bookDir: joinPath(root, entry.dirName), parent, name, requestId }));
    } catch (reason) { setError(String(reason)); } finally { stop?.(); setBusy(false); busyRef.current = false; }
  };
  return <Modal title="保存完整副本" description="将这本作品连同资料与备份一起保存。" width={690} onClose={onClose} busy={busy} className="tool-modal"
    footer={<><span className="footer-caption">已有同名目录不会被覆盖</span><div className="footer-actions"><button className="ghost-btn" disabled={busy} onClick={onClose}>关闭</button><button className="primary-btn" disabled={busy || !parent || !name.trim()} onClick={() => result ? onClose() : void copy()}>{busy ? '正在保存副本…' : result ? '完成' : '创建完整副本'}</button></div></>}>
    <div className="tool-summary"><div><span className="tool-kicker">整本作品</span><h3>{entry.book.title}</h3></div><div className="summary-number"><strong>{entry.book.chapters.length}</strong><span>章</span></div></div>
    <section className="tool-section"><h3 className="tool-section-title">保存到哪里</h3>
      <label className="field">目标位置<div className="path-picker"><input readOnly value={parent} placeholder="选择一个文件夹" /><button className="ghost-btn" disabled={busy} onClick={() => void choose()}>选择位置</button></div></label>
      <label className="field">副本文件夹名称<input disabled={busy} value={name} onChange={event => { setName(event.target.value); setResult(null); }} /></label>
      {parent && <p className="path-caption">{joinPath(parent, name)}</p>}
    </section>
    {busy && <div className="copy-progress"><progress className="tool-progress" aria-label="完整副本复制进度" max={progress?.total || 1} value={progress?.done ?? 0} /><p className="tool-status" role="status">{progress ? progress.done === progress.total ? '文件已复制，正在核对内容…' : `已复制 ${progress.done} / ${progress.total} 个文件 · ${(progress.bytes / 1024 / 1024).toFixed(2)} MB` : '正在检查作品并统计文件…'}</p></div>}
    {error && <div className="tool-message error" role="alert">{error}</div>}
    {result && <div className="tool-message success" role="status"><b>完整副本已保存并校验</b><p>{result.path.replace(/^\\\\\?\\/, '')}</p><p>{result.files} 个文件 · {(result.bytes / 1024 / 1024).toFixed(2)} MB</p><button className="ghost-btn small" onClick={async () => { const { revealItemInDir } = await import('@tauri-apps/plugin-opener'); await revealItemInDir(result.path); }}>查看副本位置</button></div>}
    <details className="tool-disclosure"><summary>副本包含什么</summary><div><p className="hint-text">正文、人物与设定、对话、AI 任务和已有快照都会保存。不包含全局设置、AI 密钥、临时工作文件和编辑锁。</p><p className="hint-text">先复制、再校验，完成后才发布为正式副本。需要防止整块硬盘损坏时，请选择另一块磁盘。</p></div></details>
  </Modal>;
}
