/**
 * Ledgerix - Application Entry Point
 * v2.2 boot fix: splash is always dismissed FIRST, then PIN overlay shows.
 * checkPIN() always resolves (never hangs). Every error path reaches hideSplash.
 */

'use strict';

import { checkPIN }             from './core/security.js';
import { loadAllData }          from './core/storage.js';
import { hideSplash, switchTab, closeModal, closeModalDirect, toggleSidebar } from './ui/navigation.js';
import { showToast }            from './ui/toast.js';
import { setTheme, toggleThemeMenu } from './ui/theme.js';
import { updateDashboard }      from './modules/dashboard.js';
import { renderItems, addItem, removeItem, updateItem, saveInvoice, resetInvoice,
         renderInvoicesList, filterInvoiceStatus, filterInvoices, loadSavedInvoice,
         deleteSavedInvoice, downloadSavedPDF, shareInvoice, autoSaveInvoice,
         getInvoiceData, generateInvoiceNumber }    from './modules/invoice.js';
import { renderClients, addNewClient, deleteClient, useClient, selectClient,
         searchClients, closeClientSearch, saveCurrentClient, filterClientList } from './modules/clients.js';
import { renderProducts, addNewProduct, deleteProduct, addProductToInvoice,
         searchProducts, closeProductSearch, filterProductList } from './modules/products.js';
import { addNotification, updateNotificationBadge, renderNotifications,
         markRead, toggleNotifications, checkPaymentReminders } from './modules/notifications.js';
import { saveProfile, loadProfileBanner, loadProfileForm,
         handleLogoUpload, handleSigUpload,
         clearProfile }                             from './modules/profile.js';
import { saveSettings, togglePIN, savePIN, removePINFromSettings } from './modules/settings.js';
import { setGSTType, setQuickRate, calculateGST,
         clearCalculator, renderHistory, loadHistory, clearHistory } from './modules/gst.js';
import { generateReport, exportReportCSV, exportReportExcel, printReport } from './modules/reports.js';
import { renderAnalytics }      from './modules/analytics.js';
import { openGlobalSearch, closeGlobalSearch, performGlobalSearch } from './modules/search.js';
import { backupData, restoreData, clearAllData, setupOfflineDetection } from './modules/backup.js';
import { downloadPDF, previewInvoice, closePreview } from './modules/pdf.js';
import { handleOCRUpload, startOCRScan, createInvoiceFromOCR, addOCRItem,
         removeOCRItem, updateOCRItem, clearOCR }   from './modules/ocr.js';
import { today, addDays }       from './utils/helpers.js';
import AppConfig               from '../../config/app.config.js';

// ── Global namespace bridge ───────────────────────────────────────────────────

window._ledgerix = {
  nav:       { switchTab, closeModal, closeModalDirect, toggleSidebar },
  ui:        { showToast, setTheme, toggleThemeMenu },
  dashboard: { updateDashboard },
  invoice: {
    addItem, removeItem, updateItem, saveInvoice, resetInvoice,
    renderItems, renderInvoicesList, filterInvoiceStatus, filterInvoices,
    loadSavedInvoice, deleteSavedInvoice, downloadSavedPDF, shareInvoice,
    autoSaveInvoice, getInvoiceData, generateInvoiceNumber,
    downloadPDF, previewInvoice, closePreview,
  },
  clients:  { renderClients, addNewClient, deleteClient, useClient, selectClient,
              searchClients, closeClientSearch, saveCurrentClient, filterClientList },
  products: { renderProducts, addNewProduct, deleteProduct, addProductToInvoice,
              searchProducts, closeProductSearch, filterProductList },
  notifications: { addNotification, updateNotificationBadge, renderNotifications,
                   markRead, toggleNotifications, checkPaymentReminders },
  profile:  { saveProfile, loadProfileBanner, loadProfileForm, handleLogoUpload, handleSigUpload, clearProfile },
  settings: { saveSettings, togglePIN, savePIN, removePINFromSettings },
  gst:      { setGSTType, setQuickRate, calculateGST, clearCalculator,
              renderHistory, loadHistory, clearHistory },
  reports:  { generateReport, exportReportCSV, exportReportExcel, printReport },
  analytics:{ renderAnalytics },
  search:   { openGlobalSearch, closeGlobalSearch, performGlobalSearch },
  backup:   { backupData, restoreData, clearAllData },
  ocr:      { handleOCRUpload, startOCRScan, createInvoiceFromOCR, addOCRItem,
              removeOCRItem, updateOCRItem, clearOCR },
};

// ── Flat shims for HTML onclick compatibility ─────────────────────────────────

window.switchTab             = switchTab;
window.toggleSidebar         = toggleSidebar;
window.closeModal            = closeModal;
window.toggleThemeMenu       = toggleThemeMenu;
window.setTheme              = setTheme;
window.openGlobalSearch      = openGlobalSearch;
window.closeGlobalSearch     = closeGlobalSearch;
window.performGlobalSearch   = performGlobalSearch;
window.toggleNotifications   = toggleNotifications;
window.markRead              = markRead;
window.updateDashboard       = updateDashboard;
window.addItem               = addItem;
window.removeItem            = removeItem;
window.updateItem            = updateItem;
window.saveInvoice           = saveInvoice;
window.resetInvoice          = resetInvoice;
window.filterInvoiceStatus   = filterInvoiceStatus;
window.filterInvoices        = filterInvoices;
window.loadSavedInvoice      = loadSavedInvoice;
window.deleteSavedInvoice    = deleteSavedInvoice;
window.downloadSavedPDF      = downloadSavedPDF;
window.shareInvoice          = shareInvoice;
window.autoSaveInvoice       = autoSaveInvoice;
window.downloadPDF           = downloadPDF;
window.previewInvoice        = previewInvoice;
window.closePreview          = closePreview;
window.addNewClient          = addNewClient;
window.deleteClient          = deleteClient;
window.useClient             = useClient;
window.selectClient          = selectClient;
window.searchClients         = searchClients;
window.closeClientSearch     = closeClientSearch;
window.saveCurrentClient     = saveCurrentClient;
window.filterClientList      = filterClientList;
window.addNewProduct         = addNewProduct;
window.deleteProduct         = deleteProduct;
window.addProductToInvoice   = addProductToInvoice;
window.searchProducts        = searchProducts;
window.closeProductSearch    = closeProductSearch;
window.filterProductList     = filterProductList;
window.saveProfile           = saveProfile;
window.handleLogoUpload      = handleLogoUpload;
window.handleSigUpload       = handleSigUpload;
window.saveSettings          = saveSettings;
window.togglePIN             = togglePIN;
window.savePIN               = savePIN;
window.removePINFromSettings = removePINFromSettings;
window.setGSTType            = setGSTType;
window.setQuickRate          = setQuickRate;
window.calculateGST          = calculateGST;
window.clearCalculator       = clearCalculator;
window.loadHistory           = loadHistory;
window.clearHistory          = clearHistory;
window.generateReport        = generateReport;
window.exportReportCSV       = exportReportCSV;
window.exportReportExcel     = exportReportExcel;
window.printReport           = printReport;
window.renderAnalytics       = renderAnalytics;
window.backupData            = backupData;
window.restoreData           = restoreData;
window.clearAllData          = clearAllData;

// ── Bridge shims for functions called from HTML ───────────────────────────────

window.generateInvoice       = previewInvoice;
window.printInvoice          = function() { window.print(); };

window.clearProfile          = clearProfile;

window.toggleGlobalSearch    = openGlobalSearch;

// PWA install — deferred prompt captured in beforeinstallprompt listener below
window.installApp            = function() {
  if (window._deferredInstallPrompt) {
    window._deferredInstallPrompt.prompt();
    window._deferredInstallPrompt.userChoice.then(choice => {
      window._deferredInstallPrompt = null;
      const btn = document.getElementById('btnInstallApp');
      if (btn) {
        btn.disabled     = choice.outcome === 'accepted';
        btn.textContent  = choice.outcome === 'accepted' ? 'Installed' : 'Install App';
      }
    });
  } else {
    // PWA already installed or browser doesn't support install prompt
    showToast('App is already installed or unavailable in this browser', 'info');
  }
};

// Check connection — uses navigator.onLine for accurate offline-first status
window.checkOfflineStatus    = function() {
  const online  = navigator.onLine;
  const offBar  = document.getElementById('offlineBar');
  if (online) {
    offBar?.classList.remove('active');
    showToast('✓ You are online', 'success');
  } else {
    offBar?.classList.add('active');
    showToast('You are offline — Ledgerix continues to work locally', 'warning');
  }
};

window.dismissInstall        = function() {
  document.getElementById('installBanner')?.classList.remove('active');
};

window.exportExcel           = function() { showToast('Use Reports tab to export Excel', 'info'); };
window.exportReportPDF       = function() { window.print(); };
window.onReportTypeChange    = function() { /* handled by generateReport */ };
window.resetReportDates      = function() {
  const t    = today();
  const from = document.getElementById('reportFromDate');
  const to   = document.getElementById('reportToDate');
  if (from) from.value = addDays(t, -30);
  if (to)   to.value   = t;
};

window.addOCROItem           = addOCRItem;
window.handleOCRUpload       = handleOCRUpload;
window.startOCRScan          = startOCRScan;
window.createInvoiceFromOCR  = createInvoiceFromOCR;
window.addOCRItem            = addOCRItem;
window.removeOCRItem         = removeOCRItem;
window.updateOCRItem         = updateOCRItem;
window.clearOCR              = clearOCR;

// toggleSettings — switches to settings tab
window.toggleSettings = function() { switchTab('settings'); };

// generateInvoiceNumber — Auto button in invoice form refreshes the number
window.generateInvoiceNumber = function() {
  const el = document.getElementById('invNumber');
  if (el) el.value = (window._ledgerix.invoice.generateInvoiceNumber || (() => ''))();
};

window.showRestoreModal      = function() {
  const el    = document.getElementById('modalContent');
  const title = document.getElementById('modalTitle');
  if (title) title.textContent = 'Restore Backup';
  if (el) el.innerHTML = `
    <p style="color:var(--c-text-mute);font-size:0.85rem;margin-bottom:1rem">Select your Ledgerix backup JSON file.</p>
    <input type="file" id="restoreFileInput" accept=".json" class="form-input" style="margin-bottom:0.8rem"
      onchange="restoreData(event)">
    <button class="btn btn-primary" style="width:100%" onclick="document.getElementById('restoreFileInput').click()">
      <i class="fas fa-upload"></i> Select Backup File
    </button>
  `;
  document.getElementById('modalOverlay')?.classList.add('active');
};

// ── Application Bootstrap ─────────────────────────────────────────────────────
//
// Boot sequence (v2.2 fixed order):
//   1. DOMContentLoaded fires
//   2. hideSplash() — always dismiss splash immediately (short delay for first-time UX)
//   3. checkPIN()   — shows PIN overlay if PIN is set; ALWAYS resolves, never hangs
//   4. loadAllData()— decrypt & hydrate state
//   5. Init UI
//
// If any step throws, the catch ensures the app still mounts in a usable state.
// hideSplash is called BEFORE checkPIN so:
//   - splash disappears on schedule
//   - PIN overlay appears cleanly on top without being hidden behind splash z-index

document.addEventListener('DOMContentLoaded', async function () {

  // Step 1: Always dismiss the splash screen first.
  // This guarantees the splash NEVER hangs regardless of PIN or error state.
  hideSplash();

  try {
    // Step 2: If PIN is set, show the unlock overlay.
    // checkPIN() always resolves — it never hangs or rejects permanently.
    await checkPIN();

    // Step 3: Decrypt and hydrate all application state.
    await loadAllData();

    // Step 4: Init form defaults
    const t = today();
    const invDate    = document.getElementById('invDate');
    const invDueDate = document.getElementById('invDueDate');
    const rptFrom    = document.getElementById('reportFromDate');
    const rptTo      = document.getElementById('reportToDate');
    if (invDate)    invDate.value    = t;
    if (invDueDate) invDueDate.value = addDays(t, 7);
    if (rptFrom)    rptFrom.value    = addDays(t, -30);
    if (rptTo)      rptTo.value      = t;

    // Set invoice number
    const invNum = document.getElementById('invNumber');
    if (invNum) invNum.value = generateInvoiceNumber();

    // Step 5: Render UI
    renderItems();
    updateDashboard();
    setupOfflineDetection();
    renderNotifications();

    // Lazy: payment reminders after short delay
    setTimeout(() => checkPaymentReminders(), 2500);

    // Sync PIN toggle UI state
    const pinEnabled = document.getElementById('pinEnabled');
    const pinSetup   = document.getElementById('pinSetup');
    const pinRemove  = document.getElementById('pinRemove');
    const hasPIN     = !!localStorage.getItem(AppConfig.STORAGE_KEYS.PIN);
    if (pinEnabled) pinEnabled.checked = hasPIN;
    if (pinSetup)   pinSetup.style.display  = 'none';
    if (pinRemove)  pinRemove.style.display  = hasPIN ? 'block' : 'none';

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeGlobalSearch();
        document.getElementById('notificationPanel')?.classList.remove('active');
        document.getElementById('modalOverlay')?.classList.remove('active');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openGlobalSearch();
      }
    });

    // Click-outside to close notification panel (critical for mobile — no Escape key)
    document.addEventListener('click', e => {
      const panel  = document.getElementById('notificationPanel');
      const btn    = document.querySelector('[onclick="toggleNotifications()"]');
      if (panel && panel.classList.contains('active')) {
        if (!panel.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
          panel.classList.remove('active');
        }
      }
    }, { passive: true });

    // Sidebar overlay
    document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);

    // Note: invoice auto-save is handled by individual onchange="autoSaveInvoice()" 
    // attributes on each form field. No form wrapper ID is needed.

  } catch (e) {
    console.error('[App] Startup error:', e);
    // Even on error, the splash is already hidden (step 1 above), so the app
    // remains accessible — user sees whatever state loaded before the error.
  }
});

// ── PWA install prompt capture ────────────────────────────────────────────────

window._deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window._deferredInstallPrompt = e;
  // Show install banner if present
  document.getElementById('installBanner')?.classList.add('active');
  const btn = document.getElementById('btnInstallApp');
  if (btn) btn.disabled = false;
});

window.addEventListener('appinstalled', () => {
  window._deferredInstallPrompt = null;
  document.getElementById('installBanner')?.classList.remove('active');
  showToast('Ledgerix installed successfully!', 'success');
});
