/**
 * Traffic headlines from Malaysian news feeds, collected every 20 minutes by a GitHub job
 * (scripts/traffic/news.mjs) into one small JSON file. No key needed.
 */
import type { NewsFeed, NewsItem, NewsKind } from './types';

const KINDS: NewsKind[] = ['accident', 'jam', 'closure', 'flood', 'roadworks', 'other'];

/** Only well-formed items with a web link survive (the feed is data from the web). */
export function parseNews(raw: unknown): NewsFeed {
  const o = (raw ?? {}) as { updated?: unknown; items?: unknown };
  const items: NewsItem[] = [];
  for (const it of Array.isArray(o.items) ? o.items : []) {
    const r = it as Record<string, unknown>;
    const link = typeof r.link === 'string' ? r.link : '';
    if (typeof r.title !== 'string' || !r.title.trim() || !/^https?:\/\//.test(link) || Number.isNaN(Date.parse(String(r.published)))) continue;
    items.push({
      title: r.title.trim().slice(0, 300),
      link,
      source: typeof r.source === 'string' ? r.source.slice(0, 60) : new URL(link).hostname,
      published: new Date(String(r.published)).toISOString(),
      roads: Array.isArray(r.roads) ? r.roads.filter((x): x is string => typeof x === 'string') : [],
      kind: KINDS.includes(r.kind as NewsKind) ? (r.kind as NewsKind) : 'other',
    });
  }
  return { updated: typeof o.updated === 'string' ? o.updated : '', items };
}

export async function fetchNews(url: string, signal?: AbortSignal): Promise<NewsFeed> {
  // The file sits behind a CDN for a few minutes; a new address every 5 minutes gets a fresh copy.
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}v=${Math.floor(Date.now() / 300_000)}`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`Traffic news failed (${res.status}).`);
  return parseNews(await res.json());
}
