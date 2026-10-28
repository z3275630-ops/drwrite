import { useEffect, useRef, useState } from 'react';
import type { Book, Character, LoreEntry } from '../types';
import { docToPlainText } from '../lib/words';
import { readChapter } from '../lib/library';
import { aliasMatch } from '../lib/entities';
import { Modal } from './Modal';
import type { EntityTarget } from './types';
import { ChapterTextSearch } from '../lib/chapterSearch';

type Result =
  | { kind: 'character' | 'lore'; name: string; sub: string; id: string }
  | { kind: 'chapter'; chapterId: string; label: string; snippets: string[] };

function snippet(text: string, idx: number, qLen: number): string {
  const from = Math.max(0, idx - 16);
  const to = Math.min(text.length, idx + qLen + 22);
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
}

export default function SearchModal(props: {
  root: string;
  dirName: string;
  book: Book;
  chars: Character[];
  lore: LoreEntry[];
  onClose: () => void;
  onJumpChapter: (chapterId: string) => void;
  onInspect: (t: EntityTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const engine = useRef(new ChapterTextSearch()).current;

  useEffect(() => {
    engine.invalidate();
    let alive = true;
    const q = query.trim();
    setError(''); setResults([]);
    if (!q) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
      const out: Result[] = [];
      for (const c of props.chars) {
        if (aliasMatch(c.name, c.aliases, q)) out.push({ kind: 'character', id: c.id, name: c.name, sub: `人物 · ${c.tier}` });
      }
      for (const l of props.lore) {
        if (aliasMatch(l.name, l.aliases, q)) out.push({ kind: 'lore', id: l.id, name: l.name, sub: `设定 · ${l.category}` });
      }
      const chapterHits = await engine.search(props.root + '/' + props.dirName, props.book.chapters, q, async id => {
        const file = await readChapter(props.root, props.dirName, id);
        if (!file) throw Error('章节无法读取：' + (props.book.chapters.find(chapter => chapter.id === id)?.title ?? id));
        return docToPlainText(file.doc as never);
      });
      if (alive && chapterHits) { setResults([...out, ...chapterHits.map(hit => ({ ...hit, kind: 'chapter' as const }))]); setSearching(false); }
      } catch (reason) { if (alive) { setError(String(reason)); setSearching(false); } }
    }, 260);
    return () => { alive = false; window.clearTimeout(t); engine.invalidate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, props.chars, props.lore, props.book, props.root, props.dirName, retry, engine]);

  return (
    <Modal title="全书搜索" width={600} onClose={props.onClose}>
      <input
        className="search-input"
        autoFocus
        placeholder="搜正文、人物、设定（含别名）…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="search-results">
        {error && <p role="alert">{error} <button className="link-btn" onClick={() => setRetry(value => value + 1)}>重试读取</button></p>}
        {!query && <div className="entity-empty">输入关键词，正文与资料一起搜</div>}
        {query && searching && <div className="entity-empty">搜索中…</div>}
        {query && !searching && !results.length && <div className="entity-empty">没有找到「{query}」</div>}
        {results.map((r, i) =>
          r.kind === 'chapter' ? (
            <button key={i} className="search-hit" onClick={() => props.onJumpChapter(r.chapterId)}>
              <div className="search-hit-head">
                <span className="cat-badge c-事件">章节</span>
                {r.label}
              </div>
              {r.snippets.map((s, j) => (
                <div key={j} className="search-snippet">
                  {s}
                </div>
              ))}
            </button>
          ) : (
            <button
              key={i}
              className="search-hit"
              onClick={() => props.onInspect({ kind: r.kind, id: r.id })}
            >
              <div className="search-hit-head">
                <span className={r.kind === 'character' ? 'tier-badge t-配角' : 'cat-badge c-术语'}>
                  {r.kind === 'character' ? '人物' : '设定'}
                </span>
                {r.name}
                <span className="entity-sub">{r.sub}</span>
              </div>
            </button>
          )
        )}
      </div>
    </Modal>
  );
}
