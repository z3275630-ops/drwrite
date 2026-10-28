/**
 * AI 对话：一本书记一段持续的创作讨论（写作顾问，不改正文）。
 * 文件：entities/chat.json，只存 user/assistant 轮次；上下文每次发送时重建。
 */
import type { JsonValue } from './json';
import { readJson, writeJson, joinPath, exists } from './fs';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  incomplete?: boolean;
}


function chatPath(root: string, dirName: string): string {
  return joinPath(joinPath(root, dirName), 'entities', 'chat.json');
}

export async function loadChat(root: string, dirName: string): Promise<ChatMsg[]> {
  const path = chatPath(root, dirName);
  if (!(await exists(path))) return [];
  const v = await readJson(path);
  if (!Array.isArray(v) || v.some(item => !item || typeof item !== 'object'
    || !['user', 'assistant'].includes(String((item as Record<string, JsonValue>).role))
    || typeof (item as Record<string, JsonValue>).content !== 'string')) throw Error('对话文件损坏，已停止写入以保留原记录');
  return v as unknown as ChatMsg[];
}

export async function saveChat(root: string, dirName: string, msgs: ChatMsg[]): Promise<void> {
  await writeJson(chatPath(root, dirName), msgs as unknown as JsonValue);
}
