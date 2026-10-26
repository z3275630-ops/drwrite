/**
 * 上下文装配器：AI 动笔前自动带上「作品信息 + 相关设定卡 + 前文」。
 * 原则（继承自织境）：AI 不直接改正文，一切产物走提案卡确认。
 */
import type { Book, ChapterMeta, Character, LoreEntry, Prop, Foreshadow } from '../types';
import type { AiMessage } from './ai';
import { propHolder } from '../types';

export type AiTaskKind = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'custom' | 'continue';

export const TASK_LABELS: Record<AiTaskKind, string> = {
  rewrite: '改写',
  expand: '扩写',
  shorten: '缩写',
  polish: '润色',
  custom: '按要求处理',
  continue: '续写',
};

const MAX_CARD_CHARS = 180;

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function recentText(s: string, max: number): string {
  return s.length > max ? '…' + s.slice(-max) : s;
}

/** 实体卡 → 紧凑文本行 */
export function entityCardLines(
  chars: Character[],
  lore: LoreEntry[],
  ids: string[],
  props: Prop[] = [],
  atChapterIndex?: number
): string[] {
  const out: string[] = [];
  for (const id of ids.slice(0, 12)) {
    const c = chars.find((x) => x.id === id);
    if (c) {
      const rel = c.relations
        .map((r) => r.label + chars.find((x) => x.id === r.targetId)?.name)
        .filter((s) => s && !s.endsWith('undefined'))
        .slice(0, 4)
        .join('、');
      // 截至所写章节的状态（如「第40章起：断臂」）
      const state =
        atChapterIndex != null && c.statusLog?.length
          ? [...c.statusLog].filter((s) => s.fromChapterIndex <= atChapterIndex).pop()?.label
          : undefined;
      out.push(
        clip(
          `· ${c.name}（人物·${c.tier}${c.aliases.length ? '，别名：' + c.aliases.join('/') : ''}）：` +
            [c.profile.gender, c.profile.age, c.profile.occupation].filter(Boolean).join('，') +
            (state ? `；现况：${state}` : '') +
            (c.personality ? '；' + clip(c.personality, 60) : '') +
            (rel ? '；关系：' + rel : ''),
          MAX_CARD_CHARS + 60
        )
      );
      continue;
    }
    const l = lore.find((x) => x.id === id);
    if (l) {
      out.push(clip(`· ${l.name}（设定·${l.category}${l.aliases.length ? '，别名：' + l.aliases.join('/') : ''}）：${l.content}`, MAX_CARD_CHARS + 80));
      continue;
    }
    const p = props.find((x) => x.id === id);
    if (p) {
      const holder = propHolder(p);
      const holderName = holder ? chars.find((x) => x.id === holder)?.name : null;
      out.push(
        clip(
          `· ${p.name}（道具${p.aliases.length ? '，别名：' + p.aliases.join('/') : ''}）：${p.content}` +
            (holder === null && p.transfers.length ? '；现况：无人持有' : holderName ? `；当前持有：${holderName}` : ''),
          MAX_CARD_CHARS + 60
        )
      );
    }
  }
  return out;
}

export interface AssembleInput {
  book: Book;
  chapter: ChapterMeta;
  /** 本章正文尾部（续写用长一点，改写用短一点） */
  chapterTail: string;
  /** Nearby text after the selection; excluded from continuation. */
  chapterAfter?: string;
  prevChapterTail?: string;
  prevSynopsis?: string;
  /** 全书滚动摘要（P5）：百万字长跑时的长期记忆 */
  plotSummary?: string;
  /** 本章章纲（P5）：动笔前定下的要点 */
  outline?: string;
  /** 本章场景节拍（P6）：sceneMark 列表 */
  scenes?: { blockIndex: number; title: string }[];
  selection?: string;
  /** 相关实体（本章出场） */
  relatedIds: string[];
  kind: AiTaskKind;
  custom?: string;
  targetWords?: number;
  foreshadows?: Foreshadow[];
}

export interface ContextSource { label: string; text: string }

/** The preview and the actual request consume exactly the same assembled blocks. */
export function buildContextSources(input: AssembleInput, chars: Character[], lore: LoreEntry[], props: Prop[] = []): ContextSource[] {
  const sources: ContextSource[] = [];
  if (input.plotSummary) sources.push({ label: '剧情总览', text: clip(input.plotSummary, 2400) });
  const cards = entityCardLines(chars, lore, input.relatedIds, props, input.chapter.index);
  if (cards.length) sources.push({ label: '相关资料', text: cards.join('\n') });
  if (input.outline) sources.push({ label: '本章章纲', text: clip(input.outline, 900) });
  if (input.scenes?.length) sources.push({ label: '场景标记', text: clip(input.scenes.map((s, i) => `${i + 1}. ${s.title.trim() || '（未命名场景）'}`).join('\n'), 800) });
  const index = (id: string) => input.book.chapters.find((c) => c.id === id)?.index;
  const pending = (input.foreshadows ?? []).filter((f) => {
    const payoff = f.payoffAnchor ? index(f.payoffAnchor.chapterId) : undefined;
    return (payoff == null || payoff > input.chapter.index) && f.plantAnchors.some((a) => {
      const at = index(a.chapterId); return at != null && at <= input.chapter.index;
    });
  }).slice(0, 12);
  if (pending.length) sources.push({ label: '待收伏笔', text: pending.map((f) => '· ' + clip(f.title, 100)).join('\n') });
  if (input.prevSynopsis) sources.push({ label: '上一章梗概', text: clip(input.prevSynopsis, 150) });
  if (input.prevChapterTail) sources.push({ label: '上一章结尾', text: recentText(input.prevChapterTail, 600) });
  if (input.chapterTail) sources.push({ label: input.kind === 'continue' ? '本章前文（最新结尾）' : '选区前文', text: recentText(input.chapterTail, input.kind === 'continue' ? 2000 : 1200) });
  if (input.chapterAfter && input.kind !== 'continue') sources.push({ label: '选区后文', text: clip(input.chapterAfter, 600) });
  return sources;
}

export function buildAiMessages(
  input: AssembleInput,
  chars: Character[],
  lore: LoreEntry[],
  props: Prop[] = []
): AiMessage[] {
  const sys: AiMessage = {
    role: 'system',
    content:
      '你是一位中文长篇小说写作助手。严格遵守：\n' +
      '1. 只输出正文文字本身。不要任何解释、前言、标注、markdown 符号或"好的"之类的应答语。\n' +
      '2. 保持原作的叙述人称、时态、文风与用词习惯。\n' +
      '3. 严格遵守给定的设定资料，不得编造与之冲突的事实；设定没写的地方可以合理发挥。\n' +
      '4. 对话与引号风格跟随原文。\n' +
      '5. 段落之间用空行分隔。',
  };

  const parts: string[] = [];
  parts.push(`【作品】《${input.book.title}》`);
  parts.push(`【本章】第${input.chapter.index + 1}章 ${input.chapter.title}${input.chapter.synopsis ? '：' + clip(input.chapter.synopsis, 100) : ''}`);
  for (const source of buildContextSources(input, chars, lore, props)) parts.push(`【${source.label}】\n${source.text}`);

  const n = input.targetWords ?? 600;
  switch (input.kind) {
    case 'rewrite':
      parts.push(`【任务】对【选中文本】进行改写：在保持情节事实与人物设定完全不变的前提下重新组织语言，可调整句式与节奏。输出替换后的完整文字。`);
      break;
    case 'expand':
      parts.push(`【任务】对【选中文本】进行扩写：保持原意与走向，丰富动作、感官、心理等细节，篇幅约为原文的 1.5～2 倍。输出替换后的完整文字。`);
      break;
    case 'shorten':
      parts.push(`【任务】对【选中文本】进行缩写：压缩到原来的一半左右，必须保留关键情节与信息。输出替换后的完整文字。`);
      break;
    case 'polish':
      parts.push(`【任务】对【选中文本】进行润色：只打磨语言（用词、节奏、错别字），不改变情节、人物与篇幅。输出替换后的完整文字。`);
      break;
    case 'custom':
      parts.push(`【任务】对【选中文本】按以下要求处理：${input.custom ?? ''}。输出替换后的完整文字。`);
      break;
    case 'continue':
      parts.push(`【任务】自然接续【本章前文（最新结尾）】继续写约 ${n} 字，遵守章纲与相关资料。不要重复已有内容，情节向前推进；写完自然停笔，不要写"（完）"或总结。`);
      break;
  }
  if (input.selection && input.kind !== 'continue') {
    parts.push('【选中文本】\n' + input.selection);
  }

  return [sys, { role: 'user', content: parts.join('\n\n') }];
}
