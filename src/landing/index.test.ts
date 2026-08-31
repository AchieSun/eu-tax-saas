import { beforeEach, describe, expect, it, vi } from 'vitest';

// Better Auth is mocked so the home-page session check can flip between
// anonymous (null) and signed-in without a real D1/KV binding. Only
// `api.getSession` is exercised by the landing routes.
let mockSession: { user: { id: string } } | null = null;
let mockAuthThrows = false;

vi.mock('../auth/auth', () => ({
  createAuth: vi.fn(() => {
    if (mockAuthThrows) throw new Error('auth exploded');
    return {
      api: { getSession: vi.fn(async () => mockSession) },
    };
  }),
}));

import { app } from '../api';

beforeEach(() => {
  mockSession = null;
  mockAuthThrows = false;
});

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

  it('GET /.well-known/security.txt serves the RFC 9116 disclosure file', async () => {
    const res = await app.request('/.well-known/security.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Contact: mailto:support@taxmora.com');
    expect(body).toContain('Expires: 2027-08-31');
    expect(body).toContain('Canonical: https://taxmora.com/.well-known/security.txt');
  });

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

describe('home page: five-screen landing (marketing/landing-page-spec.md)', () => {
  it('anonymous GET / renders all five screens', async () => {
    mockSession = null;
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.text();

    // Screen 1 - hero: positioning, €29/€99 price logic, CTAs. Single
    // founding-price narrative - the old "Free during beta" copy is gone.
    expect(body).toContain('Tax estimates for cross-border developers.');
    expect(body).toContain("€29/year while it's in");
    expect(body).toContain("when it's finished");
    expect(body).not.toContain('Free during beta');
    expect(body).toContain('Get the founding price - €29/year');
    expect(body).toContain('href="/sign-up"');
    expect(body).toContain('Get launch updates');
    expect(body).toContain('href="#waitlist"');
    // Free-calculator CTA (conversion fix): low-friction entry for hesitant
    // visitors, pointed at the English compare page.
    expect(body).toContain('Try the free calculator');
    expect(body).toContain('href="/compare?lang=en"');

    // Screen 2 - coverage: legal citations + five country cards.
    expect(body).toContain('Five countries, legal-cited rates');
    expect(body).toContain('§32a EStG');
    expect(body).toContain('2025 and 2026 tax years');
    for (const country of ['Germany', 'Netherlands', 'Portugal', 'Spain', 'UK']) {
      expect(body).toContain(`<h3>${country}</h3>`);
    }
    expect(body).toContain('🇩🇪');
    expect(body).toContain('🇳🇱');
    expect(body).toContain('🇵🇹');
    expect(body).toContain('🇪🇸');
    expect(body).toContain('🇬🇧');

    // Screen 3 - features: the four cards, verbatim tone.
    expect(body).toContain('What it does');
    expect(body).toContain('<h3>Tax calculator</h3>');
    expect(body).toContain('<h3>Residency check</h3>');
    expect(body).toContain('<h3>22 tax strategies</h3>');
    expect(body).toContain('<h3>Ask the docs</h3>');
    expect(body).toContain('in code, not vibes');
    expect(body).toContain('Answers cite');

    // Screen 4 - honest declaration: defect list + price logic + lock-in.
    expect(body).toContain("What's not done yet");
    expect(body).toContain('The UK residence test covers 8 of 17 outcomes.');
    expect(body).toContain('(Basque Country, Navarra) are partially implemented');
    expect(body).toContain('predates the 2023 Supreme Court ruling');
    // Updated post-bilingual-wave: honest note that AI strategy notes may still be Chinese.
    expect(body).toContain('AI-generated strategy notes may still come back in Chinese');
    expect(body).toContain("That's why it's €29 and not €99");
    expect(body).toContain('keep €29 for as long as the product');
    expect(body).toContain("We'd rather tell you now than surprise you later.");

    // Screen 5 - waitlist capture wired to the API.
    expect(body).toContain('Not ready to pay for a half-finished tax engine? Fair.');
    expect(body).toContain('id="waitlist"');
    expect(body).toContain('about to go from €29 to €99');
    expect(body).toContain("fetch('/api/waitlist'");
    expect(body).toContain('Notify me');
    expect(body).toContain('One email at launch. Nothing else.');

    // Footer self-deprecation (test count tracks the live suite).
    expect(body).toContain('write 977 tests about it');
  });

  it('tone red lines: zero exclamation marks in visible copy, no marketing buzzwords', async () => {
    const res = await app.request('/');
    const body = await res.text();
    // The red line is about copy, not syntax: strip scripts, styles and
    // tags (<!doctype / JS negation legitimately contain "!").
    const visibleText = body
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    expect(visibleText).not.toContain('!');
    for (const banned of [
      'revolutionize',
      'seamless',
      'empower',
      'game-changing',
      'cutting-edge',
      'trusted by',
    ]) {
      expect(body.toLowerCase()).not.toContain(banned);
    }
  });

  it('signed-in GET / redirects to /app', async () => {
    mockSession = { user: { id: 'user-1' } };
    const res = await app.request('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
  });

  it('session-check failure fails open: anonymous visitor still gets the landing page', async () => {
    mockAuthThrows = true;
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Tax estimates for cross-border developers.');
  });
});

describe('pricing page: €29 founding-price narrative (t6)', () => {
  it('GET /pricing carries the same price story as the landing page', async () => {
    const res = await app.request('/pricing');
    expect(res.status).toBe(200);
    const body = await res.text();

    // One plan, one price: €29 now, €99 when finished, lock forever.
    expect(body).toContain('€29 <span>/ year</span>');
    expect(body).toContain('Founding price');
    expect(body).toContain('price becomes €99/year');
    expect(body).toContain('€29 for as long as the product exists');

    // The three price-increase conditions, same as the honest screen.
    expect(body).toContain('Why €29 and not €99?');
    expect(body).toContain('The UK residence test covers 8 of 17 outcomes.');
    expect(body).toContain('(Basque Country, Navarra) are partially implemented');
    expect(body).toContain('predates the 2023 Supreme Court ruling');

    // CTA copy matches the landing hero and links into the same funnel.
    expect(body).toContain('Get the founding price - €29/year');
    expect(body).toContain('href="/sign-up"');

    // Old tier pricing is gone entirely.
    expect(body).not.toContain('€10');
    expect(body).not.toContain('€190');
    expect(body).not.toContain('/ month');
    expect(body).not.toContain('js-subscribe');
  });
});
