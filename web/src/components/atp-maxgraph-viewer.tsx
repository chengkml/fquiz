"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Empty, Space, Typography } from "antd";
import type { Graph } from "@maxgraph/core";

import type { AtpGraphEdge, AtpGraphJson, AtpGraphNode } from "@/lib/atp/types";

type AtpMaxGraphViewerProps = {
  graph: AtpGraphJson | null;
};

type NodePosition = {
  x: number;
  y: number;
};

const H_SPACING = 220;
const V_SPACING = 128;

const BUS_STYLE = {
  shape: "rectangle",
  rounded: true,
  strokeColor: "#2f54eb",
  fillColor: "#e6f4ff",
  fontColor: "#10239e",
  strokeWidth: 1.2,
  fontSize: 12,
  whiteSpace: "wrap",
  spacing: 4,
} as const;

const GROUND_STYLE = {
  shape: "triangle",
  direction: "north",
  strokeColor: "#7f8c8d",
  fillColor: "#f5f5f5",
  fontColor: "#262626",
  strokeWidth: 1,
  fontSize: 11,
} as const;

const EDGE_STYLE = {
  shape: "connector",
  edgeStyle: "orthogonalEdgeStyle",
  orthogonalLoop: true,
  rounded: true,
  strokeColor: "#434343",
  strokeWidth: 1.4,
  endArrow: "none",
  fontColor: "#262626",
  fontSize: 11,
  labelBackgroundColor: "#ffffff",
  labelBorderColor: "#f0f0f0",
} as const;

function buildEdgeLabel(edge: AtpGraphEdge): string {
  return edge.value ? `${edge.name} (${edge.kind}) ${edge.value}` : `${edge.name} (${edge.kind})`;
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

export function AtpMaxGraphViewer({ graph }: AtpMaxGraphViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
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
    let createdGraph: Graph | null = null;

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
        const maxgraph = await import("@maxgraph/core");
        if (disposed || !container) {
          return;
        }

        const instance = new maxgraph.Graph(container);
        createdGraph = instance;
        graphRef.current = instance;

        instance.setEnabled(false);
        instance.setCellsEditable(false);
        instance.setCellsMovable(false);
        instance.setCellsResizable(false);
        instance.setCellsBendable(false);
        instance.setCellsSelectable(true);
        instance.setConnectable(false);
        instance.setPanning(true);
        instance.setTooltips(true);

        const parent = instance.getDefaultParent();
        const nodeCells = new Map<string, ReturnType<Graph["insertVertex"]>>();

        instance.batchUpdate(() => {
          for (const node of graph.nodes) {
            const position = positions.get(node.id) ?? { x: 0, y: 0 };
            const isGround = node.kind === "ground";
            const vertex = instance.insertVertex({
              parent,
              id: `node_${node.id}`,
              value: node.label,
              position: [position.x, position.y],
              size: isGround ? [80, 56] : [140, 46],
              style: isGround ? GROUND_STYLE : BUS_STYLE,
            });
            nodeCells.set(node.id, vertex);
          }

          for (const edge of graph.edges) {
            const source = nodeCells.get(edge.source);
            const target = nodeCells.get(edge.target);
            if (!source || !target) {
              continue;
            }

            instance.insertEdge({
              parent,
              id: edge.id,
              value: buildEdgeLabel(edge),
              source,
              target,
              style: EDGE_STYLE,
            });
          }
        });

        instance.zoomActual();
        instance.center(true, true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "maxGraph 渲染失败";
        setRenderError(detail);
      }
    }

    void renderGraph();

    return () => {
      disposed = true;
      if (createdGraph) {
        createdGraph.destroy();
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

    const bounds = instance.getGraphBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    instance.zoomToRect(bounds);
  };

  const handleZoomIn = () => {
    graphRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    graphRef.current?.zoomOut();
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
