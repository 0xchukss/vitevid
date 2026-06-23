import { ResultItem } from '@/types';

export const MAX_STORYBOARD_ASSET_REUSE = 2;

function normalizeUrl(value?: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return `${url.hostname}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return value
      .split('#')[0]
      .split('?')[0]
      .trim()
      .toLowerCase();
  }
}

function titleFallbackKey(item: ResultItem) {
  const title = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 90);
  if (!title || title.length < 10) return '';
  return `title:${item.source.toLowerCase()}:${title}`;
}

export function assetUniquenessKeys(item: ResultItem) {
  const keys = new Set<string>();
  const directUrl = normalizeUrl(item.downloadUrl);
  const thumbnailUrl = normalizeUrl(item.thumbnail);
  const pageUrl = normalizeUrl(item.sourcePageUrl || item.url);

  if (directUrl) keys.add(`media:${directUrl}`);
  if (thumbnailUrl) keys.add(`thumb:${thumbnailUrl}`);
  if (pageUrl) keys.add(`page:${pageUrl}`);
  if (item.source && item.id) keys.add(`id:${item.source.toLowerCase()}:${item.id.toLowerCase()}`);

  const titleKey = titleFallbackKey(item);
  if (keys.size === 0 && titleKey) keys.add(titleKey);

  return Array.from(keys);
}

export function primaryAssetKey(item: ResultItem) {
  return assetUniquenessKeys(item)[0] || `asset:${item.source}:${item.id}`;
}

export function assetUsageCount(usage: Map<string, number>, item: ResultItem) {
  return assetUniquenessKeys(item).reduce((count, key) => Math.max(count, usage.get(key) || 0), 0);
}

export function registerAssetUsage(usage: Map<string, number>, item: ResultItem) {
  assetUniquenessKeys(item).forEach((key) => {
    usage.set(key, (usage.get(key) || 0) + 1);
  });
}

export function assetUsageRecord(usage: Map<string, number>) {
  return Object.fromEntries(usage.entries());
}

export function usageMapFromRecord(value: unknown) {
  if (!value || typeof value !== 'object') return new Map<string, number>();
  return new Map(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  );
}

export function freshAssetCandidates(items: ResultItem[], usage: Map<string, number>, maxReuse = MAX_STORYBOARD_ASSET_REUSE) {
  const fresh = items.filter((item) => assetUsageCount(usage, item) < maxReuse);
  return fresh.length > 0 ? fresh : items;
}

export function sortByAssetFreshness(items: ResultItem[], usage: Map<string, number>) {
  return [...items].sort((left, right) => assetUsageCount(usage, left) - assetUsageCount(usage, right));
}
