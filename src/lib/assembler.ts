/**
 * 上下文装配器：AI 动笔前自动带上「作品信息 + 相关设定卡 + 前文」。
 * 原则（继承自织境）：AI 不直接改正文，一切产物走提案卡确认。
 */
import type { Book, ChapterMeta, Character, LoreEntry } from '../types';
import type { AiMessage } from './ai';

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

/** 实体卡 → 紧凑文本行 */
export function entityCardLines(chars: Character[], lore: LoreEntry[], ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids.slice(0, 10)) {
    const c = chars.find((x) => x.id === id);
    if (c) {
      const rel = c.relations
        .map((r) => r.label + chars.find((x) => x.id === r.targetId)?.name)
        .filter((s) => s && !s.endsWith('undefined'))
        .slice(0, 4)
        .join('、');
      out.push(
        clip(
          `· ${c.name}（人物·${c.tier}${c.aliases.length ? '，别名：' + c.aliases.join('/') : ''}）：` +
            [c.profile.gender, c.profile.age, c.profile.occupation].filter(Boolean).join('，') +
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
    }
  }
  return out;
}

export interface AssembleInput {
  book: Book;
  chapter: ChapterMeta;
  /** 本章正文尾部（续写用长一点，改写用短一点） */
  chapterTail: string;
  prevChapterTail?: string;
  prevSynopsis?: string;
  /** 全书滚动摘要（P5）：百万字长跑时的长期记忆 */
  plotSummary?: string;
  /** 本章章纲（P5）：动笔前定下的要点 */
  outline?: string;
  selection?: string;
  /** 相关实体（本章出场） */
  relatedIds: string[];
  kind: AiTaskKind;
  custom?: string;
  targetWords?: number;
}

export function buildAiMessages(input: AssembleInput, chars: Character[], lore: LoreEntry[]): AiMessage[] {
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
  if (input.plotSummary) parts.push('【剧情总览（截至前文）】\n' + input.plotSummary);
  const cards = entityCardLines(chars, lore, input.relatedIds);
  if (cards.length) parts.push('【设定资料】\n' + cards.join('\n'));
  parts.push(`【本章】第${input.chapter.index + 1}章 ${input.chapter.title}${input.chapter.synopsis ? '：' + clip(input.chapter.synopsis, 100) : ''}`);
  if (input.outline) parts.push('【本章章纲（按要点推进情节）】\n' + clip(input.outline, 900));
  if (input.prevSynopsis) parts.push('【上一章梗概】' + clip(input.prevSynopsis, 150));
  if (input.prevChapterTail) parts.push('【上一章结尾】\n' + clip(input.prevChapterTail, 600));
  if (input.chapterTail) parts.push('【本章前文】\n' + clip(input.chapterTail, input.kind === 'continue' ? 2000 : 1200));

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
      parts.push(`【任务】自然接续【本章前文】继续写约 ${n} 字。不要重复已有内容，情节向前推进；写完自然停笔，不要写"（完）"或总结。`);
      break;
  }
  if (input.selection && input.kind !== 'continue') {
    parts.push('【选中文本】\n' + input.selection);
  }

  return [sys, { role: 'user', content: parts.join('\n\n') }];
}
