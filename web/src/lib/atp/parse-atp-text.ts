import type {
  AtpElementKind,
  AtpGraphEdge,
  AtpGraphJson,
  AtpGraphNode,
  AtpParseResult,
} from "./types";

const RESERVED_TOKENS = new Set([
  "BEGIN",
  "END",
  "NEW",
  "DATA",
  "CASE",
  "PLOT",
  "OUTPUT",
  "REQUEST",
  "BRANCH",
  "MODEL",
  "LIBRARY",
  "OPTION",
  "OPTIONS",
  "PARAM",
  "PARAMETER",
  "PARAMETERS",
  "SOURCE",
  "TACS",
  "FOR",
  "IF",
  "THEN",
  "ELSE",
  "CALL",
  "RETURN",
]);

const COMMENT_PREFIXES = ["*", "!", "#", "//"];
const GROUND_ALIASES = new Set(["0", "GND", "GROUND", "GRD", "REF"]);
const NODE_TOKEN_PATTERN = /^[A-Za-z0-9_.:+\-/]+$/;
const NAME_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_.:+\-/]*$/;

type ParsedElement = {
  name: string;
  kind: AtpElementKind;
  source: string;
  target: string;
  value: string | null;
};

function isCommentLine(trimmed: string): boolean {
  if (!trimmed) {
    return true;
  }
  if (/^C\s+/i.test(trimmed)) {
    return true;
  }
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function stripInlineComment(line: string): string {
  const exclamationIndex = line.indexOf(" !");
  const slashIndex = line.indexOf(" //");

  const indexes = [exclamationIndex, slashIndex].filter((value) => value >= 0);
  if (indexes.length === 0) {
    return line;
  }

  const cutIndex = Math.min(...indexes);
  return line.slice(0, cutIndex).trimEnd();
}

function normalizeNodeToken(token: string): string | null {
  const trimmed = token.trim().replace(/^['"]+|['"]+$/g, "");
  if (!trimmed) {
    return null;
  }

  const unwrapped = trimmed.replace(/^[\[({]+|[\])}]+$/g, "");
  if (!unwrapped) {
    return null;
  }

  const normalized = unwrapped.toUpperCase();
  if (!NODE_TOKEN_PATTERN.test(normalized)) {
    return null;
  }

  if (GROUND_ALIASES.has(normalized)) {
    return "0";
  }

  return normalized;
}

function inferElementKind(token: string): AtpElementKind {
  const upper = token.trim().toUpperCase();

  if (upper.startsWith("R")) return "R";
  if (upper.startsWith("L")) return "L";
  if (upper.startsWith("C")) return "C";
  if (upper.startsWith("SW") || upper.startsWith("BRK") || upper === "S") return "SW";
  if (upper.startsWith("V") || upper.startsWith("I") || upper.startsWith("E") || upper.startsWith("F")) return "SRC";
  if (upper.startsWith("TR") || upper.startsWith("XF") || upper.startsWith("T")) return "XFMR";
  if (upper.startsWith("LINE") || upper.startsWith("PI") || upper.startsWith("RL")) return "LINE";
  if (upper.startsWith("CTRL") || upper.startsWith("MEAS") || upper.startsWith("MON")) return "CTRL";
  return "MISC";
}

function isLikelyTypeToken(token: string): boolean {
  const upper = token.trim().toUpperCase();
  if (!upper) {
    return false;
  }
  if (RESERVED_TOKENS.has(upper)) {
    return false;
  }

  const kind = inferElementKind(upper);
  if (kind !== "MISC") {
    return true;
  }

  return upper.length <= 3 && /^[A-Z]+$/.test(upper);
}

function isLikelyElementName(token: string): boolean {
  const upper = token.trim().toUpperCase();
  if (!upper) {
    return false;
  }
  if (RESERVED_TOKENS.has(upper)) {
    return false;
  }
  if (!NAME_TOKEN_PATTERN.test(token)) {
    return false;
  }
  if (/^\d/.test(token)) {
    return false;
  }
  return true;
}

function extractValue(tokens: string[]): string | null {
  for (const token of tokens) {
    const candidate = token.trim();
    if (!candidate) {
      continue;
    }
    if (candidate === "-" || candidate === "/") {
      continue;
    }
    return candidate;
  }
  return null;
}

function sanitizeElementName(name: string, fallbackIndex: number): string {
  const normalized = name.trim().replace(/[^A-Za-z0-9_.:+\-/]/g, "");
  if (normalized) {
    return normalized;
  }
  return `E${fallbackIndex}`;
}

function parseElementTokens(tokens: string[], fallbackIndex: number): ParsedElement | null {
  if (tokens.length < 3) {
    return null;
  }

  // Format A: BUS_A BUS_B R 10
  if (tokens.length >= 4) {
    const sourceByType = normalizeNodeToken(tokens[0]);
    const targetByType = normalizeNodeToken(tokens[1]);
    const typeToken = tokens[2];

    if (sourceByType && targetByType && isLikelyTypeToken(typeToken)) {
      const kind = inferElementKind(typeToken);
      const generatedName = `${kind === "MISC" ? "E" : kind}${fallbackIndex}`;
      return {
        name: generatedName,
        kind,
        source: sourceByType,
        target: targetByType,
        value: extractValue(tokens.slice(3)),
      };
    }
  }

  // Format B: R1 BUS_A BUS_B 10
  const nameToken = tokens[0];
  const source = normalizeNodeToken(tokens[1]);
  const target = normalizeNodeToken(tokens[2]);
  if (!source || !target || !isLikelyElementName(nameToken)) {
    return null;
  }

  return {
    name: sanitizeElementName(nameToken, fallbackIndex),
    kind: inferElementKind(nameToken),
    source,
    target,
    value: extractValue(tokens.slice(3)),
  };
}

function makeUniqueName(rawName: string, seen: Map<string, number>): string {
  const count = seen.get(rawName) ?? 0;
  seen.set(rawName, count + 1);
  if (count === 0) {
    return rawName;
  }
  return `${rawName}_${count + 1}`;
}

function shouldSkipControlLine(tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const first = tokens[0].toUpperCase();
  if (RESERVED_TOKENS.has(first)) {
    return true;
  }

  if (first === "/" || first === "+") {
    return true;
  }

  return false;
}

export function parseAtpTextToGraphJson(sourceText: string): AtpParseResult {
  const normalizedText = sourceText.replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");

  const warnings: string[] = [];
  const nodesMap = new Map<string, AtpGraphNode>();
  const edges: AtpGraphEdge[] = [];
  const usedNames = new Map<string, number>();

  let parsedLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNo = index + 1;
    const trimmed = rawLine.trim();

    if (!trimmed || isCommentLine(trimmed)) {
      continue;
    }

    const uncommented = stripInlineComment(trimmed);
    if (!uncommented) {
      continue;
    }

    const tokens = uncommented
      .split(/[\s,;]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (shouldSkipControlLine(tokens)) {
      continue;
    }

    const parsed = parseElementTokens(tokens, edges.length + 1);
    if (!parsed) {
      continue;
    }

    const sourceNode = parsed.source;
    const targetNode = parsed.target;

    if (sourceNode === targetNode) {
      warnings.push(`第 ${lineNo} 行 ${parsed.name} 的首末节点相同（${sourceNode}）。`);
    }

    const sourceMeta = nodesMap.get(sourceNode) ?? {
      id: sourceNode,
      label: sourceNode,
      kind: sourceNode === "0" ? "ground" : "bus",
      degree: 0,
    };
    sourceMeta.degree += 1;
    nodesMap.set(sourceNode, sourceMeta);

    const targetMeta = nodesMap.get(targetNode) ?? {
      id: targetNode,
      label: targetNode,
      kind: targetNode === "0" ? "ground" : "bus",
      degree: 0,
    };
    targetMeta.degree += 1;
    nodesMap.set(targetNode, targetMeta);

    const uniqueName = makeUniqueName(parsed.name, usedNames);
    edges.push({
      id: `e_${edges.length + 1}`,
      name: uniqueName,
      kind: parsed.kind,
      source: sourceNode,
      target: targetNode,
      value: parsed.value,
      line_no: lineNo,
      raw_line: rawLine,
    });

    parsedLines += 1;
  }

  const nodes = Array.from(nodesMap.values()).sort((left, right) => {
    if (right.degree !== left.degree) {
      return right.degree - left.degree;
    }
    return left.id.localeCompare(right.id);
  });

  if (edges.length === 0) {
    warnings.push("未解析到可渲染的电路元件，请检查 ATP 文本格式是否为纯文本网表。");
  }

  const graph: AtpGraphJson = {
    format: "atp-graph-json-v1",
    source: "atp-text",
    created_at: new Date().toISOString(),
    stats: {
      total_lines: lines.length,
      parsed_lines: parsedLines,
      node_count: nodes.length,
      element_count: edges.length,
      warning_count: warnings.length,
    },
    nodes,
    edges,
    warnings,
  };

  return {
    graph,
    warnings,
  };
}

export function stringifyAtpGraphJson(graph: AtpGraphJson): string {
  return JSON.stringify(graph, null, 2);
}
