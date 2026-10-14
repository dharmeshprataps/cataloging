import type { FastifyInstance } from 'fastify';
import { logger } from '../logger.js';
import type { Repo } from '../db/repo.js';
import { blobStore } from '../media/store.js';

/**
 * Serves stored images (uploaded garment photos and generated shots) so the
 * simulator UI and any future admin surface can display them.
 *
 * Access control here is deliberately "know the id": ids are UUIDs and this
 * route backs a local development surface. A public multi-tenant deployment
 * must add auth before exposing it.
 */
export function registerMediaRoutes(app: FastifyInstance, repo: Repo): void {
  app.get('/media/:assetId', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = repo.getAsset(assetId);
    if (!asset) return reply.status(404).send({ error: 'not_found' });

    try {
      const data = await blobStore.get(asset.path);
      return reply
        .header('Content-Type', asset.mime)
        .header('Cache-Control', 'private, max-age=3600')
        .send(Buffer.from(data));
    } catch (err) {
      logger.error(
        { assetId, path: asset.path, err: err instanceof Error ? err.message : err },
        'stored asset bytes missing',
      );
      return reply.status(410).send({ error: 'asset_bytes_missing' });
    }
  });

  /** Catalog listing for the simulator's "saved items" panel. */
  app.get('/api/catalog', async () => {
    const org = repo.ensureDefaultOrg();
    const products = repo.listProducts(org.id, 50);
    return {
      items: products.map((product) => {
        const links = repo.listProductAssets(product.id);
        const role = (r: string) => links.filter((l) => l.role === r).map((l) => l.asset.id);
        return {
          id: product.id,
          sku: product.sku,
          title: product.title,
          createdAt: product.created_at,
          heroAssetId: role('hero')[0] ?? null,
          alternateAssetIds: role('alternate'),
        };
      }),
    };
  });
}
