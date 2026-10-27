/**
 * 正文实体引用的编辑器扩展（学织境的两段式交互）：
 *  1. EntityRefMark —— 显式关联：正文里的高亮引用，存 targetType/targetId/displayText
 *  2. EntityHintExtension —— 识别淡提示：已知实体名在正文里出现时打点状下划线，
 *     点击弹「转为关联」确认，确认后才真正写入 entityRef（识别≠关联）
 */
import { Mark, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { profileStart, profileEnd } from '../lib/performanceProbe';

export const entityRefMarkName = 'entityRef';

export interface EntityRefAttrs {
  targetType: string;
  targetId: string;
  displayText: string;
}

/* ---------- 显式关联标记 ---------- */

export const EntityRefMark = Mark.create({
  name: entityRefMarkName,
  inclusive: false,

  addAttributes() {
    return {
      targetType: { default: 'character' },
      targetId: { default: '' },
      displayText: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-entity-id]',
        getAttrs: (el) => {
          const dom = el as HTMLElement;
          return {
            targetType: dom.getAttribute('data-entity-kind') ?? 'character',
            targetId: dom.getAttribute('data-entity-id') ?? '',
            displayText: dom.getAttribute('data-display-text') ?? dom.textContent ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ mark }) {
    const a = mark.attrs as EntityRefAttrs;
    return [
      'span',
      {
        'data-entity-id': a.targetId,
        'data-entity-kind': a.targetType,
        'data-display-text': a.displayText,
        class: `ent-ref ent-${a.targetType}`,
      },
      0,
    ];
  },
});

/* ---------- 识别淡提示 ---------- */

export interface HintEntity {
  kind: 'character' | 'lore' | 'prop';
  id: string;
  name: string;
  aliases: string[];
}

export interface HintClickInfo {
  entity: HintEntity;
  from: number;
  to: number;
  clientX: number;
  clientY: number;
}

export interface RefClickInfo extends EntityRefAttrs {}

interface HintOptions {
  /** 永远读最新实体表（用 getter 闭包） */
  getEntities: () => HintEntity[];
  /** 点击淡提示 */
  onHintClick: (info: HintClickInfo) => void;
  /** 点击已有引用 */
  onRefClick: (info: RefClickInfo) => void;
}

const hintKey = new PluginKey<DecorationSet>('drwriteEntityHint');

/** 收集一段文本里命中的名字区间（长名优先，跳过重叠） */
function buildHints(state: EditorState, entities: HintEntity[]): DecorationSet {
  const measuring = profileStart();
  const decos: Decoration[] = [];
  const claimed: [number, number][] = [];
  const known = new Set(entities.map(entity => entity.id));
  const names = entities
    .flatMap((e) => [{ ...e, hit: e.name }, ...e.aliases.map((a) => ({ ...e, hit: a }))])
    .filter((x) => x.hit && x.hit.length >= 2) // 单字名误报太多，不提示
    .sort((a, b) => b.hit.length - a.hit.length);

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const reference = node.marks.find(mark => mark.type.name === entityRefMarkName);
    if (reference) {
      if (!known.has(reference.attrs.targetId)) decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'dangling' }));
      return;
    }
    const text = node.text;
    for (const n of names) {
      let idx = text.indexOf(n.hit);
      while (idx !== -1) {
        const from = pos + idx;
        const to = from + n.hit.length;
        const overlap = claimed.some(([cf, ct]) => from < ct && to > cf);
        if (!overlap) {
          claimed.push([from, to]);
          decos.push(
            Decoration.inline(
              from,
              to,
              {
                class: 'ent-hint',
                'data-hint-id': n.id,
                'data-hint-kind': n.kind,
                'data-hint-text': n.hit,
              },
              { entity: { id: n.id, kind: n.kind, text: n.hit } }
            )
          );
        }
        idx = text.indexOf(n.hit, idx + n.hit.length);
      }
    }
  });
  const decorations = DecorationSet.create(state.doc, decos);
  profileEnd('hint-build-ms', measuring);
  return decorations;
}

export const EntityHintExtension = Extension.create<HintOptions>({
  name: 'drwriteEntityHint',

  addOptions() {
    return {
      getEntities: () => [],
      onHintClick: () => {},
      onRefClick: () => {},
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key: hintKey,
        state: {
          init: (_, state) => buildHints(state, opts.getEntities()),
          apply: (tr: Transaction, old: DecorationSet, _: EditorState, newState: EditorState) => {
            if (tr.getMeta('drwriteHintRefresh')) return buildHints(newState, opts.getEntities());
            if (tr.docChanged) return buildHints(newState, opts.getEntities());
            return old;
          },
        },
        props: {
          decorations(s: EditorState) {
            return hintKey.getState(s);
          },
          handleClick: (view, pos, event) => {
            const mouse = event as MouseEvent;
            // 1) 点已有引用 → 打开检视器
            const $pos = view.state.doc.resolve(pos);
            const refMark = $pos.marks().find((m) => m.type.name === entityRefMarkName);
            if (refMark) {
              const a = refMark.attrs as EntityRefAttrs;
              opts.onRefClick({ targetType: a.targetType, targetId: a.targetId, displayText: a.displayText });
              return false; // 光标照常落位
            }
            // 2) 点淡提示 → 询问是否转为关联
            const set = hintKey.getState(view.state);
            if (set) {
              const found = set.find(pos, pos + 1);
              for (const d of found) {
                const meta = (d.spec as { entity?: { id: string; kind: string; text: string } }).entity;
                if (meta && d.from != null && d.to != null) {
                  const kind = meta.kind === 'lore' ? 'lore' : meta.kind === 'prop' ? 'prop' : 'character';
                  const entity: HintEntity = { id: meta.id, kind, name: meta.text, aliases: [] };
                  opts.onHintClick({ entity, from: d.from, to: d.to, clientX: mouse.clientX, clientY: mouse.clientY });
                  return true; // 消费点击，不落光标
                }
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
