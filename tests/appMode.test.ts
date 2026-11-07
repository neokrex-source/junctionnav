import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFile } from '../src/native/appMode';

const ok = (n: number) => new Response(new Uint8Array(n), { status: 200 });

describe('website build download', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tries a dropped file again instead of giving up on the whole download', async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => ok(10), // cut short
      () => ok(40),
    ];
    const fetchMock = vi.fn(async () => answers.shift()!());
    vi.stubGlobal('fetch', fetchMock);
    const buf = await fetchFile('https://example.org/icon.svg', 'icon.svg', 40, 3, 1);
    expect(buf.byteLength).toBe(40);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after three tries, and at once on a file that is gone', async () => {
    const busy = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', busy);
    await expect(fetchFile('https://example.org/a.js', 'a.js', 5, 3, 1)).rejects.toThrow('Could not download a.js (503).');
    expect(busy).toHaveBeenCalledTimes(3);
    const gone = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', gone);
    await expect(fetchFile('https://example.org/b.js', 'b.js', 5, 3, 1)).rejects.toThrow('Could not download b.js (404).');
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
