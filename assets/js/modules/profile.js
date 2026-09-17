/**
 * Ledgerix - Profile Module
 */

'use strict';

import * as State from '../core/state.js';
import { saveProfile as _saveProfile } from '../core/storage.js';
import { showToast } from '../ui/toast.js';
import { validateGSTIN, validatePhone, esc, currentFY } from '../utils/helpers.js';
import { checkImageSize } from '../core/security.js';

export function loadProfileForm() {
  if (!State.profile) return;
  const fields = {
    profileName:    State.profile.name    || '',
    profileAddr:    State.profile.address || '',
    profileGSTIN:   State.profile.gstin   || '',
    profilePhone:   State.profile.phone   || '',
    profileEmail:   State.profile.email   || '',
    profilePrefix:  State.profile.prefix  || 'INV',
    profileFY:      State.profile.fy      || currentFY(),
    profileBank:    State.profile.bank    || '',
    profileAccount: State.profile.account || '',
    profileIFSC:    State.profile.ifsc    || '',
    profileUPI:     State.profile.upi     || '',
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });

  if (State.profile.logo) {
    const prev = document.getElementById('logoPreview');
    if (prev) { prev.innerHTML = `<img src="${State.profile.logo}">`; prev.style.display = 'flex'; }
  }
  if (State.profile.signature) {
    const prev = document.getElementById('sigPreview');
    if (prev) { prev.innerHTML = `<img src="${State.profile.signature}">`; prev.style.display = 'flex'; }
  }
}

export async function saveProfile() {
  const name  = document.getElementById('profileName')?.value.trim();
  const gstin = document.getElementById('profileGSTIN')?.value.trim();
  const phone = document.getElementById('profilePhone')?.value.trim();

  if (!name)               { showToast('Business name required', 'warning'); return; }
  if (!validateGSTIN(gstin)) { showToast('Invalid GSTIN format (leave blank if unknown)', 'warning'); return; }
  if (!validatePhone(phone)) { showToast('Invalid phone number', 'warning'); return; }

  Object.assign(State.profile, {
    name,
    address: document.getElementById('profileAddr')?.value.trim(),
    gstin,
    phone,
    email:   document.getElementById('profileEmail')?.value.trim(),
    prefix:  document.getElementById('profilePrefix')?.value.trim() || 'INV',
    fy:      document.getElementById('profileFY')?.value.trim(),
    bank:    document.getElementById('profileBank')?.value.trim(),
    account: document.getElementById('profileAccount')?.value.trim(),
    ifsc:    document.getElementById('profileIFSC')?.value.trim(),
    upi:     document.getElementById('profileUPI')?.value.trim(),
  });

  await _saveProfile();
  showToast('Profile saved!', 'success', true);
  loadProfileBanner();
}

export function loadProfileBanner() {
  const div = document.getElementById('profileBanner');
  if (!div) return;
  if (State.profile.name) {
    div.style.display = 'block';
    const nameEl = document.getElementById('bannerBizName');
    if (nameEl) nameEl.textContent = State.profile.name;
    const detailEl = document.getElementById('bannerBizDetails');
    if (detailEl) {
      detailEl.innerHTML = (State.profile.address ? esc(State.profile.address) + '<br>' : '') +
        'GSTIN: ' + esc(State.profile.gstin || 'N/A') + ' | ' + esc(State.profile.phone || '');
    }
  } else {
    div.style.display = 'none';
  }
}

export function handleLogoUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    if (!checkImageSize(ev.target.result, 'Logo', showToast)) return;
    State.profile.logo = ev.target.result;
    const prev = document.getElementById('logoPreview');
    if (prev) { prev.innerHTML = `<img src="${ev.target.result}">`; prev.style.display = 'flex'; }
    showToast('Logo uploaded!', 'success');
  };
  reader.readAsDataURL(file);
}

export function handleSigUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    if (!checkImageSize(ev.target.result, 'Signature', showToast)) return;
    State.profile.signature = ev.target.result;
    const prev = document.getElementById('sigPreview');
    if (prev) { prev.innerHTML = `<img src="${ev.target.result}">`; prev.style.display = 'flex'; }
    showToast('Signature uploaded!', 'success');
  };
  reader.readAsDataURL(file);
}

export async function clearProfile() {
  // Reset in-memory state
  State.setProfile({});

  // Persist the cleared state through the existing encrypted storage path
  await _saveProfile();

  // Clear all profile form fields
  ['profileName','profileGSTIN','profileAddr','profilePhone','profileEmail',
   'profilePrefix','profileFY','profileBank','profileAccount','profileIFSC','profileUPI']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Hide logo and signature previews
  const lp = document.getElementById('logoPreview');
  const sp = document.getElementById('sigPreview');
  if (lp) lp.style.display = 'none';
  if (sp) sp.style.display = 'none';

  // Hide the profile banner in the invoice tab
  loadProfileBanner();

  showToast('Profile cleared', 'info');
}
