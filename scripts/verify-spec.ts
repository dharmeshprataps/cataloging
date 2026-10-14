import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, type YamlValue } from './lib/yaml.js';

/**
 * Spec-driven traceability gate.
 *
 * Enforces that the specification and the test suite cannot drift apart. It is
 * deliberately built to FAIL LOUDLY rather than fail open: every check reports a
 * violation with the offending id, file, and line so the fix is obvious.
 *
 * The design constraint that matters: this gate must never silently pass. A
 * previous attempt at traceability used vitest test tags, which the installed
 * runner accepted and silently discarded — the gate would have found zero
 * citations and reported full coverage (see DEC-0006). Therefore citations are
 * plain text in test titles and this parser is the only reader.
 *
 * A citation is necessary evidence but not sufficient: a test that is skipped,
 * that has an empty body, or that lives in a directory the scan does not reach
 * would all count as proof while proving nothing. So this gate parses test
 * declarations structurally and rejects each of those shapes (see DEC-0006).
 * What it cannot do is execute the suite — `pnpm test` runs vitest first for
 * that. The gate's job is to make the *citation* an honest pointer at a test
 * that actually runs and actually asserts.
 *
 * Run as a library from `tests/spec-gate.test.ts` (so `pnpm test` covers it) and
 * as a CLI via `pnpm spec:status` for the human-readable report.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Paths and gate behaviour are resolved from an options object so that the
 * gate's own tests can point it at fixture trees and prove it FAILS when a rule
 * is violated. A gate that has never been observed failing is not evidence of
 * anything (DEC-0006), so this seam is load-bearing.
 */
export type GateOptions = {
  repoRoot?: string;
  traceabilityPath?: string;
  testsDir?: string;
  findingsDir?: string;
  requirementFiles?: Record<string, string>;
  /** Test files excluded from citation checks — the gate's own tests. */
  excludeTestFiles?: string[];
  /**
   * Globs (relative to `testsDir`) for the test files this gate inspects. This
   * must stay in step with `vitest.config.ts`'s `include`, or a test the runner
   * executes becomes invisible to the gate — which is how a whole subdirectory
   * of unverified tests can pass silently.
   */
  testGlobs?: string[];
  /**
   * Additional files that carry requirement citations as `// ID` comments.
   * `scripts/verify-e2e.ts` is a real end-to-end check that cannot run under
   * vitest (it needs a real socket for the SSE route), so its assertions count
   * as evidence too.
   */
  citationSources?: string[];
};

export type ResolvedOptions = {
  repoRoot: string;
  specDir: string;
  testsDir: string;
  traceabilityPath: string;
  findingsDir: string;
  requirementFiles: Record<string, string>;
  excludeTestFiles: string[];
  testGlobs: string[];
  citationSources: string[];
};

/**
 * The change directory this gate polices.
 *
 * Explicit rather than discovered: the gate belongs to one approved
 * specification, and a typo here must fail loudly instead of silently policing
 * nothing.
 */
export const CHANGE_ID = 'requirements-baseline';

export function resolveOptions(options: GateOptions = {}): ResolvedOptions {
  // scripts/ -> repository root
  const repoRoot = options.repoRoot ?? path.resolve(here, '..');
  const specDir = path.join(repoRoot, 'openspec', 'changes', CHANGE_ID);
  return {
    repoRoot,
    specDir,
    testsDir: options.testsDir ?? path.join(repoRoot, 'tests'),
    traceabilityPath: options.traceabilityPath ?? path.join(specDir, 'traceability.yaml'),
    findingsDir: options.findingsDir ?? path.join(specDir, 'findings'),
    // This change keeps all normative requirement text in one document, so every
    // `file:` value in traceability.yaml resolves to it.
    requirementFiles:
      options.requirementFiles ??
      ({ requirements: path.join(specDir, 'requirements.md') } satisfies Record<string, string>),
    // The gate's own tests cite ids as fixtures to prove violation detection, so
    // they are not counted as coverage. Only `spec-gate.test.ts` exists; listing
    // a name here silently excludes that file from every citation check, so the
    // list must name real files only.
    excludeTestFiles: options.excludeTestFiles ?? ['spec-gate.test.ts'],
    // Kept in step with `vitest.config.ts`'s `include`.
    testGlobs: options.testGlobs ?? ['**/*.test.ts'],
    citationSources:
      options.citationSources ?? [path.join(repoRoot, 'scripts/verify-e2e.ts')],
  };
}

/** Canonical repo paths, for callers that want the real project. */
export const REPO_ROOT = resolveOptions().repoRoot;
export const SPEC_DIR = resolveOptions().specDir;
export const TESTS_DIR = resolveOptions().testsDir;
export const TRACEABILITY_PATH = resolveOptions().traceabilityPath;
export const FINDINGS_DIR = resolveOptions().findingsDir;

export type Implementation = 'implemented' | 'partial' | 'not_implemented' | 'deferred' | 'superseded';
export type Verification = 'verified' | 'unverified' | 'n/a';

export type Requirement = {
  id: string;
  file: string;
  title: string;
  implementation: Implementation;
  verification: Verification;
  /** False when `traceability.yaml` omitted `verification` entirely. */
  verificationStated: boolean;
  tests: string[];
  evidence: string;
  gap?: string;
  finding?: string;
  line: number;
};

export type Severity = 'error' | 'warning';

export type CheckResult = {
  name: string;
  severity: Severity;
  violations: string[];
};

export type GateResult = {
  checks: CheckResult[];
  requirements: Requirement[];
  summary: {
    total: number;
    byImplementation: Record<string, number>;
    byVerification: Record<string, number>;
    unverified: string[];
    errors: number;
    warnings: number;
  };
};

/** `<AREA>-<NNN>`, e.g. `CONV-004`. */
const REQ_ID = /^[A-Z]{2,8}-\d{3}$/;

/**
 * A test title that cites one or more requirements, e.g.
 *   "CONV-004 suppresses duplicate deliveries"
 *   "CONV-005 GEN-016 walks from photo to approved shot"
 *
 * Multiple ids are allowed because tests are legitimately coarser than
 * requirements: one end-to-end test can prove several requirements at once, and
 * forcing false granularity would mark real coverage as missing.
 */
const CITATION = /^((?:[A-Z]{2,8}-\d{3}\s+)+)\S/;

function readIfPresent(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

/**
 * The metadata-block template itself, relative to the change directory.
 *
 * It cannot carry a metadata block: the block it must contain is the example it
 * teaches, and a reader cannot tell the example from a real header. It is
 * documentation *about* the standard, not a material document governed by it, so
 * it is the one file the metadata check skips — explicitly and by name, so the
 * exemption is reviewable rather than a silent hole in the scan.
 */
const TEMPLATE_REL = path.join('templates', 'METADATA_BLOCK.md');

/**
 * Every `*.md` artifact under a directory, sorted, recursively.
 *
 * Material artifacts live at the change root, in `findings/`, in `decisions/`
 * and in `templates/`, and the next one may live somewhere else. Discovering
 * them means the metadata rule cannot be satisfied by a document simply not
 * being listed in this file.
 */
export function discoverArtifacts(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  // An explicit walk rather than `readdirSync({ recursive: true })`: the
  // recursive form's `parentPath` field is Node-version-dependent, and a gate
  // that changes meaning with the runtime is worse than a few lines of loop.
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full);
    }
  }
  return found.sort();
}

/** The value of a `| **Field** | value |` row in a metadata block, or undefined. */
export function metadataCell(text: string, field: string): string | undefined {
  const pattern = new RegExp(`^\\|\\s*\\*\\*${field}\\*\\*\\s*\\|([^|]*)\\|`, 'm');
  const match = pattern.exec(text);
  return match?.[1]?.trim();
}

/** Requirement ids declared as headings in a requirement document. */
export function extractDeclaredIds(filePath: string): Map<string, number> {
  const out = new Map<string, number>();
  const text = readIfPresent(filePath);
  if (text === undefined) return out;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^#{2,6}\s+([A-Z]{2,8}-\d{3})\b/.exec(lines[i]!);
    if (match?.[1]) out.set(match[1], i + 1);
  }
  return out;
}

export type TestCitation = {
  requirementId: string;
  title: string;
  file: string;
  line: number;
};

/** A `describe(...)` or `it(...)`-family declaration found in a test file. */
export type TestDeclaration = {
  kind: 'suite' | 'test';
  /** Dotted modifiers, e.g. `skip`, `each`, `concurrent`; '' for a plain call. */
  modifier: string;
  title: string;
  file: string;
  line: number;
  /** Whether the declaration's own modifier means it never runs. */
  skipped: boolean;
  /**
   * For a test: does the body contain at least one expectation? A body that
   * asserts nothing cannot fail, so it is not evidence.
   */
  asserts: boolean;
};

/** `it`, `test`, `describe` and their `.skip` / `.todo` / `.each` forms. */
const DECLARATION = /^\s*(?<fn>it|test|describe)(?<mods>(?:\.[A-Za-z_$][\w$]*)*)\s*\(/;
const NEVER_RUNS = /(^|\.)(skip|todo|fails|fixme|skipIf|runIf|todoIf)(\.|$)/;
/** Just before a `/`, these mean a regex literal rather than division. */
const REGEX_PRECEDING = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '<', '>', '+', '-', '*', '%', '^', '~']);

/**
 * Scans `text` once, returning a mask marking every character that sits inside
 * a string, template literal, regex literal, or comment.
 *
 * One literal-aware pass is what makes the rest of the parser trustworthy. A
 * `{` inside a regex literal in a test body (`said(/Here's the brief/)`) is
 * otherwise treated as code, and the apostrophe in it opens a phantom string
 * that never closes — so an empty-body test with such a call is misread as a
 * test with a body, which is exactly the silent pass this gate exists to stop.
 */
function literalMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  let prev = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      mask.fill(1, i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      mask.fill(1, i, stop);
      i = stop;
      continue;
    }
    const ch = text[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      const stop = Math.min(j + 1, text.length);
      mask.fill(1, i, stop);
      i = stop;
      prev = ch;
      continue;
    }
    if (ch === '/' && REGEX_PRECEDING.has(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        else if (text[j] === '\n') break;
        j += 1;
      }
      if (j < text.length && text[j] === '/') {
        let k = j + 1;
        while (k < text.length && /[a-z]/.test(text[k]!)) k += 1;
        mask.fill(1, i, k);
        i = k;
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return mask;
}

/** `text` with every literal and comment replaced by an equivalent space. */
function blankLiterals(text: string, mask: Uint8Array): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) out += mask[i] ? (text[i] === '\n' ? '\n' : ' ') : text[i];
  return out;
}

/**
 * The balanced `{...}` body starting at `start`, with literals and comments
 * blanked. Index positions are preserved, so masks can be sliced through with
 * the same offsets.
 */
function bracedBody(text: string, start: number, mask: Uint8Array): string | undefined {
  const code = blankLiterals(text, mask);
  let depth = 0;
  let from = start;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === '{') {
      if (depth === 0) from = i;
      depth += 1;
    } else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, i);
      if (depth < 0) return undefined;
    }
  }
  return undefined;
}

/** The index of the `)` closing the `(` at `open`, or -1. */
function findCloseParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of the `=>` beginning a callback at/after `from`, or -1. */
function findArrow(code: string, from: number): number {
  for (let i = from; i < code.length - 1; i += 1) {
    if (code[i] !== '=' || code[i + 1] !== '>') continue;
    // Every vitest callback is an arrow function; a `>` in a generic type
    // argument is not followed by an identifier-shaped callback body.
    return i;
  }
  return -1;
}

/** Assertions strong enough that removing them makes a test unable to fail. */
const ASSERTION = /\b(?:expect|assert)\b|\.to(?:Be|Equal|Match|Throw|Contain)\b|\bthrow\b/;

/**
 * Every `it`/`test`/`describe` declaration in the test tree, scanned
 * **recursively**.
 *
 * Recursion matters: `vitest.config.ts` globs `tests/**\/*.test.ts`, so a test in
 * a subdirectory runs in CI. A non-recursive scan would leave it uncited and
 * unverified in both directions at once.
 */
export function extractTestDeclarations(
  opts: ResolvedOptions = resolveOptions(),
): TestDeclaration[] {
  const out: TestDeclaration[] = [];
  for (const rel of findTestFiles(opts)) {
    const text = readIfPresent(path.join(opts.testsDir, rel));
    if (text === undefined) continue;
    for (const declaration of scanDeclarations(text, rel)) out.push(declaration);
  }
  return out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.title.localeCompare(b.title),
  );
}

/**
 * Test files the gate inspects, relative to `testsDir`, matched against
 * `opts.testGlobs` and walked recursively. `excludeTestFiles` is matched by
 * basename so a nested excluded file is still excluded.
 */
export function findTestFiles(opts: ResolvedOptions = resolveOptions()): string[] {
  if (!fs.existsSync(opts.testsDir)) return [];
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(opts.testsDir, full).split(path.sep).join('/');
      if (opts.excludeTestFiles.includes(path.basename(rel))) continue;
      if (matchesTestGlob(rel, opts.testGlobs)) files.push(rel);
    }
  };
  visit(opts.testsDir);
  return files.sort();
}

/** Minimal glob match: `**` crosses directories, `*` does not. */
function matchesTestGlob(rel: string, globs: string[]): boolean {
  return globs.some((glob) => {
    const pattern = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0000')
      .replace(/\*\*/g, '\u0001')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '(?:.*/)?')
      .replace(/\u0001/g, '.*');
    return new RegExp(`^${pattern}$`).test(rel);
  });
}

function scanDeclarations(text: string, file: string): TestDeclaration[] {
  const lines = text.split(/\r?\n/);
  const out: TestDeclaration[] = [];
  // Every body and title is read from this mask, so literals and comments
  // cannot be mistaken for syntax.
  const mask = literalMask(text);

  for (let i = 0; i < lines.length; i += 1) {
    const match = DECLARATION.exec(lines[i]!);
    const fn = match?.groups?.fn;
    if (!match || !fn) continue;

    const mods = (match.groups?.mods ?? '').split('.').filter((m) => m.length > 0);
    const modifier = mods.join('.');
    // `skip`/`todo`/`fails`/`fixme` and their conditional forms are all cases
    // where the body may not execute at all.
    const skipped = NEVER_RUNS.test(modifier);

    // The declaration may span lines (`it(\n  'title', ...`), so search forward
    // from the call for its title literal and body.
    const start = lineOffset(lines, i);
    const window = text.slice(start, start + 2000);
    const windowMask = mask.subarray(start, start + 2000);
    const titleMatch = /\(\s*(['"`])([\s\S]*?)\1/.exec(window);
    if (!titleMatch?.[2]) continue;

    let cursor = titleMatch.index + titleMatch[0].length;
    let asserts = false;

    if (fn !== 'describe') {
      const arrow = findArrow(blankLiterals(window, windowMask), cursor);
      if (arrow !== -1) {
        const afterArrow = arrow + 2;
        const open = blankLiterals(window, windowMask).indexOf('{', afterArrow);
        if (open !== -1) {
          cursor = open;
          const body = bracedBody(text, start + open, mask);
          asserts = body !== undefined && ASSERTION.test(blankLiterals(body, mask.subarray(start + open + 1, start + open + 1 + body.length)));
        } else {
          // Concise body on one line: `() => expect(x).toBe(y)`.
          const end = blankLiterals(window, windowMask).indexOf('\n', afterArrow);
          const concise = window.slice(afterArrow, end === -1 ? window.length : end);
          const conciseMask = mask.subarray(start + afterArrow, start + (end === -1 ? window.length : end));
          asserts = ASSERTION.test(blankLiterals(concise, conciseMask));
          cursor = afterArrow;
        }
      } else {
        // `it('title', function () { ... })`
        const open = window.indexOf('(', titleMatch.index + 1);
        const close = open === -1 ? -1 : findCloseParen(blankLiterals(window, windowMask), open + 1);
        const brace = close === -1 ? -1 : blankLiterals(window, windowMask).indexOf('{', close + 1);
        if (brace !== -1) {
          cursor = brace;
          const body = bracedBody(text, start + brace, mask);
          asserts = body !== undefined && ASSERTION.test(blankLiterals(body, mask.subarray(start + brace + 1, start + brace + 1 + body.length)));
        }
      }
    }

    out.push({
      kind: fn === 'describe' ? 'suite' : 'test',
      modifier,
      title: titleMatch[2],
      file,
      line: i + 1,
      skipped,
      asserts,
    });
    // Resume after this declaration. A `describe` body still has to be scanned
    // for the tests inside it, which is why the suite's body is not consumed:
    // only its own title line is skipped.
    i = Math.max(i, lineIndexAt(lines, start + cursor) - 1);
  }

  return out;
}

function lineOffset(lines: string[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += lines[i]!.length + 1;
  return offset;
}

function lineIndexAt(lines: string[], offset: number): number {
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    seen += lines[i]!.length + 1;
    if (seen > offset) return i + 1;
  }
  return lines.length;
}

/**
 * Whether a file's declarations mean it can be skipped wholesale: a vitest
 * `--exclude`-style suite skip, or a `describe.skip`. Used to catch a whole
 * suite wrapped in `describe.skip(...)`, which leaves the inner `it` calls
 * unmodified but never executed.
 */
export function hasSkippedSuite(declarations: TestDeclaration[]): boolean {
  return declarations.some((d) => d.kind === 'suite' && d.skipped);
}

/** Requirement citations found in test titles. */
export function extractTestCitations(opts: ResolvedOptions = resolveOptions()): TestCitation[] {
  const out: TestCitation[] = [];

  for (const declaration of extractTestDeclarations(opts)) {
    if (declaration.kind !== 'test') continue;
    const cited = CITATION.exec(declaration.title);
    if (!cited?.[1]) continue;
    for (const id of cited[1].trim().split(/\s+/)) {
      out.push({
        requirementId: id,
        title: declaration.title,
        file: declaration.file,
        line: declaration.line,
      });
    }
  }

  // Non-vitest evidence sources: a `// ID` comment cites the check below it.
  for (const source of opts.citationSources) {
    if (!fs.existsSync(source)) continue;
    const rel = path.relative(opts.repoRoot, source);
    const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const comment = /^\s*\/\/\s*([A-Z]{2,8}-\d{3}(?:\s+[A-Z]{2,8}-\d{3})*)\s*$/.exec(lines[i]!);
      if (!comment?.[1]) continue;
      for (const id of comment[1].trim().split(/\s+/)) {
        out.push({ requirementId: id, title: `e2e check at line ${i + 2}`, file: rel, line: i + 1 });
      }
    }
  }

  return out;
}

/** Requirement ids that appear in a test's title, e.g. "[GEN-001]" for later assertions. */
export function extractAllIdsInTitle(title: string): string[] {
  return [...title.matchAll(/\b([A-Z]{2,8}-\d{3})\b/g)]
    .map((m) => m[1]!)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

function asStringArray(value: YamlValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined) return [];
  return [String(value)];
}

function parseRequirements(opts: ResolvedOptions): { requirements: Requirement[]; errors: string[] } {
  const errors: string[] = [];
  const text = readIfPresent(opts.traceabilityPath);
  if (text === undefined) {
    return {
      requirements: [],
      errors: [`missing ${path.relative(opts.repoRoot, opts.traceabilityPath)}`],
    };
  }

  let doc: Record<string, YamlValue>;
  try {
    doc = parseYaml(text);
  } catch (err) {
    return {
      requirements: [],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  const raw = doc.requirements;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { requirements: [], errors: ['traceability.yaml has no `requirements:` map'] };
  }

  const requirements: Requirement[] = [];
  // Preserve declared order so reports read like the spec.
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${id}: entry must be a map`);
      continue;
    }
    const entry = value as Record<string, YamlValue>;
    const requirement: Requirement = {
      id,
      file: entry.file === undefined ? '' : String(entry.file),
      title: entry.title === undefined ? '' : String(entry.title),
      // Defaults, so the file stays readable: most requirements are implemented
      // and verified, and only deviations need stating.
      implementation: (entry.implementation === undefined
        ? 'implemented'
        : String(entry.implementation)) as Implementation,
      // No default for `verification`. Omitting it used to mean `verified`,
      // which made the strongest possible claim the one an author could make by
      // accident; the vocabulary check below now requires it to be stated. The
      // fallback is deliberately the weakest value, never `verified`.
      verification: (entry.verification === undefined
        ? 'unverified'
        : String(entry.verification)) as Verification,
      verificationStated: entry.verification !== undefined,
      tests: asStringArray(entry.tests),
      evidence: entry.evidence === undefined ? 'OBSERVED EVIDENCE' : String(entry.evidence),
      line: 0,
    };
    if (entry.gap !== undefined) requirement.gap = String(entry.gap);
    if (entry.finding !== undefined) requirement.finding = String(entry.finding);
    requirements.push(requirement);
  }

  return { requirements, errors };
}

export function runGate(options: GateOptions = {}): GateResult {
  const opts = resolveOptions(options);
  const SPEC_DIR = opts.specDir;
  const REQUIREMENT_FILES = opts.requirementFiles;
  const TESTS_DIR = opts.testsDir;
  const FINDINGS_DIR = opts.findingsDir;

  const checks: CheckResult[] = [];
  const check = (name: string, severity: Severity = 'error'): CheckResult => {
    const result: CheckResult = { name, severity, violations: [] };
    checks.push(result);
    return result;
  };

  const { requirements, errors: parseErrors } = parseRequirements(opts);

  const parseCheck = check('traceability.yaml parses and declares requirements');
  for (const e of parseErrors) parseCheck.violations.push(e);

  // ---------------------------------------------------------------- structure
  const declaredByFile = new Map<string, Map<string, number>>();
  for (const key of Object.keys(REQUIREMENT_FILES)) {
    declaredByFile.set(key, extractDeclaredIds(REQUIREMENT_FILES[key]!));
  }

  const oneFile = check('every requirement names a known requirement file');
  for (const r of requirements) {
    if (!Object.hasOwn(REQUIREMENT_FILES, r.file)) {
      oneFile.violations.push(
        `${r.id}: file '${r.file}' is not one of ${Object.keys(REQUIREMENT_FILES).join(', ')}`,
      );
    }
  }

  const exists = check('every requirement is declared as a heading in its file');
  for (const r of requirements) {
    const declared = declaredByFile.get(r.file);
    if (!declared) continue;
    const line = declared.get(r.id);
    if (line === undefined) {
      exists.violations.push(
        `${r.id}: not found as a heading in openspec/changes/${CHANGE_ID}/${r.file}.md`,
      );
    } else {
      r.line = line;
    }
  }

  const duplicates = check('no requirement id is declared twice in one file');
  for (const [file, declared] of declaredByFile) {
    const seen = new Map<string, number>();
    const text = readIfPresent(REQUIREMENT_FILES[file]!) ?? '';
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^#{2,6}\s+([A-Z]{2,8}-\d{3})\b/.exec(lines[i]!);
      if (!m?.[1]) continue;
      const id = m[1];
      if (seen.has(id)) {
        duplicates.violations.push(`${id}: declared on lines ${seen.get(id)} and ${i + 1} of ${file}.md`);
      } else {
        seen.set(id, i + 1);
      }
    }
    void declared;
  }

  // An id in the map that no file declares is an orphan entry; the reverse
  // (declared but unmapped) is reported below so both directions are covered.
  const mappedIds = new Set(requirements.map((r) => r.id));
  const unmapped = check('every declared requirement is present in traceability.yaml');
  for (const [file, declared] of declaredByFile) {
    for (const id of declared.keys()) {
      if (!mappedIds.has(id)) {
        unmapped.violations.push(`${id}: declared in ${file}.md but absent from traceability.yaml`);
      }
    }
  }

  const shape = check('requirement ids are well formed');
  for (const r of requirements) {
    if (!REQ_ID.test(r.id)) shape.violations.push(`${r.id}: does not match <AREA>-<NNN>`);
    const area = r.id.split('-')[0]!;
    const declared = declaredByFile.get(r.file);
    if (declared && ![...declared.keys()].some((k) => k.startsWith(`${area}-`))) {
      shape.violations.push(`${r.id}: area '${area}' does not appear in ${r.file}.md`);
    }
  }

  const vocab = check('implementation and verification use the defined vocabulary');
  const implOk = new Set<Implementation>(['implemented', 'partial', 'not_implemented', 'deferred', 'superseded']);
  const verOk = new Set<Verification>(['verified', 'unverified', 'n/a']);
  for (const r of requirements) {
    if (!implOk.has(r.implementation)) {
      vocab.violations.push(`${r.id}: unknown implementation '${r.implementation}'`);
    }
    if (!verOk.has(r.verification)) {
      vocab.violations.push(`${r.id}: unknown verification '${r.verification}'`);
    } else if (!r.verificationStated) {
      vocab.violations.push(
        `${r.id}: no \`verification\` given — state 'verified', 'unverified' or 'n/a' explicitly`,
      );
    }
  }

  // ------------------------------------------------------------------- tests
  const declarations = extractTestDeclarations(opts);
  const testDeclarations = declarations.filter((d) => d.kind === 'test');
  // A `describe.skip('...')` leaves the `it` calls inside it unmodified but
  // never executed, so any file containing a skipped suite is treated as
  // unproven wholesale rather than as evidence.
  const declarationsByFile = new Map<string, TestDeclaration[]>();
  for (const d of declarations) {
    const list = declarationsByFile.get(d.file) ?? [];
    list.push(d);
    declarationsByFile.set(d.file, list);
  }
  const filesWithSkippedSuite = new Set(
    [...declarationsByFile.entries()]
      .filter(([, list]) => hasSkippedSuite(list))
      .map(([file]) => file),
  );
  const citations = extractTestCitations(opts);
  const citedByRequirement = new Map<string, TestCitation[]>();
  for (const c of citations) {
    const list = citedByRequirement.get(c.requirementId) ?? [];
    list.push(c);
    citedByRequirement.set(c.requirementId, list);
  }
  // Test declarations by `file:line`, so a citation can be resolved back to the
  // declaration that produced it.
  const declarationAt = new Map<string, TestDeclaration>();
  for (const d of testDeclarations) declarationAt.set(`${d.file}:${d.line}`, d);

  const runsActually = check('every citing test actually runs');
  // Citations from a non-vitest source (`scripts/verify-e2e.ts`) are `// ID`
  // comments over real HTTP checks, not test declarations, so the structural
  // rules cannot apply to them: `pnpm verify:e2e` runs them and fails loudly.
  const isTestDeclarationCitation = (c: TestCitation): boolean =>
    !opts.citationSources.some((source) => path.relative(opts.repoRoot, source) === c.file);
  const testIsEvidence = (c: TestCitation): boolean => {
    if (!isTestDeclarationCitation(c)) return true;
    const declaration = declarationAt.get(`${c.file}:${c.line}`);
    if (!declaration) return false;
    if (declaration.skipped) return false;
    if (filesWithSkippedSuite.has(c.file)) return false;
    return true;
  };
  for (const c of citations) {
    if (!isTestDeclarationCitation(c)) continue;
    const declaration = declarationAt.get(`${c.file}:${c.line}`);
    if (declaration) {
      if (declaration.skipped) {
        runsActually.violations.push(
          `${c.file}:${c.line} is marked '${declaration.modifier}' but is cited as evidence for ${c.requirementId}`,
        );
      } else if (filesWithSkippedSuite.has(c.file)) {
        runsActually.violations.push(
          `${c.file} wraps its tests in a skipped suite, so ${c.requirementId} is not proven by line ${c.line}`,
        );
      }
    }
    // A citation whose test declaration cannot be found is reported by the
    // orphan/untethered checks; nothing extra to say here.
  }

  const assertsSomething = check('every citing test asserts something');
  for (const c of citations) {
    if (!isTestDeclarationCitation(c)) continue;
    const declaration = declarationAt.get(`${c.file}:${c.line}`);
    if (!declaration || declaration.asserts) continue;
    assertsSomething.violations.push(
      `${c.file}:${c.line} cites ${c.requirementId} but contains no assertion — an empty body cannot fail`,
    );
  }

  const orphanCitation = check('every requirement cited by a test exists in traceability.yaml');
  for (const c of citations) {
    if (!mappedIds.has(c.requirementId)) {
      orphanCitation.violations.push(
        `${c.file}:${c.line} cites unknown requirement ${c.requirementId} ("${c.title}")`,
      );
    }
  }

  const covered = check('every implemented requirement is covered by at least one test');
  for (const r of requirements) {
    if (r.implementation === 'implemented' || r.implementation === 'partial') {
      const cited = citedByRequirement.get(r.id) ?? [];
      if (cited.length === 0) {
        covered.violations.push(
          `${r.id} (${r.implementation}): no test cites it — add a test or mark it unverified`,
        );
      }
    }
  }

  const falseVerified = check('every requirement marked verified actually has a citing test');
  for (const r of requirements) {
    if (r.verification !== 'verified') continue;
    const cited = citedByRequirement.get(r.id) ?? [];
    if (cited.length === 0) {
      falseVerified.violations.push(
        `${r.id}: verification is 'verified' but no test cites it`,
      );
      continue;
    }
    // A citation is only evidence if the test it names actually runs and
    // asserts; otherwise the requirement is `verified` on paper alone.
    if (!cited.some(testIsEvidence)) {
      falseVerified.violations.push(
        `${r.id}: verification is 'verified' but every citing test is skipped, in a skipped suite, or unparseable`,
      );
    }
  }

  const declaredTests = check('declared test citations match the tests that cite them');
  for (const r of requirements) {
    // Distinct test titles, so a test citing several requirements still counts
    // once for each of them.
    const actual = new Set(
      (citedByRequirement.get(r.id) ?? []).map((c) => `${c.file}:${c.line}`),
    ).size;
    const declaredCount = r.tests.length;
    if (actual !== declaredCount) {
      declaredTests.violations.push(
        `${r.id}: traceability.yaml declares ${declaredCount} test(s) but ${actual} test title(s) cite it`,
      );
    }
  }

  const untethered = check('every test cites at least one requirement');
  for (const declaration of testDeclarations) {
    if (!CITATION.test(declaration.title)) {
      untethered.violations.push(
        `${declaration.file}:${declaration.line} "${declaration.title}" — expected a leading requirement id, e.g. 'CONV-004 ...'`,
      );
    }
  }

  // ------------------------------------------------------------ status rules
  const gaps = check('a partial requirement names its gap');
  for (const r of requirements) {
    if (r.implementation === 'partial' && !r.gap) {
      gaps.violations.push(`${r.id}: implementation is 'partial' but no \`gap\` is given`);
    }
  }

  const findings = check('a not_implemented or deferred requirement links a finding');
  const findingFiles = fs.existsSync(FINDINGS_DIR)
    ? fs.readdirSync(FINDINGS_DIR).filter((f) => f.endsWith('.md'))
    : [];
  for (const r of requirements) {
    if (r.implementation === 'not_implemented' || r.implementation === 'deferred') {
      if (!r.finding) {
        findings.violations.push(`${r.id}: implementation is '${r.implementation}' but no \`finding\` is given`);
      }
    }
  }

  const findingExists = check('every referenced finding exists on disk');
  for (const r of requirements) {
    if (!r.finding) continue;
    const present = findingFiles.some((f) => f.startsWith(`${r.finding}_`) || f === `${r.finding}.md`);
    if (!present) {
      findingExists.violations.push(
        `${r.id}: finding ${r.finding} has no artifact in openspec/changes/${CHANGE_ID}/findings/`,
      );
    }
  }

  const docs = check('every requirement document and artifact carries a metadata block');
  /**
   * Every markdown artifact under the change directory, discovered rather than
   * listed.
   *
   * This check used to name `spec.md` plus `findings/*.md`, and only those. The
   * criterion it enforces (`spec.md` AC-5) is "every material document", so the
   * hand-written list was the whole defect: `PROBLEMS.md`, `requirements.md`, the
   * change `README.md`, every `decisions/*.md` and the template went uninspected,
   * and an artifact could be added without a block and still report PASS. A
   * recursive scan cannot drift that way, and a new artifact is covered the moment
   * it lands.
   */
  const metadataDocs = discoverArtifacts(SPEC_DIR).filter(
    (doc) => path.relative(SPEC_DIR, doc) !== TEMPLATE_REL,
  );
  for (const doc of metadataDocs) {
    const text = readIfPresent(doc);
    const rel = path.relative(opts.repoRoot, doc);
    if (text === undefined) {
      docs.violations.push(`${rel}: missing`);
      continue;
    }
    if (!/^\|\s*\*\*ID\*\*\s*\|/m.test(text)) {
      docs.violations.push(`${rel}: no metadata block (\`| **ID** | ... |\`)`);
    }
    if (!/^\|\s*\*\*Status\*\*\s*\|/m.test(text)) {
      docs.violations.push(`${rel}: metadata block has no Status field`);
    }
  }

  /**
   * The repository's own precondition, enforced rather than assumed.
   *
   * `AGENTS.md`: "Do not implement until the specification has an explicit
   * `APPROVED` marker." Nothing else this gate checks means anything if the
   * specification authorising the work is still a draft, so this is the first
   * claim it verifies and the one that must never be relaxed to a warning.
   */
  const approved = check('the specification is APPROVED by a named approver');
  const specText = readIfPresent(path.join(SPEC_DIR, 'spec.md'));
  if (specText === undefined) {
    approved.violations.push(`missing ${path.relative(opts.repoRoot, path.join(SPEC_DIR, 'spec.md'))}`);
  } else {
    const specRel = path.relative(opts.repoRoot, path.join(SPEC_DIR, 'spec.md'));
    const status = metadataCell(specText, 'Status');
    if (status === undefined) {
      approved.violations.push(`${specRel}: no \`Status\` row in the metadata block`);
    } else if (!/^APPROVED\b/.test(status.trim())) {
      approved.violations.push(
        `${specRel}: Status is '${status.trim()}', not APPROVED — implementation is not authorised`,
      );
    }
    const approver = metadataCell(specText, 'Approved by');
    if (approver === undefined) {
      approved.violations.push(`${specRel}: no \`Approved by\` row in the metadata block`);
    } else if (!approver.trim() || approver.trim() === '—' || approver.trim() === '-') {
      approved.violations.push(`${specRel}: \`Approved by\` names no approver`);
    }
  }

  // ----------------------------------------------------------------- summary
  const byImplementation: Record<string, number> = {};
  const byVerification: Record<string, number> = {};
  for (const r of requirements) {
    byImplementation[r.implementation] = (byImplementation[r.implementation] ?? 0) + 1;
    byVerification[r.verification] = (byVerification[r.verification] ?? 0) + 1;
  }

  let errors = 0;
  let warnings = 0;
  for (const c of checks) {
    if (c.severity === 'error') errors += c.violations.length;
    else warnings += c.violations.length;
  }

  return {
    checks,
    requirements,
    summary: {
      total: requirements.length,
      byImplementation,
      byVerification,
      unverified: requirements.filter((r) => r.verification === 'unverified').map((r) => r.id),
      errors,
      warnings,
    },
  };
}

/** Human-readable report, used by `pnpm spec:status`. */
export function formatReport(result: GateResult): string {
  const lines: string[] = [];
  const { summary } = result;

  lines.push('');
  lines.push('SPEC TRACEABILITY REPORT');
  lines.push('='.repeat(60));
  lines.push(`requirements : ${summary.total}`);
  lines.push(
    `implementation: ${Object.entries(summary.byImplementation)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  lines.push(
    `verification  : ${Object.entries(summary.byVerification)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  lines.push('');

  for (const c of result.checks) {
    const status = c.violations.length === 0 ? 'ok  ' : c.severity === 'error' ? 'FAIL' : 'warn';
    lines.push(`[${status}] ${c.name}${c.violations.length ? ` (${c.violations.length})` : ''}`);
    for (const v of c.violations.slice(0, 15)) lines.push(`         - ${v}`);
    if (c.violations.length > 15) {
      lines.push(`         ... and ${c.violations.length - 15} more`);
    }
  }

  if (summary.unverified.length > 0) {
    lines.push('');
    lines.push(`UNVERIFIED REQUIREMENTS (${summary.unverified.length}) — implemented, unproven`);
    const perLine = 8;
    for (let i = 0; i < summary.unverified.length; i += perLine) {
      lines.push(`  ${summary.unverified.slice(i, i + perLine).join('  ')}`);
    }
    lines.push(`  see openspec/changes/${CHANGE_ID}/PROBLEMS.md`);
  }

  lines.push('');
  lines.push(
    summary.errors === 0
      ? `RESULT: PASS (${summary.warnings} warning(s))`
      : `RESULT: FAIL — ${summary.errors} error(s)`,
  );
  lines.push('');
  return lines.join('\n');
}
