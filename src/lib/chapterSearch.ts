import type { ChapterMeta } from '../types';
/** Bound cache by text size; stale queries may finish IO but cannot publish/cache stale data. */
export class ChapterTextSearch {
  private cache = new Map<string, { version: string; text: string }>();
  private characters = 0;
  private generation = 0;
  invalidate() { this.generation++; }
  clear() { this.invalidate(); this.cache.clear(); this.characters = 0; }
  async search(bookKey: string, chapters: ChapterMeta[], query: string, load: (id: string) => Promise<string>) {
    const generation = ++this.generation;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const hits: { chapterId: string; label: string; snippets: string[]; index: number }[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, chapters.length) }, async () => {
      while (cursor < chapters.length && generation === this.generation) {
        const meta = chapters[cursor++];
        const key = bookKey + '\0' + meta.id;
        const cached = this.cache.get(key);
        const text = cached?.version === meta.updatedAt ? cached.text : await load(meta.id);
        if (generation !== this.generation) return;
        if (cached?.text !== text || cached?.version !== meta.updatedAt) {
          if (cached) { this.characters -= cached.text.length; this.cache.delete(key); }
          this.cache.set(key, { version: meta.updatedAt, text }); this.characters += text.length;
          while (this.characters > 4_000_000 && this.cache.size) {
            const oldest = this.cache.keys().next().value!; this.characters -= this.cache.get(oldest)!.text.length; this.cache.delete(oldest);
          }
        }
        const snippets: string[] = [];
        const lower = text.toLocaleLowerCase(); let from = lower.indexOf(needle);
        while (from >= 0 && snippets.length < 3) {
          snippets.push((from > 20 ? '…' : '') + text.slice(Math.max(0, from - 20), from + needle.length + 45).replace(/\s+/g, ' '));
          from = lower.indexOf(needle, from + needle.length);
        }
        if (snippets.length || meta.title.toLocaleLowerCase().includes(needle)) hits.push({ chapterId: meta.id, label: `第${meta.index + 1}章 ${meta.title}`, snippets, index: meta.index });
      }
    }));
    return generation === this.generation ? hits.sort((a, b) => a.index - b.index) : null;
  }
}
