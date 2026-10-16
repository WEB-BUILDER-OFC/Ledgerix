# Ledgerix v2.11.4 — GST Billing & Business Management

Professional, enterprise-grade GST billing application for Indian businesses.

---

## Project Structure

```
Ledgerix/
├── index.html                    # Application shell (HTML only)
├── manifest.json                 # PWA manifest
├── README.md
│
├── assets/
│   ├── css/
│   │   └── main.css              # All application styles
│   │
│   ├── js/
│   │   ├── app.js                # Entry point — bootstraps all modules
│   │   │
│   │   ├── core/                 # Framework-level services
│   │   │   ├── state.js          # Single source of truth (all mutable state)
│   │   │   ├── storage.js        # localStorage read/write (encrypted)
│   │   │   └── security.js       # AES-GCM encryption, PBKDF2 PIN hashing
│   │   │
│   │   ├── modules/              # Feature modules (one per domain)
│   │   │   ├── dashboard.js      # Dashboard KPIs and charts
│   │   │   ├── invoice.js        # Invoice builder, save, PDF, list
│   │   │   ├── clients.js        # Client CRUD
│   │   │   ├── products.js       # Product CRUD
│   │   │   ├── notifications.js  # Notification system
│   │   │   ├── profile.js        # Business profile
│   │   │   ├── settings.js       # App settings, PIN, theme
│   │   │   ├── gst.js            # GST calculator
│   │   │   ├── pdf.js            # PDF generation (jsPDF)
│   │   │   ├── reports.js        # Report generation and export
│   │   │   ├── analytics.js      # Analytics charts
│   │   │   ├── search.js         # Global search
│   │   │   ├── backup.js         # Backup, restore, clear
│   │   │   ├── ocr.js            # OCR bill scanning (Tesseract)
│   │   │   └── tabHandlers.js    # Tab-switch side effects
│   │   │
│   │   ├── ui/                   # Reusable UI utilities
│   │   │   ├── navigation.js     # Tab switching, sidebar, modal
│   │   │   ├── toast.js          # Toast notifications
│   │   │   └── theme.js          # Theme management
│   │   │
│   │   └── utils/
│   │       └── helpers.js        # Pure utility functions (dates, money, validation)
│   │
│   ├── icons/                    # PWA icons (192px, 512px)
│   ├── images/                   # Static images
│   └── fonts/                    # Self-hosted fonts (optional)
│
└── config/
    └── app.config.js             # Central configuration constants
```

---

## Architecture Principles

- **SOLID** — each module has one responsibility
- **No globals** — all state lives in `core/state.js`
- **ES Modules** — native `import`/`export`, no bundler required
- **Encrypted storage** — AES-GCM-256 for sensitive keys; fails closed (never a plaintext fallback)
- **Zero inline scripts** — all JS in `assets/js/`
- **Lazy loading** — heavy modules (OCR, analytics) load on demand

---

## Running Locally

Since this app uses ES Modules (`type="module"`), it must be served over HTTP (not `file://`).

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# Then open:
http://localhost:8080
```

---

## Features

- GST Invoice Generation (CGST/SGST/IGST)
- Client & Product Management
- OCR Bill Scanner (Tesseract.js)
- PDF Export (jsPDF)
- Reports: Daily/Weekly/Monthly/Yearly/GST/Client/Product
- Analytics Charts (Chart.js)
- AES-GCM Encrypted Local Storage
- PIN Protection (PBKDF2-SHA256)
- Backup & Restore (JSON)
- PWA Ready
- Offline Support
- Indian Financial Year (April–March)
- Multi-currency Support

---

## Security

| Feature | Implementation |
|---|---|
| Data encryption | AES-GCM-256 (Web Crypto API), random 96-bit IV per write |
| Key derivation | PBKDF2-SHA256, 100,000 iterations, from a random 256-bit **install secret** |
| Install secret | Generated on first use and **persisted in `localStorage` (`_isk`)** so data stays readable after the browser/PWA is closed. (If a secret already exists in the current tab's `sessionStorage` — written by v2.11.1 and earlier — it is adopted and persisted.) |
| PIN | Screen lock only (PBKDF2-SHA256 hash with random salt). It does **not** derive or protect the encryption key |
| XSS prevention | `esc()` on all user data in innerHTML |
| CSV injection | All fields quoted with `csvField()` |
| Backup validation | Schema + key whitelist on restore |

### What is encrypted

Encrypted at rest: business profile (incl. logo/signature), clients, saved invoices and the invoice draft
(`gst_profile`, `gst_clients`, `gst_invoices`, `gst_invoice_draft`).
Stored as plain JSON (not sensitive by design): products, settings, invoice counter, calculator history,
notifications. Backup files are plain, unencrypted JSON (they omit logo/signature, the PIN hash and the install secret) — store them safely.

### Fails closed

A sensitive key is **either encrypted or not stored — there is no plaintext fallback.** If Web Crypto is
unavailable, key derivation/encryption fails, or the install secret cannot be persisted, the save throws a
`SecureStorageError`; Save Invoice / Client / Profile / Restore then show "NOT saved" and keep the previous data.
A full browser store (`QuotaExceededError`) is reported the same way.

### Threat model — what this does and does not protect

- It keeps the sensitive records from being stored as readable text and from being read by simply looking at
  the stored values or at a copy of those values alone.
- Because the install secret is stored next to the data in the same browser profile, **anyone with full access
  to this browser profile (or an unlocked device) can derive the key.** It is not a substitute for a device
  lock screen or full-disk encryption, and the PIN is not a cryptographic protection.
- Clearing the site's data deletes the secret: previously stored encrypted data then becomes **permanently
  unreadable**. Keep regular backups (Settings → Export Backup).
- Data written by v2.11.1 or earlier in a browser session that has since been closed has no recoverable key.
  On start-up such ciphertext is **kept untouched** in `<key>__unreadable` (never overwritten, the app shows a
  warning and starts empty); restore from a backup. If that safety copy itself cannot be written (storage full),
  saving to that key is refused until space is freed.
- Legacy plaintext data and older ciphertext formats (byte-array envelope, v1 per-write-salt envelope) are
  still read, then re-written encrypted on the next save.

---

## Browser Support

| Browser | Support |
|---|---|
| Chrome 90+ | ✅ Full |
| Firefox 90+ | ✅ Full |
| Safari 15+ | ✅ Full |
| Android Chrome | ✅ Full |
| Samsung Internet | ✅ Full |

*Requires ES Modules and Web Crypto API support.*
