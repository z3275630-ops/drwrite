import type { Character, RefIndexEntry } from '../types';
export interface HealthHint { characterId: string; code: string; message: string; evidence: string; fingerprint: string }
export function characterHealth(characters: Character[], refs: RefIndexEntry[]): HealthHint[] {
  const hints: HealthHint[] = [];
  const add = (characterId: string, code: string, message: string, evidence: string) => hints.push({ characterId, code, message, evidence, fingerprint: [code, characterId, evidence].join('|') });
  const owners = new Map<string, Set<string>>();
  for (const character of characters) {
    if (![character.personality, ...character.biography, ...Object.values(character.profile)].some(value => value?.trim()))
      add(character.id, 'empty', `${character.name}的资料待补`, '性格、经历、基础资料均为空');
    if (character.tier === '主角' && !refs.some(ref => ref.targetType === 'character' && ref.targetId === character.id))
      add(character.id, 'unlinked', `${character.name}尚未关联出场章节`, '层级为主角；明确关联数为0，不代表没有出场');
    for (const raw of [character.name, ...character.aliases]) {
      const name = raw.trim().toLocaleLowerCase().replace(/\s+/g, '');
      if (!name) continue; const ids = owners.get(name) ?? new Set(); ids.add(character.id); owners.set(name, ids);
    }
  }
  for (const [name, ids] of owners) if (ids.size > 1) for (const id of ids)
    add(id, 'name', `名称或别名“${name}”出现在多张卡`, [...ids].sort().join(',') + ':' + name);
  return hints;
}
