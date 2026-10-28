/**
 * 书库业务层：新建/打开/删除书、章节读写、字数与连更统计、快照、导出。
 * 数据形态（磁盘上一本书 = 一个文件夹）：
 *   book.json                     书元数据 + 章节目录
 *   chapters/<chapterId>.json     每章一个 Tiptap 文档
 *   entities/characters|lore/     P1 资料库（先建目录占位）
 *   refs.json                     引用倒排索引（P1）
 *   snapshots/<时间戳>/           完整快照 = book.json + chapters + entities + 校验清单
 */
import type { Book, ChapterFile, ChapterMeta, DailyStats } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from './json';
import {
  readJson, readJsonOrNull, writeJson, writeText, listDir, exists, mkdir,
  deleteFile, joinPath, defaultLibraryDir, appSettingsPath, isDesktop, updateSettings,
} from './fs';
import { countWords, docToMarkdown, docToPlainText } from './words';
import { genId, nowIso, todayStr } from './id';
import { updateRefsForChapter, readRefs } from './entities';
import { createSnapshot, recoverBookRestore } from './snapshots';
export { createSnapshot, listSnapshots, restoreSnapshot } from './snapshots';
export type { SnapshotInfo } from './snapshots';
import * as ent from './entities';
import { GENRE_TEMPLATES } from './templates';
import { acquireBookLease } from './bookLease';

export { genId, nowIso, todayStr };

/* ---------- 界面主题与编辑偏好（也存全局设置） ---------- */

export type ThemeName = 'light' | 'dark';

export async function getTheme(): Promise<ThemeName> {
  const v = await readJsonOrNull(await appSettingsPath());
  return (v as { theme?: string } | null)?.theme === 'dark' ? 'dark' : 'light';
}

export async function setTheme(t: ThemeName): Promise<void> {
  await updateSettings({ theme: t });
}

/** 编辑区偏好：字号 / 行距 / 字体 / 打字机滚动（P5） */
export interface EditorPrefs {
  fontSize: number;
  lineHeight: number;
  /** 'serif' | 'song' | 'hei' | 'kai' | 'fang' */
  fontFamily: string;
  typewriter: boolean;
}

export const DEFAULT_PREFS: EditorPrefs = {
  fontSize: 17.5,
  lineHeight: 2.05,
  fontFamily: 'serif',
  typewriter: false,
};

export async function loadEditorPrefs(): Promise<EditorPrefs> {
  const v = await readJsonOrNull(await appSettingsPath());
  const p = (v as { editor?: Partial<EditorPrefs> } | null)?.editor ?? {};
  return {
    fontSize: typeof p.fontSize === 'number' ? p.fontSize : DEFAULT_PREFS.fontSize,
    lineHeight: typeof p.lineHeight === 'number' ? p.lineHeight : DEFAULT_PREFS.lineHeight,
    fontFamily: typeof p.fontFamily === 'string' ? p.fontFamily : DEFAULT_PREFS.fontFamily,
    typewriter: p.typewriter === true,
  };
}

export async function saveEditorPrefs(prefs: EditorPrefs): Promise<void> {
  await updateSettings({ editor: prefs as unknown as JsonValue });
}

export { readRefs };

export function safeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '未命名'
  );
}

/* ---------- 设置与书库根 ---------- */

interface Settings {
  libraryRoot?: string;
}

async function readSettings(): Promise<Settings> {
  const p = await appSettingsPath();
  const v = await readJsonOrNull(p);
  return (v as Settings | null) ?? {};
}

export async function getLibraryRoot(): Promise<string> {
  const s = await readSettings();
  if (s.libraryRoot && (await exists(s.libraryRoot))) return s.libraryRoot;
  const def = await defaultLibraryDir();
  if (!(await exists(def))) await mkdir(def);
  return def;
}

export async function setLibraryRoot(root: string): Promise<void> {
  if (!(await exists(root))) await mkdir(root);
  await updateSettings({ libraryRoot: root });
}

/* ---------- 书的列表 ---------- */

export interface BookEntry {
  /** 书的文件夹名（书库根下） */
  dirName: string;
  book: Book;
}

export interface BookProblem { dirName: string; message: string }

export async function listBooks(root: string, onProblem?: (problem: BookProblem) => void): Promise<BookEntry[]> {
  const out: BookEntry[] = [];
  let entries: string[] = [];
  try {
    entries = await listDir(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith('/')) continue;
    const dirName = name.slice(0, -1);
    const bookDir = joinPath(root, dirName);
    const bookPath = joinPath(bookDir, 'book.json');
    try {
      // Recovery must be reachable even when the first live file was moved away.
      if (await exists(joinPath(bookDir, '.restore-journal.json'))) await recoverBookRestore(root, dirName);
      if (!(await exists(bookPath))) {
        if (await exists(joinPath(bookDir, 'snapshots'))) onProblem?.({ dirName, message: '作品目录文件缺失，已有备份仍可只读查看；未以空白目录覆盖。' });
        continue;
      }
      const book = await readJson(bookPath) as unknown as Book;
      if (!book?.id || !Array.isArray(book.chapters) || !book.stats) throw Error('作品目录格式不完整');
      out.push({ dirName, book });
    } catch (error) {
      onProblem?.({ dirName, message: '作品尚未恢复或目录无法读取：' + String(error) });
    }
  }
  out.sort((a, b) => (a.book.updatedAt < b.book.updatedAt ? 1 : -1));
  return out;
}

/* ---------- 新建书 ---------- */

export function emptyDoc(): JsonValue {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function newChapterMeta(title: string): ChapterMeta {
  return {
    id: genId(),
    index: 0,
    title,
    wordCount: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function newChapterFile(meta: ChapterMeta): ChapterFile {
  return { protocolVersion: MODEL_VERSION, meta, doc: emptyDoc() };
}

export async function createBook(
  root: string,
  title: string,
  dailyGoal?: number,
  templateId?: string
): Promise<BookEntry> {
  const id = genId();
  let dirName = `${safeName(title)}-${id.slice(0, 6)}`;
  let bookDir = joinPath(root, dirName);
  let n = 2;
  while (await exists(bookDir)) {
    dirName = `${safeName(title)}-${id.slice(0, 6)}-${n++}`;
    bookDir = joinPath(root, dirName);
  }

  await mkdir(bookDir);
  const release = await acquireBookLease(root, dirName);
  try {
  const first = newChapterMeta('第一章');
  first.index = 0;
  const book: Book = {
    id,
    protocolVersion: MODEL_VERSION,
    title: title.trim() || '未命名',
    genreTemplate: templateId,
    dailyGoal,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    chapters: [first],
    stats: { totalWords: 0, streakDays: 0 },
    dailyStats: [],
  };

  await writeJson(joinPath(bookDir, 'book.json'), book as unknown as JsonValue);
  await writeJson(
    joinPath(bookDir, 'chapters', `${first.id}.json`),
    newChapterFile(first) as unknown as JsonValue
  );
  // P1 资料库目录占位
  await writeText(joinPath(bookDir, 'entities', 'characters', '.keep'), '');
  await writeText(joinPath(bookDir, 'entities', 'lore', '.keep'), '');
  await writeJson(joinPath(bookDir, 'refs.json'), []);

  // 流派模板：生成带引导问题的占位词条
  if (templateId) {
    const tpl = GENRE_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) {
      for (const s of tpl.lores) {
        const l = ent.newLore(s.name, s.category);
        l.content = s.content;
        await ent.saveLore(root, dirName, l);
      }
    }
  }
  return { dirName, book };
  } finally { await release(); }
}

/* ---------- 书与章节读写 ---------- */

export function bookPathOf(root: string, dirName: string): string {
  return joinPath(joinPath(root, dirName), 'book.json');
}

export async function loadBook(root: string, dirName: string): Promise<Book | null> {
  await recoverBookRestore(root, dirName);
  const path = bookPathOf(root, dirName);
  const v = await exists(path) ? await readJson(path) : null;
  return (v as unknown as Book) ?? null;
}

export async function saveBook(root: string, dirName: string, book: Book): Promise<void> {
  book.updatedAt = nowIso();
  await writeJson(bookPathOf(root, dirName), book as unknown as JsonValue);
}

export async function readChapter(
  root: string,
  dirName: string,
  chapterId: string
): Promise<ChapterFile | null> {
  const p = joinPath(joinPath(root, dirName), 'chapters', `${chapterId}.json`);
  const v = await exists(p) ? await readJson(p) : null;
  if (!v) return null;
  const f = v as unknown as ChapterFile;
  // 老文件缺 meta 兜底
  if (!f.meta || (f.doc as { type?: string })?.type !== 'doc') throw new Error('章节文件格式损坏，已停止载入');
  return f;
}

export async function writeChapter(
  root: string,
  dirName: string,
  file: ChapterFile
): Promise<void> {
  const p = joinPath(joinPath(root, dirName), 'chapters', `${file.meta.id}.json`);
  await writeJson(p, file as unknown as JsonValue);
}

export async function deleteChapterFile(
  root: string,
  dirName: string,
  chapterId: string
): Promise<void> {
  const p = joinPath(joinPath(root, dirName), 'chapters', `${chapterId}.json`);
  try {
    await deleteFile(p);
  } catch {
    // 文件不存在就算了
  }
}

/* ---------- 统计 ---------- */

export function computeStreak(dailyStats: DailyStats[]): number {
  const days = new Set(dailyStats.filter((d) => d.words > 0).map((d) => d.date));
  if (days.size === 0) return 0;
  let streak = 0;
  const d = new Date();
  // 今天还没写不打断连更（从昨天起算）
  if (!days.has(dateStr(d))) d.setDate(d.getDate() - 1);
  while (days.has(dateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayWords(book: Book): number {
  const t = todayStr();
  return book.dailyStats.find((d) => d.date === t)?.words ?? 0;
}

/**
 * 保存一章并同步全书统计（字数增量按正向计入今日，删除/删减不倒扣）。
 * 返回更新后的 book。
 */
export async function saveChapterWithStats(
  root: string,
  dirName: string,
  book: Book,
  chapter: ChapterFile,
  onWarning?: (message: string) => void
): Promise<Book> {
  const newCount = countWords(docToPlainText(chapter.doc as JsonValue));
  const old = book.chapters.find((c) => c.id === chapter.meta.id);
  const diff = newCount - (old?.wordCount ?? 0);

  chapter.meta.wordCount = newCount;
  chapter.meta.updatedAt = nowIso();
  await writeChapter(root, dirName, chapter);
  // 增量更新引用倒排索引（只重扫本章，便宜）
  try {
    await updateRefsForChapter(root, dirName, chapter.meta.id, chapter.doc as JsonValue);
  } catch {
    onWarning?.('正文已保存，但资料关联索引更新失败。下次保存会重试。');
  }

  const next: Book = { ...book, chapters: book.chapters.map((c) => (c.id === chapter.meta.id ? { ...c, ...chapter.meta } : c)) };
  if (diff > 0) {
    const t = todayStr();
    const stats = [...next.dailyStats];
    const i = stats.findIndex((d) => d.date === t);
    if (i >= 0) stats[i] = { ...stats[i], words: stats[i].words + diff };
    else stats.push({ date: t, words: diff });
    next.dailyStats = stats;
  }
  next.stats = {
    totalWords: next.chapters.reduce((s, c) => s + c.wordCount, 0),
    streakDays: computeStreak(next.dailyStats),
  };
  await saveBook(root, dirName, next);

  // Daily snapshots are scheduled after this foreground save, outside its await chain.
  return next;
}

/* ---------- 导出 ---------- */

export interface ExportOptions {
  format: 'md' | 'txt';
  scope: 'all' | 'current';
  chapterId?: string;
}

export async function composeExport(
  root: string,
  dirName: string,
  book: Book,
  opts: ExportOptions
): Promise<{ filename: string; content: string }> {
  const md = opts.format === 'md';
  const chapters = opts.scope === 'current'
    ? book.chapters.filter((c) => c.id === opts.chapterId)
    : book.chapters;
  const volumes = book.volumes ?? [];
  const volTitle = (id?: string) => volumes.find((v) => v.id === id)?.title;
  const hasVols = opts.scope === 'all' && volumes.some((v) => chapters.some((c) => c.volumeId === v.id));

  const parts: string[] = [];
  if (opts.scope === 'all') {
    parts.push(md ? `# ${book.title}` : book.title);
  }
  let lastVol: string | undefined = undefined; // undefined = 还没遇到卷
  for (let i = 0; i < chapters.length; i++) {
    const meta = chapters[i];
    const no = meta.index + 1;
    const file = await readChapter(root, dirName, meta.id);
    const body = file
      ? md
        ? docToMarkdown(file.doc as JsonValue)
        : docToPlainText(file.doc as JsonValue)
      : '';
    const vol = volTitle(meta.volumeId);
    if (hasVols && vol !== lastVol) {
      if (vol) parts.push(md ? `## ${vol}` : `\n【${vol}】`);
      lastVol = vol;
    }
    // 有分卷时章节降一级，避免和卷标题同级
    const head = md
      ? `${hasVols ? '###' : '##'} 第${no}章 ${meta.title}`
      : `第${no}章 ${meta.title}`;
    parts.push(`${head}\n\n${body}`);
  }
  const content = parts.join(md ? '\n\n' : '\n\n');
  const suffix = opts.scope === 'current'
    ? `-第${(book.chapters.find((c) => c.id === opts.chapterId)?.index ?? 0) + 1}章`
    : '';
  return { filename: `${safeName(book.title)}${suffix}.${opts.format}`, content };
}

/** 保存导出文件：桌面端弹保存对话框；浏览器端触发下载 */
export async function exportDefaultDir(fallback: string): Promise<string> {
  const settings = await readJsonOrNull(await appSettingsPath()) as { exportDir?: string } | null;
  return settings?.exportDir && await exists(settings.exportDir) ? settings.exportDir : fallback;
}

export async function rememberExportDir(dir: string): Promise<void> {
  await updateSettings({ exportDir: dir });
}

export async function saveExportFile(filename: string, content: string, fallbackDir?: string): Promise<boolean> {
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dir = await exportDefaultDir(fallbackDir ?? await defaultLibraryDir());
    const path = await save({ defaultPath: joinPath(dir, filename), title: '导出稿件' });
    if (!path) return false;
    await writeText(path, content);
    const parent = path.replace(/[\\/][^\\/]+$/, '');
    // The file is already exported: preference errors must not report a false export failure.
    try { await rememberExportDir(parent); } catch { /* preserve existing settings */ }
    return true;
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/* ---------- 杂项 ---------- */

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const dt = new Date(t);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString('zh-Hans-CN');
}
