import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Character, ChapterMeta, LoreEntry, RefIndexEntry, CharacterTier, LoreCategory, Volume } from '../types';
import ChapterList from './ChapterList';
import { TIERS, LORE_CATEGORIES, aliasMatch, refChapters } from '../lib/entities';
import type { EntityTarget } from './types';

type Tab = 'chapters' | 'chars' | 'lore' | 'structure';

export default function Sidebar(props: {
  book: { chapters: ChapterMeta[]; volumes?: Volume[] } | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (meta: ChapterMeta) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onSynopsis: (meta: ChapterMeta) => void;
  onOutline: (meta: ChapterMeta) => void;
  onReorder: (dragId: string, targetId: string, pos: 'before' | 'after') => void;
  onDropToVolume: (chapterId: string, volumeId: string | null) => void;
  onAddVolume: (title: string) => void;
  onRenameVolume: (id: string, title: string) => void;
  onDeleteVolume: (id: string) => void;
  chars: Character[];
  lore: LoreEntry[];
  refs: RefIndexEntry[];
  onInspect: (t: EntityTarget) => void;
  onNew: (kind: 'character' | 'lore') => void;
  onOpenGraph: () => void;
  structure?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('chapters');
  const [charQuery, setCharQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'全部' | CharacterTier>('全部');
  const [loreQuery, setLoreQuery] = useState('');
  const [catFilter, setCatFilter] = useState<'全部' | LoreCategory>('全部');

  const chars = props.chars.filter(
    (c) => (tierFilter === '全部' || c.tier === tierFilter) && aliasMatch(c.name, c.aliases, charQuery)
  );
  const lore = props.lore.filter(
    (l) => (catFilter === '全部' || l.category === catFilter) && aliasMatch(l.name, l.aliases, loreQuery)
  );

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button className={tab === 'chapters' ? 'on' : ''} onClick={() => setTab('chapters')}>
          章节
        </button>
        <button className={tab === 'chars' ? 'on' : ''} onClick={() => setTab('chars')}>
          人物{props.chars.length ? ` ${props.chars.length}` : ''}
        </button>
        <button className={tab === 'lore' ? 'on' : ''} onClick={() => setTab('lore')}>
          设定{props.lore.length ? ` ${props.lore.length}` : ''}
        </button>
        <button className={tab === 'structure' ? 'on' : ''} onClick={() => setTab('structure')}>
          结构
        </button>
      </div>

      {tab === 'structure' ? (
        props.structure ?? null
      ) : tab === 'chapters' ? (
        props.book && (
          <ChapterList
            chapters={props.book.chapters}
            volumes={props.book.volumes ?? []}
            activeId={props.activeId}
            onSelect={props.onSelect}
            onAdd={props.onAdd}
            onRename={props.onRename}
            onDelete={props.onDelete}
            onMove={props.onMove}
            onSynopsis={props.onSynopsis}
            onOutline={props.onOutline}
            onReorder={props.onReorder}
            onDropToVolume={props.onDropToVolume}
            onAddVolume={props.onAddVolume}
            onRenameVolume={props.onRenameVolume}
            onDeleteVolume={props.onDeleteVolume}
          />
        )
      ) : tab === 'chars' ? (
        <div className="entity-pane">
          <div className="entity-tools">
            <input
              className="entity-search"
              placeholder="搜名字 / 别名"
              value={charQuery}
              onChange={(e) => setCharQuery(e.target.value)}
            />
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as typeof tierFilter)}>
              <option>全部</option>
              {TIERS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="entity-items">
            {chars.map((c) => (
              <div key={c.id} className="entity-item" onClick={() => props.onInspect({ kind: 'character', id: c.id })}>
                <span className={`tier-badge t-${c.tier}`}>{c.tier}</span>
                <span className="entity-name">{c.name}</span>
                <span className="entity-sub">{refChapters(props.refs, c.id).length} 章</span>
              </div>
            ))}
            {!chars.length && <div className="entity-empty">还没有人物，或没搜到</div>}
          </div>
          <div className="entity-foot">
            <button className="ghost-btn small" onClick={props.onOpenGraph} disabled={props.chars.length < 2}>
              关系图谱
            </button>
            <button className="add-entity" onClick={() => props.onNew('character')}>
              ＋ 新建人物
            </button>
          </div>
        </div>
      ) : (
        <div className="entity-pane">
          <div className="entity-tools">
            <input
              className="entity-search"
              placeholder="搜词条 / 别名"
              value={loreQuery}
              onChange={(e) => setLoreQuery(e.target.value)}
            />
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as typeof catFilter)}>
              <option>全部</option>
              {LORE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="entity-items">
            {lore.map((l) => (
              <div key={l.id} className="entity-item" onClick={() => props.onInspect({ kind: 'lore', id: l.id })}>
                <span className={`cat-badge c-${l.category}`}>{l.category}</span>
                <span className="entity-name">{l.name}</span>
                <span className="entity-sub">{refChapters(props.refs, l.id).length} 章</span>
              </div>
            ))}
            {!lore.length && <div className="entity-empty">还没有设定，或没搜到</div>}
          </div>
          <div className="entity-foot">
            <button className="add-entity" onClick={() => props.onNew('lore')}>
              ＋ 新建设定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
