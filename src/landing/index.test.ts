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
      // t4: every landing page exposes the /compare acquisition funnel nav link.
      expect(body).toContain('href="/compare"');
    });
  }

  it('GET /compare renders nav back to home and pricing (bidirectional reachability)', async () => {
    const res = await app.request('/compare');
    expect(res.status).toBe(200);
    const body = await res.text();
    // Nav + footer both link back into the existing site.
    expect(body).toContain('class="brand" href="/"');
    expect(body).toContain('href="/pricing"');
    // The compare page's own nav marks itself active (regex: resilient to
    // attribute reordering between href and aria-current).
    expect(body).toMatch(/href="\/compare"[^>]*aria-current="page"/);
    expect(body).toContain('nav-link-active');
  });
});
