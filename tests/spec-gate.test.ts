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

afterAll(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(options: { approveSpec?: boolean; statusRow?: string } = {}): {
  root: string;
  opts: GateOptions;
  testsDir: string;
} {
  const real = resolveOptions();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-gate-'));

  // Mirror the real layout: openspec/changes/<id>/ plus tests/ and scripts/.
  const changeRel = path.relative(real.repoRoot, real.specDir);
  fs.mkdirSync(path.join(root, path.dirname(changeRel)), { recursive: true });
  fs.cpSync(real.specDir, path.join(root, changeRel), { recursive: true });
  fs.cpSync(real.testsDir, path.join(root, 'tests'), { recursive: true });
  // Fixture tree for the non-vitest citation path (`citationSources`). The real
  // repository has no such source in this change — the e2e script that needed a
  // real socket belongs to the follow-on test change — so the fixture supplies
  // its own. Writing it here rather than copying a real file is deliberate: the
  // path must exist even on the branch that ships only the gate, or every
  // fixture would fail for a reason that does not apply to the gate itself.
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scripts', 'e2e-checks.ts'),
    ['// SIM-003', 'check(streams);', '// SIM-004', 'check(uploads);', ''].join('\n'),
  );

  const testsDir = path.join(root, 'tests');
  fs.rmSync(path.join(testsDir, 'spec-gate.test.ts'), { force: true });

  // The real `spec.md` is APPROVED, so the fixture's copy already is. Tests that
  // probe the approval rules rewrite the copy themselves.
  if (options.approveSpec === false) {
    const specPath = path.join(root, changeRel, 'spec.md');
    fs.writeFileSync(
      specPath,
      fs
        .readFileSync(specPath, 'utf8')
        .replace(/^\| \*\*Status\*\* \|.*\|$/m, '| **Status** | DRAFT — awaiting human approval |')
        .replace(/^\| \*\*Approved by\*\* \|.*\|$/m, '| **Approved by** | — |'),
    );
  }

  // The real change ships the baseline and the gate, not the product suite, so
  // its own tree fails the coverage check. Every falsification test below needs
  // to start from a tree that passes and break exactly one thing, so seed one
  // asserting test per implemented requirement. Those requirements are then
  // genuinely covered *in the fixture*, which is what makes "break one rule"
  // observable.
  seedCoverage(root, changeRel);

  tmpRoots.push(root);
  // `citationSources` must point at the fixture's own copy. Leaving the default
  // in place would fall back to the real repository's sources, so a fixture that
  // broke a citation in its copy would still pass.
  return {
    root,
    opts: {
      repoRoot: root,
      excludeTestFiles: [],
      citationSources: [path.join(root, 'scripts', 'e2e-checks.ts')],
    },
    testsDir,
  };
}

/**
 * Gives every implemented requirement a test that cites it, so the fixture
 * starts with zero coverage violations. `CONV-001` lands in a named file that
 * tests can edit; the rest are generated.
 */
function seedCoverage(root: string, changeRel: string): void {
  const doc = parseYaml(fs.readFileSync(path.join(root, changeRel, 'traceability.yaml'), 'utf8'));
  const reqs = (doc.requirements ?? {}) as Record<string, Record<string, unknown>>;

  const seedName = 'product.test.ts';
  const seed: string[] = [
    "import { expect, it } from 'vitest';",
    "it('CONV-001 stages are formally enumerated', () => { expect(1).toBe(1); });",
  ];
  const generated: string[] = ["import { expect, it } from 'vitest';"];

  for (const [id, meta] of Object.entries(reqs)) {
    const implementation = String(meta.implementation ?? 'implemented');
    if (implementation !== 'implemented' && implementation !== 'partial') continue;
    setEntry(
      root,
      id,
      `file: requirements, title: ${String(meta.title ?? id)}, verification: unverified, gap: fixture seeded for coverage, tests: [${id}]`,
    );
    if (id === 'CONV-001') continue;
    generated.push(`it('${id} is covered by this fixture', () => { expect(1).toBe(1); });`);
  }

  const testsDir = path.join(root, 'tests');
  fs.writeFileSync(path.join(testsDir, seedName), `${seed.join('\n')}\n`);
  fs.writeFileSync(path.join(testsDir, 'generated.test.ts'), `${generated.join('\n')}\n`);

  // The fixture's citation source cites two ids, so declare exactly the counts
  // the tree now produces — otherwise the "clean tree" fixture would trip the
  // declared-count check, which exists to catch a real mismatch.
  for (const id of ['SIM-003', 'SIM-004']) {
    const meta = reqs[id];
    if (!meta) continue;
    setEntry(
      root,
      id,
      `file: requirements, title: ${String(meta.title ?? id)}, verification: unverified, gap: fixture seeded for coverage, tests: [${id}, ${id}]`,
    );
  }
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

  it('has no violations other than the coverage the follow-on change supplies', () => {
    const failures = result.checks.filter(
      (c) => c.severity === 'error' && c.violations.length > 0,
    );
    // The specification is APPROVED and every other rule holds, but this change
    // deliberately ships the baseline and the gate without the product suite, so
    // 153 implemented requirements have no test citing them here. That is the
    // gate reading the tree correctly, and it is the one thing the
    // `expand-test-coverage` change turns green. Anything else failing would
    // mean the gate or the baseline drifted.
    expect(failures.map((c) => c.name)).toEqual([
      'every implemented requirement is covered by at least one test',
    ]);
    expect(failures[0]!.violations).toHaveLength(153);
  });

  it('marks the requirements no test proves as unverified rather than verified', () => {
    // Named explicitly so a future edit cannot silently flip them back to
    // `verified` — the defect this list was created to fix.
    expect(result.summary.unverified).toEqual(
      expect.arrayContaining(['GEN-008', 'GEN-009', 'SIM-008']),
    );
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
    const testPath = path.join(root, 'tests', 'product.test.ts');
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

    // Remove every piece of evidence for SIM-003 — the vitest citation and the
    // citation-source comment — then leave the requirement claiming it is
    // verified. That combination is the false-claim failure mode the gate
    // exists to catch.
    const generatedPath = path.join(root, 'tests', 'generated.test.ts');
    fs.writeFileSync(
      generatedPath,
      fs
        .readFileSync(generatedPath, 'utf8')
        .split('\n')
        .filter((line) => !line.includes("it('SIM-003 "))
        .join('\n'),
    );
    const scriptPath = path.join(root, 'scripts', 'e2e-checks.ts');
    fs.writeFileSync(
      scriptPath,
      fs.readFileSync(scriptPath, 'utf8').replace(/^\s*\/\/\s*SIM-003\s*$/m, '  // citation removed'),
    );
    setEntry(
      root,
      'SIM-003',
      'file: channels, title: Bot replies are streamed to the client, verification: verified, tests: []',
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
      'file: channels, title: Read receipts, implementation: partial, tests: [], finding: F-002',
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
    // Requirement files are not metadata-bearing; SPEC and findings are. Drop
    // only the ID row, so the Status/approval check still has something to read
    // and this test fails for the metadata reason alone.
    const specPath = path.join(root, 'openspec', 'changes', changeId, 'spec.md');
    fs.writeFileSync(specPath, fs.readFileSync(specPath, 'utf8').replace(/^\| \*\*ID\*\*.*$/m, ''));
    const result = runGate(opts);
    expect(findCheck(result, 'carries a metadata block').violations.join('\n')).toContain('spec.md');
  });

  it('detects a requirement that never states its verification', () => {
    const { root, opts } = fixture();
    setEntry(root, 'GEN-006', 'file: generation, title: References, tests: [GEN-006]');
    const result = runGate(opts);
    expect(findCheck(result, 'use the defined vocabulary')?.violations.join('\n')).toContain(
      'GEN-006',
    );
  });
});

describe('gate refuses an unapproved specification', () => {
  const specPath = (root: string) => path.join(root, 'openspec', 'changes', changeId, 'spec.md');

  it('fails when the spec is still a DRAFT, naming the missing approval', () => {
    const { root, opts } = fixture({ approveSpec: false });
    const result = runGate(opts);
    const violations = findCheck(result, 'specification is APPROVED')?.violations.join('\n') ?? '';
    expect(violations).toContain('DRAFT');
    expect(violations).toContain('Approved by');
  });

  it('fails when the spec is approved but names no approver', () => {
    const { root, opts } = fixture();
    fs.writeFileSync(
      specPath(root),
      fs
        .readFileSync(specPath(root), 'utf8')
        .replace(/^\| \*\*Approved by\*\* \|.*\|$/m, '| **Approved by** | — |'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'specification is APPROVED')?.violations.join('\n')).toContain(
      'no approver',
    );
  });

  it('fails when the spec has no Status row at all', () => {
    const { root, opts } = fixture();
    fs.writeFileSync(
      specPath(root),
      fs.readFileSync(specPath(root), 'utf8').replace(/^\| \*\*Status\*\* \|.*\|$/m, ''),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'specification is APPROVED')?.violations.join('\n')).toContain(
      'no `Status` row',
    );
  });
});

describe('gate cannot be satisfied by a test that does not run', () => {
  it('detects a whole suite wrapped in describe.skip', () => {
    const { root, opts } = fixture();
    // Claim CONV-002 is verified, then make the suite that cites it skipped.
    setEntry(
      root,
      'CONV-002',
      'file: requirements, title: Terminal sessions are not resumed, verification: verified, gap: seeded as verified for this probe, tests: [CONV-002]',
    );
    const testPath = path.join(root, 'tests', 'generated.test.ts');
    const original = fs.readFileSync(testPath, 'utf8');
    // Wrap the entire file in a skipped suite: the inner `it` calls keep their
    // citations, so a text-only gate reports full coverage.
    const wrapped = `describe.skip('skipped wholesale', () => {\n${original}\n});\n`;
    fs.writeFileSync(testPath, wrapped);

    const result = runGate(opts);
    expect(findCheck(result, 'actually runs')?.violations.join('\n')).toContain(
      'skipped suite',
    );
    expect(findCheck(result, 'marked verified actually has a citing test')?.violations.join('\n')).toContain(
      'CONV-002',
    );
  });

  it('detects an individual it.skip citing a requirement', () => {
    const { opts, testsDir } = fixture();
    fs.writeFileSync(
      path.join(testsDir, 'skipped.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        "it.skip('CONV-001 is skipped but still cites the requirement', () => { expect(1).toBe(1); });",
      ].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'actually runs')?.violations.join('\n')).toContain('CONV-001');
  });

  it('detects an it.todo citing a requirement', () => {
    const { opts, testsDir } = fixture();
    fs.writeFileSync(
      path.join(testsDir, 'todo.test.ts'),
      ["import { it } from 'vitest';", "it.todo('CONV-001 will be written later');"].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'actually runs')?.violations.join('\n')).toContain('CONV-001');
  });

  it('detects an emptied test body that still cites a requirement', () => {
    const { opts, testsDir } = fixture();
    fs.writeFileSync(
      path.join(testsDir, 'empty.test.ts'),
      [
        "import { it } from 'vitest';",
        "it('CONV-001 has a title and no assertions at all', () => {});",
      ].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'asserts something')?.violations.join('\n')).toContain(
      'no assertion',
    );
  });

  it('does not mistake a brace inside a regex literal for a test body', () => {
    const { opts, testsDir } = fixture();
    // `said(/Here's the brief/)` contains an apostrophe and a `{`-free regex;
    // a parser that scans naively for a body sees the regex as code and reports
    // an assertion where there is none.
    fs.writeFileSync(
      path.join(testsDir, 'regex.test.ts'),
      [
        "import { it } from 'vitest';",
        "const said = (_pattern: RegExp): boolean => true;",
        "it('CONV-001 has no assertion but does call a helper', () => {",
        "  said(/Here's the brief/);",
        '});',
      ].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'asserts something')?.violations.join('\n')).toContain('CONV-001');
  });

  it('detects an uncited test in a subdirectory', () => {
    const { opts, testsDir } = fixture();
    fs.mkdirSync(path.join(testsDir, 'unit'), { recursive: true });
    fs.writeFileSync(
      path.join(testsDir, 'unit', 'untethered.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        "it('does something without naming a requirement', () => { expect(1).toBe(1); });",
      ].join('\n'),
    );
    const result = runGate(opts);
    // The non-recursive scan this gate used to do would not even see the file.
    expect(findCheck(result, 'every test cites at least one requirement')?.violations.join('\n')).toContain(
      'does something without naming',
    );
  });

  it('detects an orphan citation in a subdirectory', () => {
    const { opts, testsDir } = fixture();
    fs.mkdirSync(path.join(testsDir, 'unit'), { recursive: true });
    fs.writeFileSync(
      path.join(testsDir, 'unit', 'bogus.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        "it('ZZZ-999 cites a requirement that does not exist', () => { expect(1).toBe(1); });",
      ].join('\n'),
    );
    const result = runGate(opts);
    expect(findCheck(result, 'cited by a test exists')?.violations.join('\n')).toContain('ZZZ-999');
  });
});
