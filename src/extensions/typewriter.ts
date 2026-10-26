/**
 * 打字机滚动（P5）：打字时把光标保持在可视区中上部，长文不用追着光标翻页。
 * 只在文档真正变化（敲字/删字）且编辑器持有焦点时滚动；点击跳转、程序化插入不打扰。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

interface TypewriterOptions {
  /** 每次文档变化后问一下：现在要不要打字机滚动 */
  isEnabled: () => boolean;
}

export const TypewriterExtension = Extension.create<TypewriterOptions>({
  name: 'drwriteTypewriter',

  addOptions() {
    return { isEnabled: () => false };
  },

  addProseMirrorPlugins() {
    const isEnabled = this.options.isEnabled;
    let queued = false;
    return [
      new Plugin({
        key: new PluginKey('drwriteTypewriter'),
        view() {
          return {
            update(view, prevState) {
              if (prevState.doc.eq(view.state.doc)) return; // 文档没变（纯选区/重放）
              if (!view.hasFocus()) return;
              if (!isEnabled()) return;
              if (queued) return;
              queued = true;
              requestAnimationFrame(() => {
                queued = false;
                try {
                  const coords = view.coordsAtPos(view.state.selection.head);
                  const scroller = view.dom.closest('.document-scroll') as HTMLElement | null;
                  if (!scroller) return;
                  const rect = scroller.getBoundingClientRect();
                  const target = rect.top + rect.height * 0.38; // 舒适区：中上部
                  const delta = coords.top - target;
                  // 光标离开舒适区才滚，避免每个字都抖
                  if (delta > 24 || delta < -rect.height * 0.5) {
                    scroller.scrollTop += delta;
                  }
                } catch {
                  /* 坐标拿不到就算了 */
                }
              });
            },
          };
        },
      }),
    ];
  },
});
