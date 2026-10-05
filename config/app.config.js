/**
 * Ledgerix - Application Configuration
 * Central config file — edit here to change app-wide constants.
 */

'use strict';

const AppConfig = {
  APP_NAME:    'Ledgerix',
  APP_VERSION: 'v2.11.1',
  APP_TAGLINE: 'Business Management & GST Billing',

  // Storage keys
  STORAGE_KEYS: {
    CLIENTS:          'gst_clients',
    PRODUCTS:         'gst_products',
    INVOICES:         'gst_invoices',
    PROFILE:          'gst_profile',
    SETTINGS:         'gst_settings',
    INV_COUNTER:      'gst_inv_counter',
    CALC_HISTORY:     'gst_calc_history',
    NOTIFICATIONS:    'gst_notifications',
    INVOICE_DRAFT:    'gst_invoice_draft',
    PIN:              'gst_pin',
    INSTALL_SECRET:   '_isk',
    // Prefix for per-day payment-reminder deduplication keys
    // e.g. 'gst_reminders_fired_2025-06-01'
    REMINDERS_PREFIX: 'gst_reminders_fired_',
  },

  // Encrypted storage keys (AES-GCM via security.js)
  ENCRYPTED_KEYS: ['gst_profile', 'gst_clients', 'gst_invoices', 'gst_invoice_draft'],

  // Business limits
  NOTIFICATION_CAP:     50,
  SVG_CIRCLE_CIRC:      163.36,
  DAILY_TARGET:         100000,
  MONTHLY_TARGET:       500000,
  PBKDF2_ITERATIONS:    100000,
  IMG_WARN_BYTES:       200 * 1024,
  IMG_MAX_BYTES:        512 * 1024,
  AUTOSAVE_DEBOUNCE_MS: 500,

  // GST rates
  GST_RATES: [0, 5, 12, 18, 28],

  // Default settings
  DEFAULTS: {
    CURRENCY:    'INR',
    DEFAULT_GST: 18,
    DATE_FORMAT: 'DD/MM/YYYY',
    LANGUAGE:    'en',
    THEME:       'default',
  },

  // Allowed notification types
  NOTIF_TYPES: new Set(['info', 'success', 'warning', 'error']),

  // Allowed profile/settings keys (whitelist for restore)
  ALLOWED_PROFILE_KEYS:  ['name','address','gstin','phone','email','prefix','fy','bank','account','ifsc','upi','logo','signature'],
  ALLOWED_SETTINGS_KEYS: ['currency','defaultGST','dateFormat','language','theme'],

  // Theme classes
  THEME_CLASSES: ['light-theme','theme-blue','theme-green','theme-purple','theme-corporate'],

  // Indian financial year
  FY_START_MONTH: 3, // April (0-indexed)

  // External dependency documentation
  // Core (loaded in <head> for immediate availability):
  //   Chart.js       - https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js
  //   jsPDF          - https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
  //   jsPDF-AutoTable- https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js
  //   QRCode.js      - https://cdn.jsdelivr.net/npm/qrcode.js@1.0.0/qrcode.min.js
  // Optional (lazy-loaded on first use):
  //   Tesseract.js   - https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js
  //                    (v4 used: exposes Tesseract.recognize() global; v5 removed this API)
  // Font dependencies (CDN, network-required):
  //   Google Fonts   - Poppins, Playfair Display
  //   Font Awesome 6 - woff2 files from cdnjs.cloudflare.com
};

export default AppConfig;
