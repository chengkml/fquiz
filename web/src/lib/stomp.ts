export type StompFrame = {
  command: string;
  headers: Record<string, string>;
  body?: string;
};

const TOPIC_DESTINATION_PREFIX = "/topic/";

export function topicToDestination(topic: string): string {
  return `${TOPIC_DESTINATION_PREFIX}${topic}`;
}

export function buildStompFrame(frame: StompFrame): string {
  const lines: string[] = [frame.command];
  for (const [key, value] of Object.entries(frame.headers)) {
    lines.push(`${escapeHeader(key)}:${escapeHeader(value)}`);
  }
  lines.push("");
  return `${lines.join("\n")}${frame.body ?? ""}\u0000`;
}

export function parseStompFrames(payload: string): StompFrame[] {
  const normalized = payload.replace(/\r\n/g, "\n");
  const frames: StompFrame[] = [];

  let cursor = 0;
  while (cursor < normalized.length) {
    while (cursor < normalized.length && normalized[cursor] === "\n") {
      cursor += 1;
    }
    if (cursor >= normalized.length) {
      break;
    }

    const terminator = normalized.indexOf("\u0000", cursor);
    if (terminator < 0) {
      throw new Error("frame_terminator_missing");
    }

    const raw = normalized.slice(cursor, terminator);
    cursor = terminator + 1;
    if (!raw) {
      continue;
    }
    frames.push(parseSingleFrame(raw));
  }

  return frames;
}

function parseSingleFrame(raw: string): StompFrame {
  const boundary = raw.indexOf("\n\n");
  const headerBlob = boundary >= 0 ? raw.slice(0, boundary) : raw;
  let body = boundary >= 0 ? raw.slice(boundary + 2) : "";
  const headerLines = headerBlob.split("\n");
  const command = headerLines[0]?.trim().toUpperCase();
  if (!command) {
    throw new Error("missing_command");
  }

  const headers: Record<string, string> = {};
  for (const line of headerLines.slice(1)) {
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      throw new Error("malformed_header");
    }
    const key = unescapeHeader(line.slice(0, separatorIndex));
    const value = unescapeHeader(line.slice(separatorIndex + 1));
    headers[key] = value;
  }

  if (headers["content-length"]) {
    const contentLength = Number.parseInt(headers["content-length"], 10);
    if (Number.isNaN(contentLength) || contentLength < 0) {
      throw new Error("invalid_content_length");
    }
    body = body.slice(0, contentLength);
  }

  return { command, headers, body };
}

function escapeHeader(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll(":", "\\c");
}

function unescapeHeader(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      result += char;
      continue;
    }
    const next = value[index + 1];
    if (!next) {
      result += "\\";
      continue;
    }
    index += 1;
    if (next === "r") {
      result += "\r";
    } else if (next === "n") {
      result += "\n";
    } else if (next === "c") {
      result += ":";
    } else {
      result += next;
    }
  }
  return result;
}
