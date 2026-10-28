import type { Book, Character, Foreshadow, LoreEntry, Prop, RefIndexEntry } from '../types';
import { propHolder } from '../types';
import type { EntityTarget } from './types';
import type { SceneInfo } from '../lib/scenes';
import { sceneLabel } from '../lib/scenes';
import { InlineDraft, type DraftRegistrar } from './InlineDraft';

/**
 * 当前章工作台：写作计划 / 场景 / 关联资料 / 待收提醒 / 写后回顾。
 * 全书资料与结构在左侧管理；这里仅引用同一份资料，点名称打开检视器。
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
  onSaveField: (field: 'outline' | 'synopsis', text: string) => Promise<void>;
  onSaveScene: (identity: string, text: string) => Promise<void>;
  onRegisterDraft: DraftRegistrar;
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
        <div className="sec-title first">写作计划</div>
        <div className="cp-explain">章纲：准备写什么</div>
        <InlineDraft id={`outline:${meta.id}`} label="章纲" value={meta.outline ?? ''} onSave={text => props.onSaveField('outline', text)} onRegister={props.onRegisterDraft} onExpand={props.onOpenOutline} />
        <div className="sec-title">场景安排</div>
        {props.scenes.length ? (
          <div className="scene-list">
            {props.scenes.map((s, i) => (
              <div key={s.key ?? s.id ?? s.blockIndex}>
              <button className="scene-item" disabled={s.missing} onClick={() => props.onJumpScene(s.blockIndex)}>
                <span className="scene-no">{i + 1}</span>
                {sceneLabel(s, i + 1)}
              </button>
              {s.missing && <p role="alert">原场景已删除，摘要草稿仍保留。可复制草稿，或取消；不会写到其他场景。</p>}
              <InlineDraft id={`scene:${meta.id}:${s.key ?? s.id}`} label="场景摘要" value={s.summary ?? ''} onSave={text => props.onSaveScene(s.key ?? s.id!, text)} onRegister={props.onRegisterDraft} />
              </div>
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

        <div className="sec-title">本章关联资料</div>
        {charList.length > 0 && (
          <>
            <div className="cp-list-label">人物 · {charList.length}</div>
            <EntityChips list={charList} />
          </>
        )}
        {propList.length > 0 && (
          <>
            <div className="cp-list-label">道具 · {propList.length}</div>
            <EntityChips list={propList} />
          </>
        )}
        {loreList.length > 0 && (
          <>
            <div className="cp-list-label">设定 · {loreList.length}</div>
            <EntityChips list={loreList} />
          </>
        )}
        {!charList.length && !loreList.length && !propList.length && <div className="entity-sub">
          先在左侧建资料卡，再用正文 @ 或姓名虚线确认关联；本章用到的资料会列在这里。
        </div>}

        {pending.length > 0 && (
          <>
            <div className="sec-title">待收提醒 · {pending.length}</div>
            <div className="cp-explain">已埋下、尚未回收的伏笔；点标题回看埋设章节。</div>
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

        <div className="sec-title">写后回顾</div>
        <div className="cp-explain">梗概：已经发生了什么，供后续回看与 AI 参考。</div>
        <div className="cp-quick">
          <InlineDraft id={`synopsis:${meta.id}`} label="梗概" value={meta.synopsis ?? ''} onSave={text => props.onSaveField('synopsis', text)} onRegister={props.onRegisterDraft} onExpand={props.onOpenSynopsis} />
        </div>
      </div>
    </aside>
  );
}
