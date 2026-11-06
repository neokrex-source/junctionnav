// node --experimental-strip-types --test scripts/traffic/news.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, collect, parseFeed, trafficItem } from './news.mjs';

const now = Date.parse('2026-11-06T08:00:00Z');
const ago = (h) => new Date(now - h * 3600_000).toUTCString();

test('reads RSS with CDATA and entities, and Google News titles', () => {
  const xml = `<rss><channel><title>x</title>
    <item><title><![CDATA[Crash on DUKE causes 5km crawl]]></title><link>https://a.example/1</link><pubDate>${ago(1)}</pubDate><description>&lt;p&gt;Lorry &amp; car&lt;/p&gt;</description></item>
    <item><title>Kesesakan di Lebuhraya Persekutuan - Berita Harian</title><link>https://news.google.com/rss/articles/abc</link><pubDate>${ago(2)}</pubDate><source url="https://www.bharian.com.my">Berita Harian</source></item>
  </channel></rss>`;
  const items = parseFeed(xml, 'Feed');
  assert.equal(items.length, 2);
  assert.equal(items[0].summary, 'Lorry & car');
  assert.equal(items[0].source, 'Feed');
  assert.equal(items[1].title, 'Kesesakan di Lebuhraya Persekutuan');
  assert.equal(items[1].source, 'Berita Harian');
});

test('keeps traffic on roads, drops the rest', () => {
  const it = (title, h = 1, summary = '') => ({ title, link: 'https://a.example/x', published: ago(h), summary, source: 'S' });
  assert.deepEqual(trafficItem(it('Crash on DUKE causes 5km crawl'), now)?.roads, ['DUKE']);
  assert.equal(trafficItem(it('Kemalangan babitkan tiga kenderaan di KM 290 Lebuhraya Utara-Selatan'), now)?.kind, 'accident');
  assert.equal(trafficItem(it('Jalan Ampang ditutup esok untuk perarakan'), now)?.kind, 'closure');
  assert.equal(trafficItem(it('Flash floods hit Jalan Klang Lama'), now)?.kind, 'flood');
  assert.equal(trafficItem(it('Human trafficking syndicate busted on the highway'), now), null);
  assert.equal(trafficItem(it('JPJ issues 3,000 traffic summonses'), now), null);
  assert.equal(trafficItem(it('Crash on DUKE causes 5km crawl', 13), now), null);
  assert.equal(trafficItem(it('Market closed for the holiday'), now), null);
  assert.equal(classify('Massive jam at Plaza Tol Sungai Besi'), 'jam');
});

test('removes duplicates and sorts newest first', () => {
  const a = { title: 'Crash on DUKE causes 5km crawl', link: 'https://a.example/1', published: ago(3), source: 'A' };
  const b = { title: 'Crash on DUKE causes 5km crawl!', link: 'https://b.example/1', published: ago(2), source: 'B' };
  const c = { title: 'Jam on NKVE after lorry breaks down', link: 'https://c.example/1', published: ago(1), source: 'C' };
  const out = collect([[a, c], [b]], now);
  assert.deepEqual(out.map((i) => i.source), ['C', 'A']);
});
