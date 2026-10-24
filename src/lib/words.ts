/**
 * 字数统计与 Tiptap 文档序列化。
 * 计数口径：CJK 字符逐字计；连续的英文/数字串计 1；空白不计；标点计入（与网文平台口径接近）。
 */
import type { JsonValue } from './json';

export function countWords(text: string): number {
  let cjk = 0;
  let latinRun = 0;
  let inLatinRun = false;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      inLatinRun = false;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // CJK 统一表意文字、扩展A、兼容表意、中文标点等逐字计
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点
      (code >= 0xff00 && code <= 0xffef) || // 全角形式
      (code >= 0x2000 && code <= 0x206f);   // 通用标点（破折号、省略号等）
    if (isCjk) {
      cjk++;
      inLatinRun = false;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      if (!inLatinRun) {
        latinRun++;
        inLatinRun = true;
      }
    } else {
      // 其它符号（半角标点等）计入
      cjk++;
      inLatinRun = false;
    }
  }
  return cjk + latinRun;
}

/* ---------- Tiptap doc → 纯文本 / Markdown ---------- */

interface PMNode {
  type: string;
  content?: PMNode[];
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, JsonValue>;
}

export function docToPlainText(doc: JsonValue): string {
  const blocks = docToBlocks(doc as unknown as PMNode, false);
  return blocks.join('\n');
}

export function docToMarkdown(doc: JsonValue): string {
  const blocks = docToBlocks(doc as unknown as PMNode, true);
  return blocks.join('\n\n');
}

function docToBlocks(node: PMNode, md: boolean): string[] {
  if (!node) return [];
  const out: string[] = [];
  const kids = node.content ?? [];
  for (const child of kids) {
    switch (child.type) {
      case 'heading': {
        const level = Number(child.attrs?.level ?? 2);
        const text = inlineToText(child, md);
        out.push(md ? '#'.repeat(Math.min(level, 6)) + ' ' + text : text);
        break;
      }
      case 'paragraph':
        out.push(inlineToText(child, md));
        break;
      case 'blockquote': {
        const inner = docToBlocks(child, md).join(md ? '\n\n' : '\n');
        if (md) {
          out.push(
            inner
              .split('\n')
              .map((l) => '> ' + l)
              .join('\n')
          );
        } else {
          out.push(inner);
        }
        break;
      }
      case 'codeBlock': {
        const text = (child.content ?? []).map((c) => c.text ?? '').join('');
        out.push(md ? '```\n' + text + '\n```' : text);
        break;
      }
      case 'horizontalRule':
        out.push(md ? '---' : '———');
        break;
      case 'bulletList':
      case 'orderedList': {
        const items = child.content ?? [];
        items.forEach((item, i) => {
          const lines = (item.content ?? [])
            .flatMap((p) => docToBlocks(p, md))
            .join(' ');
          const prefix = child.type === 'orderedList' ? `${i + 1}. ` : '- ';
          out.push(prefix + lines);
        });
        break;
      }
      default: {
        // 未知块级节点：尝试递归提取文本，保底空段
        const inner = docToBlocks(child, md);
        if (inner.length) out.push(...inner);
        break;
      }
    }
  }
  return out;
}

function inlineToText(node: PMNode, md: boolean): string {
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    if (child.text != null) {
      let t = child.text;
      if (md) {
        const marks = new Set((child.marks ?? []).map((m) => m.type));
        if (marks.has('code')) t = '`' + t + '`';
        else {
          if (marks.has('bold')) t = '**' + t + '**';
          if (marks.has('italic')) t = '*' + t + '*';
          if (marks.has('strike')) t = '~~' + t + '~~';
        }
      }
      parts.push(t);
    } else if (child.type === 'hardBreak') {
      parts.push('\n');
    } else if (child.content) {
      parts.push(inlineToText(child, md));
    }
  }
  return parts.join('');
}
