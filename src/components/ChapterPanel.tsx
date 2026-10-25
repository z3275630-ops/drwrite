import type { Book, Character, Foreshadow, LoreEntry, Prop, RefIndexEntry } from '../types';
import { propHolder } from '../types';
import type { EntityTarget } from './types';
import type { SceneInfo } from '../lib/scenes';
import { sceneLabel } from '../lib/scenes';

/**
 * 本章面板（P6）：右侧常驻，打开书就有内容——
 * 本章场景节拍 / 出场人物·设定·道具 / 待收伏笔 / 章纲与梗概速览。点引用仍然打开检视器。
 */
export default function ChapterPanel(props: {
  book: Book;
  activeIndex: number;
  chars: Character[];
  lore: LoreEntry[];
  propEnts: Prop[];
  refs: RefIndexEntry[];
  foreshadows: Foreshadow[];
  scenes: SceneInfo[];
  onJumpScene: (blockIndex: number) => void;
  onAddScene: () => void;
  onInspect: (t: EntityTarget) => void;
  onOpenOutline: () => void;
  onOpenSynopsis: () => void;
  onJumpChapter: (chapterId: string) => void;
}) {
  const meta = props.book.chapters[props.activeIndex];
  const chapterRefs = props.refs.filter((r) => r.chapterId === meta?.id);
  const uniq = (kind: string) => {
    const seen = new Set<string>();
    const out: { id: string; target: EntityTarget; name: string; sub: string }[] = [];
    for (const r of chapterRefs) {
      if (r.targetType !== kind || seen.has(r.targetId)) continue;
      seen.add(r.targetId);
      if (kind === 'character') {
        const c = props.chars.find((x) => x.id === r.targetId);
        if (c) {
          const state = [...(c.statusLog ?? [])].filter((s) => s.fromChapterIndex <= props.activeIndex).pop()?.label;
          out.push({ id: c.id, target: { kind: 'character', id: c.id }, name: c.name, sub: state ? c.tier + '·' + state : c.tier });
        }
      } else if (kind === 'lore') {
        const l = props.lore.find((x) => x.id === r.targetId);
        if (l) out.push({ id: l.id, target: { kind: 'lore', id: l.id }, name: l.name, sub: l.category });
      } else if (kind === 'prop') {
        const p = props.propEnts.find((x) => x.id === r.targetId);
        if (p) {
          const h = propHolder(p);
          const hn = h ? props.chars.find((c) => c.id === h)?.name : null;
          out.push({ id: p.id, target: { kind: 'prop', id: p.id }, name: p.name, sub: hn ? '持有·' + hn : '道具' });
        }
      }
    }
    return out;
  };
  const charList = uniq('character');
  const loreList = uniq('lore');
  const propList = uniq('prop');

  // 待收伏笔：已埋（含强化）且未回收，且埋设不晚于本章
  const pending = props.foreshadows.filter((f) => {
    if (f.payoffAnchor) return false;
    if (!f.plantAnchors.length) return false;
    return f.plantAnchors.some(
      (a) => (props.book.chapters.find((c) => c.id === a.chapterId)?.index ?? 0) <= props.activeIndex
    );
  });

  const EntityChips = ({ list }: { list: { id: string; target: EntityTarget; name: string; sub: string }[] }) => (
    <div className="chips">
      {list.map((x) => (
        <button key={x.id} className="chip" title={x.sub} onClick={() => props.onInspect(x.target)}>
          {x.name}
          {x.sub && list === charList ? <span className="entity-sub"> {x.sub}</span> : null}
        </button>
      ))}
      {!list.length && <span className="entity-sub">本章还没有关联（正文 @ 或点虚线）</span>}
    </div>
  );

  return (
    <aside className="inspector chapter-panel">
      <div className="inspector-head">
        <span className="inspector-title">本章 · 第{(meta?.index ?? 0) + 1}章</span>
      </div>
      <div className="inspector-body">
        <div className="sec-title first">场景节拍</div>
        {props.scenes.length ? (
          <div className="scene-list">
            {props.scenes.map((s, i) => (
              <button key={s.blockIndex} className="scene-item" onClick={() => props.onJumpScene(s.blockIndex)}>
                <span className="scene-no">{i + 1}</span>
                {sceneLabel(s, i + 1)}
              </button>
            ))}
          </div>
        ) : (
          <div className="entity-sub">
            还没有场景标记
            <button className="link-btn" onClick={props.onAddScene}>
              插入第一个场景
            </button>
          </div>
        )}

        {charList.length > 0 && (
          <>
            <div className="sec-title">出场人物 · {charList.length}</div>
            <EntityChips list={charList} />
          </>
        )}
        {propList.length > 0 && (
          <>
            <div className="sec-title">出场道具 · {propList.length}</div>
            <EntityChips list={propList} />
          </>
        )}
        {loreList.length > 0 && (
          <>
            <div className="sec-title">出场设定 · {loreList.length}</div>
            <EntityChips list={loreList} />
          </>
        )}
        {!chapterRefs.length && <div className="entity-sub" style={{ marginTop: 6 }}>本章还没有任何关联。</div>}

        {pending.length > 0 && (
          <>
            <div className="sec-title">待收伏笔 · {pending.length}</div>
            <div className="chips">
              {pending.slice(0, 8).map((f) => (
                <button
                  key={f.id}
                  className="chip fore-chip"
                  title={f.payoffAnchor ? '' : '埋于 ' + f.plantAnchors.map((a) => '第' + ((props.book.chapters.find((c) => c.id === a.chapterId)?.index ?? 0) + 1) + '章').join('、')}
                  onClick={() => f.plantAnchors[0] && props.onJumpChapter(f.plantAnchors[0].chapterId)}
                >
                  {f.title}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="sec-title">章纲 / 梗概</div>
        <div className="cp-quick">
          <button className="cp-quick-row" onClick={props.onOpenOutline}>
            <span className="cp-k">纲</span>
            <span className="cp-v">{meta?.outline ? meta.outline.split('\n')[0].slice(0, 40) : '未写章纲（点此起草）'}</span>
          </button>
          <button className="cp-quick-row" onClick={props.onOpenSynopsis}>
            <span className="cp-k">概</span>
            <span className="cp-v">{meta?.synopsis ? meta.synopsis.slice(0, 60) : '未写梗概（点此补全）'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
