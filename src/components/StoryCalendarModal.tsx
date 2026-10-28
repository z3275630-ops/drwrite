import { ControlGroup } from './Controls';
import { useState } from 'react';
import type { TimelineEvent } from '../types';
import { compareStoryTime, formatStoryTime, storySections, validateStoryTime, type StoryTime } from '../lib/storyTime';
import { Modal } from './Modal';
function TimeFields({ value, onChange, label }: { value?: StoryTime; onChange: (value?: StoryTime) => void; label: string }) {
  return <ControlGroup><legend>{label}</legend><label><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? { calendar: '天启历', year: 1 } : undefined)} />设置{label}</label>
    {value && <div className="form-grid"><label className="field">历法名称<input value={value.calendar} onChange={event => onChange({ ...value, calendar: event.target.value })} /></label>
      {(['year', 'month', 'day', 'order'] as const).map((field, index) => <label key={field} className="field">{['年（必填）', '月（可选）', '日（可选）', '排序号（可选）'][index]}<input type="number" value={value[field] ?? ''} onChange={event => onChange({ ...value, [field]: event.target.value === '' ? field === 'year' ? NaN : undefined : Number(event.target.value) })} /></label>)}
    </div>}</ControlGroup>;
}
export function StoryCalendarModal({ events, onSave, onJump, onClose }: {
  events: TimelineEvent[]; onSave: (event: TimelineEvent) => Promise<void>; onJump: (id: string, blockIndex?: number, sceneId?: string) => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState<TimelineEvent | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (!editing || busy) return;
    const invalid = validateStoryTime(editing.storyTime) ?? validateStoryTime(editing.endTime);
    const order = editing.storyTime && editing.endTime ? compareStoryTime(editing.storyTime, editing.endTime) : null;
    if (invalid || (order !== null && order > 0)) { setError(invalid ?? '结束时间不能早于开始时间'); return; }
    if (editing.endTime && !editing.storyTime) { setError('设置结束时间前请先设置开始时间'); return; }
    setBusy(true); try { await onSave(editing); setEditing(null); setError(''); } catch (reason) { setError('未保存，修改仍保留：' + String(reason)); } finally { setBusy(false); }
  };
  return <Modal title="故事时间轴 · 虚构历法" description="为已有事件补充故事日期，支持你自己的历法。" className="story-calendar-modal" width={760} onClose={onClose} busy={busy || !!editing}
    footer={<><span className="footer-caption">不同历法分别展示</span><div className="footer-actions">{editing ? <><button className="ghost-btn" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>取消修改</button><button className="primary-btn" disabled={busy} onClick={() => void save()}>保存时间</button></> : <button className="ghost-btn" onClick={onClose}>关闭</button>}</div></>}>
    <p className="hint-text">沿用已有事件，只补故事时间。支持负数年份、十三月等虚构日期；不同历法分组，不自动换算。日期不完整时按原事件顺序展示，也可统一填写排序号。</p>
    {error && <p role="alert">{error}</p>}
    {editing ? <><h3>{editing.title}</h3><TimeFields label="开始时间" value={editing.storyTime} onChange={storyTime => setEditing({ ...editing, storyTime })} /><TimeFields label="结束时间" value={editing.endTime} onChange={endTime => setEditing({ ...editing, endTime })} />
</> : <>
      {!events.length && <p>还没有事件。先到左侧“结构 → 时间线”添加事件，再来设置故事时间。</p>}
      {storySections(events).map(group => <section key={group.calendar}><h3>{group.calendar}</h3><small>{group.sorted ? '按故事时间排列' : '信息不全，保留事件顺序'}</small>
        <ol className="story-events">{group.events.map(event => <li key={event.id}><b>{event.title}</b><p>{formatStoryTime(event.storyTime)}{event.endTime ? ' 至 ' + formatStoryTime(event.endTime) : ''}</p>
          <button className="link-btn" onClick={() => setEditing({ ...event })}>编辑故事时间</button>{event.anchor && <button className="link-btn" onClick={() => { onClose(); onJump(event.anchor!.chapterId, event.anchor!.blockIndex, event.anchor!.sceneId); }}>回到章节</button>}</li>)}</ol>
      </section>)}
    </>}
  </Modal>;
}
