import type { Book, ChapterMeta } from '../types';
import type { JsonValue } from './json';
import { docToMarkdown, docToPlainText } from './words';
export interface ExportOptions { scope: 'current' | 'all' | 'volume' | 'selected'; volumeId: string; selectedIds: string[]; format: 'md' | 'txt'; split: boolean; includeTitles: boolean; includeScenes: boolean; template: string }
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { scope: 'all', volumeId: '', selectedIds: [], format: 'md', split: false, includeTitles: true, includeScenes: true, template: '{index}-{chapter}' };
export function exportRange(book: Book, options: ExportOptions, activeId: string | null): ChapterMeta[] {
  return book.chapters.filter(chapter => options.scope === 'all' || options.scope === 'current' && chapter.id === activeId || options.scope === 'selected' && options.selectedIds.includes(chapter.id)
    || options.scope === 'volume' && (chapter.volumeId ?? '') === options.volumeId);
}
export function safeExportName(name: string): string {
  let value = [...name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').normalize('NFC')].slice(0, 120).join('').trim().replace(/[. ]+$/, '') || '未命名';
  if (/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(value)) value = '_' + value;
  return value;
}
export function exportFilename(book: Book, chapter: ChapterMeta, options: ExportOptions) {
  if (!options.template.trim() || /[\\/:*?"<>|\u0000-\u001f]/.test(options.template)) throw Error('文件名模板不能为空，也不能包含路径或非法字符');
  const tokens: Record<string, string> = { book: book.title, volume: book.volumes?.find(volume => volume.id === chapter.volumeId)?.title ?? '未分卷', index: String(chapter.index + 1).padStart(3, '0'), chapter: chapter.title };
  const syntax = options.template.replace(/\{([^{}]+)\}/g, (_all, key: string) => { if (!(key in tokens)) throw Error('不支持的模板变量：' + key); return ''; });
  if (/[{}]/.test(syntax)) throw Error('模板花括号不完整');
  const replaced = options.template.replace(/\{([^{}]+)\}/g, (_all, key: string) => { if (!(key in tokens)) throw Error('不支持的模板变量：' + key); return tokens[key]; });
  return safeExportName(replaced) + '.' + options.format;
}
export function withoutScenes(doc: JsonValue): JsonValue {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  if (doc.type === 'sceneMark') return null;
  const content = Array.isArray(doc.content) ? doc.content.map(withoutScenes).filter(node => node !== null) : undefined;
  return { ...doc, ...(content ? { content } : {}) };
}
export async function composeExportPlan(book: Book, options: ExportOptions, activeId: string | null, load: (id: string) => Promise<JsonValue>) {
  const chapters = exportRange(book, options, activeId); if (!chapters.length) throw Error('所选范围没有章节');
  const names = chapters.map(chapter => exportFilename(book, chapter, options));
  if (options.split && new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) throw Error('模板生成了重名文件，请加入 {index} 等变量');
  const parts: string[] = new Array(chapters.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, chapters.length) }, async () => {
    while (cursor < chapters.length) {
      const index = cursor++, chapter = chapters[index], original = await load(chapter.id), doc = options.includeScenes ? original : withoutScenes(original);
      const text = options.format === 'md' ? docToMarkdown(doc) : docToPlainText(doc);
      const title = `第${chapter.index + 1}章 ${chapter.title}`;
      parts[index] = (options.includeTitles ? (options.format === 'md' ? '## ' : '') + title + '\n\n' : '') + text + '\n';
    }
  }));
  return { chapterIds: chapters.map(chapter => chapter.id), files: options.split ? names.map((name, index) => ({ name, content: parts[index] }))
    : [{ name: safeExportName(book.title + (chapters.length === 1 ? '-' + chapters[0].title : '-选定章节')) + '.' + options.format,
      content: (options.includeTitles ? (options.format === 'md' ? '# ' : '') + book.title + '\n\n' : '') + parts.join('\n') }] };
}
