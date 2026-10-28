import { UiSelect, ControlGroup } from './Controls';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Book } from '../types';
import { composeExportPlan, DEFAULT_EXPORT_OPTIONS, exportFilename, exportRange, safeExportName, type ExportOptions } from '../lib/exportPlan';
import { exportDefaultDir, readChapter, rememberExportDir } from '../lib/library';
import { readPreference, writePreference } from '../lib/preferences';
import { Modal } from './Modal';
export function ExportModal({ root, dirName, book, activeId, initial, onPrepare, onDone, onClose, onBusyChange }: {
  root: string; dirName: string; book: Book; activeId: string | null; initial: Partial<ExportOptions>;
  onPrepare: () => Promise<Book>; onDone: (chapterIds: string[], options: ExportOptions) => void; onClose: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState<ExportOptions>({ ...DEFAULT_EXPORT_OPTIONS, ...initial }), [parent, setParent] = useState('');
  const [folder, setFolder] = useState(safeExportName(book.title + '-导出-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  useEffect(() => { let alive = true; void Promise.all([readPreference<ExportOptions>('exportByBook', book.id), exportDefaultDir(root)]).then(([saved, path]) => {
    if (alive) { setOptions({ ...DEFAULT_EXPORT_OPTIONS, ...saved, ...initial }); setParent(path); setReady(true); }
  }).catch(reason => { if (alive) { setReady(true); setError('读取导出偏好失败，可重新选择：' + String(reason)); } }); return () => { alive = false; }; }, [book.id, root]);
  const range = exportRange(book, options, activeId);
  const filenames = useMemo(() => {
    try {
      const names = range.map(chapter => exportFilename(book, chapter, options));
      if (options.split && new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) return { names, error: '出现重名，请在模板中加入 {index}' };
      return { names: options.split ? names : [safeExportName(book.title + (range.length === 1 ? '-' + range[0].title : '-选定章节')) + '.' + options.format] };
    } catch (reason) { return { names: [], error: String(reason) }; }
  }, [book, options, range]);
  const choose = async () => {
    try { const { open } = await import('@tauri-apps/plugin-dialog'); const path = await open({ directory: true, title: '选择导出父目录（将在其中新建文件夹）', defaultPath: parent || root }); if (typeof path === 'string') setParent(path); }
    catch (reason) { setError(String(reason)); }
  };
  const save = async () => {
    if (!ready || busy || !parent || !folder.trim()) return;
    setBusy(true); onBusyChange?.(true); setError(''); setResult('');
    try {
      const latest = await onPrepare();
      const plan = await composeExportPlan(latest, options, activeId, async id => { const file = await readChapter(root, dirName, id); if (!file) throw Error('读不到章节，已停止导出'); return file.doc; });
      const saved = await invoke<{ path: string; files: number }>('export_book_files', { parent, folder, files: plan.files });
      setResult(`已导出 ${plan.chapterIds.length} 章 / ${saved.files} 个文件：${saved.path.replace(/^\\\\\?\\/, '')}`);
      onDone(plan.chapterIds, options);
      try { await rememberExportDir(parent); await writePreference('exportByBook', latest.id, options); }
      catch (reason) { setError('文件已导出，但偏好未记住：' + String(reason)); }
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); onBusyChange?.(false); }
  };
  const update = (next: Partial<ExportOptions>) => { setOptions(previous => ({ ...previous, ...next })); setResult(''); };
  return <Modal title="导出作品" description="选好范围和格式，生成一份可直接使用的正文。" className="tool-modal" width={760} onClose={onClose} busy={busy}
    footer={<><span className="footer-caption">{range.length} 章 · {options.format === 'md' ? 'Markdown' : '纯文本'}{options.split ? ' · 分章' : ' · 合并'}</span><div className="footer-actions">
      <button className="ghost-btn" disabled={busy} onClick={onClose}>关闭</button><button className="primary-btn" disabled={!ready || busy || !range.length || !!filenames.error || !parent || !folder.trim()} onClick={() => result ? onClose() : void save()}>{busy ? '正在导出…' : result ? '完成' : `导出 ${range.length} 章`}</button></div></>}>
    <ControlGroup disabled={!ready || busy}><legend>导出哪些内容</legend><div className="form-grid">
      <label className="field">章节范围<UiSelect value={options.scope} onChange={event => update({ scope: event.target.value as ExportOptions['scope'] })}><option value="current" disabled={!activeId}>本章</option><option value="volume">所选卷</option><option value="selected">勾选章节</option><option value="all">全书</option></UiSelect></label>
      <label className="field">文件格式<UiSelect value={options.format} onChange={event => update({ format: event.target.value as ExportOptions['format'] })}><option value="md">Markdown · .md</option><option value="txt">纯文本 · .txt</option></UiSelect></label>
    </div>
      {options.scope === 'volume' && <label className="field">选择卷<UiSelect value={options.volumeId} onChange={event => update({ volumeId: event.target.value })}><option value="">未分卷</option>{book.volumes?.map(volume => <option key={volume.id} value={volume.id}>{volume.title}</option>)}</UiSelect></label>}
      {options.scope === 'selected' && <div className="task-chapter-selection">{book.chapters.map(chapter => <label key={chapter.id}><input type="checkbox" checked={options.selectedIds.includes(chapter.id)} onChange={event => update({ selectedIds: event.target.checked ? [...options.selectedIds, chapter.id] : options.selectedIds.filter(id => id !== chapter.id) })} />{chapter.index + 1}. {chapter.title}</label>)}</div>}
      <details className="tool-disclosure"><summary>内容与命名<span>{options.split ? '每章一个文件' : '合并为一个文件'}</span></summary><div>
        <div className="option-checks"><label><input type="checkbox" checked={options.split} onChange={event => update({ split: event.target.checked })} />每章一个文件</label><label><input type="checkbox" checked={options.includeTitles} onChange={event => update({ includeTitles: event.target.checked })} />包含章标题</label><label><input type="checkbox" checked={options.includeScenes} onChange={event => update({ includeScenes: event.target.checked })} />包含场景标记</label></div>
        {options.split && <label className="field">分章文件名模板<input value={options.template} onChange={event => update({ template: event.target.value })} /><small>可用变量：{'{book} {volume} {index} {chapter}'}。序号沿用原目录。</small></label>}
      </div></details>
      <section className="tool-section"><h3 className="tool-section-title">保存到哪里</h3>
        <label className="field">导出位置<div className="path-picker"><input readOnly value={parent} placeholder="选择一个文件夹" /><button className="ghost-btn" onClick={() => void choose()}>选择位置</button></div></label>
        <label className="field">新建文件夹名称<input value={folder} onChange={event => { setFolder(event.target.value); setResult(''); }} /></label>
        <p className="hint-text">导出到新的文件夹；已有同名目录不会被覆盖。</p>
      </section>
      <details className="tool-disclosure"><summary>预览导出顺序<span>{range.length} 章</span></summary><div className="tool-file-preview">{range.map(chapter => <p key={chapter.id}>{chapter.index + 1}. {chapter.title}</p>)}<pre>{filenames.names.join('\n')}</pre></div></details>
    </ControlGroup>
    {(error || filenames.error) && <div className="tool-message error" role="alert">{error || filenames.error}</div>}
    {result && <div className="tool-message success" role="status">{result}</div>}
    <p className="hint-text tool-bottom-note">只导出正文，不混入场景摘要、资料卡或聊天。导出前会保存正文和右栏草稿，保存失败就停止。</p>
  </Modal>;
}
