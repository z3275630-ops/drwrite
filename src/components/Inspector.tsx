import { useState } from 'react';
import type { Book, Character, LoreEntry, RefIndexEntry } from '../types';
import { refChapters } from '../lib/entities';
import { Modal } from './Modal';
import type { EntityTarget } from './types';

export default function Inspector(props: {
  target: EntityTarget;
  chars: Character[];
  lore: LoreEntry[];
  refs: RefIndexEntry[];
  book: Book;
  onClose: () => void;
  onEdit: (e: Character | LoreEntry) => void;
  onDelete: (t: EntityTarget) => void;
  onJumpChapter: (chapterId: string) => void;
  onJumpEntity: (t: EntityTarget) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const character = props.target.kind === 'character' ? props.chars.find((c) => c.id === props.target.id) : undefined;
  const lore = props.target.kind === 'lore' ? props.lore.find((l) => l.id === props.target.id) : undefined;
  const entity = character ?? lore;
  const chapters = refChapters(props.refs, props.target.id);
  const chapterOf = (id: string) => props.book.chapters.find((c) => c.id === id);

  const factionNames = (ids: string[]) =>
    ids.map((fid) => props.lore.find((l) => l.id === fid)?.name).filter(Boolean) as string[];
  const memberNames = (fid: string) => props.chars.filter((c) => c.factionIds.includes(fid));

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-title">
          {character ? '人物' : lore ? '设定' : '检视'}
        </span>
        <button className="icon-btn" onClick={props.onClose} aria-label="关闭检视器">
          ✕
        </button>
      </div>

      {!entity ? (
        <div className="inspector-body">
          <div className="inspector-missing">该条目已被删除。</div>
          {!chapters.length ? null : (
            <>
              <div className="sec-title">正文中残留的引用（{chapters.length} 章）</div>
              <div className="chips">
                {chapters.map((r) => {
                  const ch = chapterOf(r.chapterId);
                  return (
                    <button
                      key={r.chapterId}
                      className="chip"
                      onClick={() => props.onJumpChapter(r.chapterId)}
                    >
                      第{(ch?.index ?? 0) + 1}章
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : character ? (
        <div className="inspector-body">
          <div className="entity-head">
            <span className={`tier-badge t-${character.tier}`}>{character.tier}</span>
            <span className="entity-head-name">{character.name}</span>
          </div>
          {character.aliases.length > 0 && (
            <div className="chips">
              {character.aliases.map((a) => (
                <span key={a} className="chip static">
                  {a}
                </span>
              ))}
            </div>
          )}
          {(character.profile.gender || character.profile.age || character.profile.occupation) && (
            <div className="kv">{[character.profile.gender, character.profile.age, character.profile.occupation].filter(Boolean).join(' · ')}</div>
          )}
          {character.personality && <p className="bio">{character.personality}</p>}
          {character.factionIds.length > 0 && (
            <>
              <div className="sec-title">所属势力</div>
              <div className="chips">
                {factionNames(character.factionIds).map((n) => (
                  <span key={n} className="chip static">
                    {n}
                  </span>
                ))}
              </div>
            </>
          )}
          {character.relations.length > 0 && (
            <>
              <div className="sec-title">关系</div>
              <div className="rel-list">
                {character.relations
                  .filter((r) => props.chars.some((c) => c.id === r.targetId))
                  .map((r, i) => {
                    const other = props.chars.find((c) => c.id === r.targetId);
                    return (
                      <div key={i} className="rel-row">
                        <span className="rel-label">{r.label}</span>
                        <button className="chip" onClick={() => props.onJumpEntity({ kind: 'character', id: r.targetId })}>
                          {other?.name ?? '?'}
                        </button>
                        {r.reverseLabel && <span className="rel-rev">（{r.reverseLabel}）</span>}
                      </div>
                    );
                  })}
              </div>
            </>
          )}
          {character.biography.length > 0 && (
            <>
              <div className="sec-title">经历</div>
              <ul className="bio-list">
                {character.biography.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </>
          )}
          <div className="sec-title">出场 · {chapters.length} 章</div>
          <div className="chips">
            {chapters.map((r) => {
              const ch = chapterOf(r.chapterId);
              return (
                <button key={r.chapterId} className="chip" onClick={() => props.onJumpChapter(r.chapterId)}>
                  第{(ch?.index ?? 0) + 1}章
                </button>
              );
            })}
            {!chapters.length && <span className="entity-sub">正文里还没有关联（可用 @ 或点淡提示关联）</span>}
          </div>
        </div>
      ) : lore ? (
        <div className="inspector-body">
          <div className="entity-head">
            <span className={`cat-badge c-${lore.category}`}>{lore.category}</span>
            <span className="entity-head-name">{lore.name}</span>
          </div>
          {lore.aliases.length > 0 && (
            <div className="chips">
              {lore.aliases.map((a) => (
                <span key={a} className="chip static">
                  {a}
                </span>
              ))}
            </div>
          )}
          {lore.content && <p className="bio">{lore.content}</p>}
          {lore.category === '势力' && (
            <>
              <div className="sec-title">成员 · {memberNames(lore.id).length}</div>
              <div className="chips">
                {memberNames(lore.id).map((m) => (
                  <button key={m.id} className="chip" onClick={() => props.onJumpEntity({ kind: 'character', id: m.id })}>
                    {m.name}
                  </button>
                ))}
                {!memberNames(lore.id).length && <span className="entity-sub">暂无成员（在人物卡上设置归属）</span>}
              </div>
            </>
          )}
          <div className="sec-title">出场 · {chapters.length} 章</div>
          <div className="chips">
            {chapters.map((r) => {
              const ch = chapterOf(r.chapterId);
              return (
                <button key={r.chapterId} className="chip" onClick={() => props.onJumpChapter(r.chapterId)}>
                  第{(ch?.index ?? 0) + 1}章
                </button>
              );
            })}
            {!chapters.length && <span className="entity-sub">正文里还没有关联</span>}
          </div>
        </div>
      ) : null}

      {entity && (
        <div className="inspector-foot">
          <button className="ghost-btn small" onClick={() => setConfirming(true)}>
            删除
          </button>
          <button className="primary-btn slim" onClick={() => props.onEdit(entity)}>
            编辑
          </button>
        </div>
      )}

      {confirming && entity && (
        <Modal title="删除条目" onClose={() => setConfirming(false)}>
          <p className="confirm-text">
            确定删除「{entity.name}」？正文里的关联会保留文字但不再指向任何卡片。
          </p>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setConfirming(false)}>
              取消
            </button>
            <button className="danger-btn" onClick={() => props.onDelete(props.target)}>
              删除
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
