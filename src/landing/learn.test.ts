/**
 * learn.test.ts — knowledge-platform routes (/learn, /learn/:slug).
 *
 * Covers:
 *  - GET /learn hub: article list, breadcrumb, cache header, hreflang
 *  - GET /learn/methodology: full SEO head (canonical, hreflang, Article +
 *    BreadcrumbList + FAQPage JSON-LD), content blocks, calculator CTA
 *  - GET /learn/unknown-slug: 404 with recovery links
 *  - hub/article pages mark themselves active in the nav
 */

import { describe, expect, it } from 'vitest';
import type { Bindings } from '../api';
import { app } from '../api';
import { learnArticles } from './learn/content';

function fakeEnv(): Bindings {
  return {
    DB: {},
    KV: {},
    R2: {},
    AI: {},
    VECTORIZE: {},
    QUEUE: {},
    ENVIRONMENT: 'test',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-secret',
  } as unknown as Bindings;
}

function request(path: string): Promise<Response> {
  return Promise.resolve(app.request(path, undefined, fakeEnv()));
}

describe('GET /learn (hub)', () => {
  it('200: lists registered articles with links and descriptions', async () => {
    const res = await request('/learn');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Cross-border tax knowledge');
    expect(body).toContain('href="/learn/methodology"');
    expect(body).toContain('How Taxmora calculates your take-home pay');
  });

  it('carries breadcrumb, hreflang self-reference and edge caching', async () => {
    const res = await request('/learn');
    const body = await res.text();
    expect(body).toContain('aria-label="Breadcrumb"');
    expect(body).toContain('<link rel="alternate" hreflang="en" href="https://taxmora.com/learn">');
    expect(body).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://taxmora.com/learn">',
    );
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400');
  });

  it('contains ItemList structured data and active nav marker', async () => {
    const res = await request('/learn');
    const body = await res.text();
    expect(body).toContain('"@type":"ItemList"');
    expect(body).toContain('href="/learn" class="nav-link nav-link-active"');
  });
});

describe('GET /learn/methodology', () => {
  it('200: full SEO head — canonical, hreflang, Article/Breadcrumb/FAQPage JSON-LD', async () => {
    const res = await request('/learn/methodology');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400');
    const body = await res.text();
    expect(body).toContain('<html lang="en">');
    expect(body).toContain('<title>How Taxmora calculates your take-home pay · Taxmora</title>');
    expect(body).toContain('<link rel="canonical" href="https://taxmora.com/learn/methodology">');
    expect(body).toContain(
      '<link rel="alternate" hreflang="en" href="https://taxmora.com/learn/methodology">',
    );
    expect(body).toContain('<meta property="og:type" content="article">');
    expect(body).toContain('"@type":"Article"');
    expect(body).toContain('"@type":"BreadcrumbList"');
    expect(body).toContain('"@type":"FAQPage"');
    expect(body).toContain('"dateModified":"2026-09-08"');
  });

  it('renders content blocks: table, note, FAQ, CTA, updated date', async () => {
    const res = await request('/learn/methodology');
    const body = await res.text();
    expect(body).toContain('<table class="learn-table">');
    expect(body).toContain('Orientation only');
    expect(body).toContain('Beckham');
    expect(body).toContain('£12,570');
    expect(body).toContain('class="learn-note"');
    expect(body).toContain('constitutes tax advice');
    expect(body).toContain('Frequently asked questions');
    expect(body).toContain('Last updated <time datetime="2026-09-08">2026-09-08</time>');
    expect(body).toContain('href="/compare?lang=en"');
    expect(body).toContain('Try the free calculator');
  });

  it('keeps the /compare funnel nav link present (t4 invariant)', async () => {
    const res = await request('/learn/methodology');
    const body = await res.text();
    expect(body).toContain('href="/compare"');
  });
});

describe('GET /learn/:slug 404 handling', () => {
  it('404: unknown slug renders recovery page (not the Worker default)', async () => {
    const res = await request('/learn/this-page-does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Page not found');
    expect(body).toContain('/learn/this-page-does-not-exist');
    expect(body).toContain('href="/learn"');
    expect(body).toContain('href="/compare?lang=en"');
  });
});

describe('article registry invariants (phase 2 seed)', () => {
  it('every registered article renders 200 with canonical + Article + FAQPage JSON-LD + CTA', async () => {
    expect(learnArticles.length).toBeGreaterThanOrEqual(6);
    for (const article of learnArticles) {
      const res = await request(`/learn/${article.slug}`);
      expect(res.status, article.slug).toBe(200);
      const body = await res.text();
      expect(body).toContain(
        `<link rel="canonical" href="https://taxmora.com/learn/${article.slug}">`,
      );
      expect(body).toContain('"@type":"Article"');
      expect(body).toContain('"@type":"FAQPage"');
      expect(body).toContain('constitutes tax advice');
      expect(body).toContain('Try the free calculator');
    }
  });

  it('every worked-example table is year-labelled (2025/2026) so engine years stay honest', async () => {
    for (const article of learnArticles) {
      if (!article.blocks.some((b) => b.kind === 'table')) continue;
      const res = await request(`/learn/${article.slug}`);
      const body = await res.text();
      expect(body, article.slug).toMatch(/2025|2026/);
    }
  });
});
