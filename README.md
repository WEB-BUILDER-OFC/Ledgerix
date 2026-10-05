# Ledgerix v2.11.1 — GST Billing & Business Management

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
- **Encrypted storage** — AES-GCM-256 for sensitive keys
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
| Data encryption | AES-GCM-256 (Web Crypto API) |
| Key derivation | PBKDF2-SHA256, 100,000 iterations |
| PIN hashing | PBKDF2-SHA256 with random salt |
| Session key | Stored in `sessionStorage` (not `localStorage`) |
| XSS prevention | `esc()` on all user data in innerHTML |
| CSV injection | All fields quoted with `csvField()` |
| Backup validation | Schema + key whitelist on restore |

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
