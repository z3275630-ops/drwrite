/**
 * 素材箱（P5）：灵感速记，一本一箱。
 * 文件：entities/notes.json。不进正文、不进 AI 上下文，随取随用。
 */
import type { JsonValue } from './json';
import { readJsonOrNull, writeJson, joinPath } from './fs';
import { genId, nowIso } from './id';

export interface Note {
  id: string;
  text: string;
  at: string;
}

const MAX_NOTES = 500;

function notesPath(root: string, dirName: string): string {
  return joinPath(joinPath(root, dirName), 'entities', 'notes.json');
}

export async function loadNotes(root: string, dirName: string): Promise<Note[]> {
  const v = await readJsonOrNull(notesPath(root, dirName));
  return Array.isArray(v) ? (v as unknown as Note[]) : [];
}

export async function addNote(root: string, dirName: string, text: string): Promise<Note[]> {
  const list = await loadNotes(root, dirName);
  const note: Note = { id: genId(), text: text.trim(), at: nowIso() };
  // 新的放前面
  const next = [note, ...list].slice(0, MAX_NOTES);
  await writeJson(notesPath(root, dirName), next as unknown as JsonValue);
  return next;
}

export async function deleteNote(root: string, dirName: string, id: string): Promise<Note[]> {
  const next = (await loadNotes(root, dirName)).filter((n) => n.id !== id);
  await writeJson(notesPath(root, dirName), next as unknown as JsonValue);
  return next;
}
