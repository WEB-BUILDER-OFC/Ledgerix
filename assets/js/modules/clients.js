/**
 * Ledgerix - Clients Module
 * v2.3 fix: GSTIN is optional (empty allowed), phone optional.
 *           Only validate if non-empty. Clear error toast on success.
 */

'use strict';

import * as State from '../core/state.js';
import { nextId } from '../core/state.js';
import { saveClients } from '../core/storage.js';
import { showToast } from '../ui/toast.js';
import { esc, validateGSTIN, validateEmail } from '../utils/helpers.js';
import { switchTab } from '../ui/navigation.js';

let _clientSaving = false;

function _storageErr(err) {
  if (err && (err.name === 'QuotaExceededError' || err.code === 22)) return 'browser storage is full. Export a backup and free some space.';
  return (err && err.message) ? err.message : 'unknown storage error';
}

function _sameClient(a, b) {
  return (a.name || '').trim().toLowerCase() === (b.name || '').trim().toLowerCase() &&
         (a.gstin || '').trim().toUpperCase() === (b.gstin || '').trim().toUpperCase();
}

export function renderClients() {
  const list = document.getElementById('clientsList');
  if (!list) return;

  // clientListSearch = search in Clients tab; clientSearch = search in Invoice tab autofill
  const q       = (document.getElementById('clientListSearch')?.value || document.getElementById('clientSearch')?.value || '').toLowerCase();
  const clients = q
    ? State.clients.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.gstin && c.gstin.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)))
    : State.clients;

  list.innerHTML = clients.length === 0
    ? `<div class="empty-state"><i class="fas fa-users"></i><h3>No clients yet</h3><p>Add your first client below.</p></div>`
    : clients.map(c => `
      <div class="client-card">
        <div class="card-info">
          <h4>${esc(c.name)}</h4>
          <p>${esc(c.address || 'No address')}<br>GSTIN: ${esc(c.gstin || 'N/A')} | ${esc(c.phone || '')}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-info btn-sm" onclick="window._ledgerix.clients.useClient(${c.id})" title="Use in invoice"><i class="fas fa-file-invoice"></i></button>
          <button class="btn btn-danger btn-sm" onclick="window._ledgerix.clients.deleteClient(${c.id})" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
}

export async function addNewClient() {
  const name  = document.getElementById('newClientName')?.value.trim();
  const gstin = document.getElementById('newClientGSTIN')?.value.trim();
  const addr  = document.getElementById('newClientAddr')?.value.trim();
  const phone = document.getElementById('newClientPhone')?.value.trim();
  const email = document.getElementById('newClientEmail')?.value.trim();

  // Name is required
  if (!name) { showToast('Client name is required', 'warning'); return; }

  // GSTIN is optional — only validate format if provided
  if (gstin && !validateGSTIN(gstin)) {
    showToast('Invalid GSTIN format (e.g. 22AAAAA0000A1Z5) — leave blank if unknown', 'warning');
    return;
  }

  // Phone is optional — only validate if provided
  if (phone && !_validatePhoneLoose(phone)) {
    showToast('Invalid phone number', 'warning');
    return;
  }

  // Email is optional — only validate if provided
  if (email && !validateEmail(email)) {
    showToast('Invalid email address', 'warning');
    return;
  }

  if (_clientSaving) return;
  const candidate = { id: nextId(), name, gstin, address: addr, phone, email };
  if (State.clients.some(c => _sameClient(c, candidate))) {
    showToast('This client already exists (same name and GSTIN).', 'warning');
    return;
  }

  _clientSaving = true;
  const prev = State.clients;
  try {
    State.setClients([...prev, candidate]);
    await saveClients();
  } catch (err) {
    State.setClients(prev);
    console.error('[Clients] save failed:', err);
    showToast('Client NOT saved: ' + _storageErr(err), 'error');
    return;
  } finally {
    _clientSaving = false;
  }

  ['newClientName','newClientGSTIN','newClientAddr','newClientPhone','newClientEmail']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  renderClients();
  showToast('Client saved!', 'success');
}

// Loose phone validation — just needs 10+ digits, common formats accepted
function _validatePhoneLoose(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}

export async function deleteClient(id) {
  if (!confirm('Delete this client?')) return;
  const prev = State.clients;
  State.setClients(prev.filter(c => c.id !== id));
  try {
    await saveClients();
  } catch (err) {
    State.setClients(prev);
    showToast('Client NOT deleted: ' + _storageErr(err), 'error');
    return;
  }
  renderClients();
  showToast('Client deleted', 'warning');
}

export function useClient(id) {
  const c = State.clients.find(c => c.id === id);
  if (!c) return;
  switchTab('invoice');
  setTimeout(() => selectClient(id), 120);
}

export function selectClient(id) {
  const c = State.clients.find(c => c.id === id);
  if (!c) return;
  const fields = {
    invClient:      c.name,
    invClientAddr:  c.address  || '',
    invClientGSTIN: c.gstin    || '',
    invClientPhone: c.phone    || '',
    invClientEmail: c.email    || '',
  };
  Object.entries(fields).forEach(([k, v]) => {
    const el = document.getElementById(k);
    if (el) el.value = v;
  });
  closeClientSearch();
  showToast(`Client "${c.name}" selected`, 'info');
}

export function searchClients(queryArg) {
  const results = document.getElementById('clientSearchResults');
  if (!results) return;

  // Accept value passed from oninput="searchClients(this.value)" (invoice tab invClient)
  // OR from oninput="searchClients(this.value)" (clients tab clientSearch)
  // OR fall back to reading invClient for backward compat
  const q = (queryArg !== undefined
    ? String(queryArg)
    : (document.getElementById('invClient')?.value || '')
  ).toLowerCase().trim();
  if (q.length < 1) { results.style.display = 'none'; return; }

  const matches = State.clients.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.gstin && c.gstin.toLowerCase().includes(q)));

  if (!matches.length) { results.style.display = 'none'; return; }

  results.style.display = 'block';
  results.innerHTML = matches.map(c => `
    <div class="product-item" onclick="window._ledgerix.clients.selectClient(${c.id})" style="cursor:pointer">
      <div>
        <strong>${esc(c.name)}</strong>
        ${c.gstin ? `<br><small style="color:var(--c-text-mute)">${esc(c.gstin)}</small>` : ''}
      </div>
      <i class="fas fa-arrow-right" style="color:var(--c-gold)"></i>
    </div>`).join('');
}

export function closeClientSearch() {
  const el = document.getElementById('clientSearchResults');
  if (el) el.style.display = 'none';
}

export async function saveCurrentClient() {
  const name = document.getElementById('invClient')?.value.trim();
  if (!name) { showToast('Enter client name first', 'warning'); return; }
  const data = {
    name,
    address: document.getElementById('invClientAddr')?.value.trim()  || '',
    gstin:   document.getElementById('invClientGSTIN')?.value.trim() || '',
    phone:   document.getElementById('invClientPhone')?.value.trim() || '',
    email:   document.getElementById('invClientEmail')?.value.trim() || '',
  };
  // Same validation as the Clients tab — optional fields are only checked when filled in
  if (data.gstin && !validateGSTIN(data.gstin)) { showToast('Invalid GSTIN format (e.g. 22AAAAA0000A1Z5) — leave blank if unknown', 'warning'); return; }
  if (data.phone && !_validatePhoneLoose(data.phone)) { showToast('Invalid phone number', 'warning'); return; }
  if (data.email && !validateEmail(data.email)) { showToast('Invalid email address', 'warning'); return; }
  if (_clientSaving) return;

  const prev      = State.clients;
  const existing  = prev.find(c => c.name.toLowerCase() === name.toLowerCase());
  _clientSaving = true;
  try {
    State.setClients(existing
      ? prev.map(c => (c === existing ? { ...existing, ...data } : c))
      : [...prev, { id: nextId(), ...data }]);
    await saveClients();
  } catch (err) {
    State.setClients(prev);
    console.error('[Clients] save failed:', err);
    showToast('Client NOT saved: ' + _storageErr(err), 'error');
    return;
  } finally {
    _clientSaving = false;
  }
  renderClients();
  showToast(existing ? 'Client updated!' : 'Client saved!', 'success');   // only after the write succeeded
}

export function filterClientList() {
  renderClients();
}
