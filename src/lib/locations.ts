/**
 * 地点层级树（P6，织境地图的轻量版）：
 * 世界 → 大陆 → 城市 → 地点……纯树形容器，节点可绑定一条「地点」类设定词条。
 * 文件形态：entities/locations.json
 */
import type { JsonValue } from './json';
import { readJsonOrNull, writeJson, joinPath } from './fs';
import { genId } from './id';

export interface LocationNode {
  id: string;
  label: string;
  parentId: string | null;
  /** 绑定的设定词条（category=地点）id */
  loreId?: string;
}

export interface LocationTree {
  nodes: LocationNode[];
}

export async function loadLocations(root: string, dirName: string): Promise<LocationTree> {
  const v = await readJsonOrNull(joinPath(joinPath(root, dirName), 'entities', 'locations.json'));
  const t = v as unknown as LocationTree | null;
  if (t && Array.isArray(t.nodes)) return t;
  return { nodes: [] };
}

export async function saveLocations(root: string, dirName: string, tree: LocationTree): Promise<void> {
  await writeJson(joinPath(joinPath(root, dirName), 'entities', 'locations.json'), tree as unknown as JsonValue);
}

export function newNode(label: string, parentId: string | null): LocationNode {
  return { id: genId(), label: label.trim(), parentId };
}

/** 深度优先排序（树形展示用） */
export function sortedNodes(nodes: LocationNode[]): LocationNode[] {
  const out: LocationNode[] = [];
  const walk = (parentId: string | null) => {
    for (const n of nodes.filter((x) => x.parentId === parentId)) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  // 兜底：父节点被删导致的孤儿挂到根
  for (const n of nodes) if (!out.includes(n)) out.push(n);
  return out;
}

/** 删除节点（子节点上提一级，不丢） */
export function removeNode(nodes: LocationNode[], id: string): LocationNode[] {
  const target = nodes.find((n) => n.id === id);
  if (!target) return nodes;
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.parentId === id ? { ...n, parentId: target.parentId } : n));
}
