/**
 * sha256.test.ts — Unit tests for the shared sha256Hex helper extracted in
 * Oracle P0-1 (W4 review).
 *
 * Verifies:
 *   - String input hashes match the known NIST/RFC 6234 test vectors
 *   - BufferSource input produces the same output as the equivalent string
 *   - Empty input has the documented empty-string digest
 *   - Caps (MAX_HASH_BYTES, OVERSIZED_THRESHOLD) are correctly exported
 */

import { describe, expect, it } from 'vitest';
import { MAX_HASH_BYTES, OVERSIZED_THRESHOLD, sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('hashes an empty string to the SHA-256 empty digest', async () => {
    const out = await sha256Hex('');
    // Well-known: SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(out).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes the canonical "abc" test vector', async () => {
    const out = await sha256Hex('abc');
    // FIPS 180-4 Appendix B.1: SHA256("abc")
    expect(out).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes a Uint8Array input identically to its string equivalent', async () => {
    const text = 'eu-tax-saas/DE/2024/mantelbogen|v3|deadbeef|watermark:off';
    const fromString = await sha256Hex(text);
    const fromBytes = await sha256Hex(new TextEncoder().encode(text));
    expect(fromBytes).toBe(fromString);
  });

  it('produces a 64-char lowercase hex string for any input', async () => {
    const out = await sha256Hex('arbitrary input');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exports the documented size constants', () => {
    expect(MAX_HASH_BYTES).toBe(65_536);
    expect(OVERSIZED_THRESHOLD).toBe(1_048_576);
  });
});
