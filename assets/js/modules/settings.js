/**
 * Ledgerix - Settings Module
 * v2.2: togglePIN properly removes PIN when unchecked.
 *        removePINFromSettings() exported for explicit "Remove PIN" button.
 */

'use strict';

import * as State from '../core/state.js';
import { saveSettings as _save } from '../core/storage.js';
import { showToast } from '../ui/toast.js';
import { setTheme } from '../ui/theme.js';
import { savePINToStorage, removePIN } from '../core/security.js';
import AppConfig from '../../../config/app.config.js';

export function saveSettings() {
  const gstS = document.getElementById('settingDefaultGST')?.value;
  // Default GST 0 % is legitimate; only fall back to 18 when the box is empty / not a number.
  const gst  = gstS === '' || gstS == null || !Number.isFinite(parseFloat(gstS)) ? 18 : parseFloat(gstS);
  if (gst < 0 || gst > 100) { showToast('Default GST % must be between 0 and 100', 'warning'); return; }

  const prev = { ...State.settings };
  Object.assign(State.settings, {
    currency:   document.getElementById('settingCurrency')?.value,
    defaultGST: gst,
    dateFormat: document.getElementById('settingDateFormat')?.value || 'DD/MM/YYYY',
    language:   document.getElementById('settingLanguage')?.value  || 'en',
  });
  try {
    _save();
    // Read back so a silently-ignored write (blocked storage) cannot show "saved".
    const stored = JSON.parse(localStorage.getItem(AppConfig.STORAGE_KEYS.SETTINGS) || '{}');
    if (stored.defaultGST !== State.settings.defaultGST || stored.currency !== State.settings.currency) {
      throw new Error('settings did not persist');
    }
  } catch (err) {
    State.setSettings(prev);
    console.error('[Settings] save failed:', err);
    showToast('Settings NOT saved: ' + ((err && err.message) || 'storage error'), 'error');
    return;
  }
  showToast('Settings saved!', 'success');
}

/**
 * Called when the "Enable PIN" checkbox is toggled.
 * Checked   → show the PIN setup form.
 * Unchecked → immediately remove any stored PIN and update UI.
 */
export function togglePIN() {
  const check    = document.getElementById('pinEnabled');
  const setup    = document.getElementById('pinSetup');
  const removeEl = document.getElementById('pinRemove');
  const enabled  = check?.checked;

  if (enabled) {
    // Show setup form so the user can enter their new PIN
    if (setup)    setup.style.display    = 'block';
    if (removeEl) removeEl.style.display = 'none';
  } else {
    // User unchecked → remove PIN immediately
    removePIN();
    if (setup)    setup.style.display    = 'none';
    if (removeEl) removeEl.style.display = 'none';
    showToast('PIN protection disabled', 'info');
  }
}

/**
 * Save a new 4-digit PIN entered in #newPIN.
 */
export async function savePIN() {
  if (!window.crypto || !window.crypto.subtle) {
    showToast('PIN requires HTTPS — not supported on plain HTTP', 'warning');
    return;
  }
  const pin = document.getElementById('newPIN')?.value;
  if (!pin || pin.length !== 4 || /[^\d]/.test(pin)) {
    showToast('Enter a 4-digit numeric PIN', 'warning');
    return;
  }

  // Disable button while saving to prevent double-clicks
  const saveBtn = document.querySelector('#pinSetup .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    await savePINToStorage(pin);

    // Verify the PIN is actually readable back from localStorage before claiming success
    const stored = localStorage.getItem(AppConfig.STORAGE_KEYS.PIN);
    if (!stored) {
      throw new Error('PIN was not persisted to storage');
    }

    // Only update UI after confirmed successful save
    const setup    = document.getElementById('pinSetup');
    const removeEl = document.getElementById('pinRemove');
    if (setup)    setup.style.display    = 'none';
    if (removeEl) removeEl.style.display = 'block';

    const pinInput = document.getElementById('newPIN');
    if (pinInput) pinInput.value = '';

    showToast('PIN saved — reload will require this PIN', 'success');

  } catch (err) {
    // Save failed — roll back the checkbox so UI matches reality (no PIN stored)
    const check = document.getElementById('pinEnabled');
    const setup = document.getElementById('pinSetup');
    if (check) check.checked = false;
    if (setup) setup.style.display = 'none';

    console.error('[Settings] PIN save failed:', err);
    showToast('PIN could not be saved: ' + (err && err.message ? err.message : 'unknown error'), 'warning');

  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save PIN'; }
  }
}

/**
 * Explicit "Remove PIN" action from settings UI.
 * Exported for window bridge and for settings HTML onclick.
 */
export function removePINFromSettings() {
  if (!confirm('Remove PIN protection? The app will no longer require a PIN on startup.')) return;
  removePIN();

  const check    = document.getElementById('pinEnabled');
  const setup    = document.getElementById('pinSetup');
  const removeEl = document.getElementById('pinRemove');
  if (check)    check.checked           = false;
  if (setup)    setup.style.display     = 'none';
  if (removeEl) removeEl.style.display  = 'none';

  showToast('PIN removed', 'info');
}
