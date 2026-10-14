import type { ProductRow, Repo } from '../db/repo.js';
import { logger } from '../logger.js';

/**
 * Catalog read/export helpers. Kept separate from the conversation pipeline so
 * reporting and export can grow (CSV, Shopify, a dashboard) without touching
 * conversational logic.
 */

export type CatalogEntry = {
  product: ProductRow;
  heroAssetId: string | null;
  alternateAssetIds: string[];
  inputAssetIds: string[];
};

export function getCatalogEntry(repo: Repo, productId: string): CatalogEntry | undefined {
  const product = repo.getProduct(productId);
  if (!product) return undefined;

  const links = repo.listProductAssets(productId);
  const pick = (role: string) =>
    links.filter((l) => l.role === role).map((l) => l.asset.id);

  return {
    product,
    heroAssetId: pick('hero')[0] ?? null,
    alternateAssetIds: pick('alternate'),
    inputAssetIds: pick('input'),
  };
}

export function listCatalog(repo: Repo, orgId: string, limit = 100): CatalogEntry[] {
  return repo
    .listProducts(orgId, limit)
    .map((p) => getCatalogEntry(repo, p.id))
    .filter((e): e is CatalogEntry => e !== undefined);
}

/** Minimal CSV export of the catalog without generated binaries. */
export function catalogToCsv(entries: CatalogEntry[]): string {
  const header = ['sku', 'title', 'category', 'price_cents', 'currency', 'hero_asset_id', 'created_at'];
  const escape = (value: unknown): string => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = entries.map((e) =>
    [
      e.product.sku,
      e.product.title,
      e.product.category,
      e.product.price_cents,
      e.product.currency,
      e.heroAssetId,
      e.product.created_at,
    ]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

export function logCatalogSummary(repo: Repo): void {
  const org = repo.getFirstOrg();
  if (!org) return;
  const entries = listCatalog(repo, org.id, 1000);
  const withHero = entries.filter((e) => e.heroAssetId).length;
  logger.info(
    { orgId: org.id, products: entries.length, approvedWithHero: withHero },
    'catalog summary',
  );
}
