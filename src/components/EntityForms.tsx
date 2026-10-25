import { useState } from 'react';
import type { Character, CharacterTier, LoreCategory, LoreEntry, Prop } from '../types';
import { propHolder } from '../types';
import { TIERS, LORE_CATEGORIES } from '../lib/entities';
import { Modal } from './Modal';

/** 别名小输入：回车添加，点 × 移除 */
export function ChipsInput(props: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !props.value.includes(t)) props.onChange([...props.value, t]);
    setDraft('');
  };
  return (
    <div className="chips-input">
      {props.value.map((a) => (
        <span key={a} className="chip static">
          {a}
          <button className="chip-x" onClick={() => props.onChange(props.value.filter((x) => x !== a))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={props.placeholder ?? '输入后回车'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

interface RelationRow {
  targetId: string;
  label: string;
  reverseLabel: string;
}

export function CharacterFormModal(props: {
  initial: Character;
  chars: Character[];
  lore: LoreEntry[];
  onSave: (c: Character) => void;
  onClose: () => void;
}) {
  const [c, setC] = useState<Character>({ ...props.initial, relations: [...props.initial.relations] });
  const [relDraft, setRelDraft] = useState<RelationRow>({ targetId: '', label: '', reverseLabel: '' });
  const [stChap, setStChap] = useState('');
  const [stLabel, setStLabel] = useState('');
  const factions = props.lore.filter((l) => l.category === '势力');
  const others = props.chars.filter((x) => x.id !== c.id);
  const set = (patch: Partial<Character>) => setC((prev) => ({ ...prev, ...patch }));

  const addRelation = () => {
    if (relDraft.targetId && relDraft.label.trim()) {
      set({ relations: [...c.relations, { targetId: relDraft.targetId, label: relDraft.label.trim(), reverseLabel: relDraft.reverseLabel.trim() || undefined }] });
      setRelDraft({ targetId: '', label: '', reverseLabel: '' });
    }
  };

  const statusLog = [...(c.statusLog ?? [])].sort((a, b) => a.fromChapterIndex - b.fromChapterIndex);
  const addStatus = () => {
    const idx = Number(stChap);
    const label = stLabel.trim();
    if (!label || !Number.isFinite(idx) || stChap === '') return;
    set({ statusLog: [...statusLog, { fromChapterIndex: Math.max(0, idx - 1), label }] });
    setStChap('');
    setStLabel('');
  };

  return (
    <Modal title={props.initial.name ? '编辑人物' : '新建人物'} width={560} onClose={props.onClose}>
      <div className="form-grid">
        <label className="field">
          <span>姓名 *</span>
          <input autoFocus value={c.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>层级</span>
          <select value={c.tier} onChange={(e) => set({ tier: e.target.value as CharacterTier })}>
            {TIERS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>别名 / 称号（检索与正文识别都会命中）</span>
        <ChipsInput value={c.aliases} onChange={(aliases) => set({ aliases })} />
      </label>
      <div className="form-grid three">
        <label className="field">
          <span>性别</span>
          <input value={c.profile.gender ?? ''} onChange={(e) => set({ profile: { ...c.profile, gender: e.target.value } })} />
        </label>
        <label className="field">
          <span>年龄</span>
          <input value={c.profile.age ?? ''} onChange={(e) => set({ profile: { ...c.profile, age: e.target.value } })} />
        </label>
        <label className="field">
          <span>职业</span>
          <input value={c.profile.occupation ?? ''} onChange={(e) => set({ profile: { ...c.profile, occupation: e.target.value } })} />
        </label>
      </div>
      <label className="field">
        <span>性格</span>
        <textarea rows={2} value={c.personality ?? ''} onChange={(e) => set({ personality: e.target.value })} />
      </label>
      {factions.length > 0 && (
        <label className="field">
          <span>所属势力（可多选；势力词条在「设定」里建）</span>
          <div className="chips">
            {factions.map((f) => {
              const on = c.factionIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  className={'chip toggle' + (on ? ' on' : '')}
                  onClick={() => set({ factionIds: on ? c.factionIds.filter((x) => x !== f.id) : [...c.factionIds, f.id] })}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        </label>
      )}
      <label className="field">
        <span>经历（一行一条）</span>
        <textarea
          rows={3}
          value={c.biography.join('\n')}
          onChange={(e) => set({ biography: e.target.value.split('\n').filter((x) => x.trim()) })}
        />
      </label>

      <div className="field">
        <span>状态演变（人物随剧情变化：从第几章起是什么状态，如「断臂」「成为宗主」）</span>
        <div className="rel-list">
          {statusLog.map((s, i) => (
            <div key={i} className="rel-edit-row">
              <span className="rel-label">第{s.fromChapterIndex + 1}章起</span>
              <span className="entity-name">{s.label}</span>
              <button
                className="chip-x"
                onClick={() => set({ statusLog: statusLog.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <div className="rel-edit-add">
            <input
              style={{ maxWidth: 90 }}
              inputMode="numeric"
              placeholder="第几章"
              value={stChap}
              onChange={(e) => setStChap(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addStatus()}
            />
            <input
              placeholder="状态（如 断臂/黑化/成为宗主）"
              value={stLabel}
              onChange={(e) => setStLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStatus()}
            />
            <button className="ghost-btn small" onClick={addStatus}>
              添加
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        <span>关系（从本卡指向对方；如「师徒」，反向可写「师徒」）</span>
        <div className="rel-list">
          {c.relations
            .filter((r) => props.chars.some((x) => x.id === r.targetId))
            .map((r, i) => {
              const other = props.chars.find((x) => x.id === r.targetId);
              return (
                <div key={i} className="rel-edit-row">
                  <span className="rel-label">{r.label}</span>
                  <span className="rel-arrow">→</span>
                  <span className="entity-name">{other?.name}</span>
                  {r.reverseLabel && <span className="rel-rev">（对方称：{r.reverseLabel}）</span>}
                  <button className="chip-x" onClick={() => set({ relations: c.relations.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              );
            })}
          {others.length > 0 && (
            <div className="rel-edit-add">
              <select value={relDraft.targetId} onChange={(e) => setRelDraft({ ...relDraft, targetId: e.target.value })}>
                <option value="">选择人物…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="关系（如 师徒/宿敌）"
                value={relDraft.label}
                onChange={(e) => setRelDraft({ ...relDraft, label: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addRelation()}
              />
              <input
                placeholder="反向称呼（可空）"
                value={relDraft.reverseLabel}
                onChange={(e) => setRelDraft({ ...relDraft, reverseLabel: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addRelation()}
              />
              <button className="ghost-btn small" onClick={addRelation}>
                添加
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="modal-actions">
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button className="primary-btn" disabled={!c.name.trim()} onClick={() => props.onSave({ ...c, name: c.name.trim() })}>
          保存
        </button>
      </div>
    </Modal>
  );
}

export function LoreFormModal(props: {
  initial: LoreEntry;
  onSave: (l: LoreEntry) => void;
  onClose: () => void;
}) {
  const [l, setL] = useState<LoreEntry>({ ...props.initial });
  const set = (patch: Partial<LoreEntry>) => setL((prev) => ({ ...prev, ...patch }));

  return (
    <Modal title={props.initial.name ? '编辑设定' : '新建设定'} width={540} onClose={props.onClose}>
      <div className="form-grid">
        <label className="field">
          <span>名称 *</span>
          <input autoFocus value={l.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>分类</span>
          <select value={l.category} onChange={(e) => set({ category: e.target.value as LoreCategory })}>
            {LORE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>别名 / 简称</span>
        <ChipsInput value={l.aliases} onChange={(aliases) => set({ aliases })} />
      </label>
      <label className="field">
        <span>内容（这条设定是什么、代价与边界……AI 续写时会带着它）</span>
        <textarea rows={7} value={l.content} onChange={(e) => set({ content: e.target.value })} />
      </label>
      <div className="modal-actions">
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button className="primary-btn" disabled={!l.name.trim()} onClick={() => props.onSave({ ...l, name: l.name.trim() })}>
          保存
        </button>
      </div>
    </Modal>
  );
}

/* ---------- 道具表单（P6） ---------- */

export function PropFormModal(props: {
  initial: Prop;
  chars: Character[];
  chapters: { id: string; index: number; title: string }[];
  activeChapterIndex?: number;
  onSave: (p: Prop) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<Prop>({ ...props.initial, transfers: [...props.initial.transfers] });
  const set = (patch: Partial<Prop>) => setP((prev) => ({ ...prev, ...patch }));
  const [tChap, setTChap] = useState('');
  const [tHolder, setTHolder] = useState('');
  const [tNote, setTNote] = useState('');

  const sorted = [...p.transfers].sort(
    (a, b) => (props.chapters.find((c) => c.id === a.chapterId)?.index ?? 0) - (props.chapters.find((c) => c.id === b.chapterId)?.index ?? 0)
  );
  const holder = propHolder(p);
  const holderName = holder ? props.chars.find((c) => c.id === holder)?.name : null;

  const addTransfer = () => {
    const chapterId = tChap || props.chapters[props.activeChapterIndex ?? 0]?.id;
    if (!chapterId) return;
    set({
      transfers: [
        ...p.transfers,
        { chapterId, holderId: tHolder || null, note: tNote.trim() || undefined },
      ],
    });
    setTChap('');
    setTHolder('');
    setTNote('');
  };

  return (
    <Modal title={props.initial.name ? '编辑道具' : '新建道具'} width={560} onClose={props.onClose}>
      <label className="field">
        <span>名称 *</span>
        <input autoFocus value={p.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>别名 / 别称</span>
        <ChipsInput value={p.aliases} onChange={(aliases) => set({ aliases })} />
      </label>
      <label className="field">
        <span>说明（是什么、能力与代价……AI 续写时会带着它）</span>
        <textarea rows={4} value={p.content} onChange={(e) => set({ content: e.target.value })} />
      </label>

      <div className="field">
        <span>
          流转历史（从上到下即时间顺序；当前持有人 = 最后一条
          {holderName ? `：${holderName}` : p.transfers.length ? '：无人持有' : '：未记录'})
        </span>
        <div className="rel-list">
          {sorted.map((t, i) => {
            const ch = props.chapters.find((c) => c.id === t.chapterId);
            const who = t.holderId ? props.chars.find((c) => c.id === t.holderId)?.name ?? '？' : '无人持有';
            return (
              <div key={i} className="rel-edit-row">
                <span className="rel-label">第{(ch?.index ?? 0) + 1}章</span>
                <span className="rel-arrow">→</span>
                <span className="entity-name">{who}</span>
                {t.note && <span className="rel-rev">（{t.note}）</span>}
                <button className="chip-x" onClick={() => set({ transfers: p.transfers.filter((x) => x !== t) })}>
                  ×
                </button>
              </div>
            );
          })}
          <div className="rel-edit-add">
            <select value={tChap} onChange={(e) => setTChap(e.target.value)}>
              <option value="">本章</option>
              {props.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  第{c.index + 1}章
                </option>
              ))}
            </select>
            <select value={tHolder} onChange={(e) => setTHolder(e.target.value)}>
              <option value="">无人持有</option>
              {props.chars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              placeholder="备注（如 夺得/赠予，可空）"
              value={tNote}
              onChange={(e) => setTNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTransfer()}
            />
            <button className="ghost-btn small" onClick={addTransfer}>
              记一笔
            </button>
          </div>
        </div>
      </div>

      <div className="modal-actions">
        <button className="ghost-btn" onClick={props.onClose}>
          取消
        </button>
        <button className="primary-btn" disabled={!p.name.trim()} onClick={() => props.onSave({ ...p, name: p.name.trim() })}>
          保存
        </button>
      </div>
    </Modal>
  );
}
