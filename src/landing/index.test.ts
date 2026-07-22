import { describe, expect, it } from 'vitest';
import { app } from '../api';

describe('landing pages', () => {
  const cases = [
    { path: '/', title: 'Taxmora' },
    { path: '/pricing', title: 'Pricing' },
    { path: '/terms', title: 'Terms of Service' },
    { path: '/privacy', title: 'Privacy Policy' },
    { path: '/refund', title: 'Refund Policy' },
    { path: '/cookie-policy', title: 'Cookie Policy' },
    { path: '/impressum', title: 'Impressum' },
  ];

  for (const { path, title } of cases) {
    it(`GET ${path} returns HTML with correct title`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const body = await res.text();
      expect(body).toContain(`<title>${title}`);
      expect(body).toContain('support@taxmora.com');
    });
  }
});
