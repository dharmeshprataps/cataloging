import { describe, expect, it } from 'vitest';
import { makeJpegHeader, makePng, makeTinyPng } from './fixtures/png.js';
import { MediaValidationError, estimateCostUsd, inspectImage, sha256 } from '../src/media/validate.js';

describe('inspectImage', () => {
  it('MED-002 parses PNG dimensions from the IHDR header', () => {
    const info = inspectImage(makePng(320, 480));
    expect(info.mime).toBe('image/png');
    expect(info.ext).toBe('.png');
    expect(info.width).toBe(320);
    expect(info.height).toBe(480);
  });

  it('MED-003 parses JPEG dimensions from the SOF0 segment', () => {
    // Gemini returns image/jpeg by default, so this is the production path.
    const info = inspectImage(makeJpegHeader(640, 800));
    expect(info.mime).toBe('image/jpeg');
    expect(info.ext).toBe('.jpg');
    expect(info.width).toBe(640);
    expect(info.height).toBe(800);
  });

  it('MED-003 MED-001 does not mistake a JPEG for a PNG', () => {
    expect(inspectImage(makeJpegHeader()).mime).toBe('image/jpeg');
    expect(inspectImage(makePng()).mime).toBe('image/png');
  });

  it('MED-009 still identifies a truncated JPEG that has no frame header', () => {
    // SOI only: the format is recognisable even though dimensions are unknown,
    // so this must not be reported as an unsupported format.
    const info = inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    expect(info.mime).toBe('image/jpeg');
    expect(info.width).toBeNull();
  });

  it('MED-006 rejects non-image bytes with a user-safe message', () => {
    const notAnImage = new TextEncoder().encode('this is definitely not an image');
    expect(() => inspectImage(notAnImage)).toThrow(MediaValidationError);
    try {
      inspectImage(notAnImage);
    } catch (err) {
      // The message must be something we can forward to a designer verbatim.
      expect((err as MediaValidationError).userMessage).toMatch(/JPG, PNG, or WebP/);
    }
  });

  it('MED-007 rejects an empty payload', () => {
    expect(() => inspectImage(new Uint8Array(0))).toThrow(/empty/i);
  });

  it('MED-008 accepts a tiny but valid image header', () => {
    // 1x1 is below the minimum, so it must be rejected as too small rather than
    // as an unknown format — proving dimension parsing ran.
    expect(() => inspectImage(makeTinyPng())).toThrow(/too small/i);
  });

  it('MED-005 rejects a payload larger than the configured limit', () => {
    // Just over the 8MB cap, with a valid PNG header so size is the only issue.
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1024);
    oversized.set(makePng(100, 100).subarray(0, 24), 0);
    expect(() => inspectImage(oversized)).toThrow(/exceeds the 8MB limit/i);
  });
});

describe('sha256', () => {
  it('MED-010 is stable for identical bytes and differs for different bytes', () => {
    const a = makePng(64, 64, [10, 20, 30]);
    const b = makePng(64, 64, [10, 20, 30]);
    const c = makePng(64, 64, [30, 20, 10]);
    expect(sha256(a)).toBe(sha256(b));
    expect(sha256(a)).not.toBe(sha256(c));
  });
});

describe('estimateCostUsd', () => {
  it('MED-011 scales with requested image size', () => {
    expect(estimateCostUsd('512')).toBeLessThan(estimateCostUsd('1K'));
    expect(estimateCostUsd('1K')).toBeLessThan(estimateCostUsd('4K'));
    expect(estimateCostUsd('unknown')).toBe(estimateCostUsd('2K'));
  });
});

describe('WebP support', () => {
  /**
   * A minimal VP8X extended-format WebP header. Phone cameras and some
   * screenshot tools emit WebP, so accepting it is a real requirement — and the
   * dimension encoding is easy to get wrong.
   */
  function makeWebp(width = 320, height = 240): Uint8Array {
    const bytes = new Uint8Array(30);
    const put = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
    };
    put(0, 'RIFF');
    // Canvas size is stored minus one, 24-bit little-endian, at offsets 24 and 27.
    const w = width - 1;
    const h = height - 1;
    bytes[24] = w & 0xff;
    bytes[25] = (w >> 8) & 0xff;
    bytes[26] = (w >> 16) & 0xff;
    bytes[27] = h & 0xff;
    bytes[28] = (h >> 8) & 0xff;
    bytes[29] = (h >> 16) & 0xff;
    put(8, 'WEBP');
    put(12, 'VP8X');
    return bytes;
  }

  it('MED-004 accepts a WebP image and reads its canvas dimensions', () => {
    const info = inspectImage(makeWebp(320, 240));
    expect(info.mime).toBe('image/webp');
    expect(info.ext).toBe('.webp');
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
  });

  it('MED-004 does not confuse WebP with PNG or JPEG', () => {
    expect(inspectImage(makeWebp()).mime).toBe('image/webp');
  });

  it('MED-004 rejects bytes claiming RIFF but not WEBP', () => {
    const notWebp = new Uint8Array(30);
    for (let i = 0; i < 4; i += 1) notWebp[i] = 'RIFF'.charCodeAt(i);
    for (let i = 0; i < 4; i += 1) notWebp[8 + i] = 'WAVE'.charCodeAt(i);
    expect(() => inspectImage(notWebp)).toThrow(MediaValidationError);
  });
});
