export type AtpNodeKind = "bus" | "ground";

export type AtpElementKind =
  | "R"
  | "L"
  | "C"
  | "SW"
  | "SRC"
  | "XFMR"
  | "LINE"
  | "CTRL"
  | "MISC";

export type AtpGraphNode = {
  id: string;
  label: string;
  kind: AtpNodeKind;
  degree: number;
};

export type AtpGraphEdge = {
  id: string;
  name: string;
  kind: AtpElementKind;
  source: string;
  target: string;
  value: string | null;
  line_no: number;
  raw_line: string;
};

export type AtpGraphStats = {
  total_lines: number;
  parsed_lines: number;
  node_count: number;
  element_count: number;
  warning_count: number;
};

export type AtpGraphJson = {
  format: "atp-graph-json-v1";
  source: "atp-text";
  created_at: string;
  stats: AtpGraphStats;
  nodes: AtpGraphNode[];
  edges: AtpGraphEdge[];
  warnings: string[];
};

export type AtpParseResult = {
  graph: AtpGraphJson;
  warnings: string[];
};
