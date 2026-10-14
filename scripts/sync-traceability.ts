/**
 * Syncs `tests:` arrays in spec/traceability.yaml with the citations that
 * actually exist in the test suite.
 *
 * The count must equal the number of distinct test titles citing the id, so
 * hand-maintaining it is error-prone. Run this after adding, removing, or
 * re-citing tests, then run `pnpm spec:status` to confirm.
 *
 * Order is preserved: existing ids stay in place, new ones are appended.
 */
import fs from 'node:fs';
import { extractTestCitations, resolveOptions } from './verify-spec.js';

const opts = resolveOptions();
const citations = extractTestCitations(opts);

// file:line -> title, so a test citing several ids counts once per id.
const titlesById = new Map<string, Set<string>>();
for (const c of citations) {
  const set = titlesById.get(c.requirementId) ?? new Set<string>();
  set.add(`${c.file}:${c.line}`);
  titlesById.set(c.requirementId, set);
}

let text = fs.readFileSync(opts.traceabilityPath, 'utf8');
let updated = 0;

text = text.replace(
  /^(  ([A-Z]{2,8}-\d{3}): \{)(.*)(\})$/gm,
  (line, head: string, id: string, body: string, tail: string) => {
    const actual = titlesById.get(id)?.size ?? 0;
    const existing = /tests: \[([^\]]*)\]/.exec(body)?.[1] ?? '';
    const existingIds = existing
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    // Keep any existing ids up to the real count, appending this id as needed.
    const next: string[] = [];
    for (let i = 0; i < actual; i += 1) next.push(existingIds[i] ?? id);

    const replacement = `tests: [${next.join(', ')}]`;
    const nextBody = /tests: \[[^\]]*\]/.test(body)
      ? body.replace(/tests: \[[^\]]*\]/, replacement)
      : body;

    if (nextBody !== body) updated += 1;
    return `${head}${nextBody}${tail}`;
  },
);

fs.writeFileSync(opts.traceabilityPath, text);
console.log(
  `synced ${updated} entr(ies); ${titlesById.size} requirements cited by ${citations.length} citation(s)`,
);
