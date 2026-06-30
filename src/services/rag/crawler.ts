import { createHash } from 'node:crypto';
import { TAX_LAW_ALLOWED_HOSTS, type TaxLawChunk, type TaxLawSource } from './types';

const DEFAULT_USER_AGENT = 'eu-tax-saas-bot/0.1 (+https://eu-tax-saas.com/bot)';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class CrawlerHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CrawlerHttpError';
  }
}

export interface ChunkOptions {
  target?: number;
  overlap?: number;
}

export interface TextChunk {
  chunkIndex: number;
  text: string;
  charCount: number;
}

export interface FetchSourceResult {
  contentType: string;
  body: Uint8Array;
}

export interface FetchSourceOptions {
  botContact?: string;
  maxResponseBytes?: number;
}

export interface BuildChunksOptions {
  fetchedAt?: string;
}

export function isAllowedTaxLawHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return TAX_LAW_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildChunkId(
  source: Pick<TaxLawSource, 'jurisdiction' | 'url'>,
  chunkIndex: number,
): string {
  return sha256Hex(`${source.jurisdiction}|${source.url}|${chunkIndex}`);
}

export function normalizeHtml(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutNoise = withoutComments
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ');

  const withHeadings = withoutNoise
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/section>/gi, '\n')
    .replace(/<\/article>/gi, '\n');

  return decodeHtmlEntities(withHeadings.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function normalizePdf(_body: Uint8Array): Promise<string> {
  throw new Error('pdf_normalization_not_implemented_in_wave1');
}

export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const normalized = text.replace(/\s+\n/g, '\n').trim();
  if (normalized.length === 0) return [];

  const target = opts.target ?? 1800;
  const overlap = opts.overlap ?? 200;
  if (target <= 0) throw new Error('chunk target must be positive');
  if (overlap < 0 || overlap >= target) throw new Error('chunk overlap must be >= 0 and < target');

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const rawEnd = Math.min(start + target, normalized.length);
    const end =
      rawEnd === normalized.length ? rawEnd : chooseBoundary(normalized, start, rawEnd, target);
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({ chunkIndex: chunks.length, text: chunk, charCount: chunk.length });
    }
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

export async function fetchSource(
  source: TaxLawSource,
  fetchFn: typeof fetch = globalThis.fetch,
  opts: FetchSourceOptions = {},
): Promise<FetchSourceResult> {
  if (!isAllowedTaxLawHost(source.url)) {
    throw new CrawlerHttpError(`Refusing to fetch non-allowlisted host: ${source.url}`);
  }

  const botContact = opts.botContact?.trim();
  const maxResponseBytes = opts.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetchFn(source.url, {
        headers: buildRequestHeaders(botContact),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (attempt === 0 && RETRYABLE_STATUSES.has(res.status)) {
          await sleep(1000);
          continue;
        }
        throw new CrawlerHttpError(`Fetch failed for ${source.url}: ${res.status}`, res.status);
      }
      const contentType = res.headers.get('content-type') ?? '';
      validateContentType(source, contentType);
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.byteLength > maxResponseBytes) {
        throw new CrawlerHttpError(
          `Fetch refused for ${source.url}: response exceeded ${maxResponseBytes} bytes`,
        );
      }
      return { contentType, body };
    } catch (err) {
      if (err instanceof CrawlerHttpError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) {
        await sleep(1000);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof CrawlerHttpError) throw lastError;
  throw new CrawlerHttpError(`Fetch failed for ${source.url}: ${lastError?.message ?? 'unknown'}`);
}

export function buildTaxLawChunks(
  source: TaxLawSource,
  text: string,
  opts: BuildChunksOptions = {},
): TaxLawChunk[] {
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  return chunkText(text).map((chunk) => ({
    id: buildChunkId(source, chunk.chunkIndex),
    jurisdiction: source.jurisdiction,
    sourceUrl: source.url,
    sourceTitle: source.title,
    authority: source.authority,
    taxYear: source.taxYear,
    topic: source.topic,
    regimeStatus: source.regimeStatus,
    lang: source.lang,
    chunkIndex: chunk.chunkIndex,
    charCount: chunk.charCount,
    text: chunk.text,
    contentHash: sha256Hex(chunk.text),
    fetchedAt,
    vector: null,
  }));
}

function chooseBoundary(text: string, start: number, rawEnd: number, target: number): number {
  const min = Math.max(start + Math.floor(target * 0.75), rawEnd - 120);
  const max = Math.min(text.length, rawEnd + 120);
  const window = text.slice(min, max);
  const matches = [...window.matchAll(/[.!?。！？]\s+|\n{2,}/g)];
  if (matches.length === 0) return rawEnd;
  const best = matches.reduce((prev, curr) => {
    const prevDistance = Math.abs(min + (prev.index ?? 0) - rawEnd);
    const currDistance = Math.abs(min + (curr.index ?? 0) - rawEnd);
    return currDistance < prevDistance ? curr : prev;
  });
  return min + (best.index ?? 0) + best[0].length;
}

function buildRequestHeaders(botContact: string | undefined): HeadersInit {
  const userAgent = botContact ? `${DEFAULT_USER_AGENT} contact=${botContact}` : DEFAULT_USER_AGENT;
  return {
    Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    'User-Agent': userAgent,
    From: botContact ?? 'ops@eu-tax-saas.com',
  };
}

function validateContentType(source: TaxLawSource, contentType: string): void {
  const normalized = contentType.toLowerCase();
  if (source.sourceType === 'html') {
    if (!normalized.includes('text/html') && !normalized.includes('application/xhtml+xml')) {
      throw new CrawlerHttpError(
        `Fetch refused for ${source.url}: expected HTML, got ${contentType}`,
      );
    }
    return;
  }

  if (source.sourceType === 'pdf' && !normalized.includes('application/pdf')) {
    throw new CrawlerHttpError(`Fetch refused for ${source.url}: expected PDF, got ${contentType}`);
  }
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    euro: '€',
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, raw: string) => {
    const lower = raw.toLowerCase();
    if (lower.startsWith('#x')) {
      return fromCodePoint(Number.parseInt(lower.slice(2), 16), entity);
    }
    if (lower.startsWith('#')) {
      return fromCodePoint(Number.parseInt(lower.slice(1), 10), entity);
    }
    return named[lower] ?? entity;
  });
}

function fromCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isFinite(codePoint)) return fallback;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
