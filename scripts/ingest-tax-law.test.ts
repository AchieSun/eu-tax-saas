import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TAX_LAW_ALLOWED_HOSTS,
  TaxLawChunkSchema,
  TaxLawSourceManifestSchema,
} from '../src/services/rag/types';
import { loadManifest, parseArgs, runIngest } from './ingest-tax-law';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tax-law-ingest-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('tax-law source manifest', () => {
  it('parses every official source entry', async () => {
    const sources = await loadManifest('data/tax-law-sources.yml');
    const jurisdictions = new Set(sources.map((s) => s.jurisdiction));
    expect(sources.length).toBeGreaterThanOrEqual(18);
    expect(jurisdictions).toEqual(new Set(['ES', 'PT', 'UK', 'NL', 'DE', 'EU']));
  });

  it('contains only allowlisted official hosts', async () => {
    const sources = await loadManifest('data/tax-law-sources.yml');
    for (const source of sources) {
      const host = new URL(source.url).hostname.toLowerCase();
      expect(
        TAX_LAW_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)),
      ).toBe(true);
    }
  });

  it('manifest schema rejects an invalid URL', () => {
    expect(() =>
      TaxLawSourceManifestSchema.parse({
        version: 1,
        description: 'bad',
        sources: [
          {
            jurisdiction: 'ES',
            lang: 'es',
            title: 'bad',
            url: 'not-a-url',
            sourceType: 'html',
            authority: 'BOE',
            taxYear: 2025,
            topic: 'bad',
            licenseNote: 'bad',
            lastVerifiedAt: '2026-06-11',
          },
        ],
      }),
    ).toThrow();
  });
});

describe('parseArgs', () => {
  it('uses safe defaults', () => {
    const args = parseArgs([]);
    expect(args.jurisdiction).toBe('ALL');
    expect(args.dryRun).toBe(false);
    expect(args.manifest).toContain('tax-law-sources.yml');
  });

  it('parses jurisdiction, dry-run and limit', () => {
    const args = parseArgs(['--jurisdiction', 'DE', '--dry-run', '--limit', '2']);
    expect(args).toMatchObject({ jurisdiction: 'DE', dryRun: true, limit: 2 });
  });

  it('rejects invalid jurisdiction', () => {
    expect(() => parseArgs(['--jurisdiction', 'FR'])).toThrow(/jurisdiction/);
  });
});

describe('runIngest dry-run', () => {
  it('emits schema-valid JSONL chunks without network', async () => {
    const out = await makeTempDir();
    const result = await runIngest({
      jurisdiction: 'ES',
      out,
      manifest: 'data/tax-law-sources.yml',
      dryRun: true,
      limit: 2,
    });
    expect(result.plannedSources).toHaveLength(2);
    expect(result.chunks).toHaveLength(2);
    for (const chunk of result.chunks) TaxLawChunkSchema.parse(chunk);

    const file = await readFile(join(out, 'ES.jsonl'), 'utf8');
    const lines = file.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]) as unknown).toMatchObject({ jurisdiction: 'ES', vector: null });
  });

  it('requires bot contact for non-dry-run crawls', async () => {
    const previous = process.env.EU_TAX_SAAS_BOT_CONTACT;
    process.env.EU_TAX_SAAS_BOT_CONTACT = '';
    await expect(
      runIngest({
        jurisdiction: 'ES',
        out: await makeTempDir(),
        manifest: 'data/tax-law-sources.yml',
        dryRun: false,
        limit: 1,
      }),
    ).rejects.toThrow(/EU_TAX_SAAS_BOT_CONTACT/);
    process.env.EU_TAX_SAAS_BOT_CONTACT = previous ?? '';
  });

  it('supports custom manifest path', async () => {
    const dir = await makeTempDir();
    const manifestPath = join(dir, 'manifest.yml');
    await writeFile(
      manifestPath,
      'version: 1\ndescription: test\nsources:\n  - jurisdiction: EU\n    lang: en\n    title: Test EUR-Lex\n    url: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32018L0822\n    sourceType: html\n    authority: EUR-Lex\n    taxYear: 2025\n    topic: dac6\n    licenseNote: test\n    lastVerifiedAt: 2026-06-11\n',
      'utf8',
    );
    const out = join(dir, 'out');
    const result = await runIngest({
      jurisdiction: 'ALL',
      out,
      manifest: manifestPath,
      dryRun: true,
      limit: 1,
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].jurisdiction).toBe('EU');
  });
});
