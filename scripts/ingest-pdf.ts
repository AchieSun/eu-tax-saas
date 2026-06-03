/**
 * ingest-pdf.ts — Node CLI to upload tax form PDFs to Cloudflare R2
 * and register them in the form_field_mappings D1 table.
 *
 * Run with: tsx scripts/ingest-pdf.ts --country DE --year 2024 --form mantelbogen --pdf ./tax-forms/DE/2024/mantelbogen.pdf
 *
 * Requires: pnpm add -D @aws-sdk/client-s3 tsx
 * Requires env vars: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */

import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IngestArgs {
  country: string;
  year: number;
  form: string;
  pdfPath: string;
  dryRun: boolean;
}

export interface PdfMetadata {
  sha256: string;
  r2Key: string;
  pageCount: number;
  sizeBytes: number;
}

// ─── PDF page count extraction ──────────────────────────────────────────────

/**
 * Extract page count from a PDF buffer by parsing the PDF structure.
 * Works for most standard PDFs without external dependencies.
 */
export function extractPageCount(pdfBuf: Buffer): number {
  const txt = pdfBuf.toString('binary');

  // Try the standard /Type /Pages ... /Count N pattern first
  // This matches the Pages dictionary which contains the total page count
  const m = txt.match(/\/Type\s*\/Pages[^]*?\/Count\s+(\d+)/);
  if (m) return parseInt(m[1], 10);

  // Fallback: take the max of all /Count values found in the file
  const allCounts = [...txt.matchAll(/\/Count\s+(\d+)/g)].map((x) => parseInt(x[1], 10));
  return allCounts.length > 0 ? Math.max(...allCounts) : 1;
}

// ─── Metadata extraction ────────────────────────────────────────────────────

export function extractMetadata(args: IngestArgs, buf: Buffer): PdfMetadata {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const r2Key = `tax-forms/${args.country}/${args.year}/${args.form}.pdf`;
  const pageCount = extractPageCount(buf);
  return { sha256, r2Key, pageCount, sizeBytes: buf.length };
}

// ─── R2 upload (S3-compatible API) ──────────────────────────────────────────

export type UploadToR2 = (
  buf: Buffer,
  r2Key: string,
  sha256: string,
  country: string,
  year: number,
  form: string,
) => Promise<void>;

export const defaultUploadToR2: UploadToR2 = async (buf, r2Key, sha256, country, year, form) => {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3').catch(() => {
    throw new Error(
      'Missing dependency: @aws-sdk/client-s3 is required for R2 upload.\n' +
        'Install it with: pnpm add -D @aws-sdk/client-s3\n' +
        'Then set environment variables:\n' +
        '  CF_ACCOUNT_ID=<your-cloudflare-account-id>\n' +
        '  R2_ACCESS_KEY_ID=<your-r2-access-key>\n' +
        '  R2_SECRET_ACCESS_KEY=<your-r2-secret-key>\n' +
        '  R2_BUCKET=eu-tax-saas-pdfs',
    );
  });

  const accountId = process.env.CF_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'Missing R2 environment variables. Required:\n' +
        '  CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET',
    );
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: r2Key,
      Body: buf,
      ContentType: 'application/pdf',
      Metadata: { sha256, country, year: String(year), form },
    }),
  );
};

// ─── DB registration SQL generation ─────────────────────────────────────────

/**
 * Generate a SQL INSERT ... ON CONFLICT statement for D1 registration.
 *
 * WARNING: This is a controlled ingestion tool — values come from CLI args
 * provided by the developer, not from untrusted user input. SQL injection
 * is not a practical risk here, but values are escaped via .replace for safety.
 */
export function generateRegisterSql(args: IngestArgs, meta: PdfMetadata): string {
  const id = randomUUID();
  const createdAt = Date.now();
  const esc = (s: string) => s.replace(/'/g, "''");

  return [
    `INSERT INTO form_field_mappings (id, country, form_type, tax_year, field_name, pdf_r2_key, pdf_sha256, page_count, created_at)`,
    `VALUES ('${esc(id)}', '${esc(args.country)}', '${esc(args.form)}', ${args.year}, '__pdf__', '${esc(meta.r2Key)}', '${esc(meta.sha256)}', ${meta.pageCount}, ${createdAt})`,
    `ON CONFLICT (country, form_type, tax_year, field_name) DO UPDATE SET`,
    `  pdf_r2_key = excluded.pdf_r2_key,`,
    `  pdf_sha256 = excluded.pdf_sha256,`,
    `  page_count = excluded.page_count,`,
    `  deleted_at = NULL;`,
  ].join('\n');
}

// ─── Main ingest ────────────────────────────────────────────────────────────

export async function ingest(
  args: IngestArgs,
  uploadToR2: UploadToR2 = defaultUploadToR2,
): Promise<PdfMetadata> {
  const buf = await readFile(args.pdfPath);
  const meta = extractMetadata(args, buf);

  console.log(JSON.stringify(meta, null, 2));
  console.log(`Dry-run: ${args.dryRun}`);

  if (args.dryRun) {
    console.log('\n[Skipped] R2 upload — dry-run mode.');
    console.log('[Skipped] DB registration — dry-run mode.');
    return meta;
  }

  // Upload to R2
  await uploadToR2(buf, meta.r2Key, meta.sha256, args.country, args.year, args.form);
  console.log(`\n[OK] Uploaded to R2: ${meta.r2Key}`);

  // Generate DB registration SQL
  const sql = generateRegisterSql(args, meta);
  console.log('\n[Action required] Register in D1 database:');
  console.log(
    `npx wrangler d1 execute eu-tax-saas-db --remote --command="${sql.replace(/"/g, '\\"')}"`,
  );

  return meta;
}

// ─── CLI argument parsing ───────────────────────────────────────────────────

export interface CliArgs {
  country: string;
  year: number;
  form: string;
  pdfPath: string;
  dryRun: boolean;
}

export function parseCliArgs(args: string[]): CliArgs {
  const get = (name: string, dflt?: string) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? dflt : args[i + 1];
  };

  const country = get('country');
  const year = parseInt(get('year', '0')!, 10);
  const form = get('form');
  const pdfPath = get('pdf');
  const dryRun = args.includes('--dry-run');

  if (!country || !year || !form || !pdfPath) {
    throw new Error(
      'Missing required arguments.\n' +
        'Usage: tsx scripts/ingest-pdf.ts --country DE --year 2024 --form mantelbogen --pdf ./tax-forms/DE/2024/mantelbogen.pdf [--dry-run]',
    );
  }

  return { country, year, form, pdfPath, dryRun };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

const isMain =
  argv[1] !== undefined &&
  (fileURLToPath(import.meta.url) === argv[1] ||
    argv[1].replace(/\\/g, '/').endsWith('ingest-pdf.ts') ||
    argv[1].replace(/\\/g, '/').endsWith('ingest-pdf.js'));

if (isMain) {
  try {
    const cliArgs = parseCliArgs(process.argv.slice(2));
    ingest(cliArgs).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
