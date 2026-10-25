/**
 * 场景分隔线（P6）：正文中一条可命名的横线，代表一个场景的开始。
 * 时间线/伏笔锚点、本章面板、AI 续写的场景节拍都基于它。
 * 插入用 editor.commands.insertContent({type:'sceneMark',attrs:{title}})；双击改名由 Editor 处理。
 */
import { Node, mergeAttributes } from '@tiptap/core';

export const SceneMark = Node.create({
  name: 'sceneMark',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-scene]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-scene': '1', class: 'scene-mark' }),
      ['span', { class: 'scene-line' }],
      ['span', { class: 'scene-title' }, title || '场景'],
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-s': () => this.editor.commands.insertContent({ type: this.name, attrs: { title: '' } }),
    };
  },
});


