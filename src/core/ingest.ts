import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { Repo } from '../db/repo.js';
import type { AssetRow } from '../db/repo.js';
import { logger } from '../logger.js';
import { blobStore, buildAssetKey } from '../media/store.js';
import { MediaValidationError, inspectImage, sha256 } from '../media/validate.js';
import type { DeliveryAdapter } from '../messaging/types.js';
import { buildGarmentDescriptionPrompt, variationNoteFor } from '../imaging/prompts.js';
import type { ImageProvider, ImageRef } from '../imaging/types.js';
import { ImageProviderError } from '../imaging/types.js';
import type { InboundAttachment } from '../types.js';

/**
 * Turn an inbound channel attachment into a persisted, validated asset.
 *
 * Media is downloaded through the delivery adapter (channel-specific) and
 * written to the blob store immediately, because WhatsApp's media URLs are
 * short-lived. Validation happens on the real bytes, never on a declared MIME
 * type from an untrusted payload.
 */
export async function persistInboundAsset(
  repo: Repo,
  adapter: DeliveryAdapter,
  attachment: InboundAttachment,
  source: string,
): Promise<AssetRow> {
  const { mime: declaredMime, data } = await adapter.downloadMedia(attachment.externalId);

  let info;
  try {
    info = inspectImage(data);
  } catch (err) {
    if (err instanceof MediaValidationError) throw err;
    throw new MediaValidationError(String(err), 'That photo could not be read — please resend it.');
  }

  // Dedupe identical bytes so a re-sent photo does not inflate storage.
  const hash = sha256(data);
  const existing = repo.findAssetBySha(hash);
  if (existing) {
    logger.debug({ assetId: existing.id }, 'reusing existing asset for identical bytes');
    return existing;
  }

  const key = buildAssetKey(info.ext, 'uploads');
  await blobStore.put(key, data);

  return repo.insertAsset({
    id: randomUUID(),
    kind: 'uploaded',
    mime: info.mime || declaredMime || 'image/jpeg',
    bytes: data.length,
    width: info.width,
    height: info.height,
    path: key,
    sha256: hash,
    source,
  });
}

/** Persists a generated image returned by the provider. */
export async function persistGeneratedAsset(
  repo: Repo,
  bytes: Uint8Array,
  mime: string,
): Promise<AssetRow> {
  let info;
  try {
    info = inspectImage(bytes);
  } catch (err) {
    throw new ImageProviderError(
      `provider returned an unusable image: ${err instanceof Error ? err.message : String(err)}`,
      'provider',
      true,
    );
  }

  const key = buildAssetKey(info.ext, 'generated');
  await blobStore.put(key, bytes);

  return repo.insertAsset({
    id: randomUUID(),
    kind: 'generated',
    mime: info.mime || mime,
    bytes: bytes.length,
    width: info.width,
    height: info.height,
    path: key,
    sha256: sha256(bytes),
    source: 'gemini',
  });
}

/** Loads asset bytes as provider-ready references. */
export async function loadRefs(assets: AssetRow[]): Promise<ImageRef[]> {
  const refs: ImageRef[] = [];
  for (const asset of assets) {
    try {
      refs.push({ mime: asset.mime, data: await blobStore.get(asset.path) });
    } catch (err) {
      // A missing blob must not take down the turn; degrade to fewer refs.
      logger.warn(
        { assetId: asset.id, err: err instanceof Error ? err.message : err },
        'could not read asset bytes, skipping reference',
      );
    }
  }
  return refs;
}

export { buildGarmentDescriptionPrompt, variationNoteFor };
