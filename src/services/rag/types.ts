import { z } from 'zod';

export const TAX_LAW_JURISDICTIONS = ['ES', 'PT', 'UK', 'NL', 'DE', 'EU'] as const;
export const TAX_LAW_SOURCE_TYPES = ['html', 'pdf'] as const;
export const TAX_LAW_AUTHORITIES = [
  'BOE',
  'Agencia Tributaria',
  'Portal das Financas',
  'GOV.UK',
  'HMRC',
  'legislation.gov.uk',
  'Belastingdienst',
  'wetten.overheid.nl',
  'gesetze-im-internet',
  'BMF',
  'EUR-Lex',
  'Your Europe',
] as const;

export const TAX_LAW_ALLOWED_HOSTS = [
  'boe.es',
  'www.boe.es',
  'sede.agenciatributaria.gob.es',
  'info.portaldasfinancas.gov.pt',
  'www.gov.pt',
  'www.gov.uk',
  'gov.uk',
  'www.legislation.gov.uk',
  'legislation.gov.uk',
  'www.belastingdienst.nl',
  'belastingdienst.nl',
  'wetten.overheid.nl',
  'www.gesetze-im-internet.de',
  'gesetze-im-internet.de',
  'www.bundesfinanzministerium.de',
  'bundesfinanzministerium.de',
  'eur-lex.europa.eu',
  'europa.eu',
] as const;

export const TaxLawJurisdictionSchema = z.enum(TAX_LAW_JURISDICTIONS);
export const TaxLawSourceTypeSchema = z.enum(TAX_LAW_SOURCE_TYPES);
export const TaxLawAuthoritySchema = z.enum(TAX_LAW_AUTHORITIES);

export const TaxLawSourceSchema = z.object({
  jurisdiction: TaxLawJurisdictionSchema,
  lang: z.string().min(2).max(8),
  title: z.string().min(1),
  url: z.string().url(),
  sourceType: TaxLawSourceTypeSchema,
  authority: TaxLawAuthoritySchema,
  taxYear: z.number().int().min(2024).max(2030),
  topic: z.string().min(1),
  licenseNote: z.string().min(1),
  lastVerifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const TaxLawSourceManifestSchema = z.object({
  version: z.literal(1),
  description: z.string().min(1),
  sources: z.array(TaxLawSourceSchema).min(1),
});

export const Vectorize1024Schema = z.array(z.number().finite()).length(1024);

export const TaxLawChunkSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  jurisdiction: TaxLawJurisdictionSchema,
  sourceUrl: z.string().url(),
  sourceTitle: z.string().min(1),
  authority: TaxLawAuthoritySchema,
  taxYear: z.number().int().min(2024).max(2030),
  topic: z.string().min(1),
  lang: z.string().min(2).max(8),
  chunkIndex: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
  text: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  fetchedAt: z.string().datetime(),
  vector: z.null(),
});

export const TaxLawEmbeddedChunkSchema = TaxLawChunkSchema.omit({ vector: true }).extend({
  vector: Vectorize1024Schema,
});

export const VectorizeChunkMetadataSchema = z
  .object({
    jurisdiction: TaxLawJurisdictionSchema,
    sourceUrl: z.string().url(),
    sourceTitle: z.string().min(1),
    authority: TaxLawAuthoritySchema,
    taxYear: z.number().int().min(2024).max(2030),
    topic: z.string().min(1),
    lang: z.string().min(2).max(8),
    chunkIndex: z.number().int().nonnegative(),
    charCount: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const VectorizeUpsertItemSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  values: Vectorize1024Schema,
  metadata: VectorizeChunkMetadataSchema,
});

export type TaxLawJurisdiction = z.infer<typeof TaxLawJurisdictionSchema>;
export type TaxLawSource = z.infer<typeof TaxLawSourceSchema>;
export type TaxLawSourceManifest = z.infer<typeof TaxLawSourceManifestSchema>;
export type TaxLawChunk = z.infer<typeof TaxLawChunkSchema>;
export type TaxLawEmbeddedChunk = z.infer<typeof TaxLawEmbeddedChunkSchema>;
export type Vectorize1024 = z.infer<typeof Vectorize1024Schema>;
export type VectorizeChunkMetadata = z.infer<typeof VectorizeChunkMetadataSchema>;
export type VectorizeUpsertItem = z.infer<typeof VectorizeUpsertItemSchema>;
