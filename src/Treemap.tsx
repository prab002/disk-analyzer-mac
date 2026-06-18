import { useMemo, useRef, useState, useEffect } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import type { HierarchyRectangularNode } from "d3-hierarchy";
import type { FileNode } from "./lib/types";
import { formatBytes, colorFor } from "./lib/format";

interface Props {
  /** The folder currently being visualized. */
  root: FileNode;
  /** Selected node path (for highlight). */
  selectedPath?: string;
  /** Click a directory → zoom in. */
  onZoom: (node: FileNode) => void;
  /** Click any node → select. */
  onSelect: (node: FileNode) => void;
}

// Only render cells whose laid-out area is at least this many px² — keeps the
// rectangle count sane even for folders with hundreds of thousands of files.
const MIN_AREA = 12;
// How many levels deep to draw from the current root.
const MAX_DEPTH = 3;

export default function Treemap({ root, selectedPath, onZoom, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hover, setHover] = useState<{
    node: FileNode;
    x: number;
    y: number;
  } | null>(null);

  // Track container size for a responsive treemap.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(320, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const nodes = useMemo(() => {
    const h = hierarchy<FileNode>(root, (d) => d.children)
      // Treat any node without shipped children as a leaf carrying its own
      // size — covers files AND directories truncated by the backend depth
      // cap, which would otherwise render as size 0.
      .sum((d) => (d.children && d.children.length ? 0 : d.size))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const laidOut = treemap<FileNode>()
      .size([size.w, size.h])
      .paddingInner(1)
      .paddingTop((d) => (d.depth > 0 && d.depth < MAX_DEPTH ? 16 : 1))
      .round(true)
      .tile(treemapSquarify)(h);

    const visible = laidOut
      .descendants()
      .filter((d) => d.depth > 0 && d.depth <= MAX_DEPTH)
      .filter((d) => (d.x1 - d.x0) * (d.y1 - d.y0) >= MIN_AREA);

    // A cell is a "leaf" in the rendered treemap if no other visible cell sits
    // inside it. Leaves (files AND un-expanded folders) get a solid fill;
    // containers stay subtle so their colored children show through.
    const containers = new Set(visible.map((d) => d.parent));
    return visible.map((d) => ({ node: d, leaf: !containers.has(d) }));
  }, [root, size]);

  return (
    <div className="treemap-wrap" ref={wrapRef}>
      <svg width={size.w} height={size.h}>
        {nodes.map(({ node: n, leaf }) => (
          <Cell
            key={n.data.path}
            n={n}
            leaf={leaf}
            selected={n.data.path === selectedPath}
            onZoom={onZoom}
            onSelect={onSelect}
            onHover={(node, e) =>
              setHover(
                node
                  ? { node, x: e.clientX, y: e.clientY }
                  : null
              )
            }
          />
        ))}
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="tooltip-name">{hover.node.name}</div>
          <div className="tooltip-size">{formatBytes(hover.node.size)}</div>
          <div className="tooltip-meta">
            {hover.node.is_dir
              ? `${hover.node.file_count.toLocaleString()} files`
              : "file"}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({
  n,
  leaf,
  selected,
  onZoom,
  onSelect,
  onHover,
}: {
  n: HierarchyRectangularNode<FileNode>;
  leaf: boolean;
  selected: boolean;
  onZoom: (node: FileNode) => void;
  onSelect: (node: FileNode) => void;
  onHover: (node: FileNode | null, e: React.MouseEvent) => void;
}) {
  const w = n.x1 - n.x0;
  const h = n.y1 - n.y0;
  const isDir = n.data.is_dir;
  const fill = colorFor(n.data.name, isDir);
  // Leaves (files + un-expanded folders) get a solid, visible fill; container
  // folders stay faint so the colored children drawn on top read clearly.
  const fillOpacity = leaf ? (isDir ? 0.6 : 0.85) : 0.18;
  const showLabel = w > 46 && h > 16;

  return (
    <g
      transform={`translate(${n.x0},${n.y0})`}
      className={`cell ${selected ? "selected" : ""}`}
      onMouseEnter={(e) => onHover(n.data, e)}
      onMouseMove={(e) => onHover(n.data, e)}
      onMouseLeave={(e) => onHover(null, e)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(n.data);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // Any directory is zoomable — if its children were pruned by the
        // backend depth cap, onZoom re-scans it on demand.
        if (isDir) onZoom(n.data);
      }}
    >
      <rect
        width={w}
        height={h}
        fill={fill}
        fillOpacity={fillOpacity}
        rx={3}
      />
      {showLabel && (
        <text x={5} y={12} className="cell-label">
          {n.data.name}
        </text>
      )}
    </g>
  );
}
