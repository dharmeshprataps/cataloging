import type { Brief } from '../types.js';

/**
 * Prompt construction is layered so each concern can be tested and changed in
 * isolation. The ordering matters: identity and fidelity constraints come
 * before the creative direction so the model treats them as non-negotiable.
 */

/** Layer 1: invariants that must never be traded away for a prettier shot. */
export const SYSTEM_INSTRUCTION = [
  'You are a fashion catalog photographer and retoucher producing e-commerce imagery.',
  '',
  'Hard requirements:',
  '- Reproduce the garment from the reference photos with exact fidelity: same colour,',
  '  print, pattern scale, fabric texture, cut, proportions, seams, hardware, and logos.',
  '  Never restyle, recolour, crop away, or "improve" the garment.',
  '- The model must be a synthetic, AI-generated person. Never depict a real,',
  '  identifiable individual, and never a person who appears to be a minor.',
  '- Do not add any text, watermarks, logos, or graphics that are not on the garment.',
  '- Output one photorealistic photograph. No collage, no side-by-side, no borders.',
].join('\n');

export const BRIEF_SYSTEM_INSTRUCTION = [
  'You extract structured photo-shoot briefs from short, informal messages written by',
  'clothing designers. Messages are often terse and may be lowercase or misspelled.',
  '',
  'Rules:',
  '- Only use detail the user actually provided or drew on the attached images.',
  '- Where the user was vague, choose a tasteful, commercially safe default that suits',
  '  the garment; do not ask for clarification.',
  '- The "model" field must always describe a synthetic model, never a named real person.',
  '- Keep every field short and concrete, suitable as a direct prompt fragment.',
].join('\n');

const DEFAULT_STYLE_GUIDE =
  'Clean modern e-commerce look: neutral seamless backdrop, soft even lighting, ' +
  'true-to-life colour, subject centred with the full garment in frame.';

export type PromptInput = {
  brief: Brief;
  /** Optional vision-derived description of the actual garment. */
  garmentDescription?: string;
  /** Free-text refinement supplied by the user on a revision turn. */
  revisionNote?: string;
  /** Distinguishes alternates in a variations batch. */
  variationNote?: string;
  /** Brand house style, injected so a whole catalog looks consistent. */
  styleGuide?: string;
};

/**
 * Builds the generation prompt. `revisionNote` and `variationNote` are the two
 * modes of iteration: a revision must preserve everything except what the user
 * named, while a variation deliberately explores one dimension.
 */
export function buildImagePrompt(input: PromptInput): string {
  const { brief } = input;
  const garment = input.garmentDescription?.trim() || brief.garment;

  const sections: string[] = [
    `Garment: ${garment}`,
    `Model: ${brief.model}`,
    `Pose: ${brief.pose}`,
    `Setting: ${brief.setting}`,
    `Lighting: ${brief.lighting}`,
    `Mood: ${brief.mood}`,
    `Brand style guide: ${input.styleGuide?.trim() || DEFAULT_STYLE_GUIDE}`,
  ];

  if (brief.notes.trim()) {
    sections.push(`Additional direction from the client: ${brief.notes.trim()}`);
  }

  if (input.revisionNote) {
    sections.push(
      '',
      'This is a REVISION of the attached previous output.',
      `Change only the following, and keep every other element — especially the garment, ` +
        `its colour, print, and silhouette — exactly as it is: ${input.revisionNote.trim()}`,
    );
  } else if (input.variationNote) {
    // Mutually exclusive by design: an edit and an exploration pull in opposite
    // directions, and asking for both produces a shot that does neither well.
    sections.push(
      '',
      'This is one frame from a set of ALTERNATES for the same SKU.',
      `Vary the shot along exactly this dimension, and keep the garment identical: ${input.variationNote.trim()}`,
    );
  }

  sections.push(
    '',
    `Composition: full-body fashion photograph, sharp focus across the garment, ` +
      `realistic fabric drape and folds, natural skin and hair detail, catalog-ready quality.`,
  );

  return sections.join('\n');
}

/** Prompts that steer a batch of variations apart from one another. */
export const VARIATION_NOTES = [
  'use a different pose, with the model turned slightly to show the garment side',
  'use a three-quarter front angle with a relaxed, candid stance',
  'use a seated or leaning pose that shows how the fabric falls',
  'use a different background tone that still fits the brand style guide',
  'use a closer crop from mid-thigh up, emphasising fabric and print detail',
  'use a profile or back-facing angle to show the garment from other sides',
  'use a different model build and hair, keeping the same demographic range',
  'use brighter, warmer light with a subtle directional key',
] as const;

export function variationNoteFor(index: number): string {
  return VARIATION_NOTES[index % VARIATION_NOTES.length]!;
}

/** Prompt used for the vision pass that describes the actual garment. */
export function buildGarmentDescriptionPrompt(): string {
  return [
    'Describe the garment(s) in these photos as a prompt fragment for a fashion photo shoot.',
    'Cover, in one or two sentences: garment type, colour(s), fabric, pattern or print,',
    'notable construction details (neckline, sleeves, length, closures), and any visible logos or text.',
    'Describe only what is visible. Do not describe the background, the person holding or',
    'wearing it, or the lighting. Do not speculate.',
  ].join(' ');
}

/** Prompt used to interpret the user's brief text into the structured schema. */
export function buildBriefPrompt(text: string, hasImages: boolean): string {
  return [
    'Extract a photo-shoot brief from this message.',
    hasImages
      ? 'The user has also attached one or more photos of the garment; describe the garment only if they named it in text.'
      : 'No garment photos were attached.',
    '',
    'Message:',
    '"""',
    text.trim(),
    '"""',
  ].join('\n');
}
