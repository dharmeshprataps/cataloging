import { config } from './config.js';
import { GeminiImageProvider } from './imaging/gemini.js';
import type { ImageProvider } from './imaging/types.js';
import type { DeliveryAdapter } from './messaging/types.js';

/**
 * Single place where concrete implementations are chosen. Tests override these
 * with fakes, so the pipeline never constructs its own dependencies.
 */

let cachedProvider: ImageProvider | undefined;
let cachedAdapter: DeliveryAdapter | undefined;

/**
 * A stub provider is only appropriate for dry runs without an API key. It is
 * deliberately loud: any accidental use in a real flow is obvious.
 */
export class StubImageProvider implements ImageProvider {
  readonly name = 'stub';
  readonly model = 'stub';

  async generate(): Promise<never> {
    throw new Error(
      'No image provider configured. Set GEMINI_API_KEY in .env to generate images.',
    );
  }

  async parseBrief() {
    const { BriefSchema } = await import('./types.js');
    return BriefSchema.parse({});
  }

  async describeGarment() {
    return '';
  }
}

export function getImageProvider(): ImageProvider {
  if (cachedProvider) return cachedProvider;
  const provider: ImageProvider = config.gemini.apiKey
    ? new GeminiImageProvider(config.gemini.apiKey)
    : new StubImageProvider();
  cachedProvider = provider;
  return provider;
}

export async function getDeliveryAdapter(): Promise<DeliveryAdapter> {
  if (cachedAdapter) return cachedAdapter;
  const { createDeliveryAdapter } = await import('./messaging/simulator.js');
  cachedAdapter = await createDeliveryAdapter();
  return cachedAdapter;
}

/** Test seam: inject fakes. */
export function setProviders(provider?: ImageProvider, adapter?: DeliveryAdapter): void {
  cachedProvider = provider;
  cachedAdapter = adapter;
}
