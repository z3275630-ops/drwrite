import { diffArrays } from 'diff';
export function proposalDiff(original: string, proposed: string) {
  if (original.length + proposed.length > 80000) return null;
  return diffArrays(original.split('\n'), proposed.split('\n'), { timeout: 50, maxEditLength: 2000 }) ?? null;
}
