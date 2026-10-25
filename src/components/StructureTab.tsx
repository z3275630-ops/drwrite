import { useState } from 'react';
import type { Book, Character, Foreshadow, LoreEntry, TimelineEvent } from '../types';
import type { TimelineData } from '../lib/structure';
import * as st from '../lib/structure';
import { relTime } from '../lib/library';
import { Modal } from './Modal';
import { toast } from './Toast';

interface AnchorSel {
  chapterId: string;
  blockIndex?: number;
}

export default function StructureTab(props: {
  book: Book;
  timeline: TimelineData;
  foreshadows: Foreshadow[];
  chars: Character[];
  lore: LoreEntry[];
  onTimelineChange: (t: TimelineData) => void;
  onForeshadowsChange: (f: Foreshadow[]) => void;
  onJumpChapter: (id: string) => void;
  onConsistencyCheck: () => void;
  aiReady: boolean;
  /** AI 汇总更新剧情总览（失败在 Editor 侧提示） */
  onGenerateSummary: () => Promise<void>;
  /** 手动保存总览文本 */
  onSaveSummary: (text: string) => void;
  /** 为缺梗概的章节批量生成，onProgress 汇报进度 */
  onFillSynopses: (onProgress: (done: number, total: number) => void) => Promise<void>;
}) {
  const [sub, setSub] = useState<'timeline' | 'foreshadow'>('timeline');
  const [laneId, setLaneId] = useState(props.timeline.lanes[0]?.id ?? '');
  const [addingLane, setAddingLane] = useState(false);
  const [laneDraft, setLaneDraft] = useState('');
  const [editEvent, setEditEvent] = useState<TimelineEvent | null>(null);
  const [editFore, setEditFore] = useState<Foreshadow | null>(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [sumEdit, setSumEdit] = useState<string | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [fillProgress, setFillProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmFill, setConfirmFill] = useState(false);

  const chapters = props.book.chapters;
  const chapterLabel = (id?: string | null) => {
    if (!id) return '';
    const c = chapters.find((x) => x.id === id);
    return c ? `第${c.index + 1}章` : '';
  };
  const chapterFull = (id?: string | null) => {
    if (!id) return '';
    const c = chapters.find((x) => x.id === id);
    return c ? `第${c.index + 1}章 ${c.title}` : '';
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

  return (
    <div className="entity-pane">
      <div className="plot-card">
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

      <div className="struct-switch">
        <button className={sub === 'timeline' ? 'on' : ''} onClick={() => setSub('timeline')}>
          时间线
        </button>
        <button className={sub === 'foreshadow' ? 'on' : ''} onClick={() => setSub('foreshadow')}>
          伏笔{props.foreshadows.length ? ` ${props.foreshadows.length}` : ''}
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
              <div key={e.id} className="struct-item" onClick={() => setEditEvent(e)}>
                <span className="struct-anch">
                  {e.anchor ? chapterLabel(e.anchor.chapterId) : '—'}
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
      ) : (
        <>
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
      )}

      {/* 事件编辑 */}
      {editEvent && (
        <EventModal
          ev={editEvent}
          timeline={props.timeline}
          book={props.book}
          chars={props.chars}
          lore={props.lore}
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

/* ---------- 事件编辑弹窗 ---------- */

function EventModal(props: {
  ev: TimelineEvent;
  timeline: TimelineData;
  book: Book;
  chars: Character[];
  lore: LoreEntry[];
  onSave: (e: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [ev, setEv] = useState<TimelineEvent>({ ...props.ev, relatedEntityIds: [...props.ev.relatedEntityIds] });
  const chapters = props.book.chapters;

  return (
    <Modal title={props.ev.title ? '编辑事件' : '新事件'} onClose={props.onClose}>
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
