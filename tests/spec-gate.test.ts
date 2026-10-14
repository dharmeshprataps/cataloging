import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseYaml } from '../scripts/lib/yaml.js';
import {
  CHANGE_ID as changeId,
  formatReport,
  resolveOptions,
  runGate,
  type GateOptions,
} from '../scripts/verify-spec.js';

/**
 * Tests for the traceability gate, including the obligation that actually
 * matters: **the gate must fail when a rule is violated.**
 *
 * This is not theoretical. An earlier design used vitest test tags, which the
 * installed runner accepts and silently discards — that gate would have reported
 * full coverage while inspecting nothing (`DEC-0006`). A gate nobody has watched
 * fail is not evidence of anything, so every rule has a falsification test.
 *
 * Fixtures copy the real `spec/` and `tests/` trees into a temp directory and
 * then break one thing. Testing against copies of the real files (rather than
 * hand-written toys) means the fixtures cannot pass for a reason that does not
 * apply to the real project. Replacements are format-independent, so reformatting
 * traceability.yaml does not silently disarm these tests.
 *
 * This file is excluded from citation checks (`scripts/verify-spec.ts`
 * `excludeTestFiles`): its tests manipulate requirement ids as fixtures.
 */

const tmpRoots: string[] = [];

afterAll(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): { root: string; opts: GateOptions; testsDir: string } {
  const real = resolveOptions();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-gate-'));

  // Mirror the real layout: openspec/changes/<id>/ plus tests/ and scripts/.
  const changeRel = path.relative(real.repoRoot, real.specDir);
  fs.mkdirSync(path.join(root, path.dirname(changeRel)), { recursive: true });
  fs.cpSync(real.specDir, path.join(root, changeRel), { recursive: true });
  fs.cpSync(real.testsDir, path.join(root, 'tests'), { recursive: true });
  // The e2e script is a citation source, so the fixture must include it or the
  // fixture would fail for a reason that does not apply to the real project.
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(real.repoRoot, 'scripts', 'verify-e2e.ts'),
    path.join(root, 'scripts', 'verify-e2e.ts'),
  );

  const testsDir = path.join(root, 'tests');
  fs.rmSync(path.join(testsDir, 'spec-gate.test.ts'), { force: true });
  fs.rmSync(path.join(testsDir, 'spec-traceability.test.ts'), { force: true });

  tmpRoots.push(root);
  return { root, opts: { repoRoot: root, excludeTestFiles: [] }, testsDir };
}

const tracePath = (root: string) =>
  path.join(root, 'openspec', 'changes', changeId, 'traceability.yaml');
const readTrace = (root: string) => fs.readFileSync(tracePath(root), 'utf8');
const writeTrace = (root: string, text: string) => fs.writeFileSync(tracePath(root), text);

/** Replaces the whole `ID: { ... }` line for a requirement. */
function setEntry(root: string, id: string, body: string): void {
  const next = readTrace(root).replace(
    new RegExp(`^  ${id}: \\{.*\\}$`, 'm'),
    `  ${id}: { ${body} }`,
  );
  writeTrace(root, next);
}

/**
 * Looks a check up by name fragment and FAILS if it is absent, so renaming a
 * check cannot silently turn a falsification test into a no-op.
 */
function findCheck(result: ReturnType<typeof runGate>, fragment: string) {
  const found = result.checks.find((c) => c.name.includes(fragment));
  expect(found, `no gate check matching "${fragment}" — was it renamed?`).toBeDefined();
  return found!;
}

describe('YAML reader', () => {
  it('parses the real traceability file', () => {
    const doc = parseYaml(readTrace(resolveOptions().repoRoot));
    expect(doc.version).toBe(1);
    expect(doc.change).toBe(changeId);
    expect(typeof doc.requirements).toBe('object');
  });

  it('parses inline maps, flow sequences and scalar types', () => {
    const doc = parseYaml(
      [
        'version: 1',
        'flag: true',
        'nothing: null',
        'requirements:',
        '  CONV-001: { file: conversation, title: A title with: a colon, tests: [CONV-001] }',
        '  CONV-002: { file: conversation, title: Unverified, verification: unverified, tests: [] }',
      ].join('\n'),
    );
    expect(doc.flag).toBe(true);
    expect(doc.nothing).toBeNull();
    const reqs = doc.requirements as Record<string, Record<string, unknown>>;
    expect(reqs['CONV-001']!.title).toBe('A title with: a colon');
    expect(reqs['CONV-001']!.tests).toEqual(['CONV-001']);
    expect(reqs['CONV-002']!.tests).toEqual([]);
  });

  it('ignores comments while keeping a # inside a value', () => {
    const doc = parseYaml('# lead\n\nversion: 2\nnote: value#kept\n');
    expect(doc.version).toBe(2);
    expect(doc.note).toBe('value#kept');
  });

  it('throws rather than guessing on malformed input', () => {
    expect(() => parseYaml('key without colon\n')).toThrow(/YAML parse error/);
  });
});

describe('gate against the real project', () => {
  const result = runGate();

  it('passes with no violations', () => {
    const failures = result.checks.filter(
      (c) => c.severity === 'error' && c.violations.length > 0,
    );
    // If this fails, the violation text names the exact requirement or test.
    expect(failures.map((c) => `${c.name}: ${c.violations[0]}`)).toEqual([]);
  });

  it('covers a substantial requirement set', () => {
    expect(result.summary.total).toBeGreaterThan(100);
  });

  it('is honest about what remains unverified', () => {
    // Not an assertion that unverified must be zero — it must be *visible*.
    for (const id of result.summary.unverified) {
      expect(id).toMatch(/^[A-Z]{2,8}-\d{3}$/);
    }
  });

  it('renders a report containing the summary and result', () => {
    const report = formatReport(result);
    expect(report).toContain('SPEC TRACEABILITY REPORT');
    expect(report).toContain('RESULT:');
    // The unverified section is conditional: it is absent when nothing is
    // unverified, which is correct rather than a regression.
    if (result.summary.unverified.length > 0) {
      expect(report).toContain('UNVERIFIED REQUIREMENTS');
    }
  });
});

describe('gate passes on an unmodified copy of the real project', () => {
  it('has no errors, proving the fixtures are faithful', () => {
    const { opts } = fixture();
    const result = runGate(opts);
    const failures = result.checks.filter(
      (c) => c.severity === 'error' && c.violations.length > 0,
    );
    expect(failures.map((c) => `${c.name}: ${c.violations[0]}`)).toEqual([]);
  });
});

describe('gate fails when it should', () => {
  it('reports a missing traceability file', () => {
    const { opts } = fixture();
    fs.rmSync(tracePath(opts.repoRoot!), { force: true });
    const result = runGate(opts);
    expect(findCheck(result, 'traceability.yaml parses')?.violations.length).toBeGreaterThan(0);
    expect(result.summary.errors).toBeGreaterThan(0);
  });

  it('detects a test citing an unknown requirement', () => {
    const { opts, testsDir } = fixture();
    fs.writeFileSync(
      path.join(testsDir, 'orphan.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        "it('CONV-999 cites a requirement that does not exist', () => { expect(1).toBe(1); });",
      ].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'cited by a test exists')?.violations.join('\n')).toContain(
      'CONV-999',
    );
  });

  it('detects a test that cites no requirement at all', () => {
    const { opts, testsDir } = fixture();
    fs.writeFileSync(
      path.join(testsDir, 'untethered.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        "it('does something without naming a requirement', () => { expect(1).toBe(1); });",
      ].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'every test cites at least one requirement')?.violations.join('\n')).toContain(
      'does something without naming',
    );
  });

  it('detects an implemented requirement with no test citing it', () => {
    const { root, opts } = fixture();
    // Remove CONV-001's citation from the test that names it.
    const testPath = path.join(root, 'tests', 'pipeline.test.ts');
    const original = fs.readFileSync(testPath, 'utf8');
    const withoutCitation = original.replace(
      /it\('CONV-001 /,
      "it('citation was removed ",
    );
    expect(withoutCitation, 'fixture must contain the CONV-001 citation').not.toBe(original);
    fs.writeFileSync(testPath, withoutCitation);

    const result = runGate(opts);
    expect(findCheck(result, 'covered by at least one test')?.violations.join('\n')).toContain(
      'CONV-001',
    );
  });

  it('detects a requirement claimed as verified without a citing test', () => {
    const { root, opts } = fixture();

    // Remove every piece of evidence for SIM-003, then leave the requirement
    // claiming it is verified. That combination is the false-claim failure mode
    // the gate exists to catch.
    const scriptPath = path.join(root, 'scripts', 'verify-e2e.ts');
    fs.writeFileSync(
      scriptPath,
      fs.readFileSync(scriptPath, 'utf8').replace(/^\s*\/\/\s*SIM-003\s*$/m, '  // citation removed'),
    );
    setEntry(
      root,
      'SIM-003',
      'file: channels, title: Bot replies are streamed to the client, tests: []',
    );

    const result = runGate(opts);
    const violation = findCheck(result, 'marked verified actually has a citing test');
    expect(violation.violations.join('\n')).toContain('SIM-003');
  });

  it('detects a declared test count that does not match the citations', () => {
    const { root, opts } = fixture();
    setEntry(
      root,
      'CONV-001',
      'file: conversation, title: Stages are formally enumerated, tests: [CONV-001, CONV-002]',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'declared test citations match')?.violations.join('\n')).toContain(
      'CONV-001',
    );
  });

  it('detects a requirement in the map with no heading in its requirement file', () => {
    const { root, opts } = fixture();
    fs.appendFileSync(
      tracePath(root),
      '  ZZZ-001: { file: requirements, title: Not declared anywhere, tests: [ZZZ-001] }\n',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'declared as a heading in its file')?.violations.join('\n')).toContain('ZZZ-001');
  });

  it('detects an unmapped id declared in a requirement document', () => {
    const { root, opts } = fixture();
    fs.appendFileSync(
      path.join(root, 'openspec', 'changes', changeId, 'requirements.md'),
      '\n### CONV-901 — Declared but never mapped\n\nText.\n',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'present in traceability.yaml')?.violations.join('\n')).toContain(
      'CONV-901',
    );
  });

  it('detects a partial requirement that does not name its gap', () => {
    const { root, opts } = fixture();
    setEntry(
      root,
      'WA-019',
      'file: channels, title: Read receipts, implementation: partial, tests: [], finding: PRB-0001',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'partial requirement names its gap')?.violations.join('\n')).toContain(
      'WA-019',
    );
  });

  it('detects a not_implemented requirement with no linked finding', () => {
    const { root, opts } = fixture();
    setEntry(
      root,
      'WA-009',
      'file: channels, title: Service window, implementation: not_implemented, tests: []',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'not_implemented or deferred')?.violations.join('\n')).toContain(
      'WA-009',
    );
  });

  it('detects a linked finding that does not exist on disk', () => {
    const { root, opts } = fixture();
    setEntry(
      root,
      'GEN-006',
      'file: generation, title: References, verification: unverified, tests: [], finding: PRB-9999',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'finding exists on disk')?.violations.join('\n')).toContain(
      'PRB-9999',
    );
  });

  it('detects an unknown verification vocabulary value', () => {
    const { root, opts } = fixture();
    setEntry(
      root,
      'GEN-006',
      'file: generation, title: References, verification: probably, tests: []',
    );
    const result = runGate(opts);
    expect(findCheck(result, 'use the defined vocabulary')?.violations.join('\n')).toContain(
      'GEN-006',
    );
  });

  it('detects an unknown implementation vocabulary value', () => {
    const { root, opts } = fixture();
    setEntry(root, 'GEN-006', 'file: generation, title: References, implementation: maybe, tests: []');
    const result = runGate(opts);
    expect(findCheck(result, 'use the defined vocabulary')?.violations.join('\n')).toContain(
      'GEN-006',
    );
  });

  it('detects a requirement naming an unknown requirement file', () => {
    const { root, opts } = fixture();
    setEntry(root, 'GEN-006', 'file: nonexistent, title: References, tests: [GEN-006]');
    const result = runGate(opts);
    expect(findCheck(result, 'names a known requirement file')?.violations.join('\n')).toContain('GEN-006');
  });

  it('detects a requirement document missing its metadata block', () => {
    const { root, opts } = fixture();
    // Requirement files are not metadata-bearing; SPEC and findings are.
    const specPath = path.join(root, 'openspec', 'changes', changeId, 'spec.md');
    fs.writeFileSync(specPath, fs.readFileSync(specPath, 'utf8').replace(/^\| \*\*ID\*\*.*$/m, ''));
    const result = runGate(opts);
    expect(findCheck(result, 'carries a metadata block').violations.join('\n')).toContain('spec.md');
  });
});
