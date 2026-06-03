/**
 * W4 T1.1 — YAML form-mapping loader tests.
 *
 * Covers:
 *   - Happy path: fixture YAML round-trips through Zod schema.
 *   - Missing citation rejected (legal/audit anchor must be present).
 *   - Discriminated union (acroform vs coordinate) narrows correctly.
 *   - loadFormMapping returns null for unknown (country, year, form).
 *   - loadAllMappings excludes __fixtures__ (production discipline).
 *   - Invalid country / unknown transform are rejected by Zod.
 */

import { describe, expect, it } from 'vitest';
import {
  loadAllMappings,
  loadFixtureMappings,
  loadFormMapping,
  parseFormMapping,
} from './load';
import { FormMappingSchema } from './types';

describe('FormMapping YAML loader (W4 T1.1)', () => {
  it('parses a valid fixture YAML and conforms to FormMappingSchema', () => {
    const fixtures = loadFixtureMappings();
    expect(fixtures['test-form-valid']).toBeTruthy();
    const mapping = parseFormMapping(fixtures['test-form-valid']!);
    expect(mapping.country).toBe('DE');
    expect(mapping.year).toBe(2024);
    expect(mapping.form).toBe('test-valid');
    expect(mapping.fields.length).toBeGreaterThanOrEqual(3);
    expect(() => FormMappingSchema.parse(mapping)).not.toThrow();
  });

  it('rejects a YAML where a field is missing the required citation', () => {
    const fixtures = loadFixtureMappings();
    expect(fixtures['test-form-missing-citation']).toBeTruthy();
    expect(() => parseFormMapping(fixtures['test-form-missing-citation']!)).toThrow(
      /citation/i,
    );
  });

  it('discriminates acroform vs coordinate fields via Zod union', () => {
    const fixtures = loadFixtureMappings();
    const mapping = parseFormMapping(fixtures['test-form-valid']!);
    const acroFields = mapping.fields.filter((f) => f.kind === 'acroform');
    const coordFields = mapping.fields.filter((f) => f.kind === 'coordinate');
    expect(acroFields.length).toBeGreaterThanOrEqual(1);
    expect(coordFields.length).toBeGreaterThanOrEqual(1);
    for (const f of acroFields) {
      // Type narrowing: pdfField only exists on the acroform branch.
      expect(f.pdfField).toBeTruthy();
    }
    for (const f of coordFields) {
      expect(typeof f.x).toBe('number');
      expect(typeof f.y).toBe('number');
      expect(f.page).toBeGreaterThanOrEqual(0);
    }
  });

  it('loadFormMapping returns null for non-existent country/year/form', () => {
    const result = loadFormMapping('XX', 2099, 'nonexistent');
    expect(result).toBeNull();
  });

  it('loadAllMappings excludes __fixtures__ files (production discipline)', () => {
    const all = loadAllMappings();
    expect(Array.isArray(all)).toBe(true);
    // No production YAMLs ship in T1.1; T1.3 will add DE/2024/mantelbogen.yml.
    // Whatever ships, fixtures must NEVER leak into the production set:
    expect(all.find((m) => m.form.startsWith('test-form'))).toBeUndefined();
    expect(all.find((m) => m.form === 'test-valid')).toBeUndefined();
  });

  it('rejects YAML with invalid country code', () => {
    const invalidYaml = `
country: ZZ
year: 2024
form: bad-country
formTitle: Bad
sourceUrl: https://example.com/x.pdf
sourceVersion: v1
fields:
  - kind: acroform
    pdfField: F
    sourcePath: x.y
    type: text
    transform: none
    citation: test
`;
    expect(() => parseFormMapping(invalidYaml)).toThrow();
  });

  it('rejects YAML with unknown transform value', () => {
    const invalidYaml = `
country: DE
year: 2024
form: bad-transform
formTitle: Bad
sourceUrl: https://example.com/x.pdf
sourceVersion: v1
fields:
  - kind: acroform
    pdfField: F
    sourcePath: x.y
    type: text
    transform: invalid-transform-xyz
    citation: test
`;
    expect(() => parseFormMapping(invalidYaml)).toThrow();
  });

  it('rejects YAML with non-URL sourceUrl', () => {
    const invalidYaml = `
country: DE
year: 2024
form: bad-url
formTitle: Bad
sourceUrl: not-a-url
sourceVersion: v1
fields:
  - kind: acroform
    pdfField: F
    sourcePath: x.y
    type: text
    transform: none
    citation: test
`;
    expect(() => parseFormMapping(invalidYaml)).toThrow();
  });
});
