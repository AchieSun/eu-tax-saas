import { describe, expect, it, vi } from 'vitest';
import {
  CrawlerHttpError,
  buildChunkId,
  buildTaxLawChunks,
  chunkText,
  fetchSource,
  isAllowedTaxLawHost,
  normalizeHtml,
  sha256Hex,
} from './crawler';
import type { TaxLawSource } from './types';

const SAMPLE_SOURCE: TaxLawSource = {
  jurisdiction: 'ES',
  lang: 'es',
  title: 'Ley 35/2006 del IRPF consolidated text',
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764',
  sourceType: 'html',
  authority: 'BOE',
  taxYear: 2025,
  topic: 'irpf-personal-income-tax',
  licenseNote: 'BOE public-sector legal text',
  lastVerifiedAt: '2026-06-11',
};

describe('normalizeHtml', () => {
  it('strips script/style/nav/footer and preserves headings', () => {
    const html =
      '<script>x</script><style>y</style><nav>menu</nav><h1>Title</h1><p>Body &amp; €</p><footer>f</footer>';
    expect(normalizeHtml(html)).toBe('# Title\nBody & €');
  });

  it('converts list items and decodes numeric entities', () => {
    const html = '<h2>A</h2><ul><li>One &#8364;</li><li>Two</li></ul>';
    expect(normalizeHtml(html)).toContain('## A\n- One €\n- Two');
  });
});

describe('chunkText', () => {
  it('returns empty array for blank input', () => {
    expect(chunkText('   ')).toEqual([]);
  });

  it('splits long text deterministically with overlap', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence ${i}.`).join(' ');
    const chunks = chunkText(text, { target: 120, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.charCount <= 240)).toBe(true);
    expect(chunks[0].text).toBe(chunkText(text, { target: 120, overlap: 20 })[0].text);
  });

  it('rejects invalid chunk settings', () => {
    expect(() => chunkText('hello', { target: 10, overlap: 10 })).toThrow(/overlap/);
  });
});

describe('hash and id helpers', () => {
  it('sha256Hex is stable', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('buildChunkId is deterministic and 64 hex chars', () => {
    const first = buildChunkId(SAMPLE_SOURCE, 0);
    expect(first).toBe(buildChunkId(SAMPLE_SOURCE, 0));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('host allow-list', () => {
  it('allows official hosts and rejects unknown hosts', () => {
    expect(isAllowedTaxLawHost('https://www.boe.es/buscar/act.php?id=1')).toBe(true);
    expect(isAllowedTaxLawHost('https://eur-lex.europa.eu/legal-content/EN/TXT/')).toBe(true);
    expect(isAllowedTaxLawHost('https://evil.example/phish')).toBe(false);
  });
});

describe('fetchSource', () => {
  it('refuses non-allowlisted hosts before fetch', async () => {
    const fetchFn = vi.fn();
    await expect(
      fetchSource({ ...SAMPLE_SOURCE, url: 'https://evil.example/x' }, fetchFn),
    ).rejects.toBeInstanceOf(CrawlerHttpError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retries once on retryable status and then succeeds', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('<h1>ok</h1>', { headers: { 'content-type': 'text/html' }, status: 200 }),
      );
    const result = await fetchSource(SAMPLE_SOURCE, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(result.body)).toContain('ok');
  });

  it('throws on non-retryable status', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('missing', { status: 404 }));
    await expect(fetchSource(SAMPLE_SOURCE, fetchFn)).rejects.toMatchObject({ status: 404 });
  });

  it('sends contact headers when bot contact is provided', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('<h1>ok</h1>', { headers: { 'content-type': 'text/html' }, status: 200 }),
      );
    await fetchSource(SAMPLE_SOURCE, fetchFn, { botContact: 'taxbot@example.com' });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      From: 'taxbot@example.com',
      'User-Agent': expect.stringContaining('taxbot@example.com'),
    });
  });

  it('rejects unexpected content types', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    await expect(fetchSource(SAMPLE_SOURCE, fetchFn)).rejects.toThrow(/expected HTML/);
  });

  it('rejects responses above the configured byte cap', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('too large', { headers: { 'content-type': 'text/html' }, status: 200 }),
      );
    await expect(fetchSource(SAMPLE_SOURCE, fetchFn, { maxResponseBytes: 4 })).rejects.toThrow(
      /exceeded 4 bytes/,
    );
  });
});

describe('buildTaxLawChunks', () => {
  it('maps source metadata onto chunks', () => {
    const chunks = buildTaxLawChunks(SAMPLE_SOURCE, 'A useful tax paragraph.', {
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      jurisdiction: 'ES',
      sourceUrl: SAMPLE_SOURCE.url,
      sourceTitle: SAMPLE_SOURCE.title,
      vector: null,
    });
    expect(chunks[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
