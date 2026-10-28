import type { ChapterMeta } from '../types';
export const WORKFLOWS = { unmarked: '未标记', draft: '草稿', review: '待审', revising: '返修', final: '定稿' } as const;
export type ChapterWorkflow = keyof typeof WORKFLOWS;
export function filterChapters(chapters: ChapterMeta[], query: string, workflow: string): ChapterMeta[] {
  const q = query.trim().toLocaleLowerCase();
  return chapters.filter(chapter => (!q || chapter.title.toLocaleLowerCase().includes(q))
    && (workflow === 'all' || (chapter.workflow ?? 'unmarked') === workflow));
}
