import { describe, expect, it } from 'vitest';
import {
  BRIEF_SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION,
  VARIATION_NOTES,
  buildBriefPrompt,
  buildGarmentDescriptionPrompt,
  buildImagePrompt,
  variationNoteFor,
} from '../src/imaging/prompts.js';
import { defaultBrief } from '../src/types.js';

describe('SYSTEM_INSTRUCTION', () => {
  it('CONTENT-001 CONTENT-002 always forbids depicting real people and minors', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/synthetic/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/identifiable/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/minor/i);
  });

  it('GEN-004 CONTENT-003 makes garment fidelity a hard requirement', () => {
    // This is the product's core quality risk: a pretty shot of the wrong
    // garment is worse than no shot.
    expect(SYSTEM_INSTRUCTION).toMatch(/colour|color/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/print/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/Never restyle/i);
  });

  it('CONTENT-004 forbids added text and watermarks', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/watermark/i);
  });
});

describe('buildImagePrompt', () => {
  const brief = defaultBrief({
    garment: 'a linen midi dress',
    model: 'a woman in her late twenties',
    setting: 'a sunlit courtyard',
    lighting: 'warm afternoon light',
    mood: 'relaxed summer editorial',
  });

  it('GEN-003 includes every layer of the brief', () => {
    const prompt = buildImagePrompt({ brief });
    expect(prompt).toContain('a linen midi dress');
    expect(prompt).toContain('a woman in her late twenties');
    expect(prompt).toContain('a sunlit courtyard');
    expect(prompt).toContain('warm afternoon light');
    expect(prompt).toContain('relaxed summer editorial');
  });

  it('GEN-003 prefers a vision-derived garment description when available', () => {
    const prompt = buildImagePrompt({
      brief,
      garmentDescription: 'a chartreuse silk wrap dress with a floral print',
    });
    expect(prompt).toContain('chartreuse silk wrap dress');
    expect(prompt).not.toContain('a linen midi dress');
  });

  it('GEN-003 injects the brand style guide so a catalog stays consistent', () => {
    const prompt = buildImagePrompt({ brief, styleGuide: 'Muted sage backdrops only.' });
    expect(prompt).toContain('Muted sage backdrops only.');
  });

  it('GEN-003 falls back to a default style guide when none is configured', () => {
    const prompt = buildImagePrompt({ brief });
    expect(prompt).toMatch(/Brand style guide:/);
    expect(prompt).toMatch(/neutral seamless backdrop/i);
  });

  it('GEN-003 includes client notes when present', () => {
    const withNotes = defaultBrief({ ...brief, notes: 'No jewellery please' });
    expect(buildImagePrompt({ brief: withNotes })).toContain('No jewellery please');
  });

  it('ITER-003 ITER-005 CONV-009 describes a revision as a targeted edit, not a fresh shot', () => {
    const prompt = buildImagePrompt({ brief, revisionNote: 'make the light warmer' });
    expect(prompt).toMatch(/REVISION/i);
    expect(prompt).toContain('make the light warmer');
    // Must instruct preservation of everything else, or the print drifts.
    expect(prompt).toMatch(/keep every other element/i);
  });

  it('ITER-002 describes variations as deliberate exploration', () => {
    const prompt = buildImagePrompt({ brief, variationNote: variationNoteFor(0) });
    expect(prompt).toMatch(/ALTERNATES/i);
    expect(prompt).toContain(variationNoteFor(0));
    // A variation must still hold the garment constant.
    expect(prompt).toMatch(/garment identical/i);
  });

  it('ITER-003 never mixes revision and variation instructions in one prompt', () => {
    const prompt = buildImagePrompt({
      brief,
      revisionNote: 'shorten the sleeves',
      variationNote: variationNoteFor(1),
    });
    expect(prompt).toMatch(/REVISION/i);
    expect(prompt).not.toMatch(/ALTERNATES/i);
  });
});

describe('variationNoteFor', () => {
  it('ITER-004 cycles through distinct notes and wraps safely', () => {
    expect(variationNoteFor(0)).not.toBe(variationNoteFor(1));
    expect(variationNoteFor(VARIATION_NOTES.length)).toBe(variationNoteFor(0));
    // Out-of-range indexes must never return undefined.
    expect(variationNoteFor(999)).toBeTruthy();
  });
});

describe('brief prompt builders', () => {
  it('BRIEF-001 states whether images were attached', () => {
    expect(buildBriefPrompt('red dress', true)).toMatch(/attached one or more photos/i);
    expect(buildBriefPrompt('red dress', false)).toMatch(/No garment photos/i);
  });

  it('BRIEF-002 embeds the user text verbatim so it cannot be lost', () => {
    const text = 'cropped denim jacket, moody lighting';
    expect(buildBriefPrompt(text, false)).toContain(text);
  });

  it('BRIEF-003 tells the vision pass not to describe the background or the person', () => {
    const prompt = buildGarmentDescriptionPrompt();
    expect(prompt).toMatch(/Do not describe the background/i);
    expect(prompt).toMatch(/Do not speculate/i);
  });
});

describe('BRIEF_SYSTEM_INSTRUCTION', () => {
  it('BRIEF-004 keeps the model field synthetic', () => {
    expect(BRIEF_SYSTEM_INSTRUCTION).toMatch(/synthetic/i);
    expect(BRIEF_SYSTEM_INSTRUCTION).toMatch(/never a named real person/i);
  });
});
