import { useEffect, useRef, useState } from 'react';
import type { Book, Character, Foreshadow, LoreEntry, TimelineEvent } from '../types';
import type { TimelineData } from '../lib/structure';
import type { SceneInfo } from '../lib/scenes';
import { sceneLabel } from '../lib/scenes';
import * as st from '../lib/structure';
import * as loc from '../lib/locations';
import { relTime } from '../lib/library';
import { Modal } from './Modal';
import { toast } from './Toast';
import type { EntityTarget } from './types';

interface AnchorSel {
  chapterId: string;
  blockIndex?: number;
}

export default function StructureTab(props: {
  focusRequest?: { section: 'timeline' | 'foreshadow' | 'summary'; revision: number } | null;
  book: Book;
  timeline: TimelineData;
  foreshadows: Foreshadow[];
  chars: Character[];
  lore: LoreEntry[];
  root: string;
  dirName: string;
  /** 读某一章的场景列表（时间线/伏笔锚点用） */
  loadScenes: (chapterId: string) => Promise<SceneInfo[]>;
  onTimelineChange: (t: TimelineData) => void;
  onForeshadowsChange: (f: Foreshadow[]) => void;
  onJumpChapter: (chapterId: string, blockIndex?: number) => void;
  onConsistencyCheck: () => void;
  onInspectEntity: (t: EntityTarget) => void;
  aiReady: boolean;
  /** AI 汇总更新剧情总览（失败在 Editor 侧提示） */
  onGenerateSummary: () => Promise<void>;
  /** 手动保存总览文本 */
  onSaveSummary: (text: string) => void;
  /** 为缺梗概的章节批量生成，onProgress 汇报进度 */
  onFillSynopses: (onProgress: (done: number, total: number) => void) => Promise<void>;
}) {
  const [sub, setSub] = useState<'timeline' | 'foreshadow' | 'map'>('timeline');
  const [laneId, setLaneId] = useState(props.timeline.lanes[0]?.id ?? '');
  const [addingLane, setAddingLane] = useState(false);
  const [laneDraft, setLaneDraft] = useState('');
  const [editEvent, setEditEvent] = useState<TimelineEvent | null>(null);
  const [editFore, setEditFore] = useState<Foreshadow | null>(null);
  const [foreView, setForeView] = useState<'board' | 'gantt'>('board');
  const [sumBusy, setSumBusy] = useState(false);
  const [sumEdit, setSumEdit] = useState<string | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [fillProgress, setFillProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmFill, setConfirmFill] = useState(false);
  const [tree, setTree] = useState<loc.LocationTree | null>(null);
  const [nodeEdit, setNodeEdit] = useState<{ id: string; draft: string } | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.focusRequest) return;
    const section = props.focusRequest.section;
    if (section !== 'summary') setSub(section);
    requestAnimationFrame(() => {
      (section === 'summary' ? plotRef : switchRef).current?.scrollIntoView({ block: 'start' });
    });
  }, [props.focusRequest]);

  useEffect(() => {
    void loc.loadLocations(props.root, props.dirName).then(setTree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.root, props.dirName]);

  const chapters = props.book.chapters;
  const chapterLabel = (id?: string | null) => {
    if (!id) return '';
    const c = chapters.find((x) => x.id === id);
    return c ? `第${c.index + 1}章` : '';
  };
  const entityName = (id: string) =>
    props.chars.find((c) => c.id === id)?.name ?? props.lore.find((l) => l.id === id)?.name ?? '';

  /* ---------- 时间线 ---------- */

  const addLane = () => {
    const name = laneDraft.trim();
    if (!name) {
      setAddingLane(false);
      return;
    }
    const lane = { id: crypto.randomUUID(), name };
    props.onTimelineChange({ ...props.timeline, lanes: [...props.timeline.lanes, lane] });
    setLaneId(lane.id);
    setLaneDraft('');
    setAddingLane(false);
  };

  const saveEvent = (ev: TimelineEvent) => {
    const exists = props.timeline.events.some((e) => e.id === ev.id);
    const events = exists
      ? props.timeline.events.map((e) => (e.id === ev.id ? ev : e))
      : [...props.timeline.events, ev];
    props.onTimelineChange({ ...props.timeline, events });
    setEditEvent(null);
  };

  const deleteEvent = (id: string) => {
    props.onTimelineChange({ ...props.timeline, events: props.timeline.events.filter((e) => e.id !== id) });
    setEditEvent(null);
  };

  const laneEvents = st
    .sortEvents(props.timeline.events.filter((e) => e.laneId === laneId), chapters)
    .filter((e) => e.title);

  /* ---------- 伏笔 ---------- */

  const saveFore = (f: Foreshadow) => {
    f.derivedState = st.foreshadowStateOf(f, chapters);
    const exists = props.foreshadows.some((x) => x.id === f.id);
    const list = exists ? props.foreshadows.map((x) => (x.id === f.id ? f : x)) : [...props.foreshadows, f];
    props.onForeshadowsChange(list);
    setEditFore(null);
  };

  const deleteFore = (id: string) => {
    props.onForeshadowsChange(props.foreshadows.filter((x) => x.id !== id));
    setEditFore(null);
  };

  const groups = st.FORESHADOW_ORDER.map((s) => ({
    state: s,
    items: props.foreshadows.filter((f) => st.foreshadowStateOf(f, chapters) === s),
  })).filter((g) => g.items.length);

  /* ---------- 剧情总览 ---------- */

  const summary = props.book.plotSummary ?? '';
  const upto = props.book.plotSummaryUpto ?? 0;
  const hasNew = upto < chapters.length;
  const missingSyn = chapters.filter((c) => c.wordCount > 0 && !c.synopsis).length;

  const generateSummary = async () => {
    setSumBusy(true);
    try {
      await props.onGenerateSummary();
    } finally {
      setSumBusy(false);
    }
  };

  const fillAll = async () => {
    if (!confirmFill) {
      setConfirmFill(true);
      window.setTimeout(() => setConfirmFill(false), 4000);
      return;
    }
    setConfirmFill(false);
    setFillBusy(true);
    try {
      await props.onFillSynopses((done, total) => setFillProgress({ done, total }));
      toast('梗概补全完成');
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'err');
    } finally {
      setFillBusy(false);
      setFillProgress(null);
    }
  };

  /* ---------- 地点树 ---------- */

  const persistTree = (t: loc.LocationTree) => {
    setTree(t);
    void loc.saveLocations(props.root, props.dirName, t);
  };
  const placeLore = props.lore.filter((l) => l.category === '地点');

  const renderTree = (parentId: string | null, depth: number): React.ReactNode =>
    loc.sortedNodes(tree?.nodes ?? [])
      .filter((n) => n.parentId === parentId)
      .map((n) => (
        <div key={n.id}>
          <div className="loc-row" style={{ paddingLeft: depth * 14 }}>
            {n.loreId ? (
              <button
                className="loc-label bound"
                title="打开绑定的地点词条"
                onClick={() => props.onInspectEntity({ kind: 'lore', id: n.loreId! })}
              >
                {n.label}
              </button>
            ) : nodeEdit?.id === n.id ? (
              <input
                className="rename-input"
                autoFocus
                value={nodeEdit.draft}
                onChange={(e) => setNodeEdit({ id: n.id, draft: e.target.value })}
                onBlur={() => {
                  if (nodeEdit.draft.trim()) {
                    persistTree({
                      nodes: (tree?.nodes ?? []).map((x) =>
                        x.id === n.id ? { ...x, label: nodeEdit.draft.trim() } : x
                      ),
                    });
                  }
                  setNodeEdit(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setNodeEdit(null);
                }}
              />
            ) : (
              <span
                className="loc-label"
                title="双击重命名"
                onDoubleClick={() => setNodeEdit({ id: n.id, draft: n.label })}
              >
                {n.label}
              </span>
            )}
            <span className="loc-ops">
              <select
                value={n.loreId ?? ''}
                title="绑定「地点」类设定词条"
                onChange={(e) =>
                  persistTree({
                    nodes: (tree?.nodes ?? []).map((x) =>
                      x.id === n.id ? { ...x, loreId: e.target.value || undefined } : x
                    ),
                  })
                }
              >
                <option value="">未绑定词条</option>
                {placeLore.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button className="op" title="添加下级" onClick={() => persistTree({ nodes: [...(tree?.nodes ?? []), loc.newNode('新地点', n.id)] })}>
                ＋
              </button>
              <button
                className="op danger"
                title="删除（下级上提一级）"
                onClick={() => persistTree({ nodes: loc.removeNode(tree?.nodes ?? [], n.id) })}
              >
                ✕
              </button>
            </span>
          </div>
          {renderTree(n.id, depth + 1)}
        </div>
      ));

  return (
    <div className="entity-pane">
      <div className="plot-card" ref={plotRef}>
        <div className="plot-head">
          <span className="plot-title">剧情总览</span>
          <span className="entity-sub">
            {summary
              ? `已覆盖前 ${upto} 章${props.book.plotSummaryAt ? ' · ' + relTime(props.book.plotSummaryAt) : ''}`
              : '尚未生成'}
          </span>
        </div>
        <div className={'plot-text' + (summary ? '' : ' empty')}>
          {summary
            ? summary.slice(0, 180) + (summary.length > 180 ? '…' : '')
            : '全书的滚动摘要。生成后，AI 续写、章纲、对话都会带着这份「全书记忆」，写到几百万字也忘不了开头埋的线。'}
        </div>
        <div className="plot-actions">
          <button
            className="ghost-btn small"
            disabled={!props.aiReady || sumBusy || !hasNew}
            title={!props.aiReady ? '先配置 AI' : !hasNew ? '总览已覆盖全部章节，写新章后再更新' : ''}
            onClick={() => void generateSummary()}
          >
            {sumBusy ? '汇总中…' : '✦ AI 汇总更新'}
          </button>
          <button
            className="ghost-btn small"
            disabled={!summary}
            onClick={() => setSumEdit(summary)}
          >
            查看 / 编辑
          </button>
          {missingSyn > 0 && (
            <button
              className="ghost-btn small"
              disabled={!props.aiReady || fillBusy}
              title={`有 ${missingSyn} 章写了正文但没有梗概；总览按章节梗概汇总`}
              onClick={() => void fillAll()}
            >
              {fillBusy
                ? `补梗概 ${fillProgress ? fillProgress.done + '/' + fillProgress.total : '…'}`
                : confirmFill
                  ? `确认：共 ${missingSyn} 次AI调用`
                  : `补全缺失梗概（${missingSyn}）`}
            </button>
          )}
        </div>
      </div>

      <div className="struct-switch" ref={switchRef}>
        <button className={sub === 'timeline' ? 'on' : ''} onClick={() => setSub('timeline')}>
          时间线
        </button>
        <button className={sub === 'foreshadow' ? 'on' : ''} onClick={() => setSub('foreshadow')}>
          伏笔{props.foreshadows.length ? ` ${props.foreshadows.length}` : ''}
        </button>
        <button className={sub === 'map' ? 'on' : ''} onClick={() => setSub('map')}>
          地图
        </button>
      </div>

      {sub === 'timeline' ? (
        <>
          <div className="lane-row">
            {props.timeline.lanes.map((l) => (
              <button
                key={l.id}
                className={'chip toggle' + (l.id === laneId ? ' on' : '')}
                onClick={() => setLaneId(l.id)}
              >
                {l.name}
              </button>
            ))}
            {addingLane ? (
              <input
                className="lane-input"
                autoFocus
                value={laneDraft}
                placeholder="线名，回车添加"
                onChange={(e) => setLaneDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLane()}
                onBlur={addLane}
              />
            ) : (
              <button className="chip" onClick={() => setAddingLane(true)}>
                ＋
              </button>
            )}
          </div>
          <div className="entity-items">
            {laneEvents.map((e) => (
              <div
                key={e.id}
                className="struct-item"
                onClick={() => setEditEvent(e)}
                title={e.anchor?.blockIndex != null ? '锚定到场景' : '锚定到章'}
              >
                <span className="struct-anch">
                  {e.anchor ? chapterLabel(e.anchor.chapterId) : '—'}
                  {e.anchor?.blockIndex != null ? '·场' : ''}
                </span>
                <span className="entity-name">{e.title}</span>
                <span className="entity-sub">
                  {e.relatedEntityIds.map(entityName).filter(Boolean).slice(0, 2).join('·')}
                </span>
              </div>
            ))}
            {!laneEvents.length && <div className="entity-empty">这条线上还没有事件</div>}
          </div>
          <div className="entity-foot">
            <button
              className="add-entity"
              onClick={() => setEditEvent(st.newEvent(laneId || props.timeline.lanes[0]?.id || ''))}
            >
              ＋ 新事件
            </button>
          </div>
        </>
      ) : sub === 'foreshadow' ? (
        <>
          <div className="fore-view-switch">
            <button className={foreView === 'board' ? 'on' : ''} onClick={() => setForeView('board')}>
              看板
            </button>
            <button className={foreView === 'gantt' ? 'on' : ''} onClick={() => setForeView('gantt')}>
              跨度
            </button>
          </div>
          {foreView === 'board' ? (
            <div className="entity-items fore-groups">
              {groups.map((g) => (
                <div key={g.state} className="fore-group">
                  <div className="fore-group-head">
                    <span className="fore-dot" style={{ background: st.foreshadowStateColor(g.state) }} />
                    {g.state} · {g.items.length}
                  </div>
                  {g.items.map((f) => (
                    <div key={f.id} className="struct-item" onClick={() => setEditFore(f)}>
                      <span className="entity-name">{f.title}</span>
                      <span className="entity-sub">
                        埋{f.plantAnchors.length ? '·' + f.plantAnchors.map((a) => chapterLabel(a.chapterId)).join(',') : ''}
                        {f.payoffAnchor ? ' 收·' + chapterLabel(f.payoffAnchor.chapterId) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {!groups.length && <div className="entity-empty">还没有伏笔。埋的时候记一笔，回收时勾一笔。</div>}
            </div>
          ) : (
            <div className="entity-items">
              <ForeGantt
                foreshadows={props.foreshadows}
                chapters={chapters}
                onOpen={setEditFore}
                onJump={props.onJumpChapter}
              />
              {!props.foreshadows.length && <div className="entity-empty">还没有伏笔可看跨度</div>}
            </div>
          )}
          <div className="entity-foot">
            <button className="ghost-btn small" onClick={props.onConsistencyCheck}>
              AI 巡检本章
            </button>
            <button
              className="add-entity"
              onClick={() => setEditFore(st.newForeshadow(''))}
            >
              ＋ 新伏笔
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="entity-items loc-tree">
            {tree && tree.nodes.length > 0 ? (
              renderTree(null, 0)
            ) : (
              <div className="entity-empty">世界的层级地图：大陆 → 城市 → 地点，节点可绑定「地点」类设定词条。</div>
            )}
          </div>
          <div className="entity-foot">
            <button
              className="add-entity"
              onClick={() => {
                if (!tree) return;
                persistTree({ nodes: [...tree.nodes, loc.newNode('新大陆', null)] });
              }}
            >
              ＋ 顶级地点
            </button>
          </div>
        </>
      )}

      {/* 事件编辑 */}
      {editEvent && (
        <EventModal
          ev={editEvent}
          timeline={props.timeline}
          book={props.book}
          chars={props.chars}
          lore={props.lore}
          loadScenes={props.loadScenes}
          onSave={saveEvent}
          onDelete={deleteEvent}
          onClose={() => setEditEvent(null)}
        />
      )}

      {/* 伏笔编辑 */}
      {editFore && (
        <ForeModal
          f={editFore}
          book={props.book}
          onSave={saveFore}
          onDelete={deleteFore}
          onClose={() => setEditFore(null)}
        />
      )}

      {/* 剧情总览编辑 */}
      {sumEdit !== null && (
        <Modal title="剧情总览" width={620} onClose={() => setSumEdit(null)}>
          <p className="hint-text">
            全书滚动摘要（500～800 字为宜：主线进展、人物状态、未回收伏笔）。
            AI 续写、章纲、对话都会带着它，可随时手动修订。
          </p>
          <textarea
            className="syn-area"
            rows={12}
            value={sumEdit}
            onChange={(e) => setSumEdit(e.target.value)}
          />
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setSumEdit(null)}>
              取消
            </button>
            <button
              className="primary-btn"
              onClick={() => {
                props.onSaveSummary(sumEdit.trim());
                setSumEdit(null);
                toast('剧情总览已保存');
              }}
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- 伏笔甘特图（P6）：每条伏笔一根横条，一眼看出埋收跨度 ---------- */

function ForeGantt(props: {
  foreshadows: Foreshadow[];
  chapters: { id: string; index: number; title: string }[];
  onOpen: (f: Foreshadow) => void;
  onJump: (chapterId: string) => void;
}) {
  const rows = props.foreshadows.map((f) => {
    const idxOf = (id?: string) => props.chapters.find((c) => c.id === id)?.index;
    const plants = f.plantAnchors.map((a) => idxOf(a.chapterId)).filter((x): x is number => x != null);
    const plant = plants.length ? Math.min(...plants) : null;
    const reinforce = f.reinforceAnchors.map((a) => idxOf(a.chapterId)).filter((x): x is number => x != null);
    const payoff = f.payoffAnchor ? idxOf(f.payoffAnchor.chapterId) : null;
    return { f, plant, payoff, reinforce };
  });

  const N = Math.max(1, props.chapters.length);
  const LEFT = 96;
  const STEP = Math.max(10, Math.min(18, Math.floor(560 / N)));
  const W = LEFT + N * STEP + 16;
  const ROW_H = 26;
  const H = Math.max(80, rows.length * ROW_H + 46);

  const xOf = (i: number) => LEFT + i * STEP;

  return (
    <div className="gantt-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="gantt-svg" style={{ width: Math.min(W, 620) }}>
        {/* 章号刻度：每 5 章 */}
        {Array.from({ length: N }, (_, i) => i)
          .filter((i) => i % 5 === 0)
          .map((i) => (
            <g key={i}>
              <line x1={xOf(i)} y1={22} x2={xOf(i)} y2={H - 20} className="gantt-grid" />
              <text x={xOf(i)} y={14} className="gantt-tick">
                {i + 1}
              </text>
            </g>
          ))}
        {rows.map((r, i) => {
          const y = 34 + i * ROW_H;
          if (r.plant == null) {
            return (
              <text key={r.f.id} x={4} y={y + 12} className="gantt-label muted">
                {r.f.title.slice(0, 7)}（未设伏）
              </text>
            );
          }
          const end = r.payoff ?? N - 1;
          const overdue = !r.payoff && N - 1 - r.plant > 40;
          const cls = r.payoff != null ? 'done' : overdue ? 'over' : 'open';
          return (
            <g
              key={r.f.id}
              className="gantt-row"
              onClick={() => props.onOpen(r.f)}
            >
              <text x={4} y={y + 12} className="gantt-label">
                {r.f.title.slice(0, 7)}
              </text>
              <title>{`${r.f.title}：埋于第${r.plant + 1}章${r.payoff != null ? `，第${r.payoff + 1}章回收` : '，未回收'}`}</title>
              <rect
                x={xOf(r.plant)}
                y={y}
                width={Math.max(6, xOf(end) - xOf(r.plant) + STEP * 0.6)}
                height={12}
                rx={5}
                className={`gantt-bar ${cls}`}
              />
              {r.reinforce.map((ri) => (
                <circle key={ri} cx={xOf(ri) + STEP / 2} cy={y + 6} r={2.6} className="gantt-dot" />
              ))}
              {r.payoff != null && (
                <circle cx={xOf(r.payoff) + STEP / 2} cy={y + 6} r={3.4} className="gantt-dot done" />
              )}
            </g>
          );
        })}
      </svg>
      <p className="hint-text" style={{ marginTop: 6 }}>
        横条 = 从埋设到回收的跨度；圆点 = 中途强化；红色 = 埋伏超过 40 章。点击横条编辑。
      </p>
    </div>
  );
}

/* ---------- 事件编辑弹窗 ---------- */

function EventModal(props: {
  ev: TimelineEvent;
  timeline: TimelineData;
  book: Book;
  chars: Character[];
  lore: LoreEntry[];
  loadScenes: (chapterId: string) => Promise<SceneInfo[]>;
  onSave: (e: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [ev, setEv] = useState<TimelineEvent>({ ...props.ev, relatedEntityIds: [...props.ev.relatedEntityIds] });
  const chapters = props.book.chapters;
  const [scenes, setScenes] = useState<SceneInfo[]>([]);

  useEffect(() => {
    const cid = ev.anchor?.chapterId;
    if (!cid) {
      setScenes([]);
      return;
    }
    void props.loadScenes(cid).then(setScenes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.anchor?.chapterId]);

  const sceneChips = (
    <div className="chips">
      <button
        className={'chip toggle' + (ev.anchor?.blockIndex == null ? ' on' : '')}
        onClick={() => setEv({ ...ev, anchor: ev.anchor ? { chapterId: ev.anchor.chapterId } : ev.anchor })}
      >
        章首
      </button>
      {scenes.map((s, i) => {
        const on = ev.anchor?.blockIndex === s.blockIndex;
        return (
          <button
            key={s.blockIndex}
            className={'chip toggle' + (on ? ' on' : '')}
            onClick={() => setEv({ ...ev, anchor: { chapterId: ev.anchor!.chapterId, blockIndex: s.blockIndex } })}
          >
            ◇ {sceneLabel(s, i + 1)}
          </button>
        );
      })}
      {ev.anchor && !scenes.length && <span className="entity-sub">这一章还没有场景标记</span>}
    </div>
  );

  return (
    <Modal title={props.ev.title ? '编辑事件' : '新事件'} width={520} onClose={props.onClose}>
      <label className="field">
        <span>事件标题 *</span>
        <input autoFocus value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>剧情线</span>
          <select value={ev.laneId} onChange={(e) => setEv({ ...ev, laneId: e.target.value })}>
            {props.timeline.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>发生在哪一章</span>
          <select
            value={ev.anchor?.chapterId ?? ''}
            onChange={(e) => setEv({ ...ev, anchor: e.target.value ? { chapterId: e.target.value } : null })}
          >
            <option value="">（不锚定）</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                第{c.index + 1}章 {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {ev.anchor && (
        <div className="field">
          <span>锚到哪个场景（可选，跳转更准）</span>
          {sceneChips}
        </div>
      )}
      <div className="field">
        <span>相关人物 / 设定</span>
        <div className="chips">
          {[...props.chars.map((c) => ({ id: c.id, name: c.name, sub: '人物' })), ...props.lore.map((l) => ({ id: l.id, name: l.name, sub: '设定' }))].map((x) => {
            const on = ev.relatedEntityIds.includes(x.id);
            return (
              <button
                key={x.id}
                className={'chip toggle' + (on ? ' on' : '')}
                onClick={() =>
                  setEv({
                    ...ev,
                    relatedEntityIds: on
                      ? ev.relatedEntityIds.filter((i) => i !== x.id)
                      : [...ev.relatedEntityIds, x.id],
                  })
                }
              >
                {x.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="modal-actions">
        {props.ev.title && (
          <button className="danger-btn slim" onClick={() => props.onDelete(ev.id)}>
            删除
          </button>
        )}
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button className="primary-btn" disabled={!ev.title.trim()} onClick={() => props.onSave({ ...ev, title: ev.title.trim() })}>
          保存
        </button>
      </div>
    </Modal>
  );
}

/* ---------- 伏笔编辑弹窗 ---------- */

function ForeModal(props: {
  f: Foreshadow;
  book: Book;
  onSave: (f: Foreshadow) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Foreshadow>({
    ...props.f,
    plantAnchors: [...props.f.plantAnchors],
    reinforceAnchors: [...props.f.reinforceAnchors],
  });
  const chapters = props.book.chapters;

  const toggle = (list: AnchorSel[], id: string): AnchorSel[] =>
    list.some((a) => a.chapterId === id) ? list.filter((a) => a.chapterId !== id) : [...list, { chapterId: id }];

  const ChapterChips = (props2: { label: string; list: AnchorSel[]; onToggle: (id: string) => void }) => (
    <div className="field">
      <span>{props2.label}</span>
      <div className="chips">
        {chapters.map((c) => {
          const on = props2.list.some((a) => a.chapterId === c.id);
          return (
            <button key={c.id} className={'chip toggle' + (on ? ' on' : '')} onClick={() => props2.onToggle(c.id)}>
              第{c.index + 1}章
            </button>
          );
        })}
        {!chapters.length && <span className="entity-sub">还没有章节</span>}
      </div>
    </div>
  );

  return (
    <Modal title={props.f.title ? '编辑伏笔' : '新伏笔'} width={520} onClose={props.onClose}>
      <label className="field">
        <span>伏笔标题 *（如：祖传的怀表暗格）</span>
        <input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <ChapterChips label="埋设章节（可多选）" list={f.plantAnchors} onToggle={(id) => setF({ ...f, plantAnchors: toggle(f.plantAnchors, id) })} />
      <ChapterChips
        label="强化章节（中途再提，可多选）"
        list={f.reinforceAnchors}
        onToggle={(id) => setF({ ...f, reinforceAnchors: toggle(f.reinforceAnchors, id) })}
      />
      <label className="field">
        <span>回收章节（选了就是已回收）</span>
        <select
          value={f.payoffAnchor?.chapterId ?? ''}
          onChange={(e) => setF({ ...f, payoffAnchor: e.target.value ? { chapterId: e.target.value } : null })}
        >
          <option value="">（还没回收）</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              第{c.index + 1}章 {c.title}
            </option>
          ))}
        </select>
      </label>
      <div className="modal-actions">
        {props.f.title && (
          <button className="danger-btn slim" onClick={() => props.onDelete(f.id)}>
            删除
          </button>
        )}
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button
          className="primary-btn"
          disabled={!f.title.trim()}
          onClick={() => {
            if (!f.plantAnchors.length && f.payoffAnchor) {
              toast('先选埋设章节', 'err');
              return;
            }
            props.onSave({ ...f, title: f.title.trim() });
          }}
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
