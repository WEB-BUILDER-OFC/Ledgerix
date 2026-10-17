/**
 * Ledgerix - Security Module
 * AES-GCM encryption, PBKDF2 PIN hashing, secure localStorage wrappers.
 *
 * v2.2 fixes:
 *  - checkPIN() now resolves immediately (never hangs) when:
 *      • No PIN stored
 *      • WebCrypto unavailable (fails safe — allow access)
 *      • DOM error during overlay construction
 *      • Unhandled rejection in submitPIN logic
 *  - checkPIN() returns a promise that ALWAYS resolves, never permanently rejects.
 *  - hideSplash is called BEFORE checkPIN overlay so splash is always dismissed.
 *  - PIN overlay uses only inline concrete colors (not CSS variables) to avoid
 *    token-name mismatches across theme versions.
 *  - removePIN() exported so settings.js can clear PIN on toggle-off.
 */

'use strict';

import AppConfig from '../../../config/app.config.js';

const _ENC_KEYS  = new Set(AppConfig.ENCRYPTED_KEYS);
const _KEY_CACHE = {};

/**
 * Thrown whenever a sensitive value could NOT be stored securely. Callers (Save Invoice,
 * Save Client, Save Profile, Restore, draft autosave) catch it and show "NOT saved" —
 * a sensitive key is NEVER written as plaintext as a fallback.
 */
export class SecureStorageError extends Error {
  constructor(message, cause) { super(message); this.name = 'SecureStorageError'; if (cause) this.cause = cause; }
}

// Keys whose existing ciphertext is undecryptable AND could not be copied to *__unreadable:
// encStore refuses to overwrite them (that would destroy the only copy).
const _UNPRESERVED = new Set();
let _secretUsed = null;      // install secret the cached AES key was derived from

/** Called by clearAllAppData() — after a deliberate wipe there is nothing left to protect. */
export function resetUnreadableTracking() { _UNPRESERVED.clear(); }

// ── Install secret + PBKDF2 key (derived once per page load) ─────────────────
//
// v2.11.2 ROOT-CAUSE FIX: the install secret used to live ONLY in sessionStorage.
// sessionStorage is wiped whenever the browser/PWA is closed, so every new session
// generated a different key and the previously saved clients / invoices / profile
// could no longer be decrypted — they came back as an object instead of an array
// and every later Save failed. The secret is now persisted in localStorage (as the
// project record has always documented), and a secret that already exists in this
// session's sessionStorage is ADOPTED so data saved before this fix stays readable.

function _readInstallSecret() {
  const K = AppConfig.STORAGE_KEYS.INSTALL_SECRET;
  let persisted = null, session = null;
  try { persisted = localStorage.getItem(K); } catch (_) { /* storage blocked */ }
  try { session   = sessionStorage.getItem(K); } catch (_) { /* storage blocked */ }
  return { persisted, session };
}

function _getInstallSecret() {
  const K = AppConfig.STORAGE_KEYS.INSTALL_SECRET;
  const { persisted, session } = _readInstallSecret();
  if (persisted) return persisted;
  if (session) {                                   // adopt the live-session secret (migration)
    try { localStorage.setItem(K, session); } catch (_) { /* keep session-only */ }
    return session;
  }
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(K, fresh); } catch (_) { /* fall through to session-only */ }
  try { sessionStorage.setItem(K, fresh); } catch (_) { /* ignore */ }
  return fresh;
}

async function _getSessionKey() {
  if (_KEY_CACHE['__session__']) return _KEY_CACHE['__session__'];
  if (!window.crypto || !window.crypto.subtle) throw new Error('WebCrypto unavailable');

  const installSecret = _getInstallSecret();
  _secretUsed = installSecret;
  const enc    = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(installSecret), 'PBKDF2', false, ['deriveKey']);
  const key    = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('ledgerix-v2-stable'), iterations: AppConfig.PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  _KEY_CACHE['__session__'] = key;
  return key;
}

// ct is stored as base64 (v2.11.2). Older builds stored a JSON array of byte values
// (~3.6x larger, which exhausted the localStorage quota with logo + signature).
// decStore() accepts BOTH forms, so existing data keeps loading.
function _b64FromBytes(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function _bytesFromB64(str) {
  const bin = atob(str); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function _ctBytes(ct) { return typeof ct === 'string' ? _bytesFromB64(ct) : new Uint8Array(ct); }

function _isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

// ── Encrypted localStorage read/write ────────────────────────────────────────

// The key derived from the install secret is only useful after a restart if that secret is
// persisted. If it is not (storage blocked / cleared elsewhere / changed in another tab),
// data written now would be unreadable next session — so refuse the write instead.
function _assertSecretPersisted() {
  const K = AppConfig.STORAGE_KEYS.INSTALL_SECRET;
  let stored = null;
  try { stored = localStorage.getItem(K); } catch (_) { /* treated as not persisted */ }
  if (stored === _secretUsed) return;
  if (stored == null && _secretUsed) {
    try { localStorage.setItem(K, _secretUsed); if (localStorage.getItem(K) === _secretUsed) return; } catch (_) { /* fall through */ }
    throw new SecureStorageError('The encryption key could not be saved on this device (browser storage is blocked or full) — nothing was saved.');
  }
  throw new SecureStorageError('The encryption key on this device changed (another tab cleared or reset the app). Reload Ledgerix before saving — nothing was saved.');
}

export async function encStore(name, value) {
  // Non-sensitive keys are stored as-is by design.
  if (!_ENC_KEYS.has(name)) { localStorage.setItem(name, value); return; }

  // ── Sensitive keys: encrypted or NOT stored. There is no plaintext fallback. ──
  if (_UNPRESERVED.has(name)) {
    throw new SecureStorageError('Earlier encrypted data could not be unlocked and a safety copy could not be kept (storage is full), so it will not be overwritten. Export a backup or free storage space first — nothing was saved.');
  }
  if (!window.crypto || !window.crypto.subtle || typeof window.crypto.getRandomValues !== 'function') {
    throw new SecureStorageError('Secure storage is not available in this browser (Web Crypto is missing — use a current browser over HTTPS) — nothing was saved.');
  }

  let serialised;
  try {
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const key = await _getSessionKey();
    _assertSecretPersisted();
    const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
    serialised = JSON.stringify({ v: 2, iv: Array.from(iv), ct: _b64FromBytes(new Uint8Array(ct)) });
  } catch (e) {
    if (e instanceof SecureStorageError) throw e;
    console.error('[Security] encryption failed for', name, e);
    throw new SecureStorageError('Encryption failed — nothing was saved (' + ((e && e.message) || (e && e.name) || 'unknown error') + ').', e);
  }
  // A full/blocked store surfaces unchanged (QuotaExceededError) so callers can explain it.
  localStorage.setItem(name, serialised);
}

// Keeps an undecryptable ciphertext instead of letting a later save overwrite it.
// If it cannot be kept, the key is remembered in _UNPRESERVED and encStore refuses to overwrite it.
function _quarantine(name, raw) {
  const qk = name + '__unreadable';
  let kept = false;
  try {
    const existing = localStorage.getItem(qk);
    if (existing === raw) kept = true;
    else if (!existing) { localStorage.setItem(qk, raw); kept = true; }
    else { localStorage.setItem(qk + '_' + Date.now(), raw); kept = true; }   // a different earlier copy exists — keep both
  } catch (_) { /* quota — handled below */ }
  if (!kept) _UNPRESERVED.add(name);
  try { window.dispatchEvent(new CustomEvent('ledgerix:unreadable', { detail: { name } })); } catch (_) {}
}

function _parseEnvelope(raw) {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && !Array.isArray(p) && p.iv && p.ct ? p : null;
  } catch (_) { return null; }
}

export async function decStore(name, fallback = null) {
  const raw = localStorage.getItem(name);
  if (!raw) return fallback;
  if (!_ENC_KEYS.has(name)) return raw;
  const payload = _parseEnvelope(raw);
  if (!payload) return raw;                                           // legacy plaintext (JSON array/object or not JSON)
  if (!window.crypto || !window.crypto.subtle) {
    // Ciphertext but no Web Crypto: it cannot be read. Return the empty fallback (never the
    // envelope) and leave the stored ciphertext untouched; encStore will refuse to overwrite it.
    console.warn('[Security] Web Crypto unavailable — encrypted', name, 'left untouched');
    return fallback;
  }

  try {
    if (payload.v === 1 && payload.salt) {                            // v1 migration: per-write salt scheme
      const enc2   = new TextEncoder();
      const { persisted, session } = _readInstallSecret();
      const secret = session || persisted;
      if (!secret) throw new Error('no secret for v1 data');
      const km = await crypto.subtle.importKey('raw', enc2.encode(secret), 'PBKDF2', false, ['deriveKey']);
      const k  = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc2.encode(payload.salt), iterations: AppConfig.PBKDF2_ITERATIONS, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      );
      const pt      = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(payload.iv) }, k, _ctBytes(payload.ct));
      const decoded = new TextDecoder().decode(pt);
      try { await encStore(name, decoded); } catch (e) { console.warn('[Security] v1→v2 migration write failed (data stays readable):', e); }
      return decoded;
    }
    if (payload.v !== 2) throw new Error('unsupported envelope version ' + payload.v);
    const key = await _getSessionKey();
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(payload.iv) }, key, _ctBytes(payload.ct));
    // This ciphertext decrypts fine now, so a safety copy of the SAME ciphertext (left by an earlier
    // transient failure) is a false alarm — drop it so the "could not be unlocked" warning stops.
    try { if (localStorage.getItem(name + '__unreadable') === raw) localStorage.removeItem(name + '__unreadable'); } catch (_) {}
    return new TextDecoder().decode(pt);
  } catch (e) {
    // Encrypted data exists but cannot be decrypted (key from an old session is gone).
    // Return the fallback — NOT the ciphertext envelope — so the app gets a valid empty
    // value, and keep a copy of the ciphertext so it is never silently destroyed.
    console.warn('[Security] decStore: could not decrypt', name, e);
    _quarantine(name, raw);
    return fallback;
  }
}

// ── PIN hashing ──────────────────────────────────────────────────────────────

export async function hashPIN(pin, salt) {
  if (!window.crypto || !window.crypto.subtle) throw new Error('WebCrypto unavailable');
  const enc    = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits   = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: AppConfig.PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMat, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── PIN save ─────────────────────────────────────────────────────────────────

export async function savePINToStorage(pin) {
  // Wrapped in try/catch: if PBKDF2 throws (mobile browser crypto restriction,
  // state issue, or context problem), we throw a clear error rather than silently
  // leaving localStorage un-written while the caller shows a success toast.
  let hash, salt;
  try {
    salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    hash = await hashPIN(pin, salt);
  } catch (e) {
    throw new Error('PIN hashing failed: ' + (e && e.message ? e.message : String(e)));
  }

  const value = JSON.stringify({ hash, salt });
  try {
    localStorage.setItem(AppConfig.STORAGE_KEYS.PIN, value);
    // Verify the write actually persisted (defensive check)
    const readback = localStorage.getItem(AppConfig.STORAGE_KEYS.PIN);
    if (readback !== value) {
      throw new Error('localStorage write did not persist (storage may be full or restricted)');
    }
  } catch (e) {
    throw new Error('PIN save failed: ' + (e && e.message ? e.message : String(e)));
  }
}

// ── PIN remove ───────────────────────────────────────────────────────────────

export function removePIN() {
  localStorage.removeItem(AppConfig.STORAGE_KEYS.PIN);
}

// ── PIN check ────────────────────────────────────────────────────────────────
//
// Design contract (v2.2):
//   - Always resolves. Never permanently rejects or hangs.
//   - If no PIN stored → resolves immediately (pass-through).
//   - If WebCrypto unavailable → resolves immediately (fail-safe, no lock).
//   - If PIN data is corrupt/unparseable → removes stale data and resolves.
//   - If DOM construction fails → logs error and resolves (don't block app).
//   - Called AFTER hideSplash in bootstrap so the splash is gone before the
//     PIN overlay appears (overlay replaces it rather than hiding behind it).
//
// The splash is dismissed first by the bootstrap; this function only shows
// the unlock screen. It does NOT control the splash lifecycle.

export function checkPIN() {
  const stored = localStorage.getItem(AppConfig.STORAGE_KEYS.PIN);

  // No PIN set — resolve immediately
  if (!stored) return Promise.resolve();

  // WebCrypto unavailable — fail open so the app doesn't hang
  if (!window.crypto || !window.crypto.subtle) {
    console.warn('[Security] checkPIN: WebCrypto unavailable, skipping PIN check');
    return Promise.resolve();
  }

  // Parse stored PIN data
  let pinData = null;
  let isLegacyBase64 = false;

  try {
    pinData = JSON.parse(stored);
  } catch (e) {
    // JSON.parse failed — could be the OLD btoa(pin) base64 format.
    // atob(stored) gives back the original plaintext PIN.
    // Do NOT silently delete: show the overlay and verify against the old format.
    // On correct entry, migrate to the new {hash, salt} format automatically.
    const looksBase64 = /^[A-Za-z0-9+/]+=*$/.test(stored.trim()) && stored.length >= 4;
    if (looksBase64) {
      console.info('[Security] checkPIN: detected legacy base64 PIN — showing overlay for verification');
      isLegacyBase64 = true;
      pinData = null; // handled via isLegacyBase64 path below
    } else {
      // Genuinely corrupt — not base64, not JSON. Safe to clear.
      console.warn('[Security] checkPIN: unrecognisable PIN data, clearing');
      localStorage.removeItem(AppConfig.STORAGE_KEYS.PIN);
      return Promise.resolve();
    }
  }

  // New format must have both hash and salt
  if (!isLegacyBase64 && (!pinData || (!pinData.hash && !pinData.salt))) {
    console.warn('[Security] checkPIN: PIN missing hash/salt fields, clearing');
    localStorage.removeItem(AppConfig.STORAGE_KEYS.PIN);
    return Promise.resolve();
  }

  // Build the PIN overlay and return a Promise that resolves when unlocked.
  // Wrap everything in try/catch — if DOM creation fails, resolve immediately.
  return new Promise((resolve) => {
    try {
      // Remove any pre-existing overlay (e.g. after hot-reload)
      document.getElementById('pinOverlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'pinOverlay';

      // Use concrete inline colors — NOT CSS custom properties — so the overlay
      // works regardless of which CSS version / theme variable names are active.
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:#0a1628',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'justify-content:center',
        'z-index:100001',
        'gap:14px',
        'font-family:Poppins,sans-serif',
      ].join(';');

      overlay.innerHTML = `
        <div style="width:52px;height:52px;background:#c9a84c;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#0a1628;font-family:'Playfair Display',serif">L</div>
        <h2 style="color:#c9a84c;font-family:'Playfair Display',serif;font-size:22px;margin:0">Ledgerix</h2>
        <p style="color:#8892a8;font-size:13px;margin:0">v2.11.5 — Enter your PIN to continue</p>
        <input id="pinInput" type="password" maxlength="4" inputmode="numeric" pattern="[0-9]*"
          style="background:#1a2842;border:1px solid #c9a84c;color:#f0f0f0;padding:10px 20px;border-radius:6px;font-size:22px;text-align:center;letter-spacing:8px;width:180px;outline:none;font-family:monospace"
          placeholder="••••" autocomplete="off">
        <p id="pinError" style="color:#e74c3c;font-size:12px;min-height:18px;margin:0"></p>
        <button id="pinUnlockBtn"
          style="background:#c9a84c;color:#0a1628;border:none;padding:10px 28px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;font-family:Poppins,sans-serif;min-width:180px">
          Unlock
        </button>
        <div style="border-top:1px solid #1a2842;width:180px;margin-top:8px;padding-top:12px;text-align:center">
          <p style="color:#4d5d73;font-size:11px;margin:0 0 8px 0">Forgot your PIN?</p>
          <button id="pinForgotBtn"
            style="background:#1a2842;color:#e74c3c;border:1px solid #e74c3c;padding:7px 16px;border-radius:6px;font-size:11px;cursor:pointer;font-family:Poppins,sans-serif;width:180px">
            Reset All Data &amp; Remove PIN
          </button>
        </div>
      `;

      document.body.appendChild(overlay);

      const inputEl      = overlay.querySelector('#pinInput');
      const errorEl      = overlay.querySelector('#pinError');
      const unlockBtn    = overlay.querySelector('#pinUnlockBtn');
      const forgotBtn    = overlay.querySelector('#pinForgotBtn');

      inputEl.focus();

      async function submitPIN() {
        const entered = inputEl.value;
        if (!/^\d{4}$/.test(entered)) {
          errorEl.textContent = 'Enter 4-digit PIN';
          return;
        }
        errorEl.textContent = '';
        unlockBtn.disabled  = true;
        unlockBtn.textContent = 'Checking...';

        try {
          let ok = false;
          if (isLegacyBase64) {
            // Old btoa() format: atob(stored) gives plaintext PIN
            try { ok = (atob(stored) === entered); } catch (_) { ok = false; }
            if (ok) {
              // Migrate to new PBKDF2 hash format transparently
              try { await savePINToStorage(entered); } catch (_) {}
            }
          } else if (pinData && pinData.hash && pinData.salt) {
            const hash = await hashPIN(entered, pinData.salt);
            ok = (hash === pinData.hash);
          } else {
            // Fallback safety net
            try { ok = (atob(stored) === entered); } catch (_) { ok = false; }
            if (ok) { try { await savePINToStorage(entered); } catch (_) {} }
          }

          if (ok) {
            overlay.remove();
            resolve();
          } else {
            errorEl.textContent     = 'Incorrect PIN. Try again.';
            inputEl.value           = '';
            unlockBtn.disabled      = false;
            unlockBtn.textContent   = 'Unlock';
            inputEl.focus();
          }
        } catch (err) {
          console.error('[Security] PIN verify error:', err);
          errorEl.textContent   = 'Error checking PIN. Try again.';
          unlockBtn.disabled    = false;
          unlockBtn.textContent = 'Unlock';
        }
      }

      inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') submitPIN(); });
      unlockBtn.addEventListener('click', submitPIN);

      forgotBtn.addEventListener('click', () => {
        if (!confirm('This will delete ALL stored data including invoices and clients. Are you sure?')) return;
        if (!confirm('Really delete all data and reset the PIN?')) return;
        // Clear everything and reload fresh
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
        overlay.remove();
        resolve(); // let the app mount on a clean slate
        location.reload();
      });

    } catch (domErr) {
      // DOM construction failed — resolve so the app is not permanently locked
      console.error('[Security] checkPIN: overlay construction failed, skipping PIN', domErr);
      resolve();
    }
  });
}

// ── Image size guard ─────────────────────────────────────────────────────────

export function checkImageSize(dataUrl, label, showToastFn) {
  const bytes = Math.round(dataUrl.length * 0.75);
  if (bytes > AppConfig.IMG_MAX_BYTES) {
    showToastFn(`${label} is too large (>${Math.round(AppConfig.IMG_MAX_BYTES / 1024)} KB). Please resize first.`, 'error');
    return false;
  }
  if (bytes > AppConfig.IMG_WARN_BYTES) {
    showToastFn(`${label} is large (${Math.round(bytes / 1024)} KB) — may approach storage limit.`, 'warning');
  }
  return true;
}
