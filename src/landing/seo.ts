/**
 * seo.ts — robots.txt + sitemap.xml for the marketing surface.
 *
 * The sitemap is derived from a single URL registry so new pages are added
 * in one place. Learn articles contribute their own `updated` date as
 * <lastmod>; static marketing pages use SITE_LASTMOD (bump when content
 * meaningfully changes).
 */

import { learnArticles } from './learn/content';

export const SITE_ORIGIN = 'https://taxmora.com';

/** Bump when a static (non-article) page meaningfully changes. */
export const SITE_LASTMOD = '2026-09-21';

export interface SitemapEntry {
  path: string;
  lastmod: string;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

/** Escape text for XML body/attribute contexts. */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function robotsTxt(): string {
  // /app is the auth-gated SPA - no indexable content for crawlers; the API
  // is machine-only. Everything else (marketing + learn) is allowed.
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /app',
    'Disallow: /sign-in',
    'Disallow: /sign-up',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapEntries(): SitemapEntry[] {
  const base: SitemapEntry[] = [
    { path: '/', lastmod: SITE_LASTMOD, changefreq: 'weekly', priority: 1.0 },
    { path: '/compare', lastmod: SITE_LASTMOD, changefreq: 'weekly', priority: 0.9 },
    { path: '/pricing', lastmod: SITE_LASTMOD, changefreq: 'monthly', priority: 0.7 },
    { path: '/learn', lastmod: SITE_LASTMOD, changefreq: 'weekly', priority: 0.8 },
  ];
  const articles: SitemapEntry[] = learnArticles.map((a) => ({
    path: `/learn/${a.slug}`,
    lastmod: a.updated,
    changefreq: 'monthly',
    priority: 0.7,
  }));
  return [...base, ...articles];
}

export function sitemapXml(): string {
  const urls = sitemapEntries()
    .map(
      (e) =>
        `  <url>\n    <loc>${SITE_ORIGIN}${escapeXml(e.path)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}
