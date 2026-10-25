/**
 * 旧书导入（P6）：把现成的长篇 TXT 变成一本 Drwrite 书。
 * 分章：优先按「第X章/卷/回/节、序章、楔子、尾声、番外」标题行切；
 *       切不出 2 章以上就按每 ~4000 字硬切。
 */
import type { Book, ChapterFile, ChapterMeta } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from './json';
import { createBook, writeChapter, saveBook } from './library';
import { countWords } from './words';
import { genId, nowIso } from './id';

export interface ParsedChapter {
  title: string;
  paragraphs: string[];
}

const HEAD_RE = /^\s*(第[0-9０-９一二三四五六七八九十百千万零两]+[章卷回节部]|序章|序言|楔子|引子|尾声|终章|番外\S{0,6}|Chapter\s*\d+)[^\n]{0,30}$/;

/** 解析 TXT → 章节列表 */
export function parseTxtChapters(text: string): ParsedChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters: ParsedChapter[] = [];
  let cur: ParsedChapter | null = null;

  const pushPara = (para: string) => {
    if (!cur) cur = { title: '正文', paragraphs: [] };
    if (para.trim()) cur.paragraphs.push(para.trim());
    else if (cur.paragraphs.length) cur.paragraphs.push(''); // 保留段间空行标记
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length <= 34 && HEAD_RE.test(line)) {
      if (cur && cur.paragraphs.some((p) => p.trim())) chapters.push(cur);
      else if (cur) chapters.push(cur); // 空章也保留，保住用户的标题结构
      cur = { title: line.replace(/\s+/g, ' '), paragraphs: [] };
    } else {
      if (!cur) cur = { title: '正文', paragraphs: [] };
      pushPara(raw);
    }
  }
  if (cur) chapters.push(cur);

  // 标题切分失败（≤1 章）→ 按字数硬切
  if (chapters.length <= 1) {
    return splitBySize(chapters[0]?.paragraphs.join('\n') ?? text);
  }
  return chapters.filter((c) => c.paragraphs.some((p) => p.trim()) || c.title !== '正文');
}

function splitBySize(text: string): ParsedChapter[] {
  const paras = text.split(/\n{2,}|\n/).map((s) => s.trim()).filter(Boolean);
  const out: ParsedChapter[] = [];
  let buf: string[] = [];
  let size = 0;
  const LIMIT = 4000;
  for (const p of paras) {
    buf.push(p);
    size += p.length;
    if (size >= LIMIT) {
      out.push({ title: `第${out.length + 1}章`, paragraphs: buf });
      buf = [];
      size = 0;
    }
  }
  if (buf.length) out.push({ title: `第${out.length + 1}章`, paragraphs: buf });
  return out;
}

function docOf(paragraphs: string[]): JsonValue {
  const content = paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** 导入成书（不含实体；之后可跑「AI 通读建卡」） */
export async function importTxtBook(
  root: string,
  title: string,
  parsed: ParsedChapter[],
  dailyGoal?: number
): Promise<{ dirName: string; book: Book }> {
  const { dirName, book } = await createBook(root, title, dailyGoal);
  const metas: ChapterMeta[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const c = parsed[i];
    const id = i === 0 ? book.chapters[0].id : genId();
    const words = countWords(c.paragraphs.join('\n'));
    const meta: ChapterMeta = {
      id,
      index: i,
      title: c.title.slice(0, 40) || `第${i + 1}章`,
      wordCount: words,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const file: ChapterFile = { protocolVersion: MODEL_VERSION, meta, doc: docOf(c.paragraphs) };
    await writeChapter(root, dirName, file);
    metas.push(meta);
  }
  const next: Book = {
    ...book,
    chapters: metas,
    stats: { totalWords: metas.reduce((s, c) => s + c.wordCount, 0), streakDays: 0 },
  };
  await saveBook(root, dirName, next);
  return { dirName, book: next };
}

/** 读 TXT 文件文本：桌面端走 Rust（UTF-8/GBK 自适应），浏览器端 FileReader（GBK 用 TextDecoder） */
export async function readTxtFile(): Promise<{ name: string; text: string } | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      title: '选择要导入的 TXT 文件',
      filters: [{ name: '文本', extensions: ['txt', 'md'] }],
    });
    if (typeof path !== 'string') return null;
    const { invoke } = await import('@tauri-apps/api/core');
    const text = await invoke<string>('read_text_file', { path });
    const name = path.split(/[\\/]/).pop() ?? '导入之书';
    return { name: name.replace(/\.(txt|md)$/i, ''), text };
  }
  // 浏览器（测试）：<input type=file>
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      const buf = await f.arrayBuffer();
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.includes('\uFFFD')) text = new TextDecoder('gbk').decode(buf);
      resolve({ name: f.name.replace(/\.(txt|md)$/i, ''), text });
    };
    input.click();
  });
}
