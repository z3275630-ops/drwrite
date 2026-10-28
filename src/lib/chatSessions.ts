import { exists, joinPath, listDir, readJson, writeJson } from './fs';
import type { JsonValue } from './json';
import type { ChatMsg } from './chat';
import { loadChat } from './chat';
import type { ContextPolicy } from './contextBudget';
export type ChatContext = Record<'body' | 'cards' | 'fores' | 'summary', boolean>;
export interface ChatSession {
  version: 1; id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMsg[];
  draft: string; context: ChatContext; budget?: ContextPolicy; archived?: boolean;
}
export const DEFAULT_CHAT_CONTEXT: ChatContext = { body: true, cards: true, fores: true, summary: true };
const directory = (root: string, dir: string) => joinPath(root, dir, 'entities', 'chats');
function sessionPath(root: string, dir: string, id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('无效的会话身份');
  return joinPath(directory(root, dir), id + '.json');
}
export function uniqueSessionTitle(sessions: Pick<ChatSession, 'title'>[]): string {
  const names = new Set(sessions.map(session => session.title));
  let index = 1; while (names.has(index === 1 ? '创作讨论' : `创作讨论 ${index}`)) index++;
  return index === 1 ? '创作讨论' : `创作讨论 ${index}`;
}
export function newChatSession(title = '创作讨论', id: string = crypto.randomUUID()): ChatSession {
  const now = new Date().toISOString(); return { version: 1, id, title, createdAt: now, updatedAt: now, messages: [], draft: '', context: { ...DEFAULT_CHAT_CONTEXT } };
}
export function validateSession(value: unknown): ChatSession {
  const data = value as ChatSession;
  if (!data || data.version !== 1 || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.id)
    || typeof data.title !== 'string' || typeof data.draft !== 'string' || typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string'
    || !data.context || Object.keys(DEFAULT_CHAT_CONTEXT).some(key => typeof data.context[key as keyof ChatContext] !== 'boolean')
    || data.archived !== undefined && typeof data.archived !== 'boolean'
    || data.budget !== undefined && (!Number.isSafeInteger(data.budget.maxChars) || data.budget.maxChars <= 0 || !Array.isArray(data.budget.disabled) || data.budget.disabled.some(key => typeof key !== 'string'))
    || !Array.isArray(data.messages) || data.messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || typeof message.at !== 'string'))
    throw Error('会话文件格式损坏，已停止写入并保留原件');
  return data;
}
export async function readSession(root: string, dir: string, id: string) {
  const session = validateSession(await readJson(sessionPath(root, dir, id)));
  if (session.id !== id) throw Error('会话文件名与身份不一致，未覆盖'); return session;
}
export async function saveSession(root: string, dir: string, session: ChatSession) {
  validateSession(session); await writeJson(sessionPath(root, dir, session.id), { ...session, updatedAt: new Date().toISOString() } as unknown as JsonValue);
}
/** Files, rather than an index, are authoritative, so an orphan remains discoverable. */
export async function listSessions(root: string, dir: string): Promise<{ sessions: ChatSession[]; warnings: string[] }> {
  const sessions: ChatSession[] = [], warnings: string[] = [];
  const legacy = joinPath(root, dir, 'entities', 'chat.json');
  if (await exists(legacy) && !(await exists(sessionPath(root, dir, 'legacy')))) {
    try {
      const messages = await loadChat(root, dir); // strict validation; never rewrite the old file
      await saveSession(root, dir, { ...newChatSession('之前的创作讨论', 'legacy'), messages });
    } catch (error) { warnings.push('旧对话未迁移，原件保留：' + String(error)); }
  }
  if (await exists(directory(root, dir))) {
    for (const file of await listDir(directory(root, dir))) {
      if (!file.endsWith('.json')) continue;
      try { const session = await readSession(root, dir, file.slice(0, -5)); if (!session.archived) sessions.push(session); }
      catch (error) { warnings.push(file + '：' + String(error)); }
    }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!sessions.length && !warnings.length) { const initial = newChatSession(); await saveSession(root, dir, initial); sessions.push(initial); }
  return { sessions, warnings };
}
