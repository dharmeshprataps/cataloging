import { makePng } from '../fixtures/png.js';
import { BriefSchema, type Brief } from '../../src/types.js';
import type {
  GenerateRequest,
  GenerateResult,
  ImageProvider,
  ImageRef,
} from '../../src/imaging/types.js';
import { ImageProviderError } from '../../src/imaging/types.js';

/**
 * Deterministic stand-in for Gemini.
 *
 * Every generation returns a valid PNG whose bytes vary by call, so tests can
 * prove that distinct calls produce distinct assets without any network access.
 */
export class FakeImageProvider implements ImageProvider {
  readonly name = 'fake';
  readonly model = 'fake-image-model';

  readonly calls: GenerateRequest[] = [];
  private brief: Brief = BriefSchema.parse({});
  private counter = 0;
  /** When set, the next `generate` call rejects with this error. */
  nextError: ImageProviderError | undefined;

  constructor(private readonly briefResponse: Partial<Brief> = {}) {}

  setBrief(brief: Partial<Brief>): void {
    this.brief = BriefSchema.parse(brief);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(req);

    if (this.nextError) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }

    this.counter += 1;
    // Vary the colour per call so output bytes differ measurably.
    const image = makePng(128, 160, [100 + (this.counter % 100), 80, 140]);
    return {
      image,
      mime: 'image/png',
      interactionId: `interaction-${this.counter}`,
      latencyMs: 5,
      costUsd: 0.01,
    };
  }

  async parseBrief(): Promise<Brief> {
    return BriefSchema.parse({ ...this.brief, ...this.briefResponse });
  }

  async describeGarment(_refs: ImageRef[]): Promise<string> {
    return 'a chartreuse silk wrap dress with a small floral print';
  }

  get callCount(): number {
    return this.calls.length;
  }

  lastRequest(): GenerateRequest | undefined {
    return this.calls[this.calls.length - 1];
  }
}
