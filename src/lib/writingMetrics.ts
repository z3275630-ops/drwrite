import type { ChapterMeta } from '../types';
export interface WritingSession { startedAt: number; baseline: number; target: number }
export function sessionProgress(session: WritingSession, total: number) {
  const net = total - session.baseline;
  return { net, ratio: session.target > 0 ? Math.max(0, Math.min(1, net / session.target)) : 0 };
}
export function movingAverage(values: number[], size = 5): (number | null)[] {
  const window = Math.max(1, Math.floor(size));
  return values.map((_, index) => index + 1 < window ? null : values.slice(index + 1 - window, index + 1).reduce((a, b) => a + b, 0) / window);
}
export function quotedRatio(text: string): number | null {
  const total = text.replace(/\s/g, '').length; if (!total) return null;
  const quoted = [...text.matchAll(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"/g)]
    .reduce((sum, match) => sum + match[0].slice(1, -1).replace(/\s/g, '').length, 0);
  return Math.min(1, quoted / total);
}
export function bookTotal(chapters: ChapterMeta[], currentId?: string | null, liveWords?: number) {
  return chapters.reduce((sum, chapter) => sum + (chapter.id === currentId && liveWords !== undefined ? liveWords : chapter.wordCount), 0);
}
