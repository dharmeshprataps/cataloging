/**
 * Node and pnpm runtime selection for `run.sh`.
 *
 * Why this is a module and not a few lines of bash: the first version of this
 * logic hardcoded one machine's bundled runtime
 * (`/Users/<user>/.dsh/dsh-runtimes/...`) and derived both `node` and `pnpm`
 * from it unconditionally. On any other checkout — a CI runner, a fresh clone —
 * `./test.sh` and `./run.sh tsx scripts/spec-status.ts` failed before they
 * started, while `spec.md` §9 justified shipping those files as "minimum
 * infrastructure so the suite and the gate can run in a clean checkout". Logic
 * that decides whether the toolchain runs at all belongs somewhere a test can
 * call it, so this module is pure and takes its environment as arguments.
 *
 * Selection order, and the reason for it:
 *
 *   1. `NODE_BIN` / `PNPM_BIN` — an explicit override always wins.
 *   2. a Node ≥ `MIN_NODE_MAJOR` on `PATH` or at a well-known install prefix.
 *      A system Node is preferred over the bundled one because the bundled
 *      runtime's code signature rejects native `.node` addons (see README).
 *   3. the bundled runtime, if `DSH_RUNTIME_ROOT` (or the conventional location
 *      for this platform) actually contains one. Derived, never hardcoded, and
 *      only when it exists.
 *   4. any `node` on `PATH`, with a warning. An old Node may still run the
 *      suite; refusing to try is how the clean checkout failed before.
 *
 * There is no absolute path to a developer's home directory anywhere in this
 * file, and `machineAbsolutePaths` exists so a test can keep it that way.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** `engines.node` in package.json. */
export const MIN_NODE_MAJOR = 24;

/**
 * Where a system Node is looked for when it is not on `PATH`.
 *
 * A parameter of `resolveToolchain`, not a constant read inside it, so a test
 * can assert the fallback behaviour on a machine that is not this one. The first
 * version of this code was machine-dependent and no test could see it; a
 * host-dependent default would recreate that blindness.
 */
export const DEFAULT_SYSTEM_NODE_PREFIXES: readonly string[] =
  process.platform === 'win32'
    ? [process.env.ProgramFiles ?? 'C:\\Program Files\\nodejs']
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

export type ToolchainEnv = Record<string, string | undefined>;

export type Toolchain = {
  /** Absolute path to the Node binary that will run everything. */
  node: string;
  /** Absolute path to a pnpm entrypoint, or undefined when commands need no pnpm. */
  pnpm?: string;
  /** True when `node` is below `MIN_NODE_MAJOR`; the suite may fail. */
  nodeTooOld: boolean;
  /** Human-readable notes for stderr — fallbacks and the reasons for them. */
  warnings: string[];
};

function executableName(tool: string, platform: string): string {
  return platform === 'win32' ? `${tool}.cmd` : tool;
}

function isExecutable(file: string, platform: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (platform === 'win32') return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The conventional bundled-runtime root for this platform, or undefined. */
function conventionalRuntimeRoot(env: ToolchainEnv, platform: string): string | undefined {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    return localAppData === undefined
      ? undefined
      : path.join(localAppData, 'dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies');
  }
  const home = env.HOME;
  return home === undefined
    ? undefined
    : path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies');
}

/** Candidate install locations for a system Node, in preference order. */
function systemNodeCandidates(
  env: ToolchainEnv,
  platform: string,
  prefixes: readonly string[],
): string[] {
  const candidates: string[] = [];
  const pathEntries = (env.PATH ?? '').split(path.delimiter).filter((p) => p.length > 0);
  for (const dir of pathEntries) candidates.push(path.join(dir, executableName('node', platform)));
  for (const prefix of prefixes) candidates.push(path.join(prefix, executableName('node', platform)));
  return candidates;
}

/** Major version of a Node binary, or undefined when it cannot be read. */
function nodeMajor(nodeBin: string): number | undefined {
  const probe = spawnSync(nodeBin, ['-p', 'process.versions.node.split(".")[0]'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (probe.status !== 0) return undefined;
  const major = Number.parseInt((probe.stdout ?? '').trim(), 10);
  return Number.isNaN(major) ? undefined : major;
}

/** First existing executable among `paths`. */
function firstExecutable(
  paths: readonly (string | undefined)[],
  platform = process.platform,
): string | undefined {
  for (const candidate of paths) {
    if (candidate === undefined) continue;
    if (isExecutable(candidate, platform)) return fs.realpathSync(candidate);
  }
  return undefined;
}

/**
 * Resolves the runtime `run.sh` should use, without touching the process
 * environment beyond what is passed in.
 *
 * `platform` and `systemPrefixes` are parameters so a test can assert what
 * happens on a machine that is not this one — which is the whole point: the
 * defect this replaced was invisible on the machine that had it.
 */
export function resolveToolchain(
  env: ToolchainEnv = process.env,
  platform = process.platform,
  systemPrefixes: readonly string[] = DEFAULT_SYSTEM_NODE_PREFIXES,
): Toolchain {
  const warnings: string[] = [];
  const bundledRoot = env.DSH_RUNTIME_ROOT ?? conventionalRuntimeRoot(env, platform);
  const bundledNode =
    bundledRoot === undefined
      ? undefined
      : path.join(bundledRoot, 'node', 'bin', executableName('node', platform));
  const bundledPnpm =
    bundledRoot === undefined ? undefined : path.join(bundledRoot, 'pnpm', 'bin', 'pnpm.mjs');

  const systemCandidates = systemNodeCandidates(env, platform, systemPrefixes);

  let node: string | undefined;
  let nodeTooOld = false;

  const override = env.NODE_BIN;
  if (override !== undefined && override !== '' && isExecutable(override, platform)) {
    node = fs.realpathSync(override);
  }

  if (node === undefined) {
    for (const candidate of systemCandidates) {
      if (!isExecutable(candidate, platform)) continue;
      const major = nodeMajor(candidate);
      if (major !== undefined && major >= MIN_NODE_MAJOR) {
        node = fs.realpathSync(candidate);
        break;
      }
    }
  }

  if (node === undefined && bundledNode !== undefined && isExecutable(bundledNode, platform)) {
    warnings.push(
      `falling back to the bundled Node (${bundledNode}); native modules may fail to load. ` +
        `Set NODE_BIN to a system Node >= ${MIN_NODE_MAJOR}.`,
    );
    node = fs.realpathSync(bundledNode);
  }

  if (node === undefined) {
    // Last resort: any Node on PATH. Fresh machines commonly ship an older one,
    // and an old Node that runs the suite is better than a runtime that refuses
    // to start; the warning tells the reader what to install.
    const anyNode = firstExecutable(systemCandidates, platform);
    if (anyNode !== undefined) {
      nodeTooOld = true;
      warnings.push(
        `no Node >= ${MIN_NODE_MAJOR} found; using ${anyNode}, which may fail on this suite. ` +
          `Set NODE_BIN to a system Node >= ${MIN_NODE_MAJOR} to remove this warning.`,
      );
      node = anyNode;
    }
  }

  if (node === undefined) {
    throw new Error(
      `No usable Node runtime found. Install Node >= ${MIN_NODE_MAJOR}, ` +
        'or set NODE_BIN=/path/to/node (or DSH_RUNTIME_ROOT=/path/to/bundled/runtime).',
    );
  }

  const pnpmOverride = env.PNPM_BIN;
  const pnpm = firstExecutable(
    [
      pnpmOverride !== undefined && pnpmOverride !== '' ? pnpmOverride : undefined,
      bundledPnpm,
      ...(env.PATH ?? '')
        .split(path.delimiter)
        .filter((p) => p.length > 0)
        .map((dir) => path.join(dir, executableName('pnpm', platform))),
    ],
    platform,
  );

  return { node, pnpm, nodeTooOld, warnings };
}

/**
 * Absolute path literals in a script that cannot exist on another machine.
 *
 * A shell script cannot work in a clean checkout while it points at one
 * developer's home directory or runtime install, and that failure mode is
 * invisible to every test that runs on the machine in question. This is the
 * check that makes it visible: `run.sh` and `test.sh` are asserted to contain no
 * such literal, so re-introducing one fails a test rather than a new
 * contributor's first command.
 *
 * Comment lines are ignored, because the natural way to explain this rule is to
 * quote the path that violated it. Deliberate literals (`/opt/homebrew/bin/node`
 * as a fallback prefix, `/usr/bin/env` in a shebang) are not machine-specific
 * and are not reported: only a home directory or a per-user runtime path is.
 */
const PERSONAL_PATH_PREFIXES = ['/Users/', '/home/', '/root/', '/private/var/folders/'];

export function machineAbsolutePaths(scriptText: string, repoRoot: string): string[] {
  const literal = /(?<![:\w.-])\/(?:[\w.@+-]+\/)*[\w.@+-]+/g;
  const root = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  const found = new Set<string>();
  for (const line of scriptText.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    for (const match of line.match(literal) ?? []) {
      if (match.startsWith(root)) continue;
      if (!PERSONAL_PATH_PREFIXES.some((prefix) => match === prefix.slice(0, -1) || match.startsWith(prefix))) {
        continue;
      }
      found.add(match);
    }
  }
  return [...found].sort();
}
