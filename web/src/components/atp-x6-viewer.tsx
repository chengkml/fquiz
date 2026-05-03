"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Empty, Space, Typography } from "antd";
import type { Graph as X6Graph } from "@antv/x6";

import type {
  AtpElementKind,
  AtpGraphEdge,
  AtpGraphJson,
  AtpGraphNode,
} from "@/lib/atp/types";

type AtpX6ViewerProps = {
  graph: AtpGraphJson | null;
};

type NodePosition = {
  x: number;
  y: number;
};

const H_SPACING = 220;
const V_SPACING = 128;

const BUS_NODE_STYLE = {
  body: {
    fill: "#e6f4ff",
    stroke: "#2f54eb",
    strokeWidth: 1.2,
    rx: 8,
    ry: 8,
  },
  label: {
    fill: "#10239e",
    fontSize: 12,
    textAnchor: "middle",
    textVerticalAnchor: "middle",
    pointerEvents: "none",
  },
} as const;

const GROUND_NODE_STYLE = {
  body: {
    fill: "#f5f5f5",
    stroke: "#7f8c8d",
    strokeWidth: 1,
  },
  label: {
    fill: "#262626",
    fontSize: 11,
    textAnchor: "middle",
    textVerticalAnchor: "middle",
    pointerEvents: "none",
  },
} as const;

const EDGE_STYLE = {
  line: {
    stroke: "#434343",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    sourceMarker: null,
    targetMarker: null,
  },
} as const;

const EDGE_LABEL_MARKUP = [
  {
    tagName: "rect",
    selector: "panel",
  },
  {
    tagName: "image",
    selector: "symbol",
  },
  {
    tagName: "text",
    selector: "label",
  },
] as const;

const EDGE_KIND_COLORS: Record<AtpElementKind, string> = {
  R: "#cf1322",
  L: "#0958d9",
  C: "#531dab",
  SW: "#389e0d",
  SRC: "#fa8c16",
  XFMR: "#08979c",
  LINE: "#595959",
  CTRL: "#d46b08",
  MISC: "#262626",
};

const EDGE_KINDS: AtpElementKind[] = [
  "R",
  "L",
  "C",
  "SW",
  "SRC",
  "XFMR",
  "LINE",
  "CTRL",
  "MISC",
];

const EDGE_SYMBOL_DATA_URI = EDGE_KINDS.reduce(
  (acc, kind) => {
    acc[kind] = buildEdgeSymbolDataUri(kind);
    return acc;
  },
  {} as Record<AtpElementKind, string>,
);

function buildEdgeLabelText(edge: AtpGraphEdge): string {
  return edge.value ? `${edge.name} (${edge.kind}) ${edge.value}` : `${edge.name} (${edge.kind})`;
}

function edgeSymbolGlyph(kind: AtpElementKind, color: string): string {
  switch (kind) {
    case "R":
      return `<polyline points="18,16 22,11 26,21 30,11 34,21 38,11 42,16" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "L":
      return `<path d="M 18 16 C 20 8, 24 8, 26 16 C 28 8, 32 8, 34 16 C 36 8, 40 8, 42 16" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    case "C":
      return `<line x1="26" y1="9" x2="26" y2="23" stroke="${color}" stroke-width="2"/><line x1="38" y1="9" x2="38" y2="23" stroke="${color}" stroke-width="2"/>`;
    case "SW":
      return `<circle cx="24" cy="16" r="1.8" fill="${color}"/><circle cx="40" cy="16" r="1.8" fill="${color}"/><line x1="24" y1="16" x2="40" y2="10" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    case "SRC":
      return `<circle cx="32" cy="16" r="8" fill="none" stroke="${color}" stroke-width="2"/><path d="M 27 16 C 28.5 12.5, 30.5 12.5, 32 16 C 33.5 19.5, 35.5 19.5, 37 16" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
    case "XFMR":
      return `<path d="M 24 10 C 22 12, 22 20, 24 22 C 26 20, 26 12, 24 10" fill="none" stroke="${color}" stroke-width="2"/><path d="M 32 10 C 30 12, 30 20, 32 22 C 34 20, 34 12, 32 10" fill="none" stroke="${color}" stroke-width="2"/><path d="M 40 10 C 38 12, 38 20, 40 22 C 42 20, 42 12, 40 10" fill="none" stroke="${color}" stroke-width="2"/>`;
    case "LINE":
      return `<line x1="24" y1="9" x2="40" y2="23" stroke="${color}" stroke-width="2"/><line x1="24" y1="23" x2="40" y2="9" stroke="${color}" stroke-width="2"/>`;
    case "CTRL":
      return `<rect x="23" y="10" width="18" height="12" rx="3" ry="3" fill="none" stroke="${color}" stroke-width="2"/><text x="32" y="19" text-anchor="middle" font-size="8" font-family="Arial, sans-serif" fill="${color}">C</text>`;
    case "MISC":
    default:
      return `<polygon points="32,9 40,16 32,23 24,16" fill="none" stroke="${color}" stroke-width="2"/>`;
  }
}

function encodeSvgAsDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function buildEdgeSymbolDataUri(kind: AtpElementKind): string {
  const color = EDGE_KIND_COLORS[kind];
  const glyph = edgeSymbolGlyph(kind, color);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><line x1="2" y1="16" x2="18" y2="16" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/><line x1="46" y1="16" x2="62" y2="16" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>${glyph}</svg>`;
  return encodeSvgAsDataUri(svg);
}

function buildEdgeLabel(edge: AtpGraphEdge) {
  return {
    markup: [...EDGE_LABEL_MARKUP],
    attrs: {
      panel: {
        ref: "label",
        refWidth: "118%",
        refHeight: "190%",
        refX: "-9%",
        refY: "-75%",
        fill: "rgba(255,255,255,0.9)",
        stroke: "#e5e7eb",
        strokeWidth: 1,
        rx: 4,
        ry: 4,
      },
      symbol: {
        xlinkHref: EDGE_SYMBOL_DATA_URI[edge.kind],
        width: 48,
        height: 24,
        x: -24,
        y: -30,
        preserveAspectRatio: "xMidYMid meet",
        pointerEvents: "none",
      },
      label: {
        text: buildEdgeLabelText(edge),
        fill: "#262626",
        fontSize: 11,
        fontFamily: "JetBrains Mono, Menlo, monospace",
        textAnchor: "middle",
        textVerticalAnchor: "middle",
        y: 4,
        pointerEvents: "none",
      },
    },
    position: {
      distance: 0.5,
      offset: -18,
      options: {
        keepGradient: false,
        ensureLegibility: true,
      },
    },
  };
}

function positionKey(position: NodePosition): string {
  return `${position.x}:${position.y}`;
}

function reservePosition(occupied: Set<string>, preferred: NodePosition): NodePosition {
  if (!occupied.has(positionKey(preferred))) {
    occupied.add(positionKey(preferred));
    return preferred;
  }

  for (let offset = 1; offset <= 100; offset += 1) {
    const candidateUp = { x: preferred.x, y: preferred.y - offset * V_SPACING };
    if (!occupied.has(positionKey(candidateUp))) {
      occupied.add(positionKey(candidateUp));
      return candidateUp;
    }

    const candidateDown = { x: preferred.x, y: preferred.y + offset * V_SPACING };
    if (!occupied.has(positionKey(candidateDown))) {
      occupied.add(positionKey(candidateDown));
      return candidateDown;
    }
  }

  const fallback = {
    x: preferred.x,
    y: preferred.y + (occupied.size + 1) * V_SPACING,
  };
  occupied.add(positionKey(fallback));
  return fallback;
}

function computeNodePositions(nodes: AtpGraphNode[], edges: AtpGraphEdge[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const occupied = new Set<string>();

  let nextSeedY = 0;

  for (const edge of edges) {
    const sourcePosition = positions.get(edge.source);
    const targetPosition = positions.get(edge.target);

    if (!sourcePosition && !targetPosition) {
      const source = reservePosition(occupied, { x: 0, y: nextSeedY });
      const target = reservePosition(occupied, { x: H_SPACING, y: nextSeedY });
      positions.set(edge.source, source);
      positions.set(edge.target, target);
      nextSeedY += V_SPACING * 2;
      continue;
    }

    if (sourcePosition && !targetPosition) {
      const target = reservePosition(occupied, { x: sourcePosition.x + H_SPACING, y: sourcePosition.y });
      positions.set(edge.target, target);
      continue;
    }

    if (!sourcePosition && targetPosition) {
      const source = reservePosition(occupied, { x: targetPosition.x - H_SPACING, y: targetPosition.y });
      positions.set(edge.source, source);
    }
  }

  const unplaced = nodes.filter((node) => !positions.has(node.id));
  const columns = 4;
  let col = 0;
  let row = 0;

  for (const node of unplaced) {
    const preferred = {
      x: col * H_SPACING,
      y: nextSeedY + row * V_SPACING,
    };
    positions.set(node.id, reservePosition(occupied, preferred));

    col += 1;
    if (col >= columns) {
      col = 0;
      row += 1;
    }
  }

  return positions;
}

export function AtpX6Viewer({ graph }: AtpX6ViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<X6Graph | null>(null);
  const [renderError, setRenderError] = useState("");

  const positions = useMemo(() => {
    if (!graph) {
      return new Map<string, NodePosition>();
    }
    return computeNodePositions(graph.nodes, graph.edges);
  }, [graph]);

  useEffect(() => {
    const container = containerRef.current;
    let disposed = false;
    let createdGraph: X6Graph | null = null;

    async function renderGraph() {
      if (!container) {
        return;
      }

      container.innerHTML = "";
      setRenderError("");

      if (!graph || graph.nodes.length === 0 || graph.edges.length === 0) {
        graphRef.current = null;
        return;
      }

      try {
        const { Graph } = await import("@antv/x6");
        if (disposed || !container) {
          return;
        }

        const instance = new Graph({
          container,
          interacting: false,
          panning: true,
          mousewheel: {
            enabled: true,
            modifiers: ["ctrl", "meta"],
            minScale: 0.25,
            maxScale: 4,
            zoomAtMousePosition: true,
          },
          background: {
            color: "#fcfdff",
          },
          grid: false,
        });

        createdGraph = instance;
        graphRef.current = instance;

        for (const node of graph.nodes) {
          const position = positions.get(node.id) ?? { x: 0, y: 0 };
          const nodeId = `node_${node.id}`;

          if (node.kind === "ground") {
            instance.addNode({
              id: nodeId,
              shape: "ellipse",
              x: position.x,
              y: position.y,
              width: 86,
              height: 44,
              label: node.label,
              attrs: GROUND_NODE_STYLE,
            });
            continue;
          }

          instance.addNode({
            id: nodeId,
            shape: "rect",
            x: position.x,
            y: position.y,
            width: 140,
            height: 46,
            label: node.label,
            attrs: BUS_NODE_STYLE,
          });
        }

        for (const edge of graph.edges) {
          instance.addEdge({
            id: edge.id,
            source: `node_${edge.source}`,
            target: `node_${edge.target}`,
            router: {
              name: "orth",
            },
            connector: {
              name: "rounded",
              args: {
                radius: 8,
              },
            },
            attrs: EDGE_STYLE,
            labels: [buildEdgeLabel(edge)],
          });
        }

        instance.zoomToFit({ padding: 48, maxScale: 1 });
        instance.centerContent();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "X6 渲染失败";
        setRenderError(detail);
      }
    }

    void renderGraph();

    return () => {
      disposed = true;
      if (createdGraph) {
        createdGraph.dispose();
      }
      if (graphRef.current === createdGraph) {
        graphRef.current = null;
      }
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [graph, positions]);

  const handleFit = () => {
    const instance = graphRef.current;
    if (!instance) {
      return;
    }

    instance.zoomToFit({ padding: 48, maxScale: 1 });
    instance.centerContent();
  };

  const handleZoomIn = () => {
    const instance = graphRef.current;
    if (!instance) {
      return;
    }

    const next = Math.min(instance.zoom() + 0.12, 4);
    instance.zoom(next, { absolute: true });
  };

  const handleZoomOut = () => {
    const instance = graphRef.current;
    if (!instance) {
      return;
    }

    const next = Math.max(instance.zoom() - 0.12, 0.25);
    instance.zoom(next, { absolute: true });
  };

  const hasRenderableGraph = !!graph && graph.nodes.length > 0 && graph.edges.length > 0;

  return (
    <Space direction="vertical" size={12} className="w-full">
      <Space size={8} wrap>
        <Button size="small" onClick={handleFit} disabled={!hasRenderableGraph}>
          适配视图
        </Button>
        <Button size="small" onClick={handleZoomIn} disabled={!hasRenderableGraph}>
          放大
        </Button>
        <Button size="small" onClick={handleZoomOut} disabled={!hasRenderableGraph}>
          缩小
        </Button>
        {graph && (
          <Typography.Text type="secondary">
            节点 {graph.stats.node_count} / 元件 {graph.stats.element_count}
          </Typography.Text>
        )}
      </Space>

      {renderError && <Alert type="error" showIcon message="渲染失败" description={renderError} />}

      <div className="relative min-h-[560px] w-full overflow-hidden rounded border border-gray-200 bg-[#fcfdff]">
        <div
          ref={containerRef}
          className="h-[560px] w-full"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(31, 35, 41, 0.08) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />
        {!hasRenderableGraph && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Empty description="暂无可渲染图形，先完成 ATP 转换。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </div>
    </Space>
  );
}
