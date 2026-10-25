/**
 * 撤销/重做的键盘补充：Tiptap 自带 Ctrl+Z、Ctrl+Shift+Z，
 * 这里补上 WPS/Word 用户习惯的 Ctrl+Y 重做。
 */
import { Extension } from '@tiptap/core';

export const HistoryKeys = Extension.create({
  name: 'drwriteHistoryKeys',

  addKeyboardShortcuts() {
    return {
      'Mod-y': () => this.editor.commands.redo(),
    };
  },
});
