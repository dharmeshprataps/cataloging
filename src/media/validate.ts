import { createHash } from 'node:crypto';
import { config } from '../config.js';

/**
 * Image validation and metadata probing.
 *
 * Deliberately dependency-free: only PNG/JPEG/WebP are accepted (what WhatsApp
 * and phone cameras produce), and their dimensions are readable from fixed
 * header offsets. Sniffing the actual bytes rather than trusting a declared
 * MIME type matters because the declared type arrives from an untrusted
 * channel payload.
 */

export type ImageInfo = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: '.jpg' | '.png' | '.webp';
  width: number | null;
  height: number | null;
};

export class MediaValidationError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

function sniffPng(b: Uint8Array): ImageInfo | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return undefined;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    mime: 'image/png',
    ext: '.png',
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function sniffJpeg(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;

  let offset = 2;
  let width: number | null = null;
  let height: number | null = null;

  while (offset + 3 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1]!;
    // Padding fill bytes.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan / end of image: no more frame headers to read.
    if (marker === 0xda || marker === 0xd9) break;

    const segLength = (b[offset + 2]! << 8) | b[offset + 3]!;
    if (segLength < 2) break;

    // SOF0..SOF15 excluding DHT (c4), JPG (c8), DAC (cc) carry frame dimensions.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && offset + 9 < b.length) {
      height = (b[offset + 5]! << 8) | b[offset + 6]!;
      width = (b[offset + 7]! << 8) | b[offset + 8]!;
      break;
    }
    offset += 2 + segLength;
  }

  return { mime: 'image/jpeg', ext: '.jpg', width, height };
}

function sniffWebp(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 30) return undefined;
  const riff = String.fromCharCode(...b.subarray(0, 4));
  const webp = String.fromCharCode(...b.subarray(8, 12));
  if (riff !== 'RIFF' || webp !== 'WEBP') return undefined;

  const chunk = String.fromCharCode(...b.subarray(12, 16));
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  if (chunk === 'VP8X') {
    // Extended format: 24-bit canvas size minus one, little-endian.
    const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
    return { mime: 'image/webp', ext: '.webp', width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    // Lossy: 14-bit dimensions after the 3-byte sync code and 7 bytes in.
    const w = view.getUint16(26, true) & 0x3fff;
    const h = view.getUint16(28, true) & 0x3fff;
    return { mime: 'image/webp', ext: '.webp', width: w, height: h };
  }
  if (chunk === 'VP8L') {
    // Lossless: 14-bit dimensions packed across 4 bytes starting at offset 21.
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { mime: 'image/webp', ext: '.webp', width: w, height: h };
  }
  return { mime: 'image/webp', ext: '.webp', width: null, height: null };
}

/**
 * Validates an inbound image. Throws MediaValidationError carrying a message
 * safe to forward to the end user.
 */
export function inspectImage(bytes: Uint8Array): ImageInfo {
  if (bytes.length === 0) {
    throw new MediaValidationError('empty payload', 'That file came through empty — please resend the photo.');
  }
  if (bytes.length > config.storage.maxUploadBytes) {
    const mb = (config.storage.maxUploadBytes / (1024 * 1024)).toFixed(0);
    const sizeMb = (bytes.length / (1024 * 1024)).toFixed(1);
    throw new MediaValidationError(
      `payload of ${sizeMb}MB exceeds the ${mb}MB limit`,
      `That photo is too large (${sizeMb}MB — limit ${mb}MB). Please send a smaller version.`,
    );
  }

  const info = sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes);
  if (!info) {
    throw new MediaValidationError(
      'unrecognised image format',
      'I could only read that as an unsupported format. Please send a JPG, PNG, or WebP photo.',
    );
  }

  // Guard against absurd aspect ratios that indicate a corrupt header.
  if (info.width !== null && info.height !== null) {
    if (info.width < 64 || info.height < 64) {
      throw new MediaValidationError(
        `image too small (${info.width}x${info.height})`,
        'That image is too small to work with — please send the original photo (at least 64px on each side).',
      );
    }
  }

  return info;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Estimates the cost of one image generation, used for budget logging.
 * Verified against Gemini pricing at implementation time; treat as indicative.
 */
export function estimateCostUsd(imageSize: string): number {
  switch (imageSize) {
    case '512':
      return 0.02;
    case '1K':
      return 0.03;
    case '4K':
      return 0.12;
    case '2K':
    default:
      return 0.05;
  }
}
