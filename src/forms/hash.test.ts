/**
 * hash.test.ts — Unit tests for canonicalJSONHash (W4 T0.5).
 *
 * The contract under test:
 *   - Key-order invariance: re-ordering object keys must NOT change the hash.
 *   - Value sensitivity: any change to a leaf value must change the hash.
 *   - Determinism for trivial / edge inputs (empty object stable across calls).
 */

import { describe, it, expect } from 'vitest';
import { canonicalJSON, canonicalJSONHash } from './hash';

describe('canonicalJSONHash', () => {
  it('is invariant to object key order at every nesting level', async () => {
    const a = {
      country: 'DE',
      year: 2024,
      meta: { source: 'BMF', revision: 3, nested: { z: 1, a: 2 } },
      fields: [
        { name: 'Foo', path: 'a.b', extra: { y: 1, x: 2 } },
      ],
    };
    // Same logical content, every object's keys re-ordered.
    const b = {
      meta: { nested: { a: 2, z: 1 }, revision: 3, source: 'BMF' },
      year: 2024,
      fields: [
        { extra: { x: 2, y: 1 }, path: 'a.b', name: 'Foo' },
      ],
      country: 'DE',
    };
    const [hA, hB] = await Promise.all([canonicalJSONHash(a), canonicalJSONHash(b)]);
    expect(hA).toBe(hB);
    // Sanity: also confirm canonical JSON is byte-identical.
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    // SHA-256 hex = 64 chars, lower case.
    expect(hA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any leaf value differs', async () => {
    const base = { country: 'DE', year: 2024, fields: [{ pdfField: 'Name' }] };
    const mutated = { country: 'DE', year: 2024, fields: [{ pdfField: 'Name!' }] };
    const [h1, h2] = await Promise.all([
      canonicalJSONHash(base),
      canonicalJSONHash(mutated),
    ]);
    expect(h1).not.toBe(h2);

    // Array order is semantic — re-ordering elements must also change the hash.
    const reordered = {
      country: 'DE',
      year: 2024,
      fields: [{ pdfField: 'A' }, { pdfField: 'B' }],
    };
    const swapped = {
      country: 'DE',
      year: 2024,
      fields: [{ pdfField: 'B' }, { pdfField: 'A' }],
    };
    const [hR, hS] = await Promise.all([
      canonicalJSONHash(reordered),
      canonicalJSONHash(swapped),
    ]);
    expect(hR).not.toBe(hS);
  });

  it('produces a stable, deterministic hash for trivial inputs (e.g. {})', async () => {
    const h1 = await canonicalJSONHash({});
    const h2 = await canonicalJSONHash({});
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256('{}') = 44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a
    expect(h1).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    // Distinct from null / empty array (canonical forms differ).
    expect(await canonicalJSONHash(null)).not.toBe(h1);
    expect(await canonicalJSONHash([])).not.toBe(h1);
  });
});
