import type { AspectRatio, Brief, ImageSize } from '../types.js';

/**
 * A reference image handed to the generation model. For the first shot these
 * are the user's garment photos; for revisions they also include the previous
 * output, which is what makes an edit targeted rather than a fresh roll.
 */
export type ImageRef = {
  mime: string;
  data: Uint8Array;
};

export type GenerateRequest = {
  prompt: string;
  refs: ImageRef[];
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  /** Chains a sequential edit onto a prior interaction. */
  previousInteractionId?: string;
};

export type GenerateResult = {
  image: Uint8Array;
  mime: string;
  /** Provider-side interaction id, stored to enable follow-up edits. */
  interactionId: string;
  latencyMs: number;
  costUsd: number;
};

export type ContentPolicyError = {
  kind: 'content_policy';
  message: string;
};

export type ProviderError = {
  kind: 'provider';
  message: string;
  retryable: boolean;
  status?: number;
};

export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'content_policy' | 'provider',
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

/**
 * The single seam between this product and whatever engine renders the shot.
 * A dedicated virtual try-on model (fal.ai/Replicate) would be another
 * implementation of this interface, not a refactor of the pipeline.
 */
export type ImageProvider = {
  readonly name: string;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** Turns free-form user text into a structured brief. */
  parseBrief(input: { text: string; hasImages: boolean }): Promise<Brief>;
  /** Optional vision description of the garment, used to enrich prompts. */
  describeGarment(refs: ImageRef[]): Promise<string>;
};
