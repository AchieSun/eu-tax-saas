import { describe, expect, it } from 'vitest';
import { verifyCreemWebhookSignature } from './creem';

describe('verifyCreemWebhookSignature', () => {
  const secret = 'whsec_test_secret';
  const rawBody = '{"event_type":"subscription.paid"}';

  it('returns false when signature is missing', async () => {
    const result = await verifyCreemWebhookSignature(rawBody, undefined, secret);
    expect(result).toBe(false);
  });

  it('returns false when secret is empty', async () => {
    const result = await verifyCreemWebhookSignature(rawBody, 'some-signature', '');
    expect(result).toBe(false);
  });

  it('verifies a valid HMAC-SHA256 hex signature', async () => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = await verifyCreemWebhookSignature(rawBody, signature, secret);
    expect(result).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const result = await verifyCreemWebhookSignature(rawBody, '0000000000000000', secret);
    expect(result).toBe(false);
  });
});
