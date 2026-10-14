/**
 * Minimal YAML reader for the project's own config files.
 *
 * Deliberately not a general YAML implementation. It supports exactly the subset
 * used by `spec/traceability.yaml`:
 *
 *   - comments (`# ...`), blank lines
 *   - top-level `key: value` scalars
 *   - top-level sequences (`- item`) of scalars or inline maps
 *   - one level of nested maps (`key:` then indented `child: value`)
 *   - inline flow maps (`{ a: 1, b: [x, y] }`) and flow sequences (`[a, b]`)
 *   - scalars including quoted strings and the bare words true/false/null
 *
 * A dependency was avoided on purpose: a malformed parse must be a loud error in
 * the gate, and a small reader we own is easier to reason about than a general
 * one. Unsupported input throws rather than guessing.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

class YamlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`YAML parse error on line ${line}: ${message}`);
    this.name = 'YamlError';
  }
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      // A '#' only starts a comment when preceded by whitespace or at line start,
      // so values like `sha256=#` are not truncated.
      if (i === 0 || /\s/.test(line[i - 1]!)) return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw: string, line: number): YamlValue {
  const v = raw.trim();
  if (v === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (v.startsWith('[') && v.endsWith(']')) return parseFlowSequence(v, line);
  if (v.startsWith('{') && v.endsWith('}')) return parseFlowMap(v, line);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  return v;
}

/** Splits on top-level commas, respecting nested brackets and quotes. */
function splitTopLevel(input: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth += 1;
      else if (c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) {
        parts.push(input.slice(start, i));
        start = i + 1;
      }
    }
  }
  if (inSingle || inDouble) throw new YamlError('unterminated quoted string', line);
  if (depth !== 0) throw new YamlError('unbalanced brackets', line);
  parts.push(input.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseFlowSequence(raw: string, line: number): YamlValue[] {
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return [];
  return splitTopLevel(inner, line).map((p) => parseScalar(p, line));
}

function parseFlowMap(raw: string, line: number): { [k: string]: YamlValue } {
  const inner = raw.slice(1, -1).trim();
  const out: { [k: string]: YamlValue } = {};
  if (inner === '') return out;
  for (const pair of splitTopLevel(inner, line)) {
    const idx = pair.indexOf(':');
    if (idx === -1) throw new YamlError(`flow map entry missing ':': ${pair}`, line);
    const key = unquote(pair.slice(0, idx).trim());
    out[key] = parseScalar(pair.slice(idx + 1), line);
  }
  return out;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

type LogicalLine = { indent: number; content: string; line: number };

function toLogicalLines(text: string): LogicalLine[] {
  const out: LogicalLine[] = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const withoutComment = stripComment(rawLines[i]!);
    if (withoutComment.trim() === '') continue;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    out.push({ indent, content: withoutComment.trim(), line: i + 1 });
  }
  return out;
}

export function parseYaml(text: string): { [key: string]: YamlValue } {
  const lines = toLogicalLines(text);
  let cursor = 0;

  const root: { [key: string]: YamlValue } = {};

  const parseBlock = (parentIndent: number, target: { [k: string]: YamlValue }): void => {
    while (cursor < lines.length) {
      const current = lines[cursor]!;
      if (current.indent <= parentIndent) return;

      // A sequence entry at this indent belongs to the parent key's value.
      if (current.content.startsWith('- ')) {
        throw new YamlError(
          `unexpected sequence entry '${current.content}' without a parent key`,
          current.line,
        );
      }

      const colon = findKeyColon(current.content);
      if (colon === -1) {
        throw new YamlError(`expected 'key:' but found '${current.content}'`, current.line);
      }

      const key = unquote(current.content.slice(0, colon).trim());
      const rest = current.content.slice(colon + 1).trim();
      cursor += 1;

      if (rest !== '') {
        target[key] = parseScalar(rest, current.line);
        continue;
      }

      // Empty value: either a nested map or a sequence, decided by lookahead.
      const next = lines[cursor];
      if (next && next.indent > current.indent) {
        if (next.content.startsWith('- ') || next.content === '-') {
          const seq: YamlValue[] = [];
          while (cursor < lines.length) {
            const item = lines[cursor]!;
            if (item.indent !== next.indent || !item.content.startsWith('-')) break;
            const body = item.content.slice(1).trim();
            cursor += 1;
            if (body === '') {
              // Nested map inside a sequence entry.
              const nested: { [k: string]: YamlValue } = {};
              parseBlock(item.indent, nested);
              seq.push(nested);
            } else if (body.includes(':') && !body.startsWith('{') && !body.startsWith('[')) {
              // Inline map inside a sequence entry.
              const inline: { [k: string]: YamlValue } = {};
              const c2 = findKeyColon(body);
              inline[unquote(body.slice(0, c2).trim())] = parseScalar(body.slice(c2 + 1), item.line);
              seq.push(inline);
            } else {
              seq.push(parseScalar(body, item.line));
            }
          }
          target[key] = seq;
        } else {
          const nested: { [k: string]: YamlValue } = {};
          parseBlock(current.indent, nested);
          target[key] = nested;
        }
      } else {
        target[key] = null;
      }
    }
  };

  parseBlock(-1, root);

  if (cursor < lines.length) {
    const leftover = lines[cursor]!;
    throw new YamlError(`unparsed content '${leftover.content}'`, leftover.line);
  }
  return root;
}

/** Finds the ':' that separates a key from its value, ignoring ':' inside quotes/brackets. */
function findKeyColon(content: string): number {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i]!;
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth += 1;
      else if (c === ']' || c === '}') depth -= 1;
      else if (c === ':' && depth === 0) {
        // Only a key separator if followed by whitespace or end of string.
        const after = content[i + 1];
        if (after === undefined || /\s/.test(after)) return i;
      }
    }
  }
  return -1;
}
