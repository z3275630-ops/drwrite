/**
 * 书库业务层：新建/打开/删除书、章节读写、字数与连更统计、快照、导出。
 * 数据形态（磁盘上一本书 = 一个文件夹）：
 *   book.json                     书元数据 + 章节目录
 *   chapters/<chapterId>.json     每章一个 Tiptap 文档
 *   entities/characters|lore/     P1 资料库（先建目录占位）
 *   refs.json                     引用倒排索引（P1）
 *   snapshots/<时间戳>/           快照 = book.json + chapters 整份拷贝
 */
import type { Book, ChapterFile, ChapterMeta, DailyStats } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from './json';
import {
  readJson, readJsonOrNull, writeJson, writeText, listDir, exists, mkdir,
  deleteFile, deleteDir, copyTree, joinPath, defaultLibraryDir, appSettingsPath, isDesktop,
} from './fs';
import { countWords, docToMarkdown, docToPlainText } from './words';
import { genId, nowIso, todayStr } from './id';
import { updateRefsForChapter, rebuildAllRefs, readRefs } from './entities';
import * as ent from './entities';
import { GENRE_TEMPLATES } from './templates';

export { genId, nowIso, todayStr };

/* ---------- 界面主题（也存全局设置） ---------- */

export type ThemeName = 'light' | 'dark';

export async function getTheme(): Promise<ThemeName> {
  const v = await readJsonOrNull(await appSettingsPath());
  return (v as { theme?: string } | null)?.theme === 'dark' ? 'dark' : 'light';
}

export async function setTheme(t: ThemeName): Promise<void> {
  const p = await appSettingsPath();
  const v = (await readJsonOrNull(p)) as Record<string, JsonValue> | null;
  await writeJson(p, { ...(v ?? {}), theme: t } as unknown as JsonValue);
}

function timestampName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
  const p = await appSettingsPath();
  const s = await readSettings();
  await writeJson(p, { ...s, libraryRoot: root } as unknown as JsonValue);
}

/* ---------- 书的列表 ---------- */

export interface BookEntry {
  /** 书的文件夹名（书库根下） */
  dirName: string;
  book: Book;
}

export async function listBooks(root: string): Promise<BookEntry[]> {
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
    const bookPath = joinPath(joinPath(root, dirName), 'book.json');
    const v = await readJsonOrNull(bookPath);
    if (!v) continue;
    const book = v as unknown as Book;
    if (!book?.id || !Array.isArray(book.chapters)) continue;
    out.push({ dirName, book });
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
}

/* ---------- 书与章节读写 ---------- */

export function bookPathOf(root: string, dirName: string): string {
  return joinPath(joinPath(root, dirName), 'book.json');
}

export async function loadBook(root: string, dirName: string): Promise<Book | null> {
  const v = await readJsonOrNull(bookPathOf(root, dirName));
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
  const v = await readJsonOrNull(p);
  if (!v) return null;
  const f = v as unknown as ChapterFile;
  // 老文件缺 meta 兜底
  if (!f.meta) return null;
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
  chapter: ChapterFile
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
    // 索引失败不影响正文保存
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
  return next;
}

/* ---------- 快照 ---------- */

export async function createSnapshot(root: string, dirName: string): Promise<string> {
  const bookDir = joinPath(root, dirName);
  const name = timestampName();
  const dst = joinPath(joinPath(bookDir, 'snapshots'), name);
  // 只拷 book.json + chapters/
  await copyTree(joinPath(bookDir, 'chapters'), joinPath(dst, 'chapters'));
  const bookJson = await readJson(bookPathOf(root, dirName));
  await writeJson(joinPath(dst, 'book.json'), bookJson);

  // 只保留最近 20 份
  const snaps = await listSnapshots(root, dirName);
  for (const old of snaps.slice(20)) {
    await deleteDir(joinPath(joinPath(bookDir, 'snapshots'), old));
  }
  return name;
}

export async function listSnapshots(root: string, dirName: string): Promise<string[]> {
  const dir = joinPath(joinPath(root, dirName), 'snapshots');
  if (!(await exists(dir))) return [];
  const entries = await listDir(dir);
  return entries
    .filter((e) => e.endsWith('/'))
    .map((e) => e.slice(0, -1))
    .sort()
    .reverse();
}

/** 恢复快照：先把当前内容做一份"恢复前"快照，再用快照覆盖 */
export async function restoreSnapshot(
  root: string,
  dirName: string,
  snapName: string
): Promise<void> {
  const bookDir = joinPath(root, dirName);
  await createSnapshot(root, dirName); // 恢复前自动留底
  const snapDir = joinPath(joinPath(bookDir, 'snapshots'), snapName);
  const snapBook = await readJsonOrNull(joinPath(snapDir, 'book.json'));
  if (!snapBook) throw new Error('快照数据不完整');
  // chapters 目录整体替换
  await deleteDir(joinPath(bookDir, 'chapters'));
  await copyTree(joinPath(snapDir, 'chapters'), joinPath(bookDir, 'chapters'));
  await writeJson(bookPathOf(root, dirName), snapBook);
  // 全量重建引用索引
  const snapChapters = ((snapBook as { chapters?: { id: string }[] }).chapters ?? []).map((c) => c.id);
  try {
    await rebuildAllRefs(root, dirName, snapChapters.map((id) => ({ id })), async (id) => {
      const f = await readChapter(root, dirName, id);
      return (f?.doc as JsonValue) ?? null;
    });
  } catch {
    // 索引失败不影响恢复
  }
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

  const parts: string[] = [];
  if (opts.scope === 'all') {
    parts.push(md ? `# ${book.title}` : book.title);
  }
  for (let i = 0; i < chapters.length; i++) {
    const meta = chapters[i];
    const no = meta.index + 1;
    const file = await readChapter(root, dirName, meta.id);
    const body = file
      ? md
        ? docToMarkdown(file.doc as JsonValue)
        : docToPlainText(file.doc as JsonValue)
      : '';
    const head = md ? `## 第${no}章 ${meta.title}` : `第${no}章 ${meta.title}`;
    parts.push(md ? `${head}\n\n${body}` : `${head}\n\n${body}`);
  }
  const content = parts.join(md ? '\n\n' : '\n\n');
  const suffix = opts.scope === 'current'
    ? `-第${(book.chapters.find((c) => c.id === opts.chapterId)?.index ?? 0) + 1}章`
    : '';
  return { filename: `${safeName(book.title)}${suffix}.${opts.format}`, content };
}

/** 保存导出文件：桌面端弹保存对话框；浏览器端触发下载 */
export async function saveExportFile(filename: string, content: string): Promise<boolean> {
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: filename });
    if (!path) return false;
    await writeText(path, content);
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
