# DE 2024 — Einkommensteuer Hauptvordruck (Mantelbogen) ESt 1 A — Field Inventory

> **Form**: Einkommensteuererklärung 2024 — Hauptvordruck ESt 1 A (informally: "Mantelbogen")
> **Tax year (Veranlagungszeitraum)**: 2024
> **Issuer**: Bundesministerium der Finanzen (BMF), Vordruckkommission ESt — issued in agreement with the oberste Finanzbehörden der Länder
> **Form revision marker** (from cross-referenced PDF excerpts): `2024ESt1A011NET` (page 1) / `2024ESt1A012NET` (page 2), dated September 2024
> **Pages**: 2 (since the post-2018 simplification, the Mantelbogen was reduced from 4 pages to 2)
> **Filing duty statute**: § 25 EStG (Veranlagungszeitraum), § 56 EStDV (Pflichtveranlagung), § 149 AO (Steuererklärungspflicht)

---

## 1. Authoritative source (official PDF distribution)

The BMF does **not** publish a static, direct-download PDF of ESt 1 A on `bundesfinanzministerium.de`. The official distribution channel is the **Formular-Management-System der Bundesfinanzverwaltung (FMS)** operated by ITZBund on behalf of BMF, at **`formulare-bfinv.de`**. Multiple state Finanzämter (Bayern, Thüringen, Niedersachsen) link to the same FMS entries — this confirms the FMS is the federally-authoritative source.

### Primary authoritative URLs (verified)

| Document | URL | Notes |
|---|---|---|
| **ESt 1 A 2024 Hauptvordruck (Mantelbogen)** — interactive form (PDF print via FMS) | `https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034037_24` | HTTP 200 verified. Opens Lucom Interaction Platform; user fills in browser then exports PDF via the toolbar print/PDF button. This is the **official, current, authoritative** distribution. |
| **Anleitung zur ESt 2024** (Ausfüllhilfe — describes every line) | `https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034036_24anl` | Official BMF line-by-line instructions; the canonical reference for field semantics. |
| FMS catalog folder — VZ 2024 (all Einkommensteuer forms) | `https://www.formulare-bfinv.de/ffw/catalog/openFolder.do?path=catalog%3A%2F%2FSteuerformulare%2Fest%2Fest24` | Browseable index. |
| ELSTER form listing (electronic filing alternative) | `https://www.elster.de/eportal/formulare-leistungen/alleformulare/est` | BMF's electronic filing portal; offers the same form for VZ 2019–2025. |

### Authoritativeness cross-references (3 independent state-level mirrors)

1. **Bayerisches Landesamt für Steuern**: `https://www.finanzamt.bayern.de/Informationen/Formulare/Steuererklaerung/Einkommensteuer/` — links to FMS `est24` folder.
2. **Thüringer Finanzämter**: `https://finanzamt.thueringen.de/service/formulare/einkommensteuer/2024` — links to FMS `id=034037_24` directly.
3. **Landesamt für Steuern Niedersachsen**: `https://lstn.niedersachsen.de/startseite/steuer/steuervordrucke/einkommensteuer/2024/einkommensteuer-2024-234827.html` — lists ESt 1 A 2024.

### Important caveat for our use-case (PDF overlay)

The FMS exposes the form via a Java/Lucom **interactive session**, not as a directly-downloadable AcroForm PDF. The exported PDF from the FMS print action **is** the official form layout, but our pipeline needs:

- (a) the **blank fillable PDF** with named AcroForm fields **OR**
- (b) the blank **flat PDF** + our own coordinate map for `pdf-lib` text overlay.

**Recommendation**: the caller should open `https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034037_24` in a browser, use the FMS toolbar's "blanko ausdrucken / herunterladen" PDF button (per the FMS FAQ this produces a non-fillable PDF blank — exactly what we need for overlay-based filling with `pdf-lib`), and save it as `app/tax-forms/DE/2024/mantelbogen-real.pdf`. Once obtained, real X/Y coordinates can be measured for each field below.

> ⚠️ **USER ACTION REQUIRED (optional, can defer)**: To finalize coordinates, fetch the blank PDF from the FMS URL above. The form-structure data in this doc is sufficient to author `app/src/forms/DE/2024/mantelbogen.yml` and seed D1 rows now; coordinates can be added in a follow-up commit.

---

## 2. Form structure (verified from cross-referenced sources)

Line-number assignments below are verified against three independent authoritative sources:

- The **official PDF text excerpt** with revision marker `2024ESt1A011NET` (Sep 2024), published by "BMF, Vordruckkommission ESt".
- **Haufe Steuer-Office Premium** (HI16276258, dated 2025-03-13): commentary on the 2024 ESt 1 A explicitly stating "Zeilen 8–17, 20–29" for Person A / Person B, and "Zeilen 7–33" for Allgemeine Angaben.
- **steuern.de Ausfüllhilfe Hauptvordruck Steuererklärung**: confirms "Zeile 4 = Steuernummer; Zeilen 8 und 20 = Identifikationsnummer".

### Page layout (high level)

| Page | Sections | Zeilen |
|---|---|---|
| Page 1 | Art der Erklärung; Allgemeine Angaben (Steuerpflichtige Person/Person A); Ehegatte/Person B; Bankverbindung; Religion | 1 – 33 |
| Page 2 | Einkommensersatzleistungen; Ergänzende Angaben; Steuerberater-Mitwirkung; Unterschrift | 34 – ca. 50 |

---

## 3. MVP field inventory (Page 1 + signature) — 20 fields

The `sourcePath` column maps each form field to our existing data model (Drizzle D1 schema): `user.profile.*`, `user.income.*`, `userResidency.*`. Coordinates left as `TBD` until the real blank PDF is fetched.

| # | Field name (German, exact form label) | Zeile | Section | sourcePath (proposal) | Statute citation | Coord (TBD) | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Art der Erklärung — Einkommensteuererklärung (Checkbox) | Zeile 1 | Art der Erklärung | `userResidency.filingType` (enum: `est`/`est+as`/`as_only`) | § 25 EStG | TBD | Default checked for MVP (all users file ESt). |
| 2 | Art der Erklärung — Erklärung zur Festsetzung der Arbeitnehmer-Sparzulage (Checkbox) | Zeile 2 | Art der Erklärung | `user.profile.applyForSparzulage` (boolean, default false) | § 14 5. VermBG | TBD | Out of scope for MVP — leave unchecked. |
| 3 | An das Finanzamt (Name des zuständigen Finanzamts) | Zeile 3 | Header | `userResidency.finanzamt` | § 19 AO (örtliche Zuständigkeit) | TBD | Free-text; needs lookup from PLZ → Finanzamt mapping (defer to post-MVP). |
| 4 | Steuernummer | Zeile 4 | Header | `user.profile.steuernummer` | § 8 AO i.V.m. § 139a AO | TBD | Format varies by Bundesland (e.g. Bayern: 999/999/99999). |
| 5 | Bei Wohnsitzwechsel: bisheriges Finanzamt | Zeile 5 | Header | `userResidency.previousFinanzamt` (optional) | § 19 AO | TBD | Optional; only if user moved during VZ. |
| 6 | Telefonische Rückfragen tagsüber | Zeile 7 | Allgemeine Angaben | `user.profile.phone` | (none — administrative) | TBD | Optional but recommended (per Haufe HI16276258). |
| 7 | Identifikationsnummer (Steuerpflichtige Person / Person A) | Zeile 8 | Allgemeine Angaben — Person A | `user.profile.identifikationsnummer` | § 139b AO | TBD | 11-digit IdNr; mandatory. |
| 8 | Geburtsdatum (Steuerpflichtige Person / Person A) | Zeile 8 | Allgemeine Angaben — Person A | `user.profile.dateOfBirth` (ISO date) | § 25 EStG | TBD | Format DD.MM.YYYY on the form. |
| 9 | Familienname | Zeile 9 | Allgemeine Angaben — Person A | `user.profile.lastName` | (administrative) | TBD | |
| 10 | Vorname | Zeile 10 | Allgemeine Angaben — Person A | `user.profile.firstName` | (administrative) | TBD | Same line also contains Religionsschlüssel (skip for MVP). |
| 11 | Titel, akademischer Grad | Zeile 11 | Allgemeine Angaben — Person A | `user.profile.academicTitle` (optional) | (administrative) | TBD | Optional. |
| 12 | Ausgeübter Beruf | Zeile 12 | Allgemeine Angaben — Person A | `user.income.employment.occupation` | (administrative) | TBD | Free-text; informational only. |
| 13 | Straße (derzeitige Adresse) | Zeile 13 | Allgemeine Angaben — Anschrift | `user.profile.address.street` | § 8 AO (Wohnsitz) | TBD | |
| 14 | Hausnummer (+ Hausnummerzusatz) | Zeile 14 | Allgemeine Angaben — Anschrift | `user.profile.address.houseNumber` (split into `number` + `suffix`) | § 8 AO | TBD | Two sub-fields on the form. |
| 15 | Postleitzahl (Inland) | Zeile 15 | Allgemeine Angaben — Anschrift | `user.profile.address.postalCode` | § 8 AO | TBD | Inland vs. Ausland branch — for MVP assume Inland. |
| 16 | Wohnort | Zeile 15 | Allgemeine Angaben — Anschrift | `user.profile.address.city` | § 8 AO | TBD | Same Zeile as PLZ. |
| 17 | Adressergänzung | Zeile 16 | Allgemeine Angaben — Anschrift | `user.profile.address.addressLine2` (optional) | (administrative) | TBD | Optional (e.g. "c/o", apartment number). |
| 18 | Staat (falls Anschrift im Ausland) | Zeile 17 | Allgemeine Angaben — Anschrift | `userResidency.foreignCountry` (ISO 3166-1 alpha-2, nullable) | § 1 Abs. 1 EStG | TBD | Empty for `userResidency.type='unbeschraenkt_inland'`. Verify against PDF — may also include foreign PLZ field on Zeile 15. |
| 19 | Familienstand (Verheiratet/Lebenspartnerschaft seit / Verwitwet seit / Geschieden seit / Dauernd getrennt lebend seit) — multi-checkbox + date | Zeile 18 | Familienstand & Veranlagung | `user.profile.maritalStatus` (enum) + `user.profile.maritalStatusSinceDate` | § 26 EStG (Ehegatten-Veranlagung) | TBD | Determines Splitting eligibility. Verify exact checkbox layout against PDF. |
| 20 | Eigenhändige Unterschrift Steuerpflichtige(r) — Datum + Unterschriftsfeld | Page 2 (final lines, ~Zeile 49–50) | Unterschrift | `user.profile.signature.date` (auto-filled with submission date) + signature image (out of scope) | § 25 Abs. 3 EStG, § 150 Abs. 3 AO | TBD | For MVP: fill the date; leave signature blank for user to sign manually. Confirm exact line number against PDF — "verify against PDF". |

### Deferred to post-MVP (Page 1 fields not in initial 20)

- Zeile 6: Erklärung zur Feststellung des verbleibenden Verlustvortrags (`Anlage(n)` cross-ref).
- Zeile 10 secondary cell: Religionszugehörigkeit / Religionsschlüssel (8 codes: RK, EV, etc.).
- Zeile 12 secondary: Änderung der Religion im Jahr 2024.
- Zeilen 19: Veranlagungsart (Zusammenveranlagung vs. Einzelveranlagung) — required only for married users.
- Zeilen 20–29: Ehegatte / Person B mirror of Zeilen 8–17.
- Zeilen 30–33: Bankverbindung (IBAN, BIC, Kontoinhaber, Abweichender Kontoinhaber).
- Zeile 34: Antrag auf Festsetzung der Arbeitnehmer-Sparzulage.
- Zeile 35: Einkommensersatzleistungen (Arbeitslosengeld, Elterngeld, Krankengeld, etc. — `eDaten`, vorbefüllt durch Finanzamt).
- Zeile 36: Auslandseinkommensersatzleistungen (Progressionsvorbehalt).
- Zeile 37: Ergänzende Angaben zur Steuererklärung (Freitextverweis auf Anlage).
- Page 2 footer: "Bei der Anfertigung dieser Steuererklärung hat mitgewirkt" (Steuerberater-Identifikation) — out of scope for MVP self-filer.

### Field-numbering uncertainties to verify against real PDF

- **Zeile 14 vs 15**: the Sep-2024 form excerpt shows `Hausnummer Hausnummerzusatz Postleitzahl (Inland) Wohnort` on a single text-flow row; the actual PDF may split these across two `Zeile` numbers (14 = Hausnummer, 15 = PLZ/Wohnort). **TBD: verify against PDF**.
- **Zeile 17 vs 16**: similarly, Adressergänzung and Staat may be on adjacent Zeilen — sources show both Zeile 16 and 17. **TBD: verify against PDF**.
- **Signature Zeile number**: cross-references indicate the signature block is on page 2 final lines, exact Zeile number (~49–50) to be confirmed against PDF. **TBD: verify against PDF**.

---

## 4. Statute reference summary

| Statute | Purpose | Applies to |
|---|---|---|
| **§ 25 EStG** | Veranlagungszeitraum & Erklärungspflicht (filing duty for income tax) | Whole form |
| **§ 26 EStG** | Ehegattenveranlagung (joint vs. individual assessment for married couples) | Zeilen 18–29 |
| **§ 56 EStDV** | Detailed Pflichtveranlagungs-Tatbestände | Whole form |
| **§ 149 AO** | Generelle Steuererklärungspflicht | Whole form |
| **§ 150 Abs. 3 AO** | Unterschriftspflicht (signature requirement) | Signature block |
| **§ 139a AO** | Steueridentifikationsnummer (zugewiesen vom BZSt) | Zeile 4 |
| **§ 139b AO** | Persönliche Identifikationsnummer (IdNr) | Zeile 8 |
| **§ 8 AO** | Wohnsitzbegriff (defines residence for tax purposes) | Zeilen 13–17 |
| **§ 19 AO** | Örtliche Zuständigkeit der Finanzämter | Zeilen 3, 5 |
| **§ 1 Abs. 1 EStG** | Unbeschränkte Steuerpflicht (form ESt 1 A specifically targets unbeschränkt Steuerpflichtige) | Whole form |
| **§ 14 5. VermBG** | Arbeitnehmer-Sparzulage | Zeilen 2, 34 |

---

## 5. References (used during research)

- BMF Formular-Management-System (FMS): `https://www.formulare-bfinv.de/` (operated by ITZBund for BMF)
- BMF "Formulare" landing page: `https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/Formulare/formulare.html`
- Thüringer Finanzämter (Jahresseite VZ 2024): `https://finanzamt.thueringen.de/service/formulare/einkommensteuer/2024`
- Bayerisches Landesamt für Steuern: `https://www.finanzamt.bayern.de/Informationen/Formulare/Steuererklaerung/Einkommensteuer/`
- Haufe Steuer-Office Premium — Hauptvordruck ESt 1 A 2024 commentary (HI16262423, HI16276258), dated März 2025
- BMF-Schreiben 12.08.2022 "Steuererklärungen nach amtlich vorgeschriebenem Vordruck — Vorgaben für Erklärungen in Papierform": `https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2022-08-12-steuererklaerungen-nach-amtlich-vorgeschriebenem-vordruck-vorgaben-fuer-erklaerungen-in-papierform.pdf`
- ELSTER form catalog (electronic filing): `https://www.elster.de/eportal/formulare-leistungen/alleformulare/est`

---

*Last updated: research conducted 2026-06-03. Form revision in scope: `2024ESt1A011NET` / `2024ESt1A012NET` (Sep 2024 print run, valid for VZ 2024).*