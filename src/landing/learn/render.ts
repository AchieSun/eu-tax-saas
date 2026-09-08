/**
 * learn/render.ts — SSR renderers for the knowledge platform.
 *
 * Articles from content.ts are rendered into the shared landing shell with:
 *  - breadcrumb navigation (visible + BreadcrumbList JSON-LD),
 *  - Article / FAQPage structured data for rich results,
 *  - hreflang self-references (EN-first; zh variants arrive with the
 *    bilingual wave),
 *  - the standard calculator CTA block that turns readers into users.
 */

import { SITE_NAME } from '../layout';
import { renderPage } from '../layout';
import type { LearnArticle, LearnBlock } from './content';
import { learnArticles } from './content';

const SITE_ORIGIN = 'https://taxmora.com';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const CTA_HTML = `
      <section class="card learn-cta">
        <h2>Run the numbers yourself</h2>
        <p>One salary, five countries, ten seconds - the same engine this article describes, free and without signup.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/compare?lang=en">Try the free calculator</a>
        </div>
      </section>`;

function renderBlock(block: LearnBlock): string {
  switch (block.kind) {
    case 'p':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'h2':
      return `<h2>${escapeHtml(block.text)}</h2>`;
    case 'ul':
      return `<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'table': {
      const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '';
      const thead = `<thead><tr>${block.head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${block.rows
        .map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      return `<table class="learn-table">${caption}${thead}${tbody}</table>`;
    }
    case 'note':
      return `<aside class="learn-note"><p>${escapeHtml(block.text)}</p></aside>`;
    case 'faq':
      return `<section class="learn-faq"><h2>Frequently asked questions</h2><dl>${block.items
        .map((f) => `<dt>${escapeHtml(f.q)}</dt><dd>${escapeHtml(f.a)}</dd>`)
        .join('')}</dl></section>`;
    case 'cta':
      return CTA_HTML;
  }
}

function breadcrumbHtml(crumbs: Array<{ name: string; path?: string }>): string {
  const items = crumbs.map((c, idx) => {
    const last = idx === crumbs.length - 1;
    const label = escapeHtml(c.name);
    return last
      ? `<span aria-current="page">${label}</span>`
      : `<a href="${escapeHtml(c.path ?? '/')}">${label}</a>`;
  });
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items.join(
    ' <span class="breadcrumb-sep" aria-hidden="true">/</span> ',
  )}</nav>`;
}

function articleJsonLd(article: LearnArticle): Record<string, unknown> {
  const canonical = `${SITE_ORIGIN}/learn/${article.slug}`;
  const org = { '@type': 'Organization', name: SITE_NAME, url: `${SITE_ORIGIN}/` };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.metaDescription,
    datePublished: article.updated,
    dateModified: article.updated,
    author: org,
    publisher: org,
    mainEntityOfPage: canonical,
    inLanguage: 'en',
  };
}

function breadcrumbJsonLd(crumbs: Array<{ name: string; path?: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: c.name,
      ...(c.path && idx < crumbs.length - 1 ? { item: `${SITE_ORIGIN}${c.path}` } : {}),
    })),
  };
}

function faqJsonLd(article: LearnArticle): Record<string, unknown> | null {
  const faqBlocks = article.blocks.filter((b) => b.kind === 'faq');
  const items = faqBlocks.flatMap((b) => (b.kind === 'faq' ? b.items : []));
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

const LEARN_LOCALES = (path: string) => [
  { hreflang: 'en', href: `${SITE_ORIGIN}${path}` },
  { hreflang: 'x-default', href: `${SITE_ORIGIN}${path}` },
];

const LEARN_CRUMBS = [
  { name: 'Home', path: '/' },
  { name: 'Learn', path: '/learn' },
];

export function learnArticlePage(article: LearnArticle): string {
  const path = `/learn/${article.slug}`;
  const body = [
    breadcrumbHtml([...LEARN_CRUMBS, { name: article.title }]),
    `<p class="learn-updated">Last updated <time datetime="${escapeHtml(article.updated)}">${escapeHtml(
      article.updated,
    )}</time> · English · <a href="/compare?lang=en">free calculator</a></p>`,
    ...article.blocks.map(renderBlock),
  ].join('\n');
  const jsonLd = [
    articleJsonLd(article),
    breadcrumbJsonLd([...LEARN_CRUMBS, { name: article.title }]),
  ];
  const faq = faqJsonLd(article);
  if (faq) jsonLd.push(faq);
  return renderPage({
    title: article.title,
    path,
    metaDescription: article.metaDescription,
    lang: 'en',
    ogType: 'article',
    locales: LEARN_LOCALES(path),
    breadcrumbs: [...LEARN_CRUMBS, { name: article.title }],
    jsonLd,
    body,
  });
}

export function learnHubPage(): string {
  const cards = learnArticles
    .map(
      (a) => `
      <article class="card learn-card">
        <h2><a href="/learn/${a.slug}">${escapeHtml(a.title)}</a></h2>
        <p>${escapeHtml(a.metaDescription)}</p>
        <p class="learn-updated">Last updated <time datetime="${escapeHtml(a.updated)}">${escapeHtml(
          a.updated,
        )}</time></p>
      </article>`,
    )
    .join('\n');
  const body = [
    breadcrumbHtml(LEARN_CRUMBS),
    '<h1>Cross-border tax knowledge</h1>',
    '<p>Plain-English guides to the rules behind the calculator - what each country actually applies, what the engine covers, and where the honest limits are. Every guide is written against the same rule modules the calculator runs, so the numbers you read about are the numbers you get.</p>',
    cards,
  ].join('\n');
  return renderPage({
    title: 'Cross-border tax knowledge',
    path: '/learn',
    metaDescription:
      'Guides to European cross-border tax rules: how take-home pay is calculated in DE, NL, PT, ES and the UK, which special regimes exist, and what the Taxmora engine does and does not cover.',
    lang: 'en',
    ogType: 'website',
    locales: LEARN_LOCALES('/learn'),
    breadcrumbs: LEARN_CRUMBS,
    jsonLd: [
      breadcrumbJsonLd(LEARN_CRUMBS),
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: learnArticles.map((a, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: a.title,
          url: `${SITE_ORIGIN}/learn/${a.slug}`,
        })),
      },
    ],
    body,
  });
}

export function learnNotFoundPage(slug: string): string {
  return renderPage({
    title: 'Page not found',
    path: '/learn',
    metaDescription: 'This Taxmora knowledge page does not exist.',
    lang: 'en',
    breadcrumbs: LEARN_CRUMBS,
    body: [
      breadcrumbHtml(LEARN_CRUMBS),
      '<h1>Page not found</h1>',
      `<p>There is no knowledge page at <code>/learn/${escapeHtml(slug)}</code>. Browse <a href="/learn">all guides</a> or run the <a href="/compare?lang=en">free calculator</a>.</p>`,
    ].join('\n'),
  });
}

export { learnArticles };
