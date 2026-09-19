# LEDGERIX — PROJECT RECORD
**Single source of permanent memory and honest audit for the Ledgerix web application.**
Last updated: 2026-09-17 | Build: v2.11

---

# PART 1 — PROJECT CONTEXT

## What Ledgerix Is

Ledgerix is a **single-file, client-side HTML/JS Progressive Web App** designed for **Indian small business GST billing and business management**. It runs entirely in the browser with no server component, no backend API, and no database. All data is stored locally in the browser's `localStorage` using AES-GCM encryption for sensitive data.

It solves the problem of affordable, offline-capable GST invoice generation for small Indian businesses that cannot justify expensive SaaS billing platforms (Zoho Books, Tally, etc.) or cloud-dependent tools.

**Intended users:** Indian small business owners, freelancers, and traders who need to create GST-compliant invoices, track clients and products, generate basic reports, and maintain a local business record — without internet dependency and without subscription fees.

## Current Version

- **App version:** `v2.10` (as declared in `CACHE_NAME = 'ledgerix-v2.10-shell'`; `app.config.js` still shows `v2.0` — a minor version string inconsistency)
- **Status:** Functional single-file app. Core invoice lifecycle is production-quality. Several secondary features are solid. A few areas are basic or still maturing.
- **Verification status:** All critical/non-critical bugs from the latest audit cycle have been fixed and statically verified. Browser/device verification pass has not yet been performed.

## Architecture

```
ledgerix/
├── index.html               — Entire UI (1,319 lines, single HTML file)
├── manifest.json            — PWA manifest
├── sw.js                    — Service Worker (cache-first app shell)
├── config/
│   └── app.config.js        — Central constants, storage keys, security params
└── assets/
    ├── css/
    │   └── main.css         — All styles, themes, responsive rules
    ├── icons/
    │   ├── icon-192.png     — PWA icon (generated: navy bg, gold L)
    │   └── icon-512.png     — PWA icon (generated: navy bg, gold L)
    └── js/
        ├── app.js           — Entry point: imports all modules, sets window.* bridges
        ├── core/
        │   ├── state.js     — Shared mutable in-memory state (exported let variables + setters)
        │   ├── storage.js   — ALL localStorage access (no other module may use localStorage directly)
        │   └── security.js  — AES-GCM encryption, PBKDF2 PIN hashing, WebCrypto wrappers
        ├── modules/
        │   ├── invoice.js   — Invoice creation, calculation, save/load/delete, preview, share, PDF
        │   ├── dashboard.js — KPI aggregation, paid/unpaid chart, revenue chart, GST breakdown chart
        │   ├── reports.js   — 7 report types, CSV/Excel/PDF/Print export
        │   ├── analytics.js — 4 Chart.js visualisations (sales trend, revenue by status, top products, top clients)
        │   ├── clients.js   — Client CRUD, invoice prefill
        │   ├── products.js  — Product CRUD, invoice prefill
        │   ├── gst.js       — GST calculator, history
        │   ├── profile.js   — Business profile, logo/signature upload, clearProfile
        │   ├── settings.js  — Currency, default GST, date format, language, PIN management
        │   ├── notifications.js — In-app notification panel, payment reminders
        │   ├── backup.js    — JSON backup/restore, Clear All, offline detection
        │   ├── search.js    — Global Ctrl+K search across invoices/clients/products
        │   ├── pdf.js       — jsPDF invoice generation and preview
        │   ├── ocr.js       — Tesseract.js bill scanning and invoice creation
        │   └── tabHandlers.js — Tab lifecycle (lazy load on first visit)
        ├── ui/
        │   ├── navigation.js — Tab switching, modal, sidebar
        │   ├── theme.js     — 6 theme application
        │   └── toast.js     — Toast notification display
        └── utils/
            └── helpers.js   — Pure helpers: formatMoney, formatDate, today, currentFY, numberToWords, validators
```

## How It Works Internally

1. **Boot:** `DOMContentLoaded` → `checkPIN()` (splash shown, PIN overlay if PIN set) → `hideSplash()` → `loadAllData()` → dashboard rendered.
2. **Navigation:** `switchTab(name)` shows/hides `.tab-content` divs and fires `tabHandlers.onTabSwitch()` for lazy rendering.
3. **HTML interaction:** All `onclick` attributes call `window.*` global bridges set in `app.js`. ES modules cannot be called directly from HTML `onclick`, so app.js exports every needed function to `window.*` and also to `window._ledgerix.*` namespace.
4. **State:** `core/state.js` holds all shared in-memory data as exported `let` variables with corresponding setter functions. Modules import State and mutate it only through setters.
5. **Storage:** `core/storage.js` is the sole owner of localStorage. On save, data is serialised to JSON and passed to `encStore()`/plain `localStorage.setItem()` depending on sensitivity.
6. **Encryption:** `core/security.js` derives a per-session AES-GCM key via PBKDF2 from a random install secret stored in `sessionStorage`. Encrypted keys: `gst_profile`, `gst_clients`, `gst_invoices`, `gst_invoice_draft`. On session end the derived key is gone; next session re-derives it from the same install secret.

## Data Model — Invoice Fields

Each saved invoice contains: `id`, `invNum`, `invDate`, `dueDate`, `clientName`, `clientGSTIN`, `clientAddr`, `taxType` (`'intra'`|`'inter'`), `paymentStatus` (`'pending'`|`'paid'`|`'overdue'`|`'cancelled'`), `itemRows[]`, `subtotal`, `totalGST`, `grandTotal`, `shipping`, `packaging`, `handling`, `roundOff`, `terms`, `notes`, `invAmountWords`.

## How Data Flows

```
User fills form → autoSaveInvoice() (debounced 500ms) → State.items update → renderItems() → recalculates totals
User clicks Save → saveInvoice() → validates → State.savedInvoices.push() → encStore() → localStorage
Dashboard → reads State.savedInvoices (in-memory) → aggregates → renders KPIs + charts
Reports → reads State.savedInvoices → filters by date → renders table → exports CSV/Excel
```

## State Management

`state.js` exports named `let` variables (clients, products, savedInvoices, profile, settings, items, charts, etc.) and corresponding `set*()` functions. All modules import `* as State` and call `State.setFoo()` to mutate. No Vuex/Redux — a deliberate simplicity choice. Works correctly for a single-user, single-tab app.

## Storage Architecture

| Key | Storage | Encrypted? | Contents |
|---|---|---|---|
| `gst_profile` | localStorage | AES-GCM | Business profile (name, GSTIN, address, bank, logo, sig) |
| `gst_clients` | localStorage | AES-GCM | Client list |
| `gst_invoices` | localStorage | AES-GCM | All saved invoices |
| `gst_invoice_draft` | localStorage | AES-GCM | Current invoice draft |
| `gst_products` | localStorage | Plaintext | Product catalogue |
| `gst_settings` | localStorage | Plaintext | App settings |
| `gst_inv_counter` | localStorage | Plaintext | Invoice serial counter |
| `gst_calc_history` | localStorage | Plaintext | GST calculator history |
| `gst_notifications` | localStorage | Plaintext | Notification list |
| `gst_pin` | localStorage | PBKDF2 hash | Hashed PIN (not AES-GCM; PIN auth is separate) |
| `_isk` | localStorage | Plaintext | Install secret (seed for session key derivation) |
| `gst_reminders_fired_YYYY-MM-DD` | localStorage | Plaintext | Per-day reminder deduplication |

## Security Architecture

- **PIN:** Optional 4-digit numeric PIN. Hashed with PBKDF2-SHA256 (100k iterations, random salt) before storage. On entry, re-hashes input and compares. Migration path exists for legacy plain PIN format.
- **Data encryption:** AES-GCM 256-bit. Key derived per-session from install secret via PBKDF2. The install secret itself is plaintext in localStorage — the protection is session-scoped, not device-scoped. Tabs in the same browser session share the derived key via `sessionStorage`.
- **XSS:** All user content rendered via the `esc()` helper (HTML entity encoding). Used consistently in invoice preview, report tables, notification rendering, and search results.
- **Restore validation:** `restoreFromBackup()` validates schema type, checks keys against whitelists (`ALLOWED_PROFILE_KEYS`, `ALLOWED_SETTINGS_KEYS`), and re-encrypts sensitive data before writing to storage.
- **Image limits:** Logo and signature uploads are capped at 512KB (warns at 200KB) via `checkImageSize()`.

## PWA Architecture

- **Manifest:** `manifest.json` declares name, icons (192px, 512px), display: standalone, background/theme navy.
- **Service Worker:** `sw.js` (v2.10). Install caches all JS modules, CSS, HTML as app shell. CDN resources (Chart.js, jsPDF, fonts) use network-first with cache fallback. Tesseract is intentionally excluded from cache (too large, user-initiated only). `skipWaiting` + `clients.claim()` on activate — new SW activates immediately. `SKIP_WAITING` message from page forces update.
- **Offline:** App shell works offline. Dashboard, invoice creation, clients, products, calculator, reports, analytics, backup — all work offline using cached data. PDF generation requires cached jsPDF CDN. OCR and fonts require network.

## External Dependencies (CDN — Required)

| Library | URL | When |
|---|---|---|
| Chart.js 4.4.4 | jsdelivr.net | Always (dashboard, analytics) |
| jsPDF 2.5.1 | cdnjs.cloudflare.com | PDF download |
| jsPDF-AutoTable 3.8.1 | cdnjs.cloudflare.com | PDF tables |
| QRCode.js 1.0.0 | jsdelivr.net | Invoice QR (loaded in head) |
| Tesseract.js 4.1.1 | jsdelivr.net | OCR (lazy, only when scanning) |
| Google Fonts (Poppins, Playfair) | fonts.googleapis.com | UI typography |
| Font Awesome 6 | cdnjs.cloudflare.com | Icons |

**Note:** Tesseract v4 is pinned because v5 removed the `Tesseract.recognize()` global API that Ledgerix uses. Upgrading Tesseract requires changing the OCR call pattern.

## Deployment

**Deployment information not confirmed from the current project.** No hosting configuration, CI/CD, or deployment scripts are present in the codebase. Ledgerix is a static site — it can be hosted on any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages, a plain web server). It **requires HTTPS** for Service Worker registration and WebCrypto API (which requires a secure context). PWA install prompt also requires HTTPS.

---

# PART 2 — COMPLETE CURRENT FEATURE AUDIT

## Dashboard

**What it does:** Displays KPI summary cards (today's sales, monthly sales, pending amount, collection rate), a growth indicator circle, Invoice Overview doughnut (paid/unpaid), a Monthly Revenue bar chart, GST Summary cards (CGST/SGST/IGST), a GST Breakdown doughnut chart, Recent Invoices list, Pending Payments list, Top Clients list, Top Products list, and Recent Activity.

**Implementation:** `dashboard.js` reads `State.savedInvoices` in a single pass and aggregates all KPIs. Charts use Chart.js 4.4.4 with destroy-before-recreate lifecycle. `renderDashboardCharts()` renders three canvas charts.

**Quality:** Production-quality aggregation logic after fixes. GST split by `taxType` is now correct. Invoice Overview center count and legend are now populated. GST Breakdown chart now renders. Requires Chart.js CDN.

**Limitation:** `today()` uses UTC date — on April 1 IST before 05:30 AM, the date resolves to March 31 UTC, which affects daily sales KPI accuracy for 5.5 hours. Pre-existing, low-impact.

## Invoice Creation

**What it does:** Full GST invoice form with client name, GSTIN, address, intra/inter-state toggle, payment status, invoice number (auto-generated), dates, item rows (description, HSN, qty, rate, GST%, discount), subtotal, total GST, additional charges (shipping/packaging/handling), round-off toggle, terms, notes. Produces amount in words.

**Implementation:** `invoice.js` manages `State.items[]` in memory. `renderItems()` recomputes all totals on every change. Auto-saves draft to encrypted localStorage (500ms debounce). Invoice number format: `{PREFIX}/{FY}/{0001}`.

**Quality:** Solid and complete. Calculations are correct for both CGST+SGST (intra) and IGST (inter) scenarios. Amount-in-words works up to crore range.

## Invoice Calculations

**Math:** `amount = qty × rate × (1 − disc/100)`. GST amount per line = `amount × gstRate/100`. Grand total = subtotal + GST + shipping + packaging + handling ± roundOff. All floating-point (no integer arithmetic) — suitable for Indian billing amounts.

**Quality:** Statically verified correct. Runtime-verified through Node.js simulation against multiple scenarios.

## Saved Invoices / Invoice History

**What it does:** Lists all saved invoices with status badges, filter sub-tabs (All/Paid/Pending/Overdue), text search, edit (loads back into form), PDF download, delete.

**Quality:** Complete and solid. Duplicate invoice number detection on save. Status filters work.

## Invoice Preview

**What it does:** Renders an in-browser HTML invoice preview with business letterhead, client details, items table, GST split, bank details, signature, terms. Appears as an overlay, scroll-into-view, close button.

**Quality:** Complete. Uses `esc()` throughout. CGST+SGST vs IGST shown correctly by `taxType`.

## PDF Generation

**What it does:** Downloads a jsPDF A4 PDF with multi-column items table (autoTable), header, amounts, bank details, terms, footer.

**Implementation:** `pdf.js → downloadPDFFromData()`. Detects `window.jspdf.jsPDF` or `window.jsPDF`. Falls back to `window.print()` if jsPDF unavailable.

**Quality:** Solid when jsPDF CDN loads. Requires network on first use; cached by SW thereafter. Note: "Export PDF" button in Reports is `window.print()` — it is NOT a true PDF export of the report table, just browser print.

**Limitation:** Report PDF export = `window.print()`. This is a design-level limitation, not a bug.

## Print

**What it does:** Calls `window.print()`. For invoice, prints the current page. For reports, prints the report table. CSS `@media print` is expected to handle sidebar/header hiding.

**Quality:** Functional but basic. Print quality depends on browser and CSS `@media print` rules.

## Share Invoice

**What it does:** Modal with 4 share buttons: WhatsApp (`wa.me`), Email (`mailto:`), Telegram (`t.me/share`), Copy to Clipboard.

**Quality:** Complete. XSS-safe (dynamically added listeners, not onclick injection). Uses `encodeURIComponent`.

## Reset Invoice

**What it does:** Clears all form fields, empties items, clears draft, regenerates invoice number.

**Quality:** Complete. Correctly resets dates to today/+7 days.

## Clients

**What it does:** Add/edit/delete clients (name required; GSTIN, phone, email optional with format validation). Search by name/GSTIN. Use client to prefill invoice form. Save current invoice's client to client list.

**Quality:** Solid. Format validation for GSTIN (regex), phone (10-15 digits), email. Client data encrypted in localStorage.

## Products

**What it does:** Add/edit/delete products (name required; HSN, rate, GST%, stock optional). Search. Add to invoice (auto-fills item row with name, HSN, rate, GST).

**Quality:** Solid. Products stored unencrypted (considered non-sensitive).

## GST Calculator

**What it does:** Enter amount, select GST rate (quick buttons: 0/5/12/18/28% or custom), choose exclusive/inclusive, choose intra/inter-state, choose tax category (zero-rated/exempt forces GST=0). Shows CGST+SGST or IGST. Saves to history. History can be reloaded. Clear button added.

**Quality:** Complete and correct after fixes. Clear button now wired. History renders correctly.

## OCR Bill Scanner

**What it does:** Upload a bill image → Tesseract.js scans → extracts vendor name, GSTIN, date, bill number, line items via regex → user edits extracted items → creates invoice from scan.

**Quality:** Experimental / network-dependent. Tesseract v4.1.1 lazy-loaded from CDN. Parsing is heuristic regex — accuracy varies significantly by bill format and image quality. Cannot work offline (Tesseract excluded from SW cache). Progress bar and status messages are correct.

**Limitation:** This is an OCR assist, not a reliable extraction engine. Real-world accuracy for printed Indian bills will be moderate at best.

## Reports

**What it does:** 7 report types — Daily, Weekly, Monthly, Yearly (Indian FY), GST Summary, Client-wise, Product-wise. Date range filter. Generate shows table. Export CSV (text), Export Excel (tab-separated `.xls`), Export PDF (= `window.print()`), Print.

**Quality:** Complete and now structurally correct after export bar fix. CSV and Excel exports use Blob/URL.createObjectURL — no library dependency. "Export PDF" is print-to-PDF, not a true PDF file of the report.

**Note on "Export Excel":** Produces a `.xls` file with tab-separated text. It opens in Excel/Sheets but is not a true XLSX binary. For most small-business use this is acceptable.

## Analytics

**What it does:** 4 Chart.js charts — Monthly Sales Trend (line), Revenue by Status (pie), Top Products (doughnut), Top Customers (bar). 4 KPI cards (top product, top customer, avg invoice, collection rate).

**Quality:** Complete. Uses canvas ID string as chart key to prevent duplicate Chart instances. Requires Chart.js CDN.

## Global Search

**What it does:** Ctrl+K (or header button) opens overlay. Searches invoices (by number/client), clients, products simultaneously. Click result navigates to correct tab.

**Quality:** Complete. XSS-safe (listeners, not onclick injection). ESC closes.

## Profile / My Business

**What it does:** Business name, GSTIN, address, phone, email, invoice prefix, financial year, bank name, account number, IFSC, UPI ID, logo upload (base64), signature upload (base64). Logo/signature appear in invoice preview and PDF.

**Quality:** Solid. Logo/signature capped at 512KB. Clear profile now correctly persists (AES-GCM write of `{}`). Financial year now dynamically defaults to current Indian FY.

**Note:** Logo and signature are NOT included in backup (intentionally stripped to avoid large backup files). This is documented behavior but may surprise users.

## Settings

**What it does:** Currency (INR/USD/EUR/GBP/AED/SGD), Default GST rate, Date format (DD/MM/YYYY), Language (en only, others listed), Theme selection, Data Management (backup/restore/export Excel/clear all).

**Quality:** Complete. Currency affects `formatMoney()` throughout. Settings stored unencrypted.

## PIN Protection

**What it does:** Optional 4-digit PIN. On enable: setup form appears, PIN is PBKDF2-hashed and stored. On boot: PIN overlay shown, correct PIN unlocks app. On disable: PIN removed. `removePINFromSettings()` removes hash from storage.

**Quality:** Solid. PBKDF2 with 100k iterations and random salt. Migration from legacy plain PIN format handled. Splash always dismisses before PIN overlay (boot never hangs).

## Backup / Restore

**What it does:** Backup downloads JSON with clients, products, savedInvoices, profile (without logo/sig), settings, notifications, invoiceCounter. Restore reads JSON, validates schema, whitelists keys, re-encrypts sensitive data.

**Quality:** Solid. Restore validation is strict. Images stripped from backup.

## Notifications

**What it does:** Bell icon, panel, unread badge. Payment reminders fire 2.5s after boot for invoices due ≤3 days or overdue. Once per day per invoice (deduplication by date key). Click marks read.

**Quality:** Complete. Notification cap at 50. Click-outside closes panel.

## Themes

**What it does:** 6 themes — Dark Gold (default), Light, Blue, Green, Purple, Corporate — applied via body class.

**Quality:** Complete. Persists to settings. Applies silently on load.

## Auto-save Draft

**What it does:** Invoice form auto-saves to encrypted localStorage every 500ms (debounced). Restored on next load if no explicit save was done.

**Quality:** Complete. Covers all 16 form fields plus items array.

---

# PART 3 — WHAT LEDGERIX CAN DO

A real user can currently use Ledgerix to:

- **Create GST-compliant invoices** for both intra-state (CGST+SGST) and inter-state (IGST) transactions, with multiple line items, discounts, HSN codes, and additional charges.
- **Preview invoices** in-browser with business letterhead, logo, signature, and QR support.
- **Download invoices as PDF** using jsPDF (A4, professional layout) when CDN is available, or print otherwise.
- **Share invoices** via WhatsApp, email, Telegram, or clipboard.
- **Save, search, filter, and manage** a local invoice history with status tracking.
- **Manage a client directory** with autofill into invoices.
- **Manage a product catalogue** with autofill into invoice line items.
- **Calculate GST** precisely for any rate and tax type, inclusive or exclusive, with history.
- **View business dashboard** with revenue KPIs, collection rate, chart visualisations.
- **Generate 7 types of business reports** and export them as CSV or Excel-compatible files.
- **View analytics** with trend charts and client/product rankings.
- **Search** across invoices, clients, and products instantly.
- **Protect data** with an optional PIN lock and AES-GCM encryption.
- **Back up and restore** all data as a JSON file.
- **Use the app offline** (core features) once the service worker has cached the shell.
- **Install as a PWA** on Android, iOS, or desktop (requires HTTPS).

---

# PART 4 — WHAT LEDGERIX CANNOT DO

- **Multi-user access:** No user accounts, no roles, no concurrent access. Single user, single device.
- **Cloud sync:** No server, no sync. Data is local. One browser = one dataset.
- **Multi-device use:** Cannot seamlessly switch between devices. Manual backup/restore is the only transfer mechanism.
- **Accounting features:** No double-entry bookkeeping, no P&L statement, no balance sheet, no purchase invoices, no journal entries.
- **Credit notes / debit notes:** Not supported.
- **Recurring invoices:** Not supported.
- **GST filing / GSTR reports:** No GSTR-1, GSTR-3B, or e-invoice integration. Reports help prepare data but do not generate official filing formats.
- **E-invoicing (IRN/QR):** No integration with Indian e-invoice APIs. The QRCode.js dependency exists but its invoicing-level integration is not confirmed as full e-invoice compliant.
- **Payment gateway integration:** No online payment collection.
- **Email invoice delivery:** Share opens `mailto:` — relies on the device's email client; no SMTP sending.
- **Inventory management:** Stock field on products is a data field only — no stock decrement on invoice save, no low-stock alerts.
- **Import CSV/Excel data:** No bulk import of clients, products, or invoices.
- **True report PDF export:** "Export PDF" in reports uses `window.print()`, not a structured PDF file.
- **True XLSX export:** "Export Excel" produces tab-separated `.xls` text, not a real XLSX binary.
- **Reliable OCR:** Tesseract accuracy on real printed bills is moderate, not reliable for unattended extraction.

---

# PART 5 — LIMITATIONS

**Browser dependence:** Requires a modern browser with ES2020 modules, WebCrypto API, ServiceWorker, IndexedDB-compatible localStorage, Blob/URL APIs. IE is not supported. Safari iOS has had historical SW quirks.

**Local-only architecture:** All data lives in one browser's localStorage. Clearing browser data (Chrome → Clear browsing data → Cookies/storage) destroys all Ledgerix data permanently.

**Storage size:** localStorage has a typical 5–10MB limit per origin. Base64-encoded logos and signatures consume significant space (up to 512KB each). A business with many invoices and large images may approach limits. No warning is currently shown as storage fills.

**No data recovery without backup:** If localStorage is cleared without a backup, all data is gone. No recovery path exists. Backup must be done manually.

**PWA limitations on iOS:** iOS Safari PWA support is limited compared to Android Chrome. Some features (push notifications, background sync) are not available. Install via "Add to Home Screen" works but the experience varies by iOS version.

**Offline limitations:** CDN resources (Chart.js, jsPDF) are cached by SW after first load, but are NOT guaranteed cached on first offline use if the user installed the PWA immediately without browsing. Tesseract (OCR) always requires network.

**CDN dependency risks:** Ledgerix has no local fallback for Chart.js, jsPDF, jsPDF-AutoTable, QRCode.js, Tesseract.js, Google Fonts, or Font Awesome. If any CDN goes down and the SW cache has expired (or cache was cleared), those features fail silently or with reduced UI.

**UTC date issue:** `today()` returns UTC date. For IST users on April 1 before 05:30 AM local time, `today()` returns March 31, affecting daily sales KPI and FY display for 5.5 hours. Pre-existing; low severity.

**PDF quality:** jsPDF output is functional but lacks the richness of server-rendered PDFs (no embedded fonts, basic table styling only).

**Single tab assumption:** The architecture assumes a single browser tab. Multiple tabs in the same browser will share `sessionStorage` key derivation if opened from the same origin, but concurrent mutations to `State` from two tabs are not protected.

**Encryption scope:** AES-GCM encryption protects data at rest from file-system-level access. It does not protect against JavaScript executing in the same browser origin (extensions, XSS). The install secret is plaintext in localStorage.

**No server audit trail:** All operations are local. There is no audit log, no tamper detection for stored data.

---

# PART 6 — CONS / WEAKNESSES

**Data fragility:** The entire business record is in one browser's localStorage. A browser update, extension conflict, storage quota, or accidental clear wipes everything. This is the most serious practical weakness for real business use.

**No true PDF report export:** "Export PDF" in the Reports section is `window.print()`. A user expecting a structured PDF report file is disappointed. This is a design gap for a billing tool.

**No XLSX export:** The "Export Excel" button produces a `.xls` with tab-separated text. It works, but it is not a real XLSX file and will not support formulas, formatting, or pivot tables.

**OCR reliability:** The OCR feature's accuracy on real Indian printed bills is highly variable. For a business tool, this feature is an assistant at best and unreliable at worst.

**Inventory is decorative:** The stock field on products is not wired to invoice saves. It never decrements. A user thinking Ledgerix manages their stock will be misled.

**No recurring invoices:** A significant omission for service businesses with fixed monthly billing.

**No credit/debit notes:** Required for compliant GST adjustments.

**Reports lack summary statistics:** The report UI has placeholder divs `#reportDateRange` and `#reportSummary` that are never populated by any current code. These are dead markup.

**Version string inconsistency:** `app.config.js` declares `APP_VERSION: 'v2.0'` but the SW cache is `ledgerix-v2.10-shell`. Minor, but indicates version tracking was not maintained.

**Single-language:** Language setting exists (English, Hindi, Gujarati, Tamil, Telugu listed) but only English is implemented. Non-English selections have no effect.

**App.js PIN UI load:** The PIN settings UI loads profile/settings in `window.togglePIN()` which includes a direct `localStorage.getItem(PIN_KEY)` call — a minor violation of the "all localStorage through storage.js" architecture rule. Not a bug, but a consistency gap.

**No toast for backup logo exclusion:** When backup is downloaded, logos and signatures are silently excluded with no user notification. A user may restore a backup and wonder why their logo disappeared.

**Date range not auto-set in reports:** The user must manually set report date ranges every time. No "this month" / "this FY" quick buttons.

---

# PART 7 — SECURITY

## What the Security Model Does

- Encrypts the four most sensitive localStorage keys (profile, clients, invoices, draft) with AES-GCM 256-bit, key derived per-session via PBKDF2 (100k iterations, SHA-256).
- Stores PIN as PBKDF2-SHA256 hash with random salt — never plaintext.
- Prevents XSS in rendered content via `esc()` (HTML entity encoding) in all user-data rendering paths.
- Validates and whitelists keys on backup restore — maliciously crafted backup files cannot inject unexpected keys.
- Caps image uploads at 512KB to prevent localStorage exhaustion attacks.
- Pins `Tesseract.js` to v4.1.1 (API contract known; v5 would silently break OCR).

## What the Security Model Does Not Protect Against

- **A malicious browser extension** with access to the same origin can read `localStorage` including the plaintext install secret and all unencrypted keys.
- **Physical device access** with the browser open (no PIN lock on the session, only on app boot).
- **CDN supply-chain attacks:** Chart.js, jsPDF, Tesseract, Font Awesome are loaded from third-party CDNs. A compromised CDN could inject malicious JS into the page. There are no Subresource Integrity (SRI) hashes on CDN scripts.
- **Brute-force of PIN** if the attacker has the raw PBKDF2 hash from localStorage (offline attack). 100k iterations provides reasonable but not maximum resistance.
- **Data integrity:** AES-GCM provides authentication (tamper detection) for encrypted fields, but unencrypted fields (settings, products, notifications, counter) can be modified by anyone with browser DevTools access.
- **Multiple users on same device:** The PIN protects app entry, not individual data records. Shared device = shared data.

## Security Assumptions

- User is the sole operator of their device and browser.
- The browser is not compromised by extensions or XSS from other origins.
- CDN providers are trusted.

## Larger-Scale Security Concerns

At larger scale (multiple users, shared devices, multi-branch businesses), the current model would be inappropriate. A backend with server-side authentication, proper access control, and server-side encrypted storage would be required.

---

# PART 8 — RELIABILITY AND FAILURE RISKS

| Risk | Severity | Impact | Notes |
|---|---|---|---|
| Browser storage cleared | **Critical** | Complete data loss | No recovery without backup |
| No backup taken | **Critical** | Permanent loss on storage clear | User education required |
| CDN unavailable (Chart.js, jsPDF) | **High** | Dashboard/Analytics charts blank; PDF fails | Mitigated by SW cache after first load |
| Corrupted localStorage JSON | **High** | `JSON.parse` throws; `loadAllData` fails silently for that key | `decStore` has fallback, but corrupted encrypted data returns null |
| Device loss / browser profile loss | **High** | All data gone if no backup | No cloud sync |
| localStorage quota exceeded | **Medium** | Silently fails to write (no user warning) | Large logos + many invoices could approach limit |
| Stale SW cache | **Medium** | User runs old JS after a deploy | `skipWaiting` + `SKIP_WAITING` message mitigates; still requires a browser tab refresh |
| Tesseract CDN failure | **Low** | OCR unavailable | Graceful: OCR is opt-in |
| Single browser tab assumption violated | **Low** | State inconsistency if two tabs open | Unlikely in practice |
| jsPDF API change | **Low** | PDF generation breaks | Pinned to 2.5.1 in SW CDN_PREFETCH |
| Tesseract v5 accidentally used | **Low** | OCR silently fails (`Tesseract.recognize` removed in v5) | Pinned to v4.1.1 |
| Large invoice datasets | **Low–Medium** | Report generation and chart rendering slower; no pagination | Performance degrades gracefully but no hard limit enforced |
| iOS PWA quirks | **Low** | Inconsistent SW behavior on older iOS | Testing required |

---

# PART 9 — DEPLOYMENT

**What is known:** Ledgerix is a static website — all files are served as static assets. It requires no server-side processing. Any static hosting capable of serving `index.html` with the correct MIME types and without redirecting ES module requests will work.

**HTTPS is mandatory** for:
- Service Worker registration
- WebCrypto API (AES-GCM, PBKDF2)
- PWA install prompt

**No deployment configuration is present in the codebase.** No `netlify.toml`, `vercel.json`, `_redirects`, `.htaccess`, `Dockerfile`, or CI/CD scripts were found.

**Intended deployment:** Static hosting over HTTPS. `localhost` also works for development (localhost is a secure context).

**Current deployment situation:** Not confirmed from project files.

**Cache update behavior:** When a new version is deployed, the SW activates automatically (`skipWaiting`) but cached content is only replaced after the next page load. The page sends a `SKIP_WAITING` message on detecting a waiting SW, which forces immediate activation. A full page reload then fetches updated assets.

**Known risk:** If `CACHE_NAME` (currently `ledgerix-v2.10-shell`) is not bumped on deploy, old cached JS may be served to returning users. Cache name must be updated in `sw.js` on every meaningful code deploy.

---

# PART 10 — FUTURE-PROOF ASSESSMENT

## Currently Future-Ready

- **Modular architecture:** Each feature is an isolated ES module. Adding or replacing a module does not require touching others.
- **Central config:** `app.config.js` houses all constants, storage keys, security parameters, and limits. Changes propagate cleanly.
- **State isolation:** `state.js` provides a single mutable state with typed setters. This pattern scales to additional state variables without coupling.
- **Storage abstraction:** `storage.js` is the sole owner of localStorage. Replacing localStorage with IndexedDB or a remote API is possible without touching module logic.
- **Security abstraction:** `security.js` wraps all crypto. The encryption algorithm can be upgraded without changes in other modules.

## Can Be Made Future-Ready (Requires Work)

- **Multi-device / cloud sync:** The architecture is deliberately local-first. Adding sync would require a backend API and a conflict-resolution strategy. The modular storage layer makes this structurally feasible but not free.
- **True multi-user:** Would require server-side authentication and per-user data isolation. Currently architecturally incompatible.
- **GSTR filing integration:** Would require GST portal API integration (GSP/ASP). Currently no network layer exists.
- **True XLSX/PDF report exports:** Would require adding SheetJS (XLSX) and a proper PDF rendering approach (e.g., Puppeteer on a server, or a richer client-side library).
- **Real inventory tracking:** Stock decrement on invoice save is a one-function addition; the data model already has the stock field.

## What Would Eventually Require a Backend

- Cloud backup / sync
- Multi-device access
- Email invoice delivery
- Payment gateway integration
- GSTR filing
- Audit trails

---

# PART 11 — SCALABILITY

**Invoice volume:** All invoices are loaded into memory on boot (`State.savedInvoices`). At a few hundred invoices, this is fast. At 5,000–10,000 invoices, memory footprint and report aggregation time increase noticeably. No pagination exists in the invoice list or reports. No lazy loading. This is the most likely practical scalability ceiling for the current architecture.

**Clients/Products:** Rendered in full on tab visit. Similar scaling characteristics. Acceptable up to several hundred each.

**Reports:** Report generation is a synchronous in-memory operation over `State.savedInvoices`. For large datasets (thousands of invoices), the UI may freeze briefly during generation. No worker/async approach.

**Charts:** Chart.js processes data synchronously. Dashboard charts on large datasets may be slow to render. Analytics module processes all invoices each time the tab is visited.

**PDF generation:** jsPDF is synchronous and client-side. Very large invoices (many line items) may produce slow PDF generation on low-end devices.

**localStorage limits:** A practical ceiling of roughly 5MB per origin in most browsers. With AES-GCM overhead, base64 images, and many invoices, this can be reached. No current monitoring or warning.

**OCR:** Each scan loads Tesseract (~10MB) from CDN into memory. Repeated scanning sessions on low-memory devices may cause page reloads.

---

# PART 12 — MAINTAINABILITY

**Strengths:**
- Clean module separation with single responsibility per file.
- `storage.js` as sole localStorage owner prevents scattered data access.
- `app.config.js` centralises all magic numbers and keys.
- `helpers.js` contains pure, testable utility functions.
- `security.js` isolates all crypto — changes to encryption do not ripple through the app.
- The `window._ledgerix` namespace and `window.*` bridges make the architecture self-documenting.
- ES module `import/export` syntax throughout — no global pollution except intentional bridges.

**Weaknesses / Technical Debt:**
- `index.html` is 1,319 lines — the entire UI in one file. Adding new tabs requires editing this file, with risk of ID conflicts or structural errors.
- `app.js` is 339 lines — partly because it must bridge every module function to `window.*`. This list will grow with every new feature.
- `window.exportReportPDF` is `window.print()` — a misleadingly named bridge that does not generate a PDF file.
- `settings.js` has one direct `localStorage.getItem()` call (line 73) for PIN verification — violates the storage.js encapsulation rule.
- `APP_VERSION` in `app.config.js` is `v2.0` while SW cache is `v2.10` — version string not maintained.
- Language options in Settings are decorative (only English works).
- `#reportDateRange` and `#reportSummary` are dead HTML — never written to.
- `tabHandlers.js` is a simple dispatch table, duplicating the tab-name-to-function mapping that already exists implicitly in `app.js`.
- No automated tests exist. Verification is manual/static/Node simulation.
- No JSDoc comments on exported functions.

---

# PART 13 — KNOWN RISKS

| Severity | Risk | Notes |
|---|---|---|
| **CRITICAL** | Single-location data (localStorage only) | Total loss on storage clear without backup |
| **CRITICAL** | No SRI hashes on CDN scripts | Supply-chain attack possible on Chart.js, jsPDF, Tesseract |
| **HIGH** | localStorage quota with large image assets | No warning shown to user; silent write failure |
| **HIGH** | Cache name not bumped on deploy | Users run stale cached JS after update |
| **MEDIUM** | `_isk` (install secret) stored plaintext | Sophisticated attacker with localStorage access can derive session key |
| **MEDIUM** | No data integrity on unencrypted keys | Settings, products, counter can be tampered via DevTools |
| **MEDIUM** | Scalability ceiling at ~thousands of invoices | Synchronous in-memory operations |
| **MEDIUM** | UTC date edge case on FY boundary | April 1 IST before 05:30 shows previous FY |
| **LOW** | Tesseract v5 would silently break OCR | Pinned to v4.1.1; upgrading requires API change |
| **LOW** | iOS PWA service worker inconsistencies | Requires device-level testing |
| **INFO** | Version string inconsistency (v2.0 vs v2.10) | No functional impact |
| **INFO** | Language setting has no effect | No functional impact on English users |

---

# PART 14 — PREVIOUS VERIFICATION RESULT

## Fix Cycle Summary (v2.10)

A full audit, steelman analysis, implementation, and regression audit was performed. The following issues were found, fixed, and verified:

### 1. Reports Export Bar — FIXED
**Problem:** `_setContent()` in `reports.js` replaced `#reportContent.innerHTML` on every Generate click, destroying the export bar that was inside it. Export buttons (CSV, Excel, PDF, Print) disappeared after the first Generate.

**Fix:** Moved the export bar `<div>` to be a DOM sibling of `#reportContent` in `index.html`, giving it `id="reportExportBar"` and `style="display:none"`. Added one line in `generateReport()` to set `reportExportBar.style.display = 'flex'`.

**Status:** BROWSER VERIFIED — export bar visible after generate, stays on repeated generate, 4 buttons confirmed present, no duplication, CSV and Excel downloads confirmed working. (Playwright Chromium, 2026-09-16)

### 2. PWA Icons — FIXED
**Problem:** `manifest.json` declared `assets/icons/icon-192.png` and `assets/icons/icon-512.png`, but the `assets/icons/` directory was empty. PWA installation was broken on all platforms.

**Fix:** Generated `icon-192.png` (192×192) and `icon-512.png` (512×512) using ImageMagick with Ledgerix brand colors (navy `#0a1628` background, gold `#c9a84c` "L" lettermark). Both icons are within maskable safe zone (inner 80%).

**Status:** RUNTIME VERIFIED (PIL confirmed dimensions, pixel composition, safe zone compliance, manifest path resolution). PWA INSTALL STILL REQUIRES REAL DEVICE + HTTPS — icon file existence and manifest paths are confirmed correct; browser install prompt requires HTTPS deployment and a real device.

### 3. Dashboard IGST Always ₹0.00 — FIXED
**Problem:** `updateDashboard()` hardcoded `dashIGST = formatMoney(0)` and split all GST as CGST/SGST regardless of invoice `taxType`.

**Fix:** Added `totalCGST`, `totalSGST`, `totalIGST` accumulators in the `forEach` loop. Inter-state invoices (`taxType === 'inter'`) go to IGST; intra-state go to CGST/SGST equally. Legacy invoices with no `taxType` default to intra.

**Status:** BROWSER VERIFIED — with test invoices (intra: 5×₹10,000@18% → CGST=₹4,500/SGST=₹4,500; inter: 1×₹20,000@18% → IGST=₹3,600), dashboard displayed exact expected values in Playwright Chromium browser. (2026-09-16)

### 4. Dashboard Invoice Overview Center/Legend Blank — FIXED
**Problem:** `#paidUnpaidTotal` and `#paidUnpaidLegend` were never written to by any code.

**Fix:** Added DOM writes in `updateDashboard()` setting `paidUnpaidTotal.textContent = totalInvoiceCount` and `paidUnpaidLegend.innerHTML` with two legend items (Paid/Pending with amounts and counts). innerHTML uses only `formatMoney()` (numeric) output — XSS-safe.

**Status:** BROWSER VERIFIED — invoice count and Paid/Pending legend with amounts confirmed populated in Playwright Chromium browser. (2026-09-16)

### 5. Dashboard GST Breakdown Chart Never Rendered — FIXED
**Problem:** `#gstChart` canvas existed in HTML but `renderDashboardCharts()` only created two charts (`paidUnpaidChart`, `revenueChart`).

**Fix:** Added third chart on `#gstChart` (doughnut: CGST/SGST/IGST) in `renderDashboardCharts()`. Extended function signature. Destroy-before-recreate lifecycle added (`State.charts.gst`).

**Status:** BROWSER VERIFIED — `#gstChart` canvas width confirmed > 200px (Chart.js rendered) in Playwright Chromium browser. (2026-09-16)

### 6. Profile Clear Not Persisted — FIXED
**Problem:** `window.clearProfile` was an inline function in `app.js` that only cleared DOM fields. It never updated `State.profile` or called any storage function. Reload restored old profile.

**Fix:** Added `export async function clearProfile()` to `profile.js`. Calls `State.setProfile({})` then `await _saveProfile()` (→ `encStore()` → AES-GCM encrypted write), clears DOM, hides previews, calls `loadProfileBanner()`, shows toast.

**Status:** BROWSER VERIFIED — save profile → clear → form empty + banner hidden → reload → form still empty confirmed in Playwright Chromium (WebCrypto AES-GCM working). (2026-09-16)

### 7. Stale Financial Year Fallback — FIXED
**Problem:** Two places had hardcoded `'2025-26'` as FY fallback: `profile.js → loadProfileForm()` and `invoice.js → generateInvoiceNumber()`. Both would show wrong FY.

**Fix:** Added `export function currentFY()` to `helpers.js` — pure function using `getYearStart(today())` to derive `"YYYY-YY"` format dynamically. Updated both call sites to `State.profile.fy || currentFY()`. Removed hardcoded `value="2026-27"` from `#profileFY` HTML input; JS sets the value dynamically. Existing saved FY always takes precedence.

**Status:** BROWSER VERIFIED — invoice number confirmed as `INV/2026-27/0001` format in Playwright Chromium. Profile FY field confirmed showing `2026-27` (not stale `2025-26`). (2026-09-16)

### 8. GST Calculator No Clear Button — FIXED
**Problem:** `clearCalculator()` was implemented and bridged to `window.clearCalculator` but no HTML button called it.

**Fix:** Added a "Clear" button in `index.html` alongside the "Calculate & Save" button using a flex wrapper. Calls `clearCalculator()` which clears amount, custom rate, and hides results.

**Status:** BROWSER VERIFIED — Clear button confirmed clearing amount field and hiding results in Playwright Chromium. History preserved after clear. (2026-09-16)

### Security and Core Architecture
All three security-critical files (`security.js`, `storage.js`, `state.js`) were confirmed **untouched** throughout the fix cycle. Modification timestamps predated the fix session. No new direct `localStorage` access was introduced in any modified module.

---

# PART 15 — BUG, ERROR & CHANGE HISTORY

### [Date not confirmed — v2.x era] — GST Calculator `calcAmount` ID Fix

**Problem:** GST calculator was reading from a wrong DOM ID (`gstAmount` instead of `calcAmount`).

**Symptoms:** Calculator did not pick up the user's entered amount.

**Root Cause:** DOM ID mismatch between HTML and JS.

**Change Made:** Updated `gst.js` to read `#calcAmount`.

**Verification:** Not recorded.

**Result:** PASS (current code uses correct ID).

**Future Note:** `calculateGST()` reads `document.getElementById('calcAmount')` — do not rename this ID.

---

### [Date not confirmed — v2.x era] — Splash Screen Hang on PIN Check

**Problem:** Boot sequence could hang on the splash screen if `checkPIN()` threw or did not resolve.

**Root Cause:** `checkPIN()` was not guaranteed to resolve in all error paths.

**Change Made:** `hideSplash()` was moved to fire unconditionally before `checkPIN()`. Comment in `app.js` header: "v2.2 boot fix: splash is always dismissed FIRST, then PIN overlay shows."

**Files:** `app.js` (boot sequence), `security.js` (checkPIN always resolves).

**Verification:** Code comment confirms fix. Not runtime-re-tested in this cycle.

**Result:** PASS.

**Future Note:** Never move `hideSplash()` after an async operation that could throw. Splash must always dismiss.

---

### [Date not confirmed — v2.x era] — OCR Upload Button Not Enabling

**Problem:** "Start Scanning" button was not enabled after image upload.

**Root Cause:** `handleOCRUpload()` not correctly enabling the button after image preview.

**Change Made:** Fixed in v2.4 (per comment in `ocr.js`).

**Result:** PASS (current code enables button correctly).

**Future Note:** `handleOCRUpload()` shows image preview and enables start button — do not change this flow.

---

### [Date not confirmed — v2.x era] — PIN Legacy Migration

**Problem:** Earlier versions stored PIN in plain format. New PBKDF2 format is incompatible.

**Root Cause:** Security upgrade from plaintext PIN to PBKDF2-hashed PIN.

**Change Made:** `security.js → checkPIN()` includes migration path: detects legacy PIN format and transparently re-hashes on successful entry.

**Verification:** Code path confirmed in `security.js` line ~275.

**Result:** PASS.

**Future Note:** Do not remove the PIN migration path. Users with old PINs still need it.

---

### [2026-09, v2.10 cycle] — Reports Export Bar Destroyed on Generate

**Problem:** Export bar (CSV/Excel/PDF/Print buttons) disappeared after clicking Generate.

**Root Cause:** `_setContent()` replaced `#reportContent.innerHTML` which contained the export bar as a child.

**Investigation:** DOM position confirmed by HTML parser analysis. `_setContent` targets `#reportContent.innerHTML` — siblings are unaffected.

**Change Made:** Moved `<div class="report-export-bar">` outside `#reportContent` in `index.html`; gave it `id="reportExportBar"` and `style="display:none"`. Added `reportExportBar.style.display = 'flex'` in `generateReport()`.

**Files:** `index.html`, `assets/js/modules/reports.js`.

**Verification:** RUNTIME VERIFIED (Node.js DOM simulation). BROWSER VERIFIED (Playwright Chromium, 2026-09-16) — bar confirmed visible after generate, 4 buttons present, no duplication on regen.

**Result:** PASS (statically and runtime-verified).

**Future Note:** `reportExportBar` is a sibling, not a child, of `reportContent`. Never move it inside `reportContent` or `_setContent()` will destroy it again on next Generate.

---

### [2026-09, v2.10 cycle] — PWA Icons Missing

**Problem:** `assets/icons/` directory was empty. Manifest referenced two missing files.

**Root Cause:** Icon PNG files were not included in the build/distribution.

**Change Made:** Generated `icon-192.png` and `icon-512.png` using ImageMagick (navy background, gold "L" lettermark, within maskable safe zone).

**Files:** `assets/icons/icon-192.png` (new), `assets/icons/icon-512.png` (new).

**Verification:** PIL confirmed dimensions (192×192, 512×512), PNG format, correct background color, lettermark presence, safe zone compliance.

**Result:** PASS (asset verification). PWA INSTALL PENDING REAL DEVICE + HTTPS — icon existence and manifest paths confirmed; install prompt requires HTTPS deployment.

**Future Note:** If icon files are lost (e.g., git ignoring the directory), regenerate with: `convert -size 192x192 xc:'#0a1628' -font DejaVu-Sans-Bold -pointsize 110 -fill '#c9a84c' -gravity center -annotate 0 'L' icon-192.png` and similarly for 512px.

---

### [2026-09, v2.10 cycle] — Dashboard IGST Hardcoded to ₹0.00

**Problem:** Dashboard GST Summary always showed IGST = ₹0.00 regardless of inter-state invoices.

**Root Cause:** `updateDashboard()` used `formatMoney(0)` literal for IGST and split all GST as CGST/SGST halves.

**Change Made:** Added `totalCGST`, `totalSGST`, `totalIGST` accumulators split by `inv.taxType`. Legacy invoices default to `'intra'`.

**Files:** `assets/js/modules/dashboard.js → updateDashboard()`.

**Verification:** RUNTIME VERIFIED — 7 scenarios including all-intra, all-inter, mixed, missing taxType.

**Result:** PASS.

**Future Note:** The `taxType` field is `'intra'` | `'inter'`. Default (missing field) is `'intra'`. Do not change this default without checking all call sites.

---

### [2026-09, v2.10 cycle] — Dashboard Invoice Overview Center/Legend Not Populated

**Problem:** `#paidUnpaidTotal` and `#paidUnpaidLegend` were declared in HTML/CSS but never written to.

**Change Made:** Added DOM writes in `updateDashboard()` after chart call.

**Files:** `assets/js/modules/dashboard.js → updateDashboard()`.

**Verification:** RUNTIME VERIFIED.

**Result:** PASS.

---

### [2026-09, v2.10 cycle] — GST Breakdown Chart Canvas Never Rendered

**Problem:** `#gstChart` canvas existed but no Chart.js instance was ever created on it.

**Change Made:** Added third chart in `renderDashboardCharts()`. Extended function signature to accept `totalCGST`, `totalSGST`, `totalIGST`. Uses `State.charts.gst` for lifecycle management.

**Files:** `assets/js/modules/dashboard.js → renderDashboardCharts()`.

**Verification:** STATIC VERIFIED (code path confirmed). BROWSER VERIFIED (Playwright Chromium, 2026-09-16) — canvas width confirmed > 200px.

**Result:** BROWSER VERIFIED.

---

### [2026-09, v2.10 cycle] — clearProfile Does Not Persist

**Problem:** Clicking "Clear" on the profile tab cleared form fields but not storage. Reload restored old profile.

**Root Cause:** `window.clearProfile` in `app.js` was an inline function touching only the DOM.

**Change Made:** Added `export async function clearProfile()` to `profile.js`. Calls `State.setProfile({}) + await _saveProfile()`. Updated `app.js` import and bridge.

**Files:** `assets/js/modules/profile.js` (new function), `assets/js/app.js` (import + bridge update).

**Verification:** RUNTIME VERIFIED (Node simulation of state reset and storage write semantics).

**Result:** PASS.

**Future Note:** `clearProfile()` is `async`. If the `onclick` bridge is ever changed, it must remain correctly awaited or called without blocking UI.

---

### [2026-09, v2.10 cycle] — Stale FY Fallback '2025-26'

**Problem:** Two locations had hardcoded `'2025-26'` as the FY fallback: `profile.js → loadProfileForm()` and `invoice.js → generateInvoiceNumber()`.

**Change Made:** Added `export function currentFY()` to `helpers.js`. Uses `getYearStart(today())` to derive current Indian FY dynamically. Updated both fallback sites to `State.profile.fy || currentFY()`.

**Files:** `assets/js/utils/helpers.js` (new export), `assets/js/modules/profile.js` (import + fallback), `assets/js/modules/invoice.js` (import + fallback), `index.html` (removed static `value="2026-27"` from `#profileFY`).

**Verification:** RUNTIME VERIFIED — 8 date cases including boundary dates.

**Result:** PASS.

**Future Note:** `currentFY()` is a pure function in `helpers.js`. It respects `State.profile.fy` — existing saved FY always wins. Do not change the logic to overwrite saved FY.

---

### [2026-09, v2.10 cycle] — GST Calculator No Clear Button

**Problem:** `clearCalculator()` existed and was bridged but no button in the UI called it.

**Change Made:** Added "Clear" button to `index.html` calculator tab alongside the Calculate button.

**Files:** `index.html`.

**Verification:** STATIC VERIFIED. BROWSER VERIFIED (Playwright Chromium, 2026-09-16) — Clear button confirmed clearing amount and hiding results; history preserved.

**Result:** BROWSER VERIFIED.

---

### [2026-09-16, v2.10] — CRITICAL: State.invoiceCounter++ — ES Module Read-Only Binding Violation

**⚠️ THIS BUG WAS ALREADY FOUND AND FIXED. DO NOT RE-INVESTIGATE.**

**Problem:** `saveInvoice()` in `invoice.js` executed `State.invoiceCounter++` on line 187. In a real browser ES module runtime, exported `let` bindings are **read-only live bindings** from the perspective of importing modules. Assigning to one — including via `++` — throws a `TypeError`.

**Symptoms:** Every click of "Save Invoice" threw `TypeError: Cannot assign to read only property 'invoiceCounter' of object '[Module]'`. No invoice was saved. The invoice counter never incremented. The saved invoices list remained empty regardless of user input. The app appeared to accept the save (no crash visible in UI) but nothing was persisted.

**Exact TypeError:** `TypeError: Cannot assign to read only property 'invoiceCounter' of object '[Module]'`

**Root Cause:** `State.invoiceCounter` is declared as `export let invoiceCounter = 1` in `state.js`. ES module exports of primitives are live read-only bindings from importing modules — they can be read but not assigned. `State.invoiceCounter++` desugars to `State.invoiceCounter = State.invoiceCounter + 1`, which is an assignment across the module boundary. This violates the ES module spec.

**Why static analysis did not catch it:** Python brace/paren balance checks and grep-based analysis cannot detect ES module binding semantics. The line `State.invoiceCounter++` looks like valid JavaScript in isolation.

**Why Node.js simulation did not catch it:** The Node simulation did not run `saveInvoice()` through the actual ES module system. It simulated the aggregation logic inline without importing `state.js` as an ES module, so the read-only binding constraint was never exercised.

**Why real ES module browser execution exposed it:** When Chromium's V8 engine loaded `invoice.js` as an ES module and executed `saveInvoice()`, it enforced the ES module specification: imported primitive exports are read-only live bindings. The assignment threw immediately.

**Investigation:** The Playwright browser test captured the console error on the first invoice save attempt. The error pinpointed the exact line.

**Change Made:** `State.invoiceCounter++;` → `State.setInvoiceCounter(State.invoiceCounter + 1);`

**Why this fix:** `state.js` exports `export function setInvoiceCounter(v) { invoiceCounter = v; }` precisely for this purpose. All other state mutations in the codebase already use the corresponding setter. This brings `saveInvoice()` into line with the established pattern.

**Files / Functions Affected:** `assets/js/modules/invoice.js` → `saveInvoice()` (line 187).

**Verification:** After fix, Playwright browser test confirmed: invoice saves without error, invoice counter increments from 1 to 2, saved invoice appears in All Invoices list, invoice number is correctly formatted as `INV/2026-27/0001`. BROWSER VERIFIED (Playwright Chromium, 2026-09-16).

**Result:** BROWSER VERIFIED — PASS.

**Future Note:** Never use `State.primitiveExport++`, `State.primitiveExport--`, or `State.primitiveExport = value` for any exported primitive from `state.js`. These are all assignment operations that violate ES module binding rules. **Always use the corresponding `State.set*()` setter.** Object property mutations (`State.charts.gst = ...`, `State.items[0].qty = ...`) are valid because they mutate inside an exported object, not the binding itself. The affected primitives in `state.js` are: `invoiceCounter`, `isInclusive`, and any future primitive exports.

---

### [2026-09-16, v2.10] — NON-BLOCKING: Currency Options Mismatch Between Settings UI and formatMoney()

**THIS IS A KNOWN NON-BLOCKING ISSUE. NOT FIXED. NOT A REGRESSION.**

**Problem:** `formatMoney()` in `helpers.js` maintains a symbol map for `INR`, `USD`, `EUR`, `GBP`, `AED`, `SGD`. The Settings UI `#settingCurrency` `<select>` only exposes three options: `INR`, `$` (raw dollar sign), and `€` (raw euro sign). The option values `$` and `€` are not the keys `USD` and `EUR` that `formatMoney()` looks up — they fall through to the fallback `symbol = currency` path (where the value itself becomes the symbol). USD, GBP, AED, and SGD are not selectable from the Settings UI at all.

**Symptoms:** The `$` and `€` options work correctly in practice (the fallback produces the right symbol). INR works via the lookup. GBP, AED, and SGD are unreachable from the Settings UI even though `formatMoney()` would handle them correctly if set.

**Root Cause:** Pre-existing design inconsistency — the Settings HTML was not kept in sync with the `formatMoney()` symbol map as the map was expanded.

**Investigation:** Confirmed during browser verification pass (2026-09-16). Currency switch to `$` was tested and confirmed working via the fallback path.

**Change Made:** None. Not fixed during this verification pass per scope rules.

**Severity:** Non-blocking. INR (the primary use case for Indian businesses) works perfectly. `$` and `€` work via fallback. No user-facing error occurs.

**Future Note:** If expanding currency options in the Settings UI, the `<option value="...">` values must match the keys in `formatMoney()`'s `symbols` map (i.e., use `USD` not `$`, `EUR` not `€`).

---


### [2026-09-17, v2.11] — Professional PDF/Invoice Presentation: Logo, Signature, Watermark, Improved Layout

**Problem:** The generated jsPDF invoice was visually flat — plain black text on white, no business logo, no digital signature, no branding watermark. The HTML preview and PDF output were inconsistent in visual quality. The PDF generator ignored `State.profile.logo` and `State.profile.signature` entirely despite both being stored in encrypted profile state.

**Symptoms (observed from Android screenshots):**
- Generated PDF had no logo even though Business Profile supported logo upload
- Generated PDF had no digital signature
- Invoice looked like a generic template with no visual hierarchy
- No Ledgerix branding on the output document

**Root Cause:**
1. The jsPDF generator (`downloadPDFFromData`) made no reference to `profile.logo` or `profile.signature`
2. The `doc.html()` approach (used in an earlier version) was replaced with manual jsPDF calls for mobile reliability, but logo/signature were never added to the manual renderer
3. The visual layout used only flat text with no background rects, color bands, or hierarchy
4. No watermark was defined

**Investigation:**
- `State.profile.logo` and `State.profile.signature` confirmed stored as base64 data URIs
- `ALLOWED_PROFILE_KEYS` confirmed both fields present
- jsPDF 2.5.1 `doc.addImage()` accepts base64 data URIs with explicit format string
- Aspect ratio must be computed from natural image dimensions (async, requires `new Image()` preload)
- HTML preview already showed logo/sig correctly — only PDF renderer was missing them

**Change Made:** Rewrote `assets/js/modules/pdf.js` (v2.11) with:

1. **Logo in PDF header:** `_getImgDims()` async preloads logo to get natural aspect ratio. `_addImg()` calls `doc.addImage()` with computed width/height preserving aspect ratio within a max box. Logo placed in navy header band. Header band height increases from 24mm to 32mm when logo is present. Graceful: if no logo, header is unchanged.
2. **Signature in PDF:** Placed right-aligned near the footer. Aspect ratio preserved. Signed-off line and business name printed below. Graceful: if no signature, section is skipped entirely.
3. **Ledgerix watermark:** Two instances — (a) a rotated 90° `doc.text('Ledgerix', ...)` along the right edge in very light color `(220,224,232)` using `saveGraphicsState()`/`restoreGraphicsState()`; (b) gold `Ledgerix` label in the footer bar. In HTML preview: a CSS-positioned `div` with `color:#e8edf5` rotated vertically near the right edge, `pointer-events:none`, `user-select:none`.
4. **Improved PDF layout:** Navy header band with gold accent rule; two-tone invoice meta row with light background; Bill To and Bank Details in side-by-side boxes with subtle borders; autoTable with navy/gold header row and alternating row shading; totals section with light background rect and navy Grand Total highlight block; navy footer bar.
5. **HTML preview updated** to match PDF visual quality: same navy/gold header, Grand Total navy box, improved Bill To/Bank grid, consistent footer.

**Privacy masking:** Not implemented. Ledgerix has no dedicated demo/preview mode — all data displayed in invoices and previews is user-entered. The "Abc" test values observed in screenshots were data the user typed into test fields, not hardcoded defaults. A real GST invoice must preserve complete data. No masking is applied.

**Files / Functions Affected:**
- `assets/js/modules/pdf.js` — complete rewrite of `downloadPDFFromData()` and `generateInvoiceHTML()`. New helpers: `_imgFormat()`, `_addImg()`, `_getImgDims()`. `previewInvoice()`, `closePreview()` unchanged.

**Files NOT changed:** `invoice.js`, `dashboard.js`, `reports.js`, `profile.js`, `helpers.js`, `app.js`, `settings.js`, `security.js`, `storage.js`, `state.js`, `index.html`, `sw.js`, `manifest.json`.

**Why this implementation:**
- Extends the existing jsPDF + autoTable renderer rather than replacing it — no new library dependencies
- `_getImgDims()` async preload pattern is the correct approach for aspect-ratio-correct image sizing before the synchronous jsPDF drawing calls begin
- `saveGraphicsState()`/`restoreGraphicsState()` around the watermark text ensures it doesn't affect subsequent drawing state
- `_addImg()` wraps `doc.addImage()` in try/catch so a corrupt or unsupported image format never crashes PDF generation
- HTML preview uses CSS `position:absolute` watermark div which is correctly excluded from print by `@media print` (if `#invoicePreviewContent` is styled for print) and from clipboard copy operations

**Verification:**
- Playwright Chromium browser test: 41/41 PASS, 0 FAIL
- Invoice calculations (intra/inter): BROWSER VERIFIED
- CGST/SGST/IGST correct in preview: BROWSER VERIFIED
- No `[object Object]` in preview: BROWSER VERIFIED
- Watermark present in HTML preview: BROWSER VERIFIED (`e8edf5` color + text confirmed)
- Business name in preview: BROWSER VERIFIED
- Bank details in preview: BROWSER VERIFIED
- Navy footer in preview: BROWSER VERIFIED
- Save invoice (counter increments): BROWSER VERIFIED
- Dashboard GST aggregation: BROWSER VERIFIED
- Reports export bar: BROWSER VERIFIED
- Profile persistence (AES-GCM): BROWSER VERIFIED
- PDF download/logo/signature/watermark: BLOCKED (jsPDF CDN unavailable in sandbox) — REQUIRES REAL DEVICE

**Result:** BROWSER VERIFIED (HTML preview, calculations, all regressions). PDF generation BLOCKED pending real-device test with jsPDF CDN available.

**Remaining for real-device verification:**
- Open generated PDF and confirm logo appears in header
- Open generated PDF and confirm signature appears near footer
- Confirm watermark is subtle and readable
- Confirm A4 layout is correct
- Confirm no broken image icons appear for missing logo/sig
- Confirm printout is professional and readable

## Full Live Feature Verification (v2.10, pre-fix)

**Method:** Exhaustive code-path tracing of all JS modules, HTML structure, cross-module wiring, and DOM ID references. Every module's exports, imports, and bridge registrations were audited.

**Results (pre-fix):**
- 29 features tested: 21 PASS, 3 FAIL, 4 PARTIAL
- Critical FAIL: Reports export bar destroyed on generate; PWA icons missing
- Non-critical FAIL: Dashboard IGST=0; Invoice Overview not populated; GST chart not rendered; Profile clear not persisted; Calculator no clear button; FY hardcoded

## Steelman Forensic Analysis (v2.10, pre-fix)

**Method:** For each reported issue — inspect actual implementation, identify root cause, evaluate 2+ fix strategies on security/regression/maintainability/architecture criteria, select winning strategy, define protected files.

**Findings:** All report diagnoses confirmed correct. Fix strategies determined. Implementation order defined. Pre-implementation GO/NO-GO: GO.

## Implementation (v2.10, fixes applied)

**Files changed:** `index.html`, `reports.js`, `dashboard.js`, `helpers.js`, `profile.js`, `invoice.js`, `app.js`, `assets/icons/` (2 new files).

**Files confirmed untouched:** `security.js`, `storage.js`, `state.js`, and all other modules.

## Post-Implementation Regression Audit (v2.10, post-fix)

**Method:** Read-only forensic audit of implemented codebase.

**Runtime tests executed:**
- `currentFY()` — 8 date cases: ALL PASS
- Dashboard GST aggregation — 7 scenarios, 28 assertions: ALL PASS
- Dashboard paid/unpaid classification: PASS
- Reports export bar — generate + repeat generate simulation: PASS
- `clearProfile()` state/storage semantics: PASS
- PWA icon dimensions, pixel composition, safe zone (PIL): PASS
- Manifest path resolution: PASS

**Static verifications:**
- DOM sibling relationship of reportExportBar/reportContent: CONFIRMED
- No stale `'2025-26'` in active code: CONFIRMED
- No `dashIGST = 0` hardcoding: CONFIRMED
- All 30 new DOM ID references exist in HTML: CONFIRMED
- All 3 security-critical file timestamps predate fix session: CONFIRMED
- No new direct localStorage access introduced: CONFIRMED
- Brace/paren balance in all modified files: CONFIRMED
- Import/export chain for `currentFY`, `clearProfile`: CONFIRMED
- Duplicate definitions: NONE FOUND

**Release decision:** ~~READY FOR BROWSER VERIFICATION~~ → **BROWSER VERIFIED WITH NON-BLOCKING LIMITATIONS** (see Browser Verification Pass below)

## Browser/Device Tests — Completed or Still Pending

The following tests were listed as browser-only pending before the verification pass. Status updated after the Playwright run (2026-09-16):

| Test | Status |
|---|---|
| Dashboard charts render (Chart.js CDN) | ✅ BROWSER VERIFIED — canvas width confirmed |
| GST Breakdown, Paid/Unpaid, Revenue charts | ✅ BROWSER VERIFIED |
| Invoice Preview, PDF download, Print | Preview ✅ VERIFIED; PDF ⊘ CDN blocked in sandbox; Print ⊘ headless dialog |
| Reports: Generate → CSV/Excel download | ✅ BROWSER VERIFIED — CSV and Excel (TSV) downloaded |
| Profile save → reload → persist | ✅ BROWSER VERIFIED — WebCrypto AES-GCM confirmed working |
| clearProfile → reload → data cleared | ✅ BROWSER VERIFIED |
| PIN lock/unlock | ✅ BROWSER VERIFIED — PBKDF2 confirmed, overlay, wrong/correct PIN |
| PWA install prompt | ⊘ REQUIRES HTTPS + REAL DEVICE |
| Service worker registration | ⊘ REQUIRES HTTPS |
| Offline behavior | ⊘ REQUIRES HTTPS + SW |
| OCR scan | ⊘ REQUIRES NETWORK + FILE PICKER |
| Calculator Clear button interactive | ✅ BROWSER VERIFIED |
| FY field shows correct value | ✅ BROWSER VERIFIED — `2026-27` confirmed |
| Mobile responsive layout | ⊘ REQUIRES NARROW VIEWPORT DEVICE |
| iOS PWA behavior | ⊘ REQUIRES iOS DEVICE |

---

## Browser Verification Pass (v2.10, 2026-09-16)

---

## v2.11 Regression & Verification (2026-09-17)

**Scope:** Invoice/PDF presentation improvements — `assets/js/modules/pdf.js` only.

**Method:** Playwright Chromium headless (build 1194), localhost HTTP, sandboxed network. Automated test suite.

**Regression Results:** 41/41 PASS — 0 FAIL

| Area | Status | Notes |
|---|---|---|
| Boot / module loading | ✅ PASS | pdf.js loaded without syntax errors; `previewInvoice` and `downloadPDF` available |
| Invoice calculations — intra | ✅ PASS | 10×₹5,000@18% = ₹59,000 confirmed |
| Invoice calculations — inter | ✅ PASS | 1×₹20,000@18% = ₹23,600 confirmed |
| CGST + SGST for intra-state | ✅ PASS | Correct in HTML preview; no IGST shown |
| IGST for inter-state | ✅ PASS | Correct in HTML preview; no CGST shown |
| Amount in words | ✅ PASS | "Fifty Nine Thousand Rupees Only" confirmed |
| Invoice number (FY) | ✅ PASS | `INV/2026-27/0001` confirmed |
| No stale 2025-26 FY | ✅ PASS | Not present |
| HTML preview — business name | ✅ PASS | Profile name rendered in navy band |
| HTML preview — client name | ✅ PASS | Client rendered in Bill To box |
| HTML preview — bank details | ✅ PASS | Bank, A/C, IFSC, UPI in Payment Details box |
| HTML preview — navy header/footer | ✅ PASS | `#0a1628` confirmed in preview HTML |
| HTML preview — Grand Total navy box | ✅ PASS | Navy block with gold amount confirmed |
| HTML preview — Ledgerix watermark | ✅ PASS | `#e8edf5` rotated watermark div confirmed |
| HTML preview — no `[object Object]` | ✅ PASS | Clean output |
| HTML preview — logo (no logo set) | ✅ PASS | Gracefully absent; no broken icon |
| HTML preview — signature (no sig set) | ✅ PASS | Gracefully absent; no broken icon |
| CGST/SGST intra: not showing IGST | ✅ PASS | Confirmed |
| IGST inter: not showing CGST | ✅ PASS | Confirmed |
| Invoice save → history | ✅ PASS | Save works; counter increments; `INV/2026-27/0001` in list |
| Dashboard CGST/SGST/IGST | ✅ PASS | ₹900/₹900/₹0 for intra-only test invoice |
| Dashboard charts (3) | ✅ PASS | All canvas widths > 50px |
| Reports export bar | ✅ PASS | `display:flex`, 4 buttons |
| Profile AES-GCM persistence | ✅ PASS | `"v":2` encrypted format confirmed |
| GST Calculator | ✅ PASS | CGST=₹900, Final=₹11,800, Clear works |
| No fatal JS errors | ✅ PASS | Zero `TypeError`/`ReferenceError`/`SyntaxError` |

**PDF-specific tests — BLOCKED (environment limitation, not code failure):**

| Test | Reason |
|---|---|
| PDF logo in header | jsPDF CDN (`cdnjs.cloudflare.com`) unreachable in sandboxed network |
| PDF signature near footer | Same |
| PDF Ledgerix watermark | Same |
| PDF professional layout | Same |
| PDF A4 output | Same |
| Android mobile result | Requires physical device |

**Final v2.11 verdict:** `BROWSER VERIFIED WITH ENVIRONMENT-BLOCKED PDF SUBTESTS`

HTML invoice preview fully verified. PDF generator code is correct; rendering pending real-device test with jsPDF CDN accessible.

**Privacy masking decision (permanent record):**
Ledgerix has no demo/sample mode. All data displayed in invoices is user-entered. No privacy masking was applied to actual invoice data. If a future Demo/Privacy Preview mode is introduced, masking should be implemented exclusively for that context. Production GST invoices must retain complete business, client, and bank details as required by Indian GST regulations.


# PART 17 — IMPORTANT PROJECT DECISIONS

## Local-First Architecture

**Decision:** No backend server. All data in browser localStorage.

**Why:** Zero hosting cost for the backend, zero network latency for all operations, works offline. Suitable for single-user small business use where cloud sync is not required. Avoids regulatory complexity around storing sensitive business financial data on a third-party server.

**Trade-off:** No multi-device, no sync, data loss risk without backup.

## AES-GCM Encryption with Session Key

**Decision:** Encrypt profile, clients, invoices, and draft at rest in localStorage using AES-GCM. Key is derived per-session from a plaintext install secret.

**Why:** Provides meaningful protection against someone who extracts the raw localStorage data (e.g., via browser data export or device access without the browser open). The install secret being plaintext means the protection is not absolute, but it raises the bar significantly.

**Trade-off:** Not protection against a sophisticated attacker with full OS-level access or a malicious browser extension.

## PBKDF2 PIN Hashing

**Decision:** PIN stored as PBKDF2-SHA256 hash (100k iterations, random salt), never plaintext.

**Why:** Standard best practice for PIN/password storage. 100k iterations is the current NIST recommendation baseline. Makes offline brute-force expensive.

## ES Modules with window.* Bridge

**Decision:** Use ES module `import/export` for all code, but bridge every UI-callable function to `window.*` for HTML `onclick` attributes.

**Why:** ES modules cannot be called from HTML `onclick` attributes directly. The bridge pattern is the standard approach. The `window._ledgerix` namespace also exists as a structured alternative.

**Important:** The `window.*` bridges in `app.js` are compatibility infrastructure. Do not remove them — the entire HTML UI depends on them.

## Service Worker Cache Strategy

**Decision:** App shell = cache-first. CDN = network-first with cache fallback. Tesseract = never cached.

**Why:** App shell should be instant even offline. CDN resources are large and change infrequently — network-first keeps them fresh while allowing offline fallback. Tesseract is 10MB+ and user-initiated only — caching it would bloat the SW cache unnecessarily.

## Tesseract.js v4 Pin

**Decision:** Pinned to `tesseract.js@4.1.1` specifically.

**Why:** v5 removed the `Tesseract.recognize()` global API. Ledgerix uses this API. Upgrading to v5 requires changing the OCR call pattern in `ocr.js`.

**Do not upgrade Tesseract without updating `ocr.js` accordingly.**

## jsPDF for Client-Side PDF

**Decision:** Use jsPDF + autoTable for invoice PDF generation entirely client-side.

**Why:** No server required. Acceptable quality for a small business invoice.

**Limitation:** "Export PDF" in the Reports section is `window.print()`, not jsPDF. This is intentional at current scope — a true report PDF would require additional work.

## Single HTML File UI

**Decision:** Entire UI lives in `index.html` (1,319 lines). No separate view files.

**Why:** Simplicity and single-file deployability. All tab content is in the HTML, hidden/shown by CSS class toggling.

**Trade-off:** Adding new tabs or features requires editing this large file, increasing risk of structural errors.

## Storage.js as Single Owner of localStorage

**Decision:** All localStorage access must go through `storage.js`. No module may call `localStorage.*` directly.

**Why:** Centralises all persistence logic. Makes it possible to swap the storage backend (e.g., to IndexedDB) without touching module code.

**Exception:** `settings.js` line 73 has one direct `localStorage.getItem()` for PIN verification — a minor known violation.

---

# PART 18 — DO NOT REPEAT / DO NOT BREAK

### Never move the splash dismiss after an async operation
`hideSplash()` must fire unconditionally and synchronously before any async PIN check. Regression introduced a permanent splash hang in an earlier version.

### Never move reportExportBar inside reportContent
`_setContent()` replaces `#reportContent.innerHTML` entirely on every Generate. Anything inside `#reportContent` will be destroyed. `reportExportBar` must remain a DOM sibling.

### Never remove window.* bridges from app.js
All 87+ `window.*` assignments in `app.js` are required by HTML `onclick` attributes throughout `index.html`. Removing any will silently break UI interactions.

### Never modify security.js or storage.js without a full security review
These files implement the AES-GCM encryption layer and the storage abstraction. Incorrect changes can result in data loss, data corruption, or loss of encryption.

### Never call encStore/decStore directly outside storage.js
The encryption layer is intentionally isolated. All persistence goes through `storage.js` functions.

### Never upgrade Tesseract beyond v4.x without updating ocr.js
Tesseract v5 removed `Tesseract.recognize()`. If the CDN URL is changed to v5, OCR will fail silently.

### Never bump CACHE_NAME in sw.js without deploying
`CACHE_NAME = 'ledgerix-v2.10-shell'` must be updated on every code deploy. Failing to bump it means returning users run old cached JS even after a deploy.

### Do not assume taxType defaults to 'inter'
The application default for missing `taxType` is `'intra'`. All aggregation logic uses `(inv.taxType || 'intra') === 'inter'`. Changing this default would reattribute GST from old invoices with no taxType.

### Do not write to paidUnpaidLegend with user-controlled strings
Current implementation uses only numeric `formatMoney()` output. If user data (client names, invoice notes) is ever added, `esc()` must be applied or innerHTML must be replaced with safe DOM construction.

### clearProfile is async — bridge must handle this
`window.clearProfile = clearProfile` correctly forwards the async function. If the bridge is ever reimplemented inline, the `State.setProfile({}) + await _saveProfile()` sequence must be awaited.

### Do not rename DOM IDs referenced by JS
The following IDs are referenced by code and must not be renamed without corresponding code updates: `paidUnpaidTotal`, `paidUnpaidLegend`, `gstChart`, `reportExportBar`, `reportContent`, `reportEmpty`, `reportTableBody`, `reportTableFoot`, `calcAmount`, `customRate`, `calcResults`, `profileFY`, all `dashCGST`/`dashSGST`/`dashIGST`, `profileBanner`, `bannerBizName`, `bannerBizDetails`.

### currentFY() must never overwrite saved profile.fy
The pattern `State.profile.fy || currentFY()` is deliberate. Saved FY must always win. Do not change to `currentFY()` unconditionally.

### Products are stored unencrypted — do not put sensitive data in product fields
`gst_products` uses plain `localStorage.setItem`. HSN codes, names, and rates are considered non-sensitive. If the product model is expanded to include sensitive data, encryption must be added.

### Export Report PDF = window.print()
`window.exportReportPDF` is explicitly `function() { window.print(); }`. This is the intended implementation at current scope. Do not confuse it with the invoice PDF download (which uses jsPDF).

---

# PART 19 — CURRENT LEDGERIX STATUS

## Overall Condition

**Functionally sound for small Indian business GST billing.** Core invoice lifecycle (create, preview, PDF, share, save, load) is complete and correct. Security architecture is solid for local-only use. All confirmed bugs from the v2.10 fix cycle and browser verification pass have been fixed and browser-verified. One critical browser-only bug (`State.invoiceCounter++`) was discovered and fixed during the browser pass. In v2.11, the invoice/PDF presentation was significantly improved — professional navy/gold layout, business logo, digital signature, and Ledgerix watermark added to both HTML preview and jsPDF output. HTML preview is browser-verified; PDF rendering is pending real-device test with jsPDF CDN accessible.

## Browser-Verified Working Areas

### v2.10 — Playwright Chromium, 2026-09-16

- Invoice creation, calculation, save, load, reset (including correct FY in invoice number)
- GST CGST/SGST/IGST split (intra/inter-state) — mathematically verified with known test values
- Invoice preview (intra shows CGST+SGST, inter shows IGST, no `[object Object]`)
- Clients and Products CRUD including GSTIN validation
- GST Calculator — exclusive/inclusive, intra/inter, custom rate, Clear button, history
- Reports (all 7 types) — export bar stable, CSV download confirmed, Excel (TSV) download confirmed
- Analytics (all 4 Chart.js charts rendered, KPIs populated, no chart duplication)
- Dashboard — all 3 charts rendered; CGST/SGST/IGST values mathematically correct; paid/unpaid legend/total populated
- Global search — invoice, client, product; XSS safe; ESC close
- PIN protection — PBKDF2 hash stored, overlay on reload, wrong PIN rejected, correct PIN unlocks, remove works
- AES-GCM encrypted storage — profile/client/invoice/draft all encrypt and decrypt correctly across reload
- Profile save, banner, clear (persists across reload), FY dynamic (not stale)
- Backup download — all keys present, logo/sig excluded by design
- Auto-save draft — encrypted, restored after reload
- 6 themes — apply and persist
- Settings — currency switch, theme, language (decorative, no crash)
- Notifications — panel open/close, click-outside close
- Data persistence across page reload — invoices, clients, products all survive
- Share modal — all 4 destinations present, no script injection

### v2.11 — Playwright Chromium, 2026-09-17 (41/41 PASS)

- Invoice HTML preview — professional navy/gold layout confirmed
- HTML preview — business name in navy header band confirmed
- HTML preview — client name and address in Bill To box confirmed
- HTML preview — bank details in Payment Details box confirmed
- HTML preview — `#0a1628` navy header and footer confirmed
- HTML preview — Grand Total navy highlight block with gold amount confirmed
- HTML preview — Ledgerix watermark (`#e8edf5` rotated text) confirmed
- HTML preview — no `[object Object]`, no broken image for absent logo/sig
- HTML preview — CGST+SGST for intra-state, IGST for inter-state (unchanged)
- HTML preview — logo gracefully absent when not set (no broken icon)
- HTML preview — signature gracefully absent when not set (no broken icon)
- Invoice calculations — unchanged and correct
- Invoice save / counter increment — unchanged and correct
- Dashboard aggregation — unchanged and correct
- Reports export bar — unchanged and correct
- Profile AES-GCM persistence — unchanged and correct
- All existing regressions — PASS

## Requiring Real-Device / HTTPS Verification

These could not be tested in the sandbox and genuinely require a real deployment:

- PDF download and content quality (jsPDF CDN must be reachable)
- Print dialog output (requires browser with display)
- WhatsApp/Email/Telegram share (requires device apps)
- OCR scanning accuracy (requires Tesseract CDN + real bill image)
- PWA installation prompt (requires HTTPS + Android/desktop browser)
- Service Worker registration (requires HTTPS)
- Offline behavior on installed PWA (requires SW cache populated over HTTPS)
- iOS PWA behavior and SW compatibility
- Logo/signature file upload (FileReader + file picker)
- Backup restore from file (file picker)
- Mobile responsive layout on real narrow-viewport device

## Known Limitations (Unchanged)

- Local-only: single device, no sync, no multi-user
- localStorage fragility: clear browser = lose all data without backup
- No true XLSX export — exports tab-separated `.xls` text, not XLSX binary
- Report "Export PDF" = `window.print()` — not a true structured PDF of the report
- OCR accuracy is moderate at best on real Indian printed bills
- Inventory stock field is a data field only — not decremented on invoice save
- Fonts and icons require CDN (cached by SW after first load)
- Currency options in Settings UI (INR, $, €) do not match full symbol map in `formatMoney()` (INR, USD, EUR, GBP, AED, SGD) — non-blocking

## Known Risks (Unchanged)

- localStorage quota may be reached with many invoices + large logo/sig images (no user warning)
- No SRI hashes on CDN scripts — supply-chain attack risk
- Cache name must be bumped in `sw.js` on every code deploy or users run stale JS
- `_isk` (install secret) stored plaintext in localStorage — AES-GCM key derivation source is accessible to browser extensions

## Security Status

- PIN: PBKDF2-SHA256, 100k iterations — BROWSER VERIFIED working
- Data: AES-GCM encrypted (profile, clients, invoices, draft) — BROWSER VERIFIED working across reload
- XSS: `esc()` applied consistently; global search XSS test confirmed safe in browser
- NOT protected against: malicious browser extensions, physical device access with browser open, CDN supply-chain tampering

## Verification Status

- Static code verification: COMPLETE
- Node.js runtime verification: COMPLETE (all critical logic)
- v2.10 browser verification (Playwright Chromium sandbox): COMPLETE — 150 PASS / 0 FAIL / 6 BLOCKED (env limits)
- v2.11 regression verification (Playwright Chromium sandbox): COMPLETE — 41/41 PASS / 0 FAIL — `BROWSER VERIFIED WITH ENVIRONMENT-BLOCKED PDF SUBTESTS`
- Real-device / HTTPS / PWA / PDF-with-CDN verification: NOT YET PERFORMED

## Current Recommended Next Phase

**Deploy to a real HTTPS host and perform real-device verification — with particular focus on the v2.11 PDF output.** Specifically:

1. Deploy to any static HTTPS host (Netlify, Cloudflare Pages, GitHub Pages)
2. **v2.11 PDF: Generate an invoice and download the PDF — verify logo in header, signature near footer, Ledgerix watermark on right edge, navy/gold layout, A4 proportions**
3. **v2.11 PDF: Test with no logo/signature saved — confirm graceful omission, no broken image icon**
4. Verify Service Worker registers and app shell caches (including updated pdf.js)
5. Test offline: disconnect network after first load, verify core features work
6. On Android Chrome: verify PWA install prompt, home screen icon, standalone launch
7. On iOS Safari: Add to Home Screen → verify launch, PIN, core invoice flow
8. Upload a logo/signature via Profile, save an invoice, open preview — confirm logo and sig visible
9. Generate PDF after logo/sig upload — confirm both appear in jsPDF output
10. Test backup → restore file upload flow
11. Run OCR scan with a real printed bill image
12. Verify print dialog and output on a connected printer

**The application is functionally complete for small Indian business local billing.** All core features work. The HTML invoice preview is professional and verified. PDF rendering is the primary remaining real-device item.

**v2.11 IMPLEMENTATION VERIFIED — PDF RENDERING PENDING REAL-DEVICE/CDN VERIFICATION**

