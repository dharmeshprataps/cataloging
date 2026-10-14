/**
 * Entrypoint for `run.sh`: resolves the runtime, reports any fallback, and
 * executes the requested tool in this process's place.
 *
 * Plain JavaScript rather than TypeScript on purpose. This is the one file that
 * runs on a *fresh* checkout, before `pnpm install` has created `node_modules`,
 * so it cannot rely on `tsx`. It reaches the resolver through a dynamic import of
 * the literal `.ts` path, which lets Node's type stripping (Node >= 22.6) load
 * it — and which also keeps this file out of `tsc`, because a static `.ts`
 * import would need `allowImportingTsExtensions`.
 *
 * The decisions themselves live in `scripts/lib/tooling.ts`, where they are
 * unit-tested without spawning a child process.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: ./run.sh {pnpm|node|tsx|vitest|tsc|which} [args...]';

/**
 * Maps a `run.sh` verb to the file inside `node_modules` that implements it.
 * Exported (via the module) so a test can assert the paths, rather than a test
 * discovering a wrong path only when someone runs the command.
 */
export const DEPENDENCY_ENTRYPOINTS = {
  tsx: ['tsx', 'dist', 'cli.mjs'],
  vitest: ['vitest', 'vitest.mjs'],
  tsc: ['typescript', 'bin', 'tsc'],
};

export function dependencyEntrypoint(tool, cwd = process.cwd()) {
  const segments = DEPENDENCY_ENTRYPOINTS[tool];
  if (segments === undefined) return undefined;
  return path.join(cwd, 'node_modules', ...segments);
}

/**
 * The error message for a tool that is not installed, or undefined when it is.
 *
 * A clean checkout has no `node_modules`, and the raw failure is Node's "Cannot
 * find module" for a path the reader never chose. This turns it into the one
 * instruction that fixes it.
 */
export function missingDependencyError(tool, cwd = process.cwd()) {
  const entry = dependencyEntrypoint(tool, cwd);
  if (entry === undefined || fs.existsSync(entry)) return undefined;
  return (
    `${tool} is not installed in this checkout (${path.relative(cwd, entry) || entry} is missing).\n` +
    'Run `./run.sh pnpm install` first.'
  );
}

/**
 * Builds the argv for the runtime we resolved.
 *
 * `.mjs` entrypoints are scripts that need an interpreter; a system `pnpm` shim
 * is an executable in its own right.
 */
export function commandFor(tool, args, toolchain, cwd = process.cwd()) {
  if (tool === 'pnpm') {
    if (toolchain.pnpm === undefined) {
      throw new Error(
        'No pnpm found. Install pnpm (`corepack enable pnpm`, `npm i -g pnpm`) or set ' +
          'PNPM_BIN=/path/to/pnpm.',
      );
    }
    return toolchain.pnpm.endsWith('.mjs')
      ? { command: toolchain.node, args: [toolchain.pnpm, ...args] }
      : { command: toolchain.pnpm, args };
  }
  if (tool === 'node') return { command: toolchain.node, args };
  const entry = dependencyEntrypoint(tool, cwd);
  if (entry === undefined) {
    throw new Error(USAGE);
  }
  return { command: toolchain.node, args: [entry, ...args] };
}

async function main() {
  const [tool, ...args] = process.argv.slice(2);
  if (tool === undefined) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }

  let resolveToolchain;
  try {
    const here = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
    ({ resolveToolchain } = await import(pathToFileURL(path.join(here, 'lib', 'tooling.ts')).href));
  } catch (error) {
    // The most likely cause is a Node too old to strip types. `run.sh` passes
    // `--experimental-strip-types` below 22.18, so this is the residual case:
    // say what the runtime is missing rather than printing a module-resolution
    // stack trace.
    process.stderr.write(
      `Cannot load the runtime resolver: ${error instanceof Error ? error.message : String(error)}\n` +
        `This needs a Node that can strip TypeScript types (>= 22.18), or tsx in ` +
        `node_modules. Running ${process.version}.\n`,
    );
    process.exit(1);
  }

  let toolchain;
  try {
    toolchain = resolveToolchain();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  for (const warning of toolchain.warnings) process.stderr.write(`warning: ${warning}\n`);

  if (tool === 'which') {
    process.stdout.write(`${toolchain.node}\n`);
    process.exit(0);
  }

  let command;
  try {
    const missing = missingDependencyError(tool);
    if (missing !== undefined) throw new Error(missing);
    command = commandFor(tool, args, toolchain);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }

  const result = spawnSync(command.command, command.args, { stdio: 'inherit' });
  if (result.error !== undefined) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

// Only dispatch when executed as a program; importing this file (a test does,
// to check `commandFor`) must not spawn anything.
//
// Top-level `await` rather than `main().catch(...)`: without something holding
// the event loop open, Node exits with status 0 as soon as the synchronous part
// of `main` returns, so the command does nothing and reports success. That is
// the precise failure this launcher exists to prevent, and it is invisible
// unless the test drives the real script.
if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`run.sh failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  }
}
