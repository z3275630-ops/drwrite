import { useMemo, useRef, useState } from 'react';
import type { Character } from '../types';
import { Modal } from './Modal';

interface Pt {
  x: number;
  y: number;
}

const W = 640;
const H = 460;
const RADIUS: Record<string, number> = { 主角: 26, 配角: 20, 闲角: 16, 过客: 13, 龙套: 11 };

/** 简易可拖拽关系图：节点圆形布局，拖动记忆位置；连线带关系称呼 */
export default function GraphModal(props: {
  chars: Character[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo(() => {
    const byId = new Map(props.chars.map((c) => [c.id, c]));
    const degree = new Map<string, number>();
    for (const c of props.chars) {
      for (const r of c.relations) {
        if (!byId.has(r.targetId)) continue;
        degree.set(c.id, (degree.get(c.id) ?? 0) + 1);
        degree.set(r.targetId, (degree.get(r.targetId) ?? 0) + 1);
      }
    }
    // 度数高的放中间，其余围圈
    const sorted = [...props.chars].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    const positions = new Map<string, Pt>();
    if (sorted.length) {
      positions.set(sorted[0].id, { x: W / 2, y: H / 2 });
      const ring = sorted.slice(1);
      const radius = Math.min(W, H) / 2 - 70;
      ring.forEach((c, i) => {
        const ang = (i / Math.max(1, ring.length)) * Math.PI * 2 - Math.PI / 2;
        positions.set(c.id, { x: W / 2 + Math.cos(ang) * radius, y: H / 2 + Math.sin(ang) * radius });
      });
    }
    return { positions, byId };
  }, [props.chars]);

  const [moved, setMoved] = useState<Record<string, Pt>>({});
  const dragId = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const posOf = (id: string): Pt => moved[id] ?? nodes.positions.get(id) ?? { x: W / 2, y: H / 2 };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setMoved((prev) => ({
      ...prev,
      [dragId.current as string]: {
        x: Math.max(30, Math.min(W - 30, ((e.clientX - rect.left) / rect.width) * W)),
        y: Math.max(30, Math.min(H - 30, ((e.clientY - rect.top) / rect.height) * H)),
      },
    }));
  };

  const edges: { from: string; to: string; label: string }[] = [];
  for (const c of props.chars) {
    for (const r of c.relations) {
      if (nodes.byId.has(r.targetId)) edges.push({ from: c.id, to: r.targetId, label: r.label });
    }
  }

  return (
    <Modal title="关系图谱" width={700} onClose={props.onClose}>
      <p className="hint-text">拖动节点整理布局；点击节点打开人物卡。连线上的字是关系称呼。</p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="graph-svg"
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragId.current = null)}
        onPointerLeave={() => (dragId.current = null)}
      >
        {edges.map((e, i) => {
          const a = posOf(e.from);
          const b = posOf(e.to);
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c9b98f" strokeWidth={1.4} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="graph-edge-label">
                {e.label}
              </text>
            </g>
          );
        })}
        {props.chars.map((c) => {
          const p = posOf(c.id);
          const r = RADIUS[c.tier] ?? 14;
          return (
            <g
              key={c.id}
              transform={`translate(${p.x},${p.y})`}
              className="graph-node"
              onPointerDown={(ev) => {
                ev.stopPropagation();
                dragId.current = c.id;
              }}
              onClick={(ev) => {
                ev.stopPropagation();
                props.onSelect(c.id);
              }}
            >
              <circle r={r} className={`g-tier-${c.tier}`} />
              <text y={r + 14} className="graph-node-label">
                {c.name}
              </text>
            </g>
          );
        })}
      </svg>
    </Modal>
  );
}
