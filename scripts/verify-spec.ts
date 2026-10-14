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
 * Run as a library from `tests/spec-traceability.test.ts` (so `pnpm test` covers
 * it) and as a CLI via `pnpm spec:status` for the human-readable report.
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
    excludeTestFiles: options.excludeTestFiles ?? ['spec-traceability.test.ts', 'spec-gate.test.ts'],
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

/** Requirement citations found in test titles. */
export function extractTestCitations(opts: ResolvedOptions = resolveOptions()): TestCitation[] {
  const out: TestCitation[] = [];
  if (!fs.existsSync(opts.testsDir)) return out;
  const files = fs
    .readdirSync(opts.testsDir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();

  for (const file of files) {
    // The gate's own tests cite ids as fixtures to prove violation detection,
    // so they are not counted as coverage.
    if (opts.excludeTestFiles.includes(file)) continue;

    const full = path.join(opts.testsDir, file);
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^\s*(?:it|test)\(\s*(['"`])(.*?)\1/.exec(lines[i]!);
      const title = match?.[2];
      if (!title) continue;
      const cited = CITATION.exec(title);
      if (!cited?.[1]) continue;
      for (const id of cited[1].trim().split(/\s+/)) {
        out.push({ requirementId: id, title, file, line: i + 1 });
      }
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
      verification: (entry.verification === undefined
        ? 'verified'
        : String(entry.verification)) as Verification,
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
        `${r.id}: not found as a heading in spec/requirements/${r.file}.md`,
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
    }
  }

  // ------------------------------------------------------------------- tests
  const citations = extractTestCitations(opts);
  const citedByRequirement = new Map<string, TestCitation[]>();
  for (const c of citations) {
    const list = citedByRequirement.get(c.requirementId) ?? [];
    list.push(c);
    citedByRequirement.set(c.requirementId, list);
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
  const testFiles = fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.ts') && !opts.excludeTestFiles.includes(f))
    .sort();
  for (const file of testFiles) {
    const lines = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^\s*(?:it|test)\(\s*(['"`])(.*?)\1/.exec(lines[i]!);
      const title = m?.[2];
      if (!title) continue;
      if (!CITATION.test(title)) {
        untethered.violations.push(
          `${file}:${i + 1} "${title}" — expected a leading requirement id, e.g. 'CONV-004 ...'`,
        );
      }
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
        `${r.id}: finding ${r.finding} has no artifact in spec/artifacts/`,
      );
    }
  }

  const docs = check('every requirement document and artifact carries a metadata block');
  // Material artifacts that must carry a metadata block. requirements.md holds
  // normative text and uses headings instead, so it is checked separately.
  const metadataDocs = [
    path.join(SPEC_DIR, 'spec.md'),
    ...findingFiles.map((f) => path.join(FINDINGS_DIR, f)),
  ];
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
    lines.push('  see spec/artifacts/PRB-0003_Normalization_Gaps.md');
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
