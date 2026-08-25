/**
 * Static landing page content.
 *
 * NOTE: The legal text below is a starter template for merchant-review
 * compliance (Paddle/Creem). Before going live you should have a qualified
 * lawyer review Terms, Privacy, Refund and Cookie policies for your
 * jurisdiction and target markets.
 */

import { COMPANY_ADDRESS, SITE_NAME, SUPPORT_EMAIL, renderPage } from './layout';

const META_HOME =
  'Tax estimates for cross-border developers in Germany, the Netherlands, Portugal, Spain and the UK. Legal-cited rates, 2025 and 2026 tax years. Founding price €29/year.';
const META_PRICING =
  'One plan for Taxmora: €29/year founding price while the engine is in this state, €99 once it is finished. Founding members keep €29 for as long as the product exists.';
const META_LEGAL =
  'Legal information, terms of service, privacy policy, refund policy and cookie policy for Taxmora.';

const CURRENT_DATE = '14 July 2026';

/**
 * Landing home page - the five-screen structure from
 * marketing/landing-page-spec.md, written to catch the DEV.to article
 * traffic (marketing/content/devto/07-v6.md is the tone reference:
 * developer-to-developer, zero exclamation marks, no marketing
 * buzzwords, defects listed up front).
 *
 * Screen map: 1 hero / 2 coverage / 3 features / 4 "What's not done
 * yet" / 5 waitlist email capture + footer self-deprecation.
 *
 * Tone red lines (spec): no exclamation marks anywhere, no
 * revolutionize/seamless/empower-style buzzwords, no social proof,
 * no "complete/all-in-one" claims. Specific numbers and honest gaps
 * are the pitch.
 */
export const homePage = (): string =>
  renderPage({
    title: SITE_NAME,
    path: '/',
    metaDescription: META_HOME,
    body: `
      <style>
        /* Home-page-local styles; shared tokens live in layout.ts. */
        .country-grid, .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: var(--space-sm);
          margin-block: var(--space-md);
        }
        .feature-grid { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
        .country-card h3, .feature-card h3 { margin: 0 0 var(--space-xs); }
        .country-card p, .feature-card p { margin: 0; font-size: 0.95rem; }
        .country-card .flag { font-size: 1.6rem; display: block; margin-bottom: var(--space-xs); }
        .honest-section {
          background: #f1f5f9;
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          padding: var(--space-lg);
          margin-block: var(--space-lg);
        }
        .honest-section h2 { margin-top: 0; }
        .honest-section ul { margin-bottom: var(--space-md); }
        .waitlist-input {
          flex: 1 1 240px;
          padding: 0.75rem 0.875rem;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          font-size: 1rem;
          font-family: inherit;
        }
        .waitlist-input:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
        .waitlist-form { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-block: var(--space-md); }
        .waitlist-message { margin: 0; }
        .landing-footnote {
          text-align: center;
          font-size: 0.85rem;
          color: var(--color-muted);
          opacity: 0.75;
          margin-block: var(--space-xl);
        }
      </style>

      <section class="hero">
        <h1>${SITE_NAME}</h1>
        <p>Tax estimates for cross-border developers.</p>
        <p>
          Five countries. One engine. €29/year while it's in this state, €99
          when it's finished.
        </p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/sign-up">Get the founding price - €29/year</a>
          <a class="btn btn-secondary" href="#waitlist">Get launch updates</a>
        </div>
      </section>

      <section>
        <h2>Five countries, legal-cited rates</h2>
        <p>
          Every rate and threshold in our calculators traces back to the law that
          defines it - §32a EStG for Germany, the Belastingdienst tariff for the
          Netherlands, IRS code for Portugal, IRPF for Spain, and HMRC rules for
          the UK. 2025 and 2026 tax years.
        </p>
        <div class="country-grid">
          <div class="card country-card">
            <span class="flag" aria-hidden="true">🇩🇪</span>
            <h3>Germany</h3>
            <p>Cubic-spline tariff, §32a EStG</p>
          </div>
          <div class="card country-card">
            <span class="flag" aria-hidden="true">🇳🇱</span>
            <h3>Netherlands</h3>
            <p>Box 1 rates and the 30% ruling</p>
          </div>
          <div class="card country-card">
            <span class="flag" aria-hidden="true">🇵🇹</span>
            <h3>Portugal</h3>
            <p>IRS brackets and IFICI status</p>
          </div>
          <div class="card country-card">
            <span class="flag" aria-hidden="true">🇪🇸</span>
            <h3>Spain</h3>
            <p>State + regional IRPF, Beckham regime</p>
          </div>
          <div class="card country-card">
            <span class="flag" aria-hidden="true">🇬🇧</span>
            <h3>UK</h3>
            <p>HMRC rules, Statutory Residence Test</p>
          </div>
        </div>
      </section>

      <section>
        <h2>What it does</h2>
        <div class="feature-grid">
          <div class="card feature-card">
            <h3>Tax calculator</h3>
            <p>
              Income tax for 5 countries, 2025/2026, with legal citations on
              every threshold.
            </p>
          </div>
          <div class="card feature-card">
            <h3>Residency check</h3>
            <p>
              Decision-tree assessment incl. the UK Statutory Residence Test.
              See where you'd count as resident.
            </p>
          </div>
          <div class="card feature-card">
            <h3>22 tax strategies</h3>
            <p>
              From the NL 30% ruling to Portugal's IFICI to Spain's Beckham
              regime - with eligibility rules in code, not vibes.
            </p>
          </div>
          <div class="card feature-card">
            <h3>Ask the docs</h3>
            <p>
              RAG-powered Q&amp;A over the actual tax law sources. Answers cite
              their sources.
            </p>
          </div>
        </div>
      </section>

      <section class="honest-section">
        <h2>What's not done yet</h2>
        <ul>
          <li>The UK residence test covers 8 of 17 outcomes.</li>
          <li>The Spanish foral regimes (Basque Country, Navarra) are partially implemented.</li>
          <li>The Dutch Box 3 model predates the 2023 Supreme Court ruling.</li>
          <li>The deterministic parts of the app are bilingual, but AI-generated strategy notes may still come back in Chinese.</li>
        </ul>
        <p>
          That's why it's €29 and not €99. When those three are done, the price
          goes up. If you sign up now, you keep €29 for as long as the product
          exists.
        </p>
        <p>We'd rather tell you now than surprise you later.</p>
      </section>

      <section id="waitlist">
        <h2>Not ready to pay for a half-finished tax engine? Fair.</h2>
        <p>
          Leave your email and I'll tell you when the Box 3 fix, the UK
          residence test, and the Spanish foral regimes are done - and the price
          is about to go from €29 to €99.
        </p>
        <form class="waitlist-form" id="waitlist-form" novalidate>
          <input
            class="waitlist-input"
            type="email"
            id="waitlist-email"
            name="email"
            required
            autocomplete="email"
            placeholder="your@email.com"
            aria-label="Email address"
          >
          <button class="btn btn-primary" type="submit">Notify me</button>
        </form>
        <p class="auth-error" id="waitlist-error" hidden></p>
        <p class="waitlist-message" id="waitlist-ok" hidden></p>
        <p>One email at launch. Nothing else. No newsletter, no drip campaign.</p>
      </section>

      <p class="landing-footnote">
        ${SITE_NAME} - built by one developer who filed cross-border taxes wrong
        for two years and got annoyed enough to write 966 tests about it.
      </p>

      <script>
        (function () {
          var form = document.getElementById('waitlist-form');
          var errorEl = document.getElementById('waitlist-error');
          var okEl = document.getElementById('waitlist-ok');
          form.addEventListener('submit', function (event) {
            event.preventDefault();
            var email = document.getElementById('waitlist-email').value;
            var button = form.querySelector('button[type="submit"]');
            var original = button.textContent;
            button.disabled = true;
            button.textContent = 'Adding you...';
            fetch('/api/waitlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ email: email }),
            })
              .then(function (res) {
                return res.json().then(function (data) { return { res: res, data: data }; });
              })
              .then(function (result) {
                if (result.res.ok) {
                  form.hidden = true;
                  okEl.textContent = result.data.status === 'already_registered'
                    ? "You're already on the list."
                    : "You're on the list. One email when it ships.";
                  okEl.hidden = false;
                } else if (result.res.status === 429) {
                  errorEl.textContent = 'Too many attempts from your address. Try again tomorrow.';
                  errorEl.hidden = false;
                } else {
                  errorEl.textContent = 'Enter a valid email address.';
                  errorEl.hidden = false;
                }
              })
              .catch(function () {
                errorEl.textContent = 'Network error. Please try again.';
                errorEl.hidden = false;
              })
              .finally(function () {
                button.disabled = false;
                button.textContent = original;
              });
          });
        })();
      </script>
    `,
  });

export const pricingPage = (): string =>
  renderPage({
    title: 'Pricing',
    path: '/pricing',
    metaDescription: META_PRICING,
    body: `
      <h1>Pricing</h1>
      <p>
        One plan, every feature. The price is a function of how finished the
        engine is, not of a tier list.
      </p>

      <div class="pricing-grid">
        <div class="card">
          <h2>Founding price</h2>
          <div class="price">€29 <span>/ year</span></div>
          <p>While the engine is in its current state. Everything included:</p>
          <ul class="feature-list">
            <li>Tax calculator for all 5 countries, 2025 and 2026 tax years</li>
            <li>Residency check incl. the UK Statutory Residence Test</li>
            <li>All 22 tax strategies, eligibility rules included</li>
            <li>Ask the docs - RAG Q&amp;A over the actual law sources</li>
            <li>Deadline reminders and email support</li>
          </ul>
          <a class="btn btn-primary" href="/sign-up">Get the founding price - €29/year</a>
          <p>
            When the Box 3 fix, the UK residence test and the Spanish foral
            regimes are done, the price becomes €99/year. Founding members keep
            €29 for as long as the product exists.
          </p>
        </div>
      </div>

      <section class="card">
        <h2>Why €29 and not €99?</h2>
        <p>The engine is upfront about what it does not do yet:</p>
        <ul class="feature-list">
          <li>The UK residence test covers 8 of 17 outcomes.</li>
          <li>The Spanish foral regimes (Basque Country, Navarra) are partially implemented.</li>
          <li>The Dutch Box 3 model predates the 2023 Supreme Court ruling.</li>
        </ul>
        <p>When those three are done, the price goes up. That is the whole pricing model.</p>
      </section>

      <section class="card">
        <h2>Common questions</h2>
        <h3>Can I cancel?</h3>
        <p>
          Yes, any time from your account settings or by emailing
          <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
        </p>
        <h3>What payment methods are accepted?</h3>
        <p>
          We accept major credit and debit cards, Apple Pay, Google Pay and other local payment
          methods offered by our payment processors.
        </p>
        <h3>Is VAT included?</h3>
        <p>
          Our merchant of record handles EU VAT compliance. The price shown during checkout reflects
          the correct tax treatment for your location.
        </p>
        <h3>Do you offer refunds?</h3>
        <p>
          Yes. See our <a href="/refund">Refund Policy</a> for details.
        </p>
      </section>
    `,
  });

export const signInPage = (): string =>
  renderPage({
    title: 'Sign in',
    path: '/sign-in',
    metaDescription: 'Sign in to your Taxmora account to subscribe and access Pro features.',
    body: `
      <h1>Sign in</h1>
      <section class="card auth-card">
        <p>
          Sign in to subscribe and access your Taxmora account. New here?
          <a href="/sign-up">Create an account</a>.
        </p>
        <form class="auth-form" id="signin-form" novalidate>
          <label>
            Email
            <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com">
          </label>
          <label>
            Password
            <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="Your password">
          </label>
          <p class="auth-error" id="error" hidden></p>
          <button class="btn btn-primary" type="submit">Sign in</button>
        </form>
      </section>

      <script>
        (function () {
          var form = document.getElementById('signin-form');
          var errorEl = document.getElementById('error');
          form.addEventListener('submit', function (event) {
            event.preventDefault();
            var email = document.getElementById('email').value;
            var password = document.getElementById('password').value;
            var button = form.querySelector('button[type="submit"]');
            var original = button.textContent;
            button.disabled = true;
            button.textContent = 'Signing in...';
            fetch('/api/auth/sign-in/email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ email: email, password: password }),
            })
              .then(function (res) {
                return res.json().then(function (data) { return { res: res, data: data }; });
              })
              .then(function (result) {
                if (result.res.ok && result.data.token) {
                  window.location.href = '/app';
                } else if (result.res.status === 429) {
                  errorEl.textContent = 'Too many attempts. Please wait a minute and try again.';
                  errorEl.hidden = false;
                } else {
                  errorEl.textContent = 'Invalid email or password. Please try again.';
                  errorEl.hidden = false;
                }
              })
              .catch(function () {
                errorEl.textContent = 'Network error. Please try again.';
                errorEl.hidden = false;
              })
              .finally(function () {
                button.disabled = false;
                button.textContent = original;
              });
          });
        })();
      </script>
    `,
  });

export const signUpPage = (): string =>
  renderPage({
    title: 'Create account',
    path: '/sign-up',
    metaDescription: 'Create a free Taxmora account to subscribe and access Pro features.',
    body: `
      <h1>Create account</h1>
      <section class="card auth-card">
        <p>
          Create a free Taxmora account. Already have one?
          <a href="/sign-in">Sign in</a>.
        </p>
        <form class="auth-form" id="signup-form" novalidate>
          <label>
            Name
            <input type="text" id="name" name="name" required autocomplete="name" placeholder="Your name">
          </label>
          <label>
            Email
            <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com">
          </label>
          <label>
            Password
            <input type="password" id="password" name="password" required autocomplete="new-password" placeholder="At least 8 characters" minlength="8">
          </label>
          <p class="auth-error" id="error" hidden></p>
          <button class="btn btn-primary" type="submit">Create account</button>
        </form>
      </section>

      <script>
        (function () {
          var form = document.getElementById('signup-form');
          var errorEl = document.getElementById('error');
          form.addEventListener('submit', function (event) {
            event.preventDefault();
            var name = document.getElementById('name').value;
            var email = document.getElementById('email').value;
            var password = document.getElementById('password').value;
            var button = form.querySelector('button[type="submit"]');
            var original = button.textContent;
            button.disabled = true;
            button.textContent = 'Creating account...';
            fetch('/api/auth/sign-up/email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ name: name, email: email, password: password }),
            })
              .then(function (res) {
                return res.json().then(function (data) { return { res: res, data: data }; });
              })
              .then(function (result) {
                if (result.res.ok && result.data.token) {
                  window.location.href = '/app';
                } else if (result.res.status === 429) {
                  errorEl.textContent = 'Too many attempts. Please wait a minute and try again.';
                  errorEl.hidden = false;
                } else {
                  errorEl.textContent = result.data.message || 'Unable to create account. Please try again.';
                  errorEl.hidden = false;
                }
              })
              .catch(function () {
                errorEl.textContent = 'Network error. Please try again.';
                errorEl.hidden = false;
              })
              .finally(function () {
                button.disabled = false;
                button.textContent = original;
              });
          });
        })();
      </script>
    `,
  });

export const termsPage = (): string =>
  renderPage({
    title: 'Terms of Service',
    path: '/terms',
    metaDescription: META_LEGAL,
    body: `
      <h1>Terms of Service</h1>
      <p class="legal-date">Last updated: ${CURRENT_DATE}</p>

      <p>
        Please read these Terms of Service ("Terms") carefully before using ${SITE_NAME}
        ("the Service"). By accessing or using the Service, you agree to be bound by these Terms.
        If you do not agree, do not use the Service.
      </p>

      <h2>1. Service description</h2>
      <p>
        ${SITE_NAME} is a software application that provides tax estimates, residency-day tracking,
        deadline reminders and general information for individuals in or moving between Spain,
        Portugal, Germany, the Netherlands and the United Kingdom.
      </p>

      <h2>2. Not professional advice</h2>
      <p>
        The Service is an information tool only. It does not provide legal, tax, accounting or
        immigration advice. Output generated by the Service should be reviewed by a qualified
        professional before it is used for filing, financial planning or decision-making. We are
        not liable for any loss arising from reliance on the Service output.
      </p>

      <h2>3. Eligibility and accounts</h2>
      <p>
        You must be at least 18 years old and capable of entering into a binding contract. You are
        responsible for maintaining the confidentiality of your account credentials and for all
        activity that occurs under your account.
      </p>

      <h2>4. Subscriptions and billing</h2>
      <p>
        Access to paid features requires an active subscription. Fees are billed in advance through
        our third-party payment processors. All payments are non-refundable except as described in
        our <a href="/refund">Refund Policy</a>.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service for any unlawful purpose;</li>
        <li>attempt to gain unauthorised access to the Service or its systems;</li>
        <li>reverse-engineer, scrape or copy the Service except as permitted by law;</li>
        <li>upload false, misleading or infringing information;</li>
        <li>interfere with other users' access to the Service.</li>
      </ul>

      <h2>6. Termination</h2>
      <p>
        We may suspend or terminate your account if you breach these Terms or if continued provision
        of the Service would create legal or compliance risk. You may cancel your subscription at any
        time.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        All code, designs, text and other content provided by us are owned by us or our licensors.
        You retain ownership of data you input. We only use it to provide and improve the Service,
        as described in our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, our total liability for any claim arising out of or
        relating to the Service is limited to the amount you paid for the Service in the 12 months
        preceding the claim. We are not liable for indirect, consequential or punitive damages.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction in which the operator is
        registered, without regard to conflict-of-law principles. ${COMPANY_ADDRESS}
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service after changes are
        posted constitutes acceptance of the revised Terms.
      </p>

      <h2>11. Contact</h2>
      <p>
        For questions about these Terms, contact us at
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
    `,
  });

export const privacyPage = (): string =>
  renderPage({
    title: 'Privacy Policy',
    path: '/privacy',
    metaDescription: META_LEGAL,
    body: `
      <h1>Privacy Policy</h1>
      <p class="legal-date">Last updated: ${CURRENT_DATE}</p>

      <p>
        This Privacy Policy explains how ${SITE_NAME} ("we", "us") collects, uses, stores and
        protects your personal data when you use our Service.
      </p>

      <h2>1. Data controller</h2>
      <p>${COMPANY_ADDRESS}</p>
      <p>Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>

      <h2>2. Information we collect</h2>
      <p>We collect the following categories of personal data:</p>
      <ul>
        <li>
          <strong>Account information:</strong> email address, authentication identifiers and
          profile settings.
        </li>
        <li>
          <strong>Usage data:</strong> pages visited, features used and interactions with the
          Service.
        </li>
        <li>
          <strong>Tax-related inputs:</strong> income figures, residency days, country selections
          and other values you enter to generate estimates. These are processed only to provide the
          Service.
        </li>
        <li>
          <strong>Payment information:</strong> handled by our payment processors. We do not store
          full credit-card numbers.
        </li>
        <li>
          <strong>Technical data:</strong> IP address, browser type, device information and cookies
          (see our <a href="/cookie-policy">Cookie Policy</a>).
        </li>
      </ul>

      <h2>3. How we use your data</h2>
      <p>We use personal data to:</p>
      <ul>
        <li>provide, maintain and improve the Service;</li>
        <li>authenticate users and secure accounts;</li>
        <li>process payments and subscriptions;</li>
        <li>send service-related notifications, such as deadline reminders;</li>
        <li>comply with legal and tax obligations.</li>
      </ul>

      <h2>4. Legal basis (for users in the EEA/UK)</h2>
      <p>We process personal data on the following legal bases:</p>
      <ul>
        <li>performance of our contract with you (providing the Service);</li>
        <li>compliance with legal obligations;</li>
        <li>our legitimate interests in security, fraud prevention and service improvement;</li>
        <li>your consent, where required (for example for non-essential cookies).</li>
      </ul>

      <h2>5. Data retention</h2>
      <p>
        We keep your personal data for as long as your account is active or as needed to provide the
        Service. You can request deletion of your account and associated data by contacting
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>

      <h2>6. Data sharing</h2>
      <p>We share data only with:</p>
      <ul>
        <li>payment processors to handle billing;</li>
        <li>cloud hosting and authentication providers that process data on our behalf;</li>
        <li>competent authorities when required by law.</li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>7. Your rights</h2>
      <p>
        Depending on your location, you may have the right to access, correct, delete, restrict or
        port your personal data, and to object to certain processing. To exercise these rights,
        email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>

      <h2>8. Security</h2>
      <p>
        We use encryption in transit, access controls and regular backups to protect your data.
        However, no online service is completely secure, and we cannot guarantee absolute security.
      </p>

      <h2>9. International transfers</h2>
      <p>
        Your data may be processed in countries outside your own, including by cloud providers with
        operations globally. We rely on appropriate safeguards such as standard contractual clauses
        where required.
      </p>

      <h2>10. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy. We will post the revised version on this page with an
        updated date.
      </p>

      <h2>11. Contact</h2>
      <p>
        For privacy questions, contact
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
    `,
  });

export const refundPage = (): string =>
  renderPage({
    title: 'Refund Policy',
    path: '/refund',
    metaDescription: META_LEGAL,
    body: `
      <h1>Refund Policy</h1>
      <p class="legal-date">Last updated: ${CURRENT_DATE}</p>

      <p>
        We want you to be satisfied with ${SITE_NAME}. If you are not, you may request a refund
        under the terms below.
      </p>

      <h2>1. Subscription refunds</h2>
      <p>
        If you cancel your subscription within <strong>30 days</strong> of your most recent payment
        and have not materially abused the Service, you are eligible for a full refund of that
        payment. No questions asked.
      </p>

      <h2>2. How to request a refund</h2>
      <p>
        Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address
        associated with your account. Include your account email and the date of the payment you
        would like refunded.
      </p>

      <h2>3. Refund processing</h2>
      <p>
        Approved refunds are processed through our payment processor to the original payment method
        within 10 business days. Processing times may vary depending on your bank or card issuer.
      </p>

      <h2>4. Exceptions</h2>
      <p>
        We reserve the right to deny refund requests where we detect fraud, chargeback abuse,
        violations of our <a href="/terms">Terms of Service</a>, or multiple refund requests for the
        same account.
      </p>

      <h2>5. Changes</h2>
      <p>
        We may update this Refund Policy. The version in effect at the time of your payment applies
        to that payment.
      </p>

      <h2>6. Contact</h2>
      <p>
        For refund questions, contact
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
    `,
  });

export const cookiePage = (): string =>
  renderPage({
    title: 'Cookie Policy',
    path: '/cookie-policy',
    metaDescription: META_LEGAL,
    body: `
      <h1>Cookie Policy</h1>
      <p class="legal-date">Last updated: ${CURRENT_DATE}</p>

      <p>
        This Cookie Policy explains how ${SITE_NAME} uses cookies and similar technologies when you
        visit our website.
      </p>

      <h2>1. What are cookies?</h2>
      <p>
        Cookies are small text files stored on your device by your browser. They help websites
        remember your preferences and understand how visitors use the site.
      </p>

      <h2>2. Cookies we use</h2>
      <p><strong>Essential cookies.</strong> These are necessary for the Service to function, such as authentication and security cookies. They cannot be disabled.</p>
      <p><strong>Preference cookies.</strong> These remember your settings, such as language or display preferences.</p>
      <p><strong>Analytics cookies.</strong> These help us understand how visitors interact with the website. We use these only with your consent where required.</p>

      <h2>3. Managing cookies</h2>
      <p>
        You can manage or delete cookies through your browser settings. Please note that disabling
        essential cookies may prevent parts of the Service from working.
      </p>

      <h2>4. Third-party services</h2>
      <p>
        We may use third-party analytics or payment providers that place their own cookies. These
        providers are responsible for cookies they set in accordance with their own policies.
      </p>

      <h2>5. Changes</h2>
      <p>
        We may update this Cookie Policy from time to time. The latest version will always be
        available on this page.
      </p>

      <h2>6. Contact</h2>
      <p>
        For cookie-related questions, contact
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
    `,
  });

export const impressumPage = (): string =>
  renderPage({
    title: 'Impressum',
    path: '/impressum',
    metaDescription: META_LEGAL,
    body: `
      <h1>Impressum</h1>
      <p class="legal-date">Last updated: ${CURRENT_DATE}</p>

      <p>
        This page is provided in accordance with the German Telemediengesetz (TMG) and serves as
        the legally required disclosure of the operator of this website.
      </p>

      <h2>Operator</h2>
      <p>
        <strong>Zhe Sun</strong><br>
        Taxmora<br>
        Lane 517, Tangqi Road<br>
        Baoshan District, Shanghai 201900<br>
        China
      </p>

      <h2>Contact</h2>
      <p>
        Email: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </p>

      <h2>VAT / tax identification</h2>
      <p>
        N/A<br>
        <em>Tax identification number is not currently registered.</em>
      </p>

      <h2>Responsible for content</h2>
      <p>
        Zhe Sun<br>
        Address as above
      </p>

      <h2>Dispute resolution</h2>
      <p>
        The European Commission provides a platform for online dispute resolution (OS):
        <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
          https://ec.europa.eu/consumers/odr
        </a>.
      </p>
      <p>
        We are neither willing nor obliged to participate in dispute resolution proceedings before
        a consumer arbitration board.
      </p>

      <h2>Liability for content</h2>
      <p>
        As a service provider we are responsible for our own content on these pages under general
        law. We are not obliged to monitor transmitted or stored third-party information or to
        investigate circumstances that indicate illegal activity.
      </p>

      <h2>Liability for links</h2>
      <p>
        Our offer contains links to external third-party websites over whose content we have no
        influence. Therefore we cannot assume any liability for this external content. The respective
        provider or operator of the linked pages is always responsible for their content.
      </p>
    `,
  });
