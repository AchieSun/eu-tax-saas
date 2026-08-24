/**
 * Shared landing-page shell.
 *
 * These pages are static HTML served directly from the Cloudflare Worker so
 * Paddle/Creem merchant reviewers see a public site with Pricing, Terms,
 * Privacy, Refund and Cookie policies even before the SolidStart frontend is
 * deployed separately.
 */

export const SITE_NAME = 'Taxmora';
export const SUPPORT_EMAIL = 'support@taxmora.com';
export const COMPANY_ADDRESS = 'Operated by a sole proprietor registered in China.';

interface PageOptions {
  title: string;
  path: string;
  metaDescription: string;
  body: string;
  /** HTML lang attribute; defaults to 'en'. Chinese-first pages pass 'zh-CN'. */
  lang?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const navLink = (path: string, label: string, currentPath: string): string => {
  const active = path === currentPath ? ' aria-current="page"' : '';
  return `<a href="${path}" class="nav-link${active ? ' nav-link-active' : ''}"${active}>${escapeHtml(label)}</a>`;
};

export function renderPage(options: PageOptions): string {
  const { title, path, metaDescription, body } = options;
  const fullTitle = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <link rel="canonical" href="https://taxmora.com${path}">
  <style>
    :root {
      --color-bg: #ffffff;
      --color-surface: #f8fafc;
      --color-text: #0f172a;
      --color-muted: #475569;
      --color-border: #e2e8f0;
      --color-primary: #2563eb;
      --color-primary-hover: #1d4ed8;
      --radius: 12px;
      --max-width: 760px;
      --space-xs: 0.5rem;
      --space-sm: 0.75rem;
      --space-md: 1.25rem;
      --space-lg: 2rem;
      --space-xl: 3rem;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: var(--color-text);
      background: var(--color-bg);
    }
    header {
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .container {
      width: min(100% - 2rem, var(--max-width));
      margin-inline: auto;
    }
    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-block: var(--space-sm);
      gap: var(--space-md);
      flex-wrap: wrap;
    }
    .brand {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-text);
      text-decoration: none;
      letter-spacing: -0.02em;
    }
    .brand span { color: var(--color-primary); }
    nav { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
    .nav-link {
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--color-muted);
      text-decoration: none;
      padding: 0.375rem 0.5rem;
      border-radius: 6px;
    }
    .nav-link:hover, .nav-link-active { color: var(--color-primary); background: #eff6ff; }
    .nav-cta {
      font-size: 0.95rem;
      font-weight: 600;
      color: #fff;
      background: var(--color-primary);
      padding: 0.375rem 0.875rem;
      border-radius: 8px;
      text-decoration: none;
    }
    .nav-cta:hover { background: var(--color-primary-hover); color: #fff; }
    .auth-card { max-width: 420px; }
    .auth-form label {
      display: block;
      margin-bottom: var(--space-sm);
      font-weight: 500;
      color: var(--color-text);
    }
    .auth-form input {
      display: block;
      width: 100%;
      margin-top: 0.25rem;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: 1rem;
      font-family: inherit;
    }
    .auth-form input:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .auth-error { color: #dc2626; font-size: 0.9rem; margin: var(--space-sm) 0; }
    .auth-hint { margin-top: var(--space-lg); }
    main { min-height: 60vh; padding-block: var(--space-xl); }
    h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 var(--space-md); letter-spacing: -0.02em; }
    h2 { font-size: 1.35rem; margin: var(--space-lg) 0 var(--space-sm); }
    h3 { font-size: 1.1rem; margin: var(--space-md) 0 var(--space-xs); }
    p { margin: 0 0 var(--space-md); color: var(--color-muted); }
    a { color: var(--color-primary); }
    a:hover { color: var(--color-primary-hover); }
    ul, ol { margin: 0 0 var(--space-md); padding-left: 1.5rem; color: var(--color-muted); }
    li { margin-bottom: var(--space-xs); }
    .hero {
      text-align: center;
      padding-block: var(--space-xl);
    }
    .hero h1 { font-size: 2.5rem; max-width: 600px; margin-inline: auto; }
    .hero p { font-size: 1.15rem; max-width: 560px; margin-inline: auto; }
    .cta-row {
      display: flex;
      gap: var(--space-sm);
      justify-content: center;
      flex-wrap: wrap;
      margin-top: var(--space-lg);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.75rem 1.5rem;
      border-radius: var(--radius);
      font-weight: 600;
      text-decoration: none;
      transition: background 150ms, transform 150ms;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1.5;
    }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-primary { background: var(--color-primary); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); color: #fff; }
    .btn-secondary { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }
    .btn-secondary:hover:not(:disabled) { background: #f1f5f9; }
    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: var(--space-lg);
      margin-bottom: var(--space-md);
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: var(--space-md);
      margin-block: var(--space-lg);
    }
    .price {
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--color-text);
      margin: var(--space-sm) 0;
    }
    .price span {
      font-size: 1rem;
      font-weight: 500;
      color: var(--color-muted);
    }
    .feature-list { list-style: none; padding: 0; }
    .feature-list li {
      padding-left: 1.5rem;
      position: relative;
      color: var(--color-muted);
    }
    .feature-list li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #059669;
      font-weight: 700;
    }
    footer {
      border-top: 1px solid var(--color-border);
      padding-block: var(--space-lg);
      background: var(--color-surface);
      font-size: 0.9rem;
      color: var(--color-muted);
    }
    .footer-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--space-md);
    }
    .footer-col strong { display: block; margin-bottom: var(--space-xs); color: var(--color-text); }
    .footer-col a { display: block; color: var(--color-muted); text-decoration: none; margin-bottom: 0.25rem; }
    .footer-col a:hover { color: var(--color-primary); }
    .legal-date { color: var(--color-muted); font-size: 0.9rem; margin-bottom: var(--space-lg); }
    .cookie-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #0f172a;
      color: #f8fafc;
      padding: 1rem;
      z-index: 100;
      display: none;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
    }
    .cookie-banner.show { display: block; }
    .cookie-banner-inner {
      width: min(100% - 2rem, var(--max-width));
      margin-inline: auto;
      display: flex;
      gap: var(--space-md);
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .cookie-banner p {
      color: #e2e8f0;
      margin: 0;
      font-size: 0.9rem;
      flex: 1 1 320px;
    }
    .cookie-banner a { color: #93c5fd; }
    .cookie-banner-actions {
      display: flex;
      gap: var(--space-sm);
      flex-wrap: wrap;
    }
    .cookie-banner button {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .cookie-btn-necessary {
      background: transparent;
      color: #e2e8f0;
      border: 1px solid #475569;
    }
    .cookie-btn-accept {
      background: var(--color-primary);
      color: #fff;
    }
    @media (max-width: 480px) {
      .hero h1 { font-size: 1.75rem; }
      h1 { font-size: 1.5rem; }
      .header-inner { justify-content: center; }
      .cookie-banner-inner { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container header-inner">
      <a class="brand" href="/">Tax<span>mora</span></a>
      <nav>
        ${navLink('/', 'Home', path)}
        ${navLink('/compare', '五国对比', path)}
        ${navLink('/pricing', 'Pricing', path)}
        ${navLink('/terms', 'Terms', path)}
        ${navLink('/privacy', 'Privacy', path)}
        <a class="nav-cta" href="/sign-in">Sign in</a>
      </nav>
    </div>
  </header>
  <main>
    <div class="container">
      ${body}
    </div>
  </main>
  <footer>
    <div class="container footer-grid">
      <div class="footer-col">
        <strong>Product</strong>
        <a href="/">Home</a>
        <a href="/compare">五国税后收入对比计算器</a>
        <a href="/pricing">Pricing</a>
      </div>
      <div class="footer-col">
        <strong>Legal</strong>
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/refund">Refund Policy</a>
        <a href="/cookie-policy">Cookie Policy</a>
        <a href="/impressum">Impressum</a>
      </div>
      <div class="footer-col">
        <strong>Support</strong>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
        <span>${escapeHtml(COMPANY_ADDRESS)}</span>
      </div>
    </div>
  </footer>

  <div id="cookie-banner" class="cookie-banner" role="dialog" aria-label="Cookie consent">
    <div class="cookie-banner-inner">
      <p>
        We use essential cookies for security and authentication, and optional analytics cookies to improve the site.
        See our <a href="/cookie-policy">Cookie Policy</a>.
      </p>
      <div class="cookie-banner-actions">
        <button class="cookie-btn-necessary" id="cookie-necessary" type="button">Necessary only</button>
        <button class="cookie-btn-accept" id="cookie-accept" type="button">Accept all</button>
      </div>
    </div>
  </div>

  <script>
    (function () {
      const banner = document.getElementById('cookie-banner');
      const necessaryBtn = document.getElementById('cookie-necessary');
      const acceptBtn = document.getElementById('cookie-accept');
      const KEY = 'taxmora-cookie-consent';

      function hideBanner(choice) {
        try {
          localStorage.setItem(KEY, choice);
        } catch (e) {
          // localStorage may be disabled in private mode.
        }
        if (banner) banner.classList.remove('show');
      }

      try {
        const stored = localStorage.getItem(KEY);
        if (!stored && banner) {
          banner.classList.add('show');
        }
      } catch (e) {
        if (banner) banner.classList.add('show');
      }

      if (necessaryBtn) necessaryBtn.addEventListener('click', function () { hideBanner('necessary'); });
      if (acceptBtn) acceptBtn.addEventListener('click', function () { hideBanner('all'); });
    })();
  </script>
</body>
</html>`;
}
