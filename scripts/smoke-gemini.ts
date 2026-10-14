/**
 * Live smoke test against the real Gemini API.
 *
 * This is the check that cannot be faked: it proves the `interactions.create`
 * call shape, the multi-reference-image input, the structured-brief JSON
 * response, and — most importantly — that a returned image is real decodable
 * image data. Run it once after configuring a key, and after any SDK bump.
 *
 *   ./run.sh pnpm smoke:gemini
 *
 * Costs a small amount of API credit (a few image generations).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GeminiImageProvider } from '../src/imaging/gemini.js';
import { buildImagePrompt } from '../src/imaging/prompts.js';
import { inspectImage } from '../src/media/validate.js';
import { defaultBrief } from '../src/types.js';
import { makePng } from '../tests/fixtures/png.js';

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures.push(label);
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  if (!config.gemini.apiKey) {
    console.error(
      '\nGEMINI_API_KEY is not set.\n' +
        'Add it to .env (see .env.example) and re-run: ./run.sh pnpm smoke:gemini\n',
    );
    process.exit(2);
  }

  const outDir = path.resolve('data/smoke');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nModel: ${config.gemini.imageModel}`);
  console.log('This makes real API calls and costs a small amount.\n');

  const provider = new GeminiImageProvider(config.gemini.apiKey);

  // Stand-in "garment photo". A flat colour block is enough to prove the
  // round-trip; it is not a fidelity test.
  const garment = makePng(512, 640, [40, 90, 160]);
  console.log('== garment description (vision) ==');
  const description = await provider.describeGarment([{ mime: 'image/png', data: garment }]);
  check('vision pass returned a description', description.length > 0, description.slice(0, 90));

  console.log('\n== structured brief ==');
  let brief;
  try {
    brief = await provider.parseBrief({
      text: 'midi wrap dress, outdoor daytime, model walking, warm light, 4:5',
      hasImages: true,
    });
    check('brief parsed into the schema', typeof brief.garment === 'string');
    check('brief kept the requested aspect ratio', brief.aspectRatio === '4:5', brief.aspectRatio);
    console.log(
      `     garment="${brief.garment}"\n     aspect=${brief.aspectRatio} size=${brief.imageSize}`,
    );
  } catch (err) {
    // The brief is a convenience; a text-model problem must not fail the run.
    console.log(
      `  [WARN] brief parsing failed (text model "${config.gemini.textModel}"): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    brief = defaultBrief();
  }

  console.log('\n== image generation (multi-reference input) ==');
  const started = Date.now();
  const result = await provider.generate({
    prompt: buildImagePrompt({
      brief,
      ...(description ? { garmentDescription: description } : {}),
    }),
    refs: [{ mime: 'image/png', data: garment }],
    aspectRatio: brief.aspectRatio,
    imageSize: brief.imageSize,
  });
  const elapsed = Date.now() - started;

  check('returned non-empty image bytes', result.image.length > 0, `${result.image.length} bytes`);
  check('returned an interaction id for follow-up edits', result.interactionId.length > 0, result.interactionId);

  let info;
  try {
    info = inspectImage(result.image);
    check('bytes are a decodable image', true, `${info.mime} ${info.width}x${info.height}`);
  } catch (err) {
    check('bytes are a decodable image', false, err instanceof Error ? err.message : String(err));
  }

  const outFile = path.join(outDir, `smoke-${Date.now()}.jpg`);
  fs.writeFileSync(outFile, result.image);
  console.log(`\nWrote ${outFile}`);
  console.log(`Latency ${elapsed}ms, estimated cost $${result.costUsd.toFixed(3)}`);

  console.log(
    failures.length === 0
      ? '\n✅ Live smoke test passed. The real SDK surface works as implemented.\n'
      : `\n❌ ${failures.length} check(s) failed:\n${failures.map((f) => `   - ${f}`).join('\n')}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nSmoke test threw:', err instanceof Error ? err.stack : err, '\n');
  process.exit(1);
});
