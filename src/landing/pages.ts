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
  'Taxmora helps European cross-border workers and digital nomads estimate tax outcomes across Spain, Portugal, Germany, the Netherlands and the UK.';
const META_PRICING =
  'Simple, transparent pricing for Taxmora. Monthly and annual plans with no hidden fees.';
const META_LEGAL =
  'Legal information, terms of service, privacy policy, refund policy and cookie policy for Taxmora.';

const CURRENT_DATE = '14 July 2026';

export const homePage = (): string =>
  renderPage({
    title: SITE_NAME,
    path: '/',
    metaDescription: META_HOME,
    body: `
      <section class="hero">
        <h1>Tax clarity for cross-border life in Europe</h1>
        <p>
          ${SITE_NAME} helps freelancers, remote workers and digital nomads estimate tax outcomes
          across Spain, Portugal, Germany, the Netherlands and the UK — without spreadsheets or guesswork.
        </p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/pricing">View pricing</a>
          <a class="btn btn-secondary" href="mailto:${SUPPORT_EMAIL}">Contact support</a>
        </div>
      </section>

      <section class="card">
        <h2>What you get</h2>
        <ul class="feature-list">
          <li>Multi-country tax estimates for ES, PT, DE, NL and the UK</li>
          <li>Residency-day calendar and presence-test checks</li>
          <li>Personalised strategy suggestions with legal citations</li>
          <li>Deadline reminders and draft form helpers</li>
          <li>Plain-language answers from curated tax-law sources</li>
        </ul>
      </section>

      <section class="card">
        <h2>Who it is for</h2>
        <p>
          If you earn in one country while living in another — or split your year between several
          EU jurisdictions — ${SITE_NAME} gives you a single place to model scenarios, compare
          regimes and stay on top of filing deadlines.
        </p>
      </section>

      <section class="card">
        <h2>Important notice</h2>
        <p>
          ${SITE_NAME} provides software-assisted calculations and general information. It does
          <strong>not</strong> constitute legal, tax or accounting advice. Always consult a qualified
          professional before filing a return or making a financial decision.
        </p>
      </section>
    `,
  });

export const pricingPage = (): string =>
  renderPage({
    title: 'Pricing',
    path: '/pricing',
    metaDescription: META_PRICING,
    body: `
      <h1>Simple pricing</h1>
      <p>
        One plan, every feature. Cancel anytime from your account settings or by emailing
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>

      <div class="pricing-grid">
        <div class="card">
          <h2>Monthly</h2>
          <div class="price">€10 <span>/ month</span></div>
          <p>Billed monthly. VAT included where applicable.</p>
          <ul class="feature-list">
            <li>Unlimited tax estimates</li>
            <li>All 5 supported countries</li>
            <li>Residency calendar</li>
            <li>Strategy suggestions</li>
            <li>Deadline reminders</li>
            <li>Email support</li>
          </ul>
          <button class="btn btn-primary js-subscribe" data-plan="monthly" type="button">
            Subscribe monthly
          </button>
        </div>

        <div class="card">
          <h2>Annual</h2>
          <div class="price">€190 <span>/ year</span></div>
          <p>Billed annually. Save vs monthly billing. VAT included where applicable.</p>
          <ul class="feature-list">
            <li>Everything in Monthly</li>
            <li>Priority email support</li>
            <li>Early access to new country guides</li>
          </ul>
          <button class="btn btn-primary js-subscribe" data-plan="annual" type="button">
            Subscribe annually
          </button>
        </div>
      </div>

      <section class="card">
        <h2>Common questions</h2>
        <h3>Can I change or cancel my plan?</h3>
        <p>
          Yes. You can upgrade, downgrade or cancel at any time. Changes take effect at the next
          billing cycle.
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

      <script>
        (function () {
          document.querySelectorAll('.js-subscribe').forEach(function (button) {
            var originalText = button.textContent || '';
            button.addEventListener('click', function () {
              var plan = button.getAttribute('data-plan');
              button.disabled = true;
              button.textContent = 'Loading...';
              fetch('/api/payment/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ plan: plan }),
              })
                .then(function (res) {
                  return res.json().then(function (data) {
                    return { res: res, data: data };
                  });
                })
                .then(function (result) {
                  if (result.res.ok && result.data.checkoutUrl) {
                    window.location.href = result.data.checkoutUrl;
                  } else if (result.res.status === 401) {
                    alert('Please sign in first to subscribe.');
                  } else {
                    alert(result.data.error || 'Unable to start checkout. Please try again.');
                  }
                })
                .catch(function () {
                  alert('Network error. Please try again.');
                })
                .finally(function () {
                  button.disabled = false;
                  button.textContent = originalText;
                });
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
