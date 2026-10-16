/**
 * Ledgerix - Backup & Restore Module
 */

'use strict';

import * as State from '../core/state.js';
import { restoreFromBackup, clearAllAppData, loadAllData } from '../core/storage.js';
import { showToast } from '../ui/toast.js';
import { closeModalDirect } from '../ui/navigation.js';
import { downloadBlob } from '../utils/helpers.js';

export function backupData() {
  const data = {
    clients:        State.clients,
    products:       State.products,
    savedInvoices:  State.savedInvoices,
    profile:        _stripImages(State.profile),
    settings:       State.settings,
    invoiceCounter: State.invoiceCounter,
    notifications:  State.notifications,
    exportedAt:     new Date().toISOString(),
    version:        '2.0',
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const name = `Ledgerix_Backup_${new Date().toLocaleDateString('en-IN').replace(/\//g, '-')}.json`;
  // downloadBlob attaches the link to the DOM and delays revoking the URL (needed on Android)
  if (downloadBlob(blob, name)) showToast('Backup downloaded!', 'success');
  else showToast('Backup could not be downloaded on this browser', 'error');
}

function _stripImages(profile) {
  const { logo, signature, ...rest } = profile || {};
  return rest;
}

export function restoreData(e) {
  // e may be an Event (from onchange="restoreData(event)") or an HTMLInputElement
  // Handle both safely
  const file = (e && e.target ? e.target.files : e && e.files ? e.files : null)?.[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) { showToast('Please select a JSON backup file!', 'error'); return; }

  const input = e && e.target ? e.target : (e && e.files ? e : null);
  const reader = new FileReader();
  reader.onload = function (ev) {
    (async () => {
      let data;
      try {
        data = JSON.parse(ev.target.result);
      } catch (err) {
        showToast('This is not a valid Ledgerix backup file (could not read JSON).', 'error');
        if (input) input.value = '';
        return;
      }
      // Restoring REPLACES the current data — make that explicit before touching anything.
      const n = (k) => (Array.isArray(data && data[k]) ? data[k].length : 0);
      const msg = `Restore backup?\n\nThis will REPLACE the data on this device with the backup:\n` +
        `• ${n('savedInvoices')} invoices, ${n('clients')} clients, ${n('products')} products\n\n` +
        `Current: ${State.savedInvoices.length} invoices, ${State.clients.length} clients, ${State.products.length} products.`;
      if (!confirm(msg)) { if (input) input.value = ''; return; }
      try {
        await restoreFromBackup(data);
        await loadAllData();

        // Refresh all visible UI
        const { updateDashboard } = await import('./dashboard.js');
        const { renderClients }   = await import('./clients.js');
        const { renderProducts }  = await import('./products.js');
        const { renderInvoicesList } = await import('./invoice.js');

        updateDashboard();
        renderClients();
        renderProducts();
        renderInvoicesList();

        showToast('Data restored!', 'success', true);
        closeModalDirect();
      } catch (err) {
        const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
        showToast(quota ? 'Restore failed: browser storage is full. Your existing data was kept.'
                        : 'Restore failed: ' + ((err && err.message) || 'invalid backup') + '. Your existing data was kept.', 'error');
        console.error('[Backup] Restore error:', err);
      } finally {
        if (input) input.value = '';
      }
    })();
  };
  reader.readAsText(file);
}

export function clearAllData() {
  if (!confirm('WARNING: This will delete ALL data! Are you sure?')) return;
  if (!confirm('Really sure? This cannot be undone!')) return;
  clearAllAppData();
  location.reload();
}

export function setupOfflineDetection() {
  window.addEventListener('online',  () => {
    document.getElementById('offlineBar')?.classList.remove('active');
    showToast('Back online!', 'success');
  });
  window.addEventListener('offline', () => {
    document.getElementById('offlineBar')?.classList.add('active');
    showToast('You are offline', 'warning');
  });
  if (!navigator.onLine) document.getElementById('offlineBar')?.classList.add('active');
}
