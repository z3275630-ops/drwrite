import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { countWords, docToPlainText } from '../lib/words';
import type { JsonValue } from '../lib/json';
import { fmtNum } from '../lib/library';

// Immutable ProseMirror documents can share one calculation across both counters.
const counts = new WeakMap<DocumentNode, number>();
function words(editor: Editor | null): number {
  if (!editor) return 0;
  const doc = editor.state.doc;
  let value = counts.get(doc);
  // Use the same serializer as disk statistics, including scene titles and separators.
  if (value === undefined) { value = countWords(docToPlainText(editor.getJSON() as unknown as JsonValue)); counts.set(doc, value); }
  return value;
}
export { words as editorWordCount };
export function LiveWordCount({ editor, saved, footer = false }: { editor: Editor | null; saved?: number; footer?: boolean }) {
  const value = useEditorState({ editor, selector: ({ editor }) => words(editor) }) ?? 0;
  return <>{footer ? '本章 ' : ''}{fmtNum(value)} 字{footer && saved !== undefined && saved !== value ? `（已存 ${fmtNum(saved)}）` : ''}</>;
}
export function EmptyEditorHint({ editor }: { editor: Editor | null }) {
  const empty = useEditorState({ editor, selector: ({ editor }) => editor?.isEmpty ?? true });
  return empty ? <div className="placeholder-hint">落笔无需完美，先写下第一句……</div> : null;
}
export function UndoRedoControls({ editor }: { editor: Editor | null }) {
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    undo: editor?.can().undo() ?? false, redo: editor?.can().redo() ?? false,
  }) });
  return <div className="undo-group">
    <button className="ghost-btn icon-only" title="撤销（Ctrl+Z）" disabled={!state?.undo} onClick={() => editor?.chain().focus().undo().run()}>↶</button>
    <button className="ghost-btn icon-only" title="重做（Ctrl+Y）" disabled={!state?.redo} onClick={() => editor?.chain().focus().redo().run()}>↷</button>
  </div>;
}
