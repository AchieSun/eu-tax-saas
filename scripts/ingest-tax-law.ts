#!/usr/bin/env tsx

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  buildTaxLawChunks,
  fetchSource,
  normalizeHtml,
  normalizePdf,
} from '../src/services/rag/crawler';
import {
  type TaxLawChunk,
  TaxLawChunkSchema,
  type TaxLawJurisdiction,
  type TaxLawSource,
  TaxLawSourceManifestSchema,
} from '../src/services/rag/types';

export interface IngestTaxLawArgs {
  jurisdiction: TaxLawJurisdiction | 'ALL';
  out: string;
  manifest: string;
  dryRun: boolean;
  limit?: number;
  upsert: boolean;
  workerUrl?: string;
  adminCookieFile?: string;
  batchSize: number;
}

interface UpsertHttpClient {
  postChunks(
    url: string,
    cookie: string,
    chunks: TaxLawChunk[],
  ): Promise<{ ok: boolean; error?: string }>;
}

interface CliResult {
  chunks: TaxLawChunk[];
  plannedSources: TaxLawSource[];
  warnings: string[];
  upserted?: number;
}

const DEFAULT_MANIFEST = resolve(process.cwd(), 'data/tax-law-sources.yml');
const DEFAULT_OUT = resolve(process.cwd(), 'data/tax-law-chunks');
const DEFAULT_BATCH_SIZE = 64;
const VALID_JURISDICTIONS = new Set(['ES', 'PT', 'UK', 'NL', 'DE', 'EU', 'ALL']);

export function parseArgs(argv: string[]): IngestTaxLawArgs {
  const args: IngestTaxLawArgs = {
    jurisdiction: 'ALL',
    out: DEFAULT_OUT,
    manifest: DEFAULT_MANIFEST,
    dryRun: false,
    upsert: false,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--jurisdiction': {
        const value = argv[++i];
        if (!value || !VALID_JURISDICTIONS.has(value)) {
          throw new Error('--jurisdiction must be one of ES|PT|UK|NL|DE|EU|ALL');
        }
        args.jurisdiction = value as IngestTaxLawArgs['jurisdiction'];
        break;
      }
      case '--out': {
        const value = argv[++i];
        if (!value) throw new Error('--out requires a directory or -');
        args.out = value === '-' ? '-' : resolve(process.cwd(), value);
        break;
      }
      case '--manifest': {
        const value = argv[++i];
        if (!value) throw new Error('--manifest requires a path');
        args.manifest = resolve(process.cwd(), value);
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--limit': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value <= 0) throw new Error('--limit must be positive int');
        args.limit = value;
        break;
      }
      case '--upsert':
        args.upsert = true;
        break;
      case '--worker-url': {
        const value = argv[++i];
        if (!value) throw new Error('--worker-url requires a URL');
        args.workerUrl = value;
        break;
      }
      case '--admin-cookie-file': {
        const value = argv[++i];
        if (!value) throw new Error('--admin-cookie-file requires a path');
        args.adminCookieFile = value;
        break;
      }
      case '--batch-size': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value <= 0 || value > 64) {
          throw new Error('--batch-size must be an integer between 1 and 64');
        }
        args.batchSize = value;
        break;
      }
      case '--help':
      case '-h':
        throw new Error(helpText());
      default:
        throw new Error(`Unknown argument: ${arg}\n${helpText()}`);
    }
  }

  if (args.upsert) {
    if (!args.workerUrl) throw new Error('--upsert requires --worker-url');
    if (!args.adminCookieFile) throw new Error('--upsert requires --admin-cookie-file');
  }

  return args;
}

export async function loadManifest(path: string): Promise<TaxLawSource[]> {
  const parsed = YAML.parse(await readFile(path, 'utf8')) as unknown;
  const manifest = TaxLawSourceManifestSchema.parse(parsed);
  return manifest.sources;
}

export async function runIngest(
  args: IngestTaxLawArgs,
  deps: {
    httpClient?: UpsertHttpClient;
    readFileImpl?: (path: string, encoding: 'utf8') => Promise<string>;
  } = {},
): Promise<CliResult> {
  const allSources = await loadManifest(args.manifest);
  let sources =
    args.jurisdiction === 'ALL'
      ? allSources
      : allSources.filter((source) => source.jurisdiction === args.jurisdiction);
  if (args.limit !== undefined) sources = sources.slice(0, args.limit);

  const botContact = process.env.EU_TAX_SAAS_BOT_CONTACT;
  if (!args.dryRun && (!botContact || botContact === 'undefined')) {
    throw new Error('EU_TAX_SAAS_BOT_CONTACT is required for non-dry-run crawls');
  }

  const warnings: string[] = [];
  const chunks: TaxLawChunk[] = [];

  for (const source of sources) {
    if (args.dryRun) {
      const stub = buildTaxLawChunks(
        source,
        `DRY-RUN ${source.jurisdiction} ${source.title} ${source.url}`,
        { fetchedAt: '2026-01-01T00:00:00.000Z' },
      );
      chunks.push(...stub);
      continue;
    }

    if (source.sourceType === 'pdf') {
      warnings.push(`Skipped PDF source in wave 1: ${source.url}`);
      continue;
    }

    const fetched = await fetchSource(source, globalThis.fetch, { botContact });
    const text =
      source.sourceType === 'html'
        ? normalizeHtml(new TextDecoder().decode(fetched.body))
        : await normalizePdf(fetched.body);
    const sourceChunks = buildTaxLawChunks(source, text);
    for (const chunk of sourceChunks) {
      TaxLawChunkSchema.parse(chunk);
      chunks.push(chunk);
    }
  }

  if (args.out === '-') {
    for (const chunk of chunks) {
      process.stdout.write(`${JSON.stringify(chunk)}\n`);
    }
  } else {
    await writeChunks(args.out, chunks);
  }

  let upserted: number | undefined;
  if (args.upsert) {
    upserted = await upsertChunksToWorker(args, chunks, deps);
  }

  return { chunks, plannedSources: sources, warnings, upserted };
}

async function upsertChunksToWorker(
  args: IngestTaxLawArgs,
  chunks: TaxLawChunk[],
  deps: {
    httpClient?: UpsertHttpClient;
    readFileImpl?: (path: string, encoding: 'utf8') => Promise<string>;
  } = {},
): Promise<number> {
  if (!args.workerUrl || !args.adminCookieFile) {
    throw new Error('--worker-url and --admin-cookie-file are required for upsert');
  }

  const readFileImpl = deps.readFileImpl ?? readFile;
  const cookie = (await readFileImpl(args.adminCookieFile, 'utf8')).trim();
  const httpClient =
    deps.httpClient ??
    createDefaultHttpClient({
      fetchImpl: globalThis.fetch,
      workerUrl: args.workerUrl,
      batchSize: args.batchSize,
    });

  let upserted = 0;
  for (let i = 0; i < chunks.length; i += args.batchSize) {
    const batch = chunks.slice(i, i + args.batchSize);
    const result = await httpClient.postChunks(args.workerUrl, cookie, batch);
    if (!result.ok) {
      throw new Error(`Upsert failed: ${result.error ?? 'unknown error'}`);
    }
    upserted += batch.length;
  }

  return upserted;
}

function createDefaultHttpClient(deps: {
  fetchImpl: typeof fetch;
  workerUrl: string;
  batchSize: number;
}): UpsertHttpClient {
  return {
    async postChunks(url: string, cookie: string, chunks: TaxLawChunk[]) {
      const res = await deps.fetchImpl(`${url}/api/admin/rag/upsert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ chunks }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'unknown error');
        return { ok: false, error: `${res.status} ${res.statusText}: ${text}` };
      }

      return { ok: true };
    },
  };
}

export async function writeChunks(outDir: string, chunks: TaxLawChunk[]): Promise<void> {
  const byJurisdiction = new Map<TaxLawJurisdiction, TaxLawChunk[]>();
  for (const chunk of chunks) {
    const existing = byJurisdiction.get(chunk.jurisdiction) ?? [];
    existing.push(chunk);
    byJurisdiction.set(chunk.jurisdiction, existing);
  }

  await mkdir(outDir, { recursive: true });
  for (const [jurisdiction, rows] of byJurisdiction) {
    const file = resolve(outDir, `${jurisdiction}.jsonl`);
    const tmp = `${file}.tmp`;
    const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  }
}

function helpText(): string {
  return 'Usage: pnpm ingest:tax-law -- [--jurisdiction ES|PT|UK|NL|DE|EU|ALL] [--out dir|-] [--manifest path] [--dry-run] [--limit N] [--upsert --worker-url URL --admin-cookie-file PATH [--batch-size N]]';
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runIngest(parseArgs(process.argv.slice(2)))
    .then((result) => {
      for (const warning of result.warnings) console.error(`warning: ${warning}`);
      const upsertPart = result.upserted !== undefined ? ` upserted=${result.upserted}` : '';
      console.error(
        `sources=${result.plannedSources.length} chunks=${result.chunks.length}${upsertPart}`,
      );
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
