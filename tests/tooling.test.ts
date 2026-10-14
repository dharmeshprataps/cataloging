import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dependencyEntrypoint, commandFor } from '../scripts/run-tool.mjs';
import { discoverArtifacts, resolveOptions } from '../scripts/verify-spec.js';
import {
  machineAbsolutePaths,
  MIN_NODE_MAJOR,
  resolveToolchain,
  type ToolchainEnv,
} from '../scripts/lib/tooling.js';

/**
 * Tests for the two tooling guarantees this change makes, `TOOL-001` and
 * `TOOL-002`.
 *
 * Both exist because the first version of this work could not be trusted in a
 * clean checkout or could not be checked at all:
 *
 * - `TOOL-001`: the metadata-block rule (`spec.md` AC-5) was enforced over
 *   `spec.md` plus `findings/*.md` only, so `PROBLEMS.md` and `requirements.md`
 *   carried no block and the gate still reported PASS.
 * - `TOOL-002`: `run.sh` derived `node` *and* `pnpm` from one hardcoded
 *   developer path, so every command failed on a machine without it — while
 *   `spec.md` §9 justified shipping the file as "minimum infrastructure so the
 *   suite and the gate can run in a clean checkout".
 *
 * Neither failure could be caught by a test that ran on the developer's machine,
 * so the tests below assert the properties that made it invisible: discovery is
 * recursive, and no absolute path outside the repository appears in the script.
 */

const tmpRoots: string[] = [];

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tooling-'));
  tmpRoots.push(dir);
  return dir;
}

/** Writes an executable stub that answers the version probe with `major`. */
function writeNodeStub(dir: string, name: string, major: number): string {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    `#!/bin/sh\nif [ "$1" = "-p" ]; then echo "${major}"; exit 0; fi\nexit 0\n`,
  );
  fs.chmodSync(file, 0o755);
  return file;
}

/** Writes an executable stub that reports the pnpm version, like real pnpm. */
function writePnpmStub(dir: string): string {
  const file = path.join(dir, 'pnpm');
  fs.writeFileSync(file, '#!/bin/sh\necho "11.7.0"\n');
  fs.chmodSync(file, 0o755);
  return file;
}

function env(overrides: ToolchainEnv): ToolchainEnv {
  // A deliberately empty environment: no HOME, no DSH_RUNTIME_ROOT, no PATH
  // unless the case supplies one. A resolver that depends on one machine's
  // layout cannot pass this by accident.
  return { ...overrides };
}

describe('TOOL-001 the metadata rule covers every material artifact', () => {
  it('TOOL-001 discovers artifacts recursively, including new directories', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'decisions', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
    fs.writeFileSync(path.join(dir, 'decisions', 'nested', 'DEC-0009.md'), '# dec\n');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'not markdown\n');
    expect(discoverArtifacts(dir).map((f) => path.relative(dir, f))).toEqual([
      path.join('decisions', 'nested', 'DEC-0009.md'),
      'spec.md',
    ]);
  });

  it('TOOL-001 discovers every real artifact, and the template is the only exemption', () => {
    const real = resolveOptions();
    const artifacts = discoverArtifacts(real.specDir).map((f) => path.relative(real.specDir, f));
    for (const required of ['spec.md', 'requirements.md', 'PROBLEMS.md', 'README.md']) {
      expect(artifacts, `${required} must be discovered`).toContain(required);
    }
    expect(artifacts.filter((f) => f.startsWith('decisions'))).not.toHaveLength(0);
    expect(artifacts.filter((f) => f.endsWith('METADATA_BLOCK.md'))).toHaveLength(1);
  });

  it('TOOL-001 every discovered artifact except the template really carries a block', () => {
    const real = resolveOptions();
    const missing = discoverArtifacts(real.specDir)
      .filter((f) => path.relative(real.specDir, f) !== path.join('templates', 'METADATA_BLOCK.md'))
      .filter((f) => !/^\|\s*\*\*ID\*\*\s*\|/m.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(real.repoRoot, f));
    expect(missing, 'these artifacts would fail the gate').toEqual([]);
  });
});

describe('TOOL-002 the toolchain is resolved from the environment', () => {
  it('TOOL-002 run.sh contains no absolute path outside this repository', () => {
    const real = resolveOptions();
    const text = fs.readFileSync(path.join(real.repoRoot, 'run.sh'), 'utf8');
    expect(machineAbsolutePaths(text, real.repoRoot)).toEqual([]);
  });

  it('TOOL-002 test.sh only delegates, and so cannot reintroduce a runtime path', () => {
    const real = resolveOptions();
    const text = fs.readFileSync(path.join(real.repoRoot, 'test.sh'), 'utf8');
    expect(machineAbsolutePaths(text, real.repoRoot)).toEqual([]);
  });

  it('TOOL-002 machineAbsolutePaths still detects a hardcoded runtime path', () => {
    // The guard above is only evidence if it fails when the defect returns.
    const offending = 'ROOT="/Users/someone/.dsh/dsh-runtimes/dependencies"\nBUNDLED="$ROOT/node/bin/node"\n';
    const found = machineAbsolutePaths(offending, '/tmp/checkout-with-no-such-dir');
    expect(found).toContain('/Users/someone/.dsh/dsh-runtimes/dependencies');
  });

  it('TOOL-002 resolves a developer Node override without needing a bundled runtime', () => {
    const dir = tempDir();
    const node = writeNodeStub(dir, 'node', MIN_NODE_MAJOR);
    const toolchain = resolveToolchain(env({ NODE_BIN: node }));
    expect(toolchain.node).toBe(fs.realpathSync(node));
    expect(toolchain.nodeTooOld).toBe(false);
    expect(toolchain.warnings).toEqual([]);
  });

  it('TOOL-002 finds Node on PATH when nothing is overridden', () => {
    const dir = tempDir();
    const node = writeNodeStub(dir, 'node', MIN_NODE_MAJOR);
    const toolchain = resolveToolchain(env({ PATH: dir }), 'linux');
    expect(toolchain.node).toBe(fs.realpathSync(node));
  });

  it('TOOL-002 reports an old Node instead of refusing to start', () => {
    const dir = tempDir();
    writeNodeStub(dir, 'node', 18);
    const toolchain = resolveToolchain(env({ PATH: dir }), 'linux', []);
    expect(toolchain.nodeTooOld).toBe(true);
    expect(toolchain.warnings.join(' ')).toContain(String(MIN_NODE_MAJOR));
  });

  it('TOOL-002 uses the bundled runtime only when it exists, and only as a fallback', () => {
    const dir = tempDir();
    const runtimeRoot = path.join(dir, 'runtime');
    fs.mkdirSync(path.join(runtimeRoot, 'node', 'bin'), { recursive: true });
    const bundled = writeNodeStub(path.join(runtimeRoot, 'node', 'bin'), 'node', MIN_NODE_MAJOR);

    // No PATH and no system prefixes: the bundled runtime is the only candidate,
    // which is the clean-checkout-with-a-bundled-runtime case. Pinning both keeps
    // the assertion off this machine's own Node install.
    const used = resolveToolchain(env({ DSH_RUNTIME_ROOT: runtimeRoot }), 'linux', []);
    expect(used.node).toBe(fs.realpathSync(bundled));
    expect(used.warnings.join(' ')).toContain('bundled');

    // A root that does not exist must not be treated as one that does: this is
    // the exact shape of the original defect.
    expect(() =>
      resolveToolchain(env({ DSH_RUNTIME_ROOT: path.join(dir, 'absent') }), 'linux', []),
    ).toThrow(/No usable Node runtime/);
  });

  it('TOOL-002 prefers a capable system Node over the bundled runtime', () => {
    const dir = tempDir();
    const runtimeRoot = path.join(dir, 'runtime');
    fs.mkdirSync(path.join(runtimeRoot, 'node', 'bin'), { recursive: true });
    writeNodeStub(path.join(runtimeRoot, 'node', 'bin'), 'node', MIN_NODE_MAJOR);
    const system = writeNodeStub(dir, 'node', MIN_NODE_MAJOR + 1);

    const chosen = resolveToolchain(env({ PATH: dir, DSH_RUNTIME_ROOT: runtimeRoot }), 'linux', []);
    expect(chosen.node).toBe(fs.realpathSync(system));
    expect(chosen.warnings).toEqual([]);
  });

  it('TOOL-002 resolves pnpm from PNPM_BIN, then PATH, and reports when none is available', () => {
    const dir = tempDir();
    const node = writeNodeStub(dir, 'node', MIN_NODE_MAJOR);
    const pnpm = writePnpmStub(dir);

    expect(resolveToolchain(env({ NODE_BIN: node, PNPM_BIN: pnpm }), 'linux').pnpm).toBe(
      fs.realpathSync(pnpm),
    );
    expect(resolveToolchain(env({ NODE_BIN: node, PATH: dir }), 'linux').pnpm).toBe(
      fs.realpathSync(pnpm),
    );

    const empty = tempDir();
    const without = resolveToolchain(env({ NODE_BIN: node, PATH: empty }), 'linux');
    expect(without.pnpm).toBeUndefined();
    expect(() => commandFor('pnpm', ['install'], without)).toThrow(/PNPM_BIN/);
  });

  it('TOOL-002 every documented verb maps to a real entrypoint or an interpreter', () => {
    const real = resolveOptions();
    const toolchain = { node: process.execPath, pnpm: '/usr/local/bin/pnpm', nodeTooOld: false, warnings: [] };
    for (const verb of ['tsx', 'vitest', 'tsc']) {
      const entry = dependencyEntrypoint(verb, real.repoRoot);
      expect(entry, `${verb} must map to an entrypoint`).toBeDefined();
      expect(fs.existsSync(entry!), `${entry} must exist`).toBe(true);
      expect(commandFor(verb, [], toolchain, real.repoRoot)).toEqual({
        command: process.execPath,
        args: [entry],
      });
    }
    // A real pnpm shim is executable on its own; `pnpm.mjs` needs the Node we chose.
    expect(commandFor('pnpm', ['run'], toolchain)).toEqual({
      command: '/usr/local/bin/pnpm',
      args: ['run'],
    });
    expect(commandFor('pnpm', ['run'], { ...toolchain, pnpm: '/opt/pnpm.mjs' })).toEqual({
      command: process.execPath,
      args: ['/opt/pnpm.mjs', 'run'],
    });
  });

  it('TOOL-002 the real launcher actually runs a command and reports its result', () => {
    // Every test above calls a pure function. That is not enough: the launcher
    // was once written as `main().catch(...)` with no top-level await, so Node
    // exited with status 0 before the async work settled and `./run.sh` silently
    // did nothing. Only driving the real script through a real shell catches
    // that, so this test does exactly that — with `NODE_BIN` pinned to the Node
    // running the suite, so the result does not depend on this machine's PATH.
    const real = resolveOptions();
    const ran = spawnSync(path.join(real.repoRoot, 'run.sh'), ['which'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_BIN: process.execPath, PATH: '/usr/bin:/bin' },
    });
    expect(ran.status, `stderr: ${ran.stderr}`).toBe(0);
    expect(ran.stdout.trim()).toBe(fs.realpathSync(process.execPath));

    // A verb with no entrypoint installed for it must fail loudly, not silently.
    const unusable = spawnSync(path.join(real.repoRoot, 'run.sh'), ['not-a-verb'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_BIN: process.execPath, PATH: '/usr/bin:/bin' },
    });
    expect(unusable.status).toBe(2);
    expect(unusable.stderr).toContain('usage:');
  });
});
