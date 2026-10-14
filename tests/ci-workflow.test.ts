import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../scripts/verify-spec.js';

/**
 * Tests for the CI workflow this change adds.
 *
 * `.github/workflows/agent-policy.yml` was the only workflow at the merged
 * baseline revision, and it checked one thing: that a pull request body names a
 * spec path. Nothing installed the dependencies, ran the suite, ran the build, or
 * ran the gate. `openspec/changes/requirements-baseline/README.md` recorded that
 * as known limitation 3 — "`pnpm test` must be run by hand" — which is a
 * statement about a *pull request*, so no test in the suite could have caught it.
 *
 * Every test here cites `TOOL-003`, the requirement the follow-on
 * `ci-traceability-gate` change adds for that behaviour. The baseline's gate
 * rejects a test that cites no requirement, which is why the requirement exists:
 * the gate would not let the workflow's own tests exist untraceable.
 *
 * Each rule below therefore has a falsification test that mutates the workflow
 * and watches the rule report it, in the style `tests/spec-gate.test.ts` uses for
 * the traceability gate: a check nobody has watched fail is not evidence.
 *
 * The workflow is read structurally rather than by regex-scraping whole files,
 * but it is not parsed with `scripts/lib/yaml.ts`: that reader is built for the
 * traceability index's flow maps and rejects a sequence of maps, which is what
 * every GitHub Actions `steps:` list is. The readers below understand only the
 * subset this workflow uses — top-level keys, and two-space-indented job keys —
 * and say so rather than pretending to be general.
 */

const { repoRoot, citationSources } = resolveOptions();
const workflowRel = '.github/workflows/ci.yml';
const workflowPath = path.join(repoRoot, workflowRel);
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  packageManager?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
};

function readWorkflow(): string {
  return fs.readFileSync(workflowPath, 'utf8');
}

/**
 * The text of a top-level block: the key's own line plus every following line
 * indented beneath it, stopping at the next line that starts in column zero.
 */
function topLevelBlock(workflowText: string, key: string): string {
  const lines = workflowText.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return '';
  const body: string[] = [lines[start]!];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

/** Job id -> that job's block text, for the two-space-indented keys under `jobs:`. */
function jobBlocks(workflowText: string): Record<string, string> {
  const lines = topLevelBlock(workflowText, 'jobs').split('\n');
  const blocks: Record<string, string> = {};
  let current: string | undefined;
  for (const line of lines.slice(1)) {
    const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (header) {
      current = header[1]!;
      blocks[current] = '';
      continue;
    }
    if (current !== undefined) blocks[current] += `${line}\n`;
  }
  return blocks;
}

/** A `- name:` entry — a job under `jobs:`, or a step under `steps:`. */
type Block = { name: string; fields: Record<string, string>; children: Block[] };

/**
 * The `key: value` lines of a block, ignoring keys that are really just part of
 * a nested block's path. Two keys are never repeated in this workflow, which is
 * asserted by `missingChecks` reporting a job that declares two `if:` lines.
 */
function blockFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split('\n')) {
    if (/^\s*-/.test(line)) continue;
    const match = /^[ \t]*([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.trim();
  }
  return fields;
}

/** A `- ` sequence at exactly `indent` spaces, each entry taking its nested lines. */
function blocksAt(lines: string[], indent: number): Block[] {
  const blocks: Block[] = [];
  let entry: { name: string; body: string[] } | undefined;
  for (const line of lines) {
    const header = new RegExp(`^ {${indent}}- (.*)$`).exec(line);
    if (header) {
      if (entry) blocks.push({ name: entry.name, ...splitEntry(entry.body) });
      const label = /^name:\s*(.+)$/.exec(header[1]!.trim());
      entry = { name: label ? label[1]!.trim().replace(/^['"]|['"]$/g, '') : header[1]!.trim(), body: [] };
      continue;
    }
    if (entry) entry.body.push(line);
  }
  if (entry) blocks.push({ name: entry.name, ...splitEntry(entry.body) });
  return blocks;
}

/** A block's own properties, plus any deeper `- ` sequence as its children. */
function splitEntry(body: string[]): { fields: Record<string, string>; children: Block[] } {
  const own: string[] = [];
  const nested: string[] = [];
  let inChildren = false;
  for (const line of body) {
    if (/^ {6}- /.test(line)) inChildren = true;
    (inChildren ? nested : own).push(line);
  }
  return { fields: blockFields(own.join('\n')), children: inChildren ? blocksAt(nested, 6) : [] };
}

/** One job: its id, its own condition, its steps, and the commands those run. */
type Job = { id: string; condition: string | undefined; steps: { condition: string | undefined; run: string }[] };

/** Every job, with the condition and `run:` commands of each of its steps. */
function workflowJobs(workflowText: string): Job[] {
  const jobs = topLevelBlock(workflowText, 'jobs');
  const lines = jobs.split('\n').slice(1);
  const entries: { id: string; body: string[] }[] = [];
  let entry: { id: string; body: string[] } | undefined;
  for (const line of lines) {
    const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (header) {
      if (entry) entries.push(entry);
      entry = { id: header[1]!, body: [] };
      continue;
    }
    if (entry) entry.body.push(line);
  }
  if (entry) entries.push(entry);

  return entries.map(({ id, body }) => {
    const own: string[] = [];
    const stepLines: string[] = [];
    let inSteps = false;
    for (const line of body) {
      if (/^ {4}steps:\s*$/.test(line)) inSteps = true;
      (inSteps ? stepLines : own).push(line);
    }
    return {
      id,
      condition: blockFields(own.join('\n'))['if'],
      steps: blocksAt(stepLines, 6).map((step) => ({
        condition: step.fields['if'],
        run: step.fields['run'] ?? '',
      })),
    };
  });
}

/**
 * Whether a condition disables its job or step however the workflow is run.
 *
 * Both spellings GitHub accepts for a literal are recognised — `if: false` and
 * `if: ${{ false }}` — plus the literal `0`. Anything the expression language
 * computes from context (a matrix value, `github.event`, a comparison) is
 * deliberately left alone: a static reader cannot decide it, and guessing would
 * report a working workflow as broken. The gap that leaves is recorded in §7.4 of
 * the change spec.
 */
function staticallyDisabled(condition: string | undefined): boolean {
  if (condition === undefined) return false;
  const expression = /^\$\{\{\s*(.*?)\s*\}\}$/.exec(condition.trim());
  const literal = (expression ? expression[1]! : condition).trim().replace(/^['"]|['"]$/g, '');
  return literal === 'false' || literal === '0';
}

/**
 * The commands plus the body of every `pnpm <script>` they invoke, transitively,
 * so a check that reaches a file through a script is recognised as running it.
 * Steps behind a statically false condition contribute nothing: a command that is
 * written down but never executes has not run.
 */
function executedCommands(job: Job, scripts: Record<string, string>): string {
  const parts: string[] = [];
  if (!staticallyDisabled(job.condition)) {
    for (const step of job.steps) {
      if (!staticallyDisabled(step.condition) && step.run !== '') parts.push(step.run);
    }
  }
  const seen = new Set<string>();
  for (let i = 0; i < parts.length; i += 1) {
    for (const match of parts[i]!.matchAll(/\bpnpm(?:\s+run)?\s+([\w:.-]+)/g)) {
      const name = match[1]!;
      if (seen.has(name) || scripts[name] === undefined) continue;
      seen.add(name);
      parts.push(scripts[name]!);
    }
  }
  return parts.join('\n');
}

/** The checks the workflow must run, and the job that must own each one. */
const REQUIRED_CHECKS: { script: string; job: string }[] = [
  { script: 'pnpm typecheck', job: 'typecheck' },
  { script: 'pnpm build', job: 'build' },
  { script: 'pnpm test', job: 'test' },
  { script: 'pnpm verify:e2e', job: 'e2e' },
];

/**
 * Every required check missing from the workflow, disabled by a condition, or
 * run by the wrong job. A job guarded by `if: false` is reported as absent: it
 * exists in the file, but no run reaches it.
 */
function missingChecks(workflowText: string, scripts: Record<string, string>): string[] {
  const jobs = new Map(workflowJobs(workflowText).map((job) => [job.id, job]));
  const problems: string[] = [];
  for (const { script, job } of REQUIRED_CHECKS) {
    const found = jobs.get(job);
    if (found === undefined) {
      problems.push(`no \`${job}\` job`);
      continue;
    }
    if (staticallyDisabled(found.condition)) {
      problems.push(`${job} job is disabled by \`if: ${found.condition}\``);
      continue;
    }
    if (!executedCommands(found, scripts).includes(script)) {
      problems.push(`${job} does not run \`${script}\``);
    }
  }
  return problems;
}

/** Why the trigger set does not cover pull requests and pushes to `main`. */
function triggerProblems(workflowText: string): string[] {
  const on = topLevelBlock(workflowText, 'on');
  const problems: string[] = [];
  if (!/^on:\s*$/m.test(on)) problems.push('no `on:` block');
  if (!/^\s{2}pull_request:/m.test(on)) problems.push('does not trigger on `pull_request`');
  if (!/^\s{2}push:/m.test(on)) problems.push('does not trigger on `push`');
  if (!/^\s{4}branches:\s*\[main\]\s*$/m.test(on) && !/^\s{4}branches:\s*$\n\s{6}- main\s*$/m.test(on)) {
    problems.push('`push` does not name `main`');
  }
  if (!/^\s{2}workflow_dispatch:/m.test(on)) problems.push('cannot be re-run via `workflow_dispatch`');
  return problems;
}

/** Why a job's runtime does not honour `package.json`. */
function runtimeProblems(
  workflowText: string,
  pkg: { engines?: { node?: string }; packageManager?: string },
): string[] {
  const problems: string[] = [];
  const enginesMajor = Number(/(\d+)/.exec(pkg.engines?.node ?? '')?.[1] ?? 0);
  const shown = [...workflowText.matchAll(/node-version:\s*'?(\d+)(?:\.x)?'?/g)].map((m) => Number(m[1]));
  if (shown.length === 0) problems.push('names no `node-version`');
  for (const major of shown) {
    if (major < enginesMajor) problems.push(`node-version ${major} is below engines.node ${pkg.engines?.node}`);
  }
  if (new Set(shown).size > 1) problems.push(`jobs disagree on node-version: ${shown.join(', ')}`);

  for (const [id, block] of Object.entries(jobBlocks(workflowText))) {
    if (!/run:\s*corepack enable/.test(block)) {
      problems.push(`${id} does not enable the package manager pinned in package.json`);
    }
    if (!/uses:\s*actions\/setup-node@/.test(block)) problems.push(`${id} does not pin a Node version`);
  }

  // The pin has one source of truth: `packageManager`. A version named here can
  // disagree with it, and a version named here is the bug this rule prevents.
  if (!pkg.packageManager) problems.push('package.json declares no `packageManager`');
  if (/pnpm\/action-setup/.test(workflowText)) problems.push('installs a package manager from a separate action');
  if (/pnpm@\d/.test(workflowText)) problems.push('names a package-manager version instead of reading the pin');
  return problems;
}

/** Why the workflow does not run read-only with no secrets. */
function permissionProblems(workflowText: string): string[] {
  const problems: string[] = [];
  const permissions = topLevelBlock(workflowText, 'permissions');
  if (!/^permissions:\s*$/m.test(permissions)) problems.push('no `permissions:` block');
  if (!/^\s{2}contents:\s*read\s*$/m.test(permissions)) problems.push('does not declare `contents: read`');
  if (/\bwrite\b/.test(permissions)) problems.push('requests a write permission');
  if (/secrets\./.test(workflowText)) problems.push('references a repository secret');
  if (/\.env\b/.test(workflowText)) problems.push('reads a developer `.env`');
  return problems;
}

/**
 * Citation sources whose evidence is a `// ID` comment — the shape the gate
 * accepts from `scripts/verify-e2e.ts` — that no CI step executes.
 *
 * This is the mechanised form of acceptance check 4: a requirement whose only
 * evidence is a comment in a script nobody runs is not verified by anything.
 *
 * "Executes" means reached by a step in a job that no `if:` statically disables.
 * Matching the `run:` text alone was not enough: a step behind `if: ${{ false }}`,
 * or an `e2e` job behind one, still matched, so a guard named
 * `unexecutedCitationSources` returned nothing for a citation nothing ran. That
 * is the same failure this change exists to close, one level up.
 */
function unexecutedCitationSources(
  workflowText: string,
  sources: string[],
  root: string,
  scripts: Record<string, string>,
): string[] {
  const executed = workflowJobs(workflowText)
    .map((job) => executedCommands(job, scripts))
    .join('\n');
  const problems: string[] = [];
  for (const source of sources) {
    if (!fs.existsSync(source)) continue;
    const rel = path.relative(root, source).split(path.sep).join('/');
    const cites = fs
      .readFileSync(source, 'utf8')
      .split(/\r?\n/)
      .some((line) => /^\s*\/\/\s*[A-Z]{2,8}-\d{3}(?:\s+[A-Z]{2,8}-\d{3})*\s*$/.test(line));
    if (!cites) continue;
    if (!executed.includes(rel)) problems.push(`${rel} carries a citation but no CI step runs it`);
  }
  return problems;
}

describe('the CI workflow', () => {
  it('TOOL-003 exists under .github/workflows/', () => {
    expect(fs.existsSync(workflowPath), `${workflowRel} must exist`).toBe(true);
  });

  it('TOOL-003 runs the suite, the gate, the build and the end-to-end checks', () => {
    expect(missingChecks(readWorkflow(), packageJson.scripts ?? {})).toEqual([]);
  });

  it('TOOL-003 runs each check as its own job, so one red job cannot hide another', () => {
    expect(Object.keys(jobBlocks(readWorkflow())).sort()).toEqual(['build', 'e2e', 'test', 'typecheck']);
  });

  it('TOOL-003 triggers on pull_request and on push to main', () => {
    expect(triggerProblems(readWorkflow())).toEqual([]);
  });

  it('TOOL-003 uses the Node and package manager package.json already pins', () => {
    expect(runtimeProblems(readWorkflow(), packageJson)).toEqual([]);
  });

  it('TOOL-003 runs read-only and references no secret', () => {
    expect(permissionProblems(readWorkflow())).toEqual([]);
  });

  it('TOOL-003 executes every citation that lives outside the test suite', () => {
    expect(
      unexecutedCitationSources(readWorkflow(), citationSources, repoRoot, packageJson.scripts ?? []),
    ).toEqual([]);
  });
});

describe('the CI workflow rules fail when violated', () => {
  const drop = (command: string): string =>
    readWorkflow()
      .split('\n')
      .filter((line) => !line.includes(`run: ${command}`))
      .join('\n');

  it('TOOL-003 reports a check whose step was removed', () => {
    expect(missingChecks(drop('pnpm build'), packageJson.scripts ?? {})).toContain(
      'build does not run `pnpm build`',
    );
  });

  it('TOOL-003 reports a dropped job', () => {
    const withoutE2e = readWorkflow().replace(/^ {2}e2e:\n(?:.*\n)*?(?=^ {2}\w|^$)/m, '');
    expect(missingChecks(withoutE2e, packageJson.scripts ?? {})).toContain('no `e2e` job');
  });

  it('TOOL-003 reports a trigger that no longer covers push to main', () => {
    expect(triggerProblems(readWorkflow().replace('    branches: [main]\n', ''))).toContain(
      '`push` does not name `main`',
    );
  });

  it('TOOL-003 reports a Node version below the engine requirement', () => {
    const probe = readWorkflow().replace(/node-version: '24'/g, "node-version: '20.x'");
    expect(runtimeProblems(probe, packageJson).join('\n')).toContain('below engines.node');
  });

  it('TOOL-003 reports the package manager being installed from a separate action', () => {
    const probe = readWorkflow().replaceAll('run: corepack enable', 'uses: pnpm/action-setup@v4');
    expect(runtimeProblems(probe, packageJson)).toContain('installs a package manager from a separate action');
  });

  it('TOOL-003 reports a secret reference and a write permission', () => {
    const probe = readWorkflow()
      .replace('  contents: read', '  contents: write')
      .replace('        run: pnpm test', '        run: echo ${{ secrets.GEMINI_API_KEY }}');
    const problems = permissionProblems(probe);
    expect(problems).toContain('requests a write permission');
    expect(problems).toContain('references a repository secret');
  });

  it('TOOL-003 reports a citation source the workflow stops running', () => {
    const probe = drop('pnpm verify:e2e');
    expect(unexecutedCitationSources(probe, citationSources, repoRoot, packageJson.scripts ?? [])).toEqual([
      'scripts/verify-e2e.ts carries a citation but no CI step runs it',
    ]);
  });

  it('TOOL-003 reports a citation source reached only by a step disabled with if:false', () => {
    const probe = readWorkflow().replace(
      '      - name: End-to-end checks\n        run: pnpm verify:e2e',
      '      - name: End-to-end checks\n        if: ${{ false }}\n        run: pnpm verify:e2e',
    );
    expect(probe).not.toBe(readWorkflow());
    expect(unexecutedCitationSources(probe, citationSources, repoRoot, packageJson.scripts ?? [])).toEqual([
      'scripts/verify-e2e.ts carries a citation but no CI step runs it',
    ]);
  });

  it('TOOL-003 reports a required job disabled with if:false', () => {
    const probe = readWorkflow().replace('  e2e:\n    name: e2e\n', '  e2e:\n    name: e2e\n    if: false\n');
    expect(probe).not.toBe(readWorkflow());
    expect(missingChecks(probe, packageJson.scripts ?? {})).toContain('e2e job is disabled by `if: false`');
    expect(unexecutedCitationSources(probe, citationSources, repoRoot, packageJson.scripts ?? [])).toEqual([
      'scripts/verify-e2e.ts carries a citation but no CI step runs it',
    ]);
  });

  it('TOOL-003 leaves a condition it cannot decide alone, rather than calling it disabled', () => {
    const probe = readWorkflow().replace(
      '  e2e:\n    name: e2e\n',
      "  e2e:\n    name: e2e\n    if: github.event_name == 'workflow_dispatch'\n",
    );
    expect(probe).not.toBe(readWorkflow());
    expect(missingChecks(probe, packageJson.scripts ?? {})).toEqual([]);
    expect(unexecutedCitationSources(probe, citationSources, repoRoot, packageJson.scripts ?? [])).toEqual([]);
  });
});
