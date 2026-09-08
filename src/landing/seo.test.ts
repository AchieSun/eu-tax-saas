/**
 * seo.test.ts — robots.txt, sitemap.xml and site-wide SEO head tags.
 *
 * Covers:
 *  - GET /robots.txt: allow-all + api/auth/app disallow + sitemap pointer
 *  - GET /sitemap.xml: every registry URL, lastmod, XML well-formedness
 *  - site-wide structured data: Organization + WebSite JSON-LD on every page
 *    (verified via the learn article page, which needs no auth binding)
 */

import { describe, expect, it } from 'vitest';
import type { Bindings } from '../api';
import { app } from '../api';

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

describe('GET /robots.txt', () => {
  it('200: allow-all with api/auth/app disallow and sitemap pointer', async () => {
    const res = await request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Disallow: /app');
    expect(body).toContain('Disallow: /sign-in');
    expect(body).toContain('Disallow: /sign-up');
    expect(body).toContain('Sitemap: https://taxmora.com/sitemap.xml');
  });

  it('is cacheable at the edge', async () => {
    const res = await request('/robots.txt');
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600');
  });
});

describe('GET /sitemap.xml', () => {
  it('200: xml content type with urlset namespace', async () => {
    const res = await request('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it('lists every marketing + learn URL with lastmod', async () => {
    const res = await request('/sitemap.xml');
    const body = await res.text();
    for (const path of ['/', '/compare', '/pricing', '/learn', '/learn/methodology']) {
      expect(body).toContain(`<loc>https://taxmora.com${path}</loc>`);
    }
    expect(body).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect(body).toContain('<changefreq>');
    expect(body).toContain('<priority>');
  });

  it('never emits an unescaped ampersand (XML safety)', async () => {
    const res = await request('/sitemap.xml');
    const body = await res.text();
    // Any literal "&" must be part of an entity, not raw XML content.
    expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });

  it('is cacheable at the edge', async () => {
    const res = await request('/sitemap.xml');
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600');
  });
});

describe('site-wide SEO head tags', () => {
  it('every page carries Organization + WebSite JSON-LD and Open Graph basics', async () => {
    const res = await request('/learn/methodology');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"@type":"Organization"');
    expect(body).toContain('"@type":"WebSite"');
    expect(body).toContain('<meta property="og:title"');
    expect(body).toContain(
      '<meta property="og:url" content="https://taxmora.com/learn/methodology">',
    );
    expect(body).toContain('<meta property="og:site_name" content="Taxmora">');
    // JSON-LD is injection-safe: a raw "</" can never terminate the script.
    expect(body).not.toMatch(/<\/script><script/g);
  });
});
