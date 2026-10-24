import { useEffect, useState } from 'react';
import type { Book, Character, LoreEntry } from '../types';
import { docToPlainText } from '../lib/words';
import { readChapter } from '../lib/library';
import { aliasMatch } from '../lib/entities';
import { Modal } from './Modal';
import type { EntityTarget } from './types';

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

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      const out: Result[] = [];
      for (const c of props.chars) {
        if (aliasMatch(c.name, c.aliases, q)) out.push({ kind: 'character', id: c.id, name: c.name, sub: `人物 · ${c.tier}` });
      }
      for (const l of props.lore) {
        if (aliasMatch(l.name, l.aliases, q)) out.push({ kind: 'lore', id: l.id, name: l.name, sub: `设定 · ${l.category}` });
      }
      const ql = q.toLowerCase();
      for (const meta of props.book.chapters) {
        const file = await readChapter(props.root, props.dirName, meta.id);
        if (!file) continue;
        const text = docToPlainText(file.doc as never);
        const lower = text.toLowerCase();
        const hits: string[] = [];
        let idx = lower.indexOf(ql);
        while (idx !== -1 && hits.length < 3) {
          hits.push(snippet(text, idx, q.length));
          idx = lower.indexOf(ql, idx + q.length);
        }
        if (hits.length) {
          out.push({ kind: 'chapter', chapterId: meta.id, label: `第${meta.index + 1}章 ${meta.title}`, snippets: hits });
        }
      }
      setResults(out);
      setSearching(false);
    }, 260);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, props.chars, props.lore, props.book]);

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
