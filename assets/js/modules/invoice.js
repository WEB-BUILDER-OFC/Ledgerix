/**
 * Ledgerix - Invoice Module
 * All persistence goes through core/storage.js — no direct localStorage access.
 */

'use strict';

import AppConfig from '../../../config/app.config.js';
import * as State from '../core/state.js';
import { nextId } from '../core/state.js';
import { saveInvoices, saveInvoiceCounter, clearDraft, saveDraft } from '../core/storage.js';
import { showToast } from '../ui/toast.js';
import { esc, formatMoney, today, addDays, numberToWords, currentFY } from '../utils/helpers.js';

let _autoSaveTimer = null;

// ── Item management ───────────────────────────────────────────────────────────

export function addItem(desc = '', hsn = '', qty = 1, rate = 0, gst = State.settings.defaultGST || 18, disc = 0) {
  const id = nextId();
  State.items.push({ id, desc, hsn, qty, rate: parseFloat(rate), gst: parseFloat(gst), disc: parseFloat(disc) || 0 });
  renderItems();
  autoSaveInvoice();
}

export function removeItem(idx) {
  State.items.splice(idx, 1);
  renderItems();
  autoSaveInvoice();
}

export function updateItem(idx, field, value) {
  if (!State.items[idx]) return;
  State.items[idx][field] = ['qty','rate','gst','disc'].includes(field) ? parseFloat(value) || 0 : value;
  renderItems();
  autoSaveInvoice();
}

export function renderItems() {
  const tbody = document.getElementById('itemsTableBody');
  if (!tbody) return;

  if (State.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--gray);padding:2rem">No items added yet</td></tr>';
    _updateTotals(0, 0, 0);
    return;
  }

  let subtotal = 0, totalGST = 0;
  tbody.innerHTML = State.items.map((it, idx) => {
    const amount = (it.qty * it.rate) * (1 - (it.disc || 0) / 100);
    const gstAmt = amount * (it.gst / 100);
    subtotal += amount;
    totalGST += gstAmt;
    return `<tr>
      <td><input type="text" class="item-input" value="${esc(it.desc)}" onchange="window._ledgerix.invoice.updateItem(${idx},'desc',this.value)" placeholder="Description"></td>
      <td><input type="text" class="item-input" value="${esc(it.hsn)}" onchange="window._ledgerix.invoice.updateItem(${idx},'hsn',this.value)" placeholder="HSN"></td>
      <td><input type="number" class="item-input" value="${it.qty}" onchange="window._ledgerix.invoice.updateItem(${idx},'qty',this.value)" min="0.01" step="0.01"></td>
      <td><input type="number" class="item-input" value="${it.rate}" onchange="window._ledgerix.invoice.updateItem(${idx},'rate',this.value)" min="0"></td>
      <td><input type="number" class="item-input" value="${it.gst}" onchange="window._ledgerix.invoice.updateItem(${idx},'gst',this.value)" min="0" max="28"></td>
      <td><input type="number" class="item-input" value="${it.disc || 0}" onchange="window._ledgerix.invoice.updateItem(${idx},'disc',this.value)" min="0" max="100"></td>
      <td style="text-align:right">${formatMoney(amount)}</td>
      <td style="text-align:right;color:var(--warning)">${formatMoney(gstAmt)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="window._ledgerix.invoice.removeItem(${idx})"><i class="fas fa-trash"></i></button></td>
    </tr>`;
  }).join('');

  const shipping  = parseFloat(document.getElementById('invShipping')?.value)  || 0;
  const packaging = parseFloat(document.getElementById('invPackaging')?.value) || 0;
  const handling  = parseFloat(document.getElementById('invHandling')?.value)  || 0;
  const grandTotal = subtotal + totalGST + shipping + packaging + handling;

  _updateTotals(subtotal, totalGST, grandTotal);
}

function _updateTotals(subtotal, totalGST, grandTotal) {
  const roundOff   = document.getElementById('invRoundOff')?.checked;
  const rounded    = roundOff ? Math.round(grandTotal) : grandTotal;
  const roundDiff  = rounded - grandTotal;
  function setEl(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
  setEl('invSubtotal',   formatMoney(subtotal));
  setEl('invTotalGST',   formatMoney(totalGST));
  setEl('invGrandTotal', formatMoney(rounded));
  const rdEl = document.getElementById('invRoundDiff');
  if (rdEl) rdEl.textContent = roundOff && Math.abs(roundDiff) > 0.001
    ? (roundDiff > 0 ? '+' : '') + formatMoney(roundDiff) : '';
  const wordsEl = document.getElementById('invAmountWords');
  if (wordsEl) wordsEl.textContent = numberToWords(Math.round(rounded)) + ' Rupees Only';
}

// ── Auto-save draft ────────────────────────────────────────────────────────────

export function autoSaveInvoice() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    const draft = {
      client:        document.getElementById('invClient')?.value,
      clientAddr:    document.getElementById('invClientAddr')?.value,
      clientGSTIN:   document.getElementById('invClientGSTIN')?.value,
      clientPhone:   document.getElementById('invClientPhone')?.value,
      clientEmail:   document.getElementById('invClientEmail')?.value,
      invNum:        document.getElementById('invNumber')?.value,
      invDate:       document.getElementById('invDate')?.value,
      dueDate:       document.getElementById('invDueDate')?.value,
      paymentStatus: document.getElementById('invPaymentStatus')?.value,
      paymentMethod: document.getElementById('invPaymentMethod')?.value,
      taxType:       document.getElementById('invTaxType')?.value,
      shipping:      document.getElementById('invShipping')?.value,
      packaging:     document.getElementById('invPackaging')?.value,
      handling:      document.getElementById('invHandling')?.value,
      terms:         document.getElementById('invTerms')?.value,
      notes:         document.getElementById('invNotes')?.value,
      items:         State.items,
    };
    saveDraft(draft);
  }, AppConfig.AUTOSAVE_DEBOUNCE_MS);
}

// ── Invoice number ─────────────────────────────────────────────────────────────

export function generateInvoiceNumber() {
  const prefix = State.profile.prefix || 'INV';
  const fy     = State.profile.fy     || currentFY();
  return `${prefix}/${fy}/${String(State.invoiceCounter).padStart(4, '0')}`;
}

// ── Get invoice data from form ─────────────────────────────────────────────────

export function getInvoiceData() {
  const clientName = document.getElementById('invClient')?.value.trim();
  if (!clientName) { showToast('Please enter client name', 'warning'); return null; }
  if (State.items.length === 0) { showToast('Please add at least one item', 'warning'); return null; }

  let subtotal = 0, totalGST = 0;
  const itemRows = State.items.map(it => {
    const amount = (it.qty * it.rate) * (1 - (it.disc || 0) / 100);
    const gstAmt = amount * (it.gst / 100);
    subtotal += amount;
    totalGST += gstAmt;
    return { ...it, amount: amount.toFixed(2), gstAmount: gstAmt.toFixed(2) };
  });

  const shipping  = parseFloat(document.getElementById('invShipping')?.value)  || 0;
  const packaging = parseFloat(document.getElementById('invPackaging')?.value) || 0;
  const handling  = parseFloat(document.getElementById('invHandling')?.value)  || 0;
  const grandTotal = subtotal + totalGST + shipping + packaging + handling;

  return {
    invNum:        document.getElementById('invNumber')?.value || generateInvoiceNumber(),
    invDate:       document.getElementById('invDate')?.value,
    dueDate:       document.getElementById('invDueDate')?.value,
    clientName,
    clientAddr:    document.getElementById('invClientAddr')?.value.trim(),
    clientGSTIN:   document.getElementById('invClientGSTIN')?.value.trim(),
    clientPhone:   document.getElementById('invClientPhone')?.value.trim(),
    clientEmail:   document.getElementById('invClientEmail')?.value.trim(),
    taxType:       document.getElementById('invTaxType')?.value     || 'intra',
    paymentStatus: document.getElementById('invPaymentStatus')?.value || 'pending',
    paymentMethod: document.getElementById('invPaymentMethod')?.value || '',
    shipping, packaging, handling,
    terms:     document.getElementById('invTerms')?.value,
    notes:     document.getElementById('invNotes')?.value,
    itemRows,
    subtotal:  subtotal.toFixed(2),
    totalGST:  totalGST.toFixed(2),
    grandTotal: (document.getElementById('invRoundOff')?.checked
      ? Math.round(grandTotal)
      : grandTotal).toFixed(2),
    dueBadge: '',
  };
}

// ── Save invoice ───────────────────────────────────────────────────────────────

export async function saveInvoice() {
  const data = getInvoiceData();
  if (!data) return;

  // Duplicate number check
  const dupe = State.savedInvoices.find(i => i.invNum === data.invNum);
  if (dupe && !confirm(`Invoice ${data.invNum} already exists. Save as new copy anyway?`)) return;

  const invoice = { id: nextId(), ...data, savedAt: new Date().toLocaleString() };
  State.savedInvoices.unshift(invoice);
  await saveInvoices();

  State.setInvoiceCounter(State.invoiceCounter + 1);
  saveInvoiceCounter();          // centralised — no direct localStorage access
  clearTimeout(_autoSaveTimer);
  clearDraft();

  showToast('Invoice saved!', 'success', true);
  import('./dashboard.js').then(m => m.updateDashboard());
}

// ── Reset invoice ──────────────────────────────────────────────────────────────

export function resetInvoice() {
  clearTimeout(_autoSaveTimer);
  State.setItems([]);
  renderItems();
  clearDraft();

  const fields = ['invClient','invClientAddr','invClientGSTIN','invClientPhone','invClientEmail',
                  'invShipping','invPackaging','invHandling','invTerms','invNotes'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const invNum  = document.getElementById('invNumber');
  if (invNum)  invNum.value  = generateInvoiceNumber();
  const invDate = document.getElementById('invDate');
  if (invDate) invDate.value = today();
  const dueDate = document.getElementById('invDueDate');
  if (dueDate) dueDate.value = addDays(today(), 7);

  showToast('Invoice reset!', 'info');
}

// ── Saved invoices list ────────────────────────────────────────────────────────

export function renderInvoicesList() {
  const list = document.getElementById('savedInvoicesList');
  if (!list) return;

  const filter = State.currentInvoiceFilter;
  const q      = (document.getElementById('invoiceSearch')?.value || '').toLowerCase();

  let filtered = State.savedInvoices;
  if (filter !== 'all') filtered = filtered.filter(inv => inv.paymentStatus === filter);
  if (q) filtered = filtered.filter(inv =>
    inv.invNum.toLowerCase().includes(q) || inv.clientName.toLowerCase().includes(q));

  list.innerHTML = filtered.length === 0
    ? '<p style="color:var(--gray);text-align:center;padding:2rem">No invoices found</p>'
    : filtered.map(inv => `
      <div class="saved-invoice-item">
        <div style="flex:1">
          <h4 style="color:var(--gold);font-size:0.9rem">${esc(inv.invNum)} - ${esc(inv.clientName)}</h4>
          <p style="color:var(--gray);font-size:0.75rem">${esc(inv.invDate)} | Due: ${esc(inv.dueDate)} | ${inv.itemRows.length} items | Total: ${formatMoney(inv.grandTotal)}</p>
          <span class="badge badge-${esc(inv.paymentStatus)}">${esc(inv.paymentStatus)}</span>
          ${inv.paymentMethod ? `<span style="font-size:0.7rem;color:var(--gray);margin-left:0.5rem">${esc(inv.paymentMethod)}</span>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn btn-info btn-sm" onclick="window._ledgerix.invoice.loadSavedInvoice(${inv.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-success btn-sm" onclick="window._ledgerix.invoice.downloadSavedPDF(${inv.id})"><i class="fas fa-file-pdf"></i></button>
          <button class="btn btn-danger btn-sm" onclick="window._ledgerix.invoice.deleteSavedInvoice(${inv.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
}

export function filterInvoiceStatus(status) {
  State.setCurrentInvoiceFilter(status);
  // Highlight matching sub-tab by its onclick content (no event argument needed)
  document.querySelectorAll('#invoices-tab .sub-tab').forEach(t => {
    const onclick = t.getAttribute('onclick') || '';
    t.classList.toggle('active', onclick.includes("'" + status + "'"));
  });
  renderInvoicesList();
}

export function filterInvoices() { renderInvoicesList(); }

export function loadSavedInvoice(id) {
  const inv = State.savedInvoices.find(i => i.id === id);
  if (!inv) return;

  import('../ui/navigation.js').then(m => m.switchTab('invoice'));

  setTimeout(() => {
    const fields = {
      invClient:        inv.clientName,
      invClientAddr:    inv.clientAddr    || '',
      invClientGSTIN:   inv.clientGSTIN   || '',
      invClientPhone:   inv.clientPhone   || '',
      invClientEmail:   inv.clientEmail   || '',
      invNumber:        inv.invNum,
      invDate:          inv.invDate,
      invDueDate:       inv.dueDate,
      invPaymentStatus: inv.paymentStatus,
      invPaymentMethod: inv.paymentMethod || '',
      invTaxType:       inv.taxType       || 'intra',
      invShipping:      inv.shipping      || 0,
      invPackaging:     inv.packaging     || 0,
      invHandling:      inv.handling      || 0,
      invTerms:         inv.terms         || '',
      invNotes:         inv.notes         || '',
    };
    Object.entries(fields).forEach(([k, v]) => { const el = document.getElementById(k); if (el) el.value = v; });
    State.setItems(inv.itemRows.map(it => ({ ...it, id: nextId() })));
    renderItems();
  }, 150);
}

export async function deleteSavedInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  State.setSavedInvoices(State.savedInvoices.filter(i => i.id !== id));
  await saveInvoices();
  renderInvoicesList();
  import('./dashboard.js').then(m => m.updateDashboard());
  showToast('Invoice deleted!', 'warning', true);
}

export async function downloadSavedPDF(id) {
  const inv = State.savedInvoices.find(i => i.id === id);
  if (!inv) return;
  import('./pdf.js').then(m => m.downloadPDFFromData(inv));
}

// ── Share invoice ──────────────────────────────────────────────────────────────

export function shareInvoice() {
  const data = getInvoiceData();
  if (!data) return;

  const text    = `Invoice ${data.invNum}\nClient: ${data.clientName}\nAmount: ${formatMoney(data.grandTotal)}\nStatus: ${data.paymentStatus}`;
  const modal   = document.getElementById('modalContent');
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.textContent = 'Share Invoice';

  modal.innerHTML = '<div class="share-grid" id="shareGrid"></div>';
  const grid = document.getElementById('shareGrid');
  const enc  = encodeURIComponent(text);

  function makeBtn(cls, icon, label, action) {
    const btn = document.createElement('button');
    btn.className = 'share-btn ' + cls;
    btn.innerHTML = `<i class="${icon}"></i> ${label}`;
    btn.addEventListener('click', action);
    grid.appendChild(btn);
  }

  makeBtn('share-whatsapp', 'fab fa-whatsapp',  'WhatsApp',  () => window.open('https://wa.me/?text=' + enc, '_blank'));
  makeBtn('share-email',    'fas fa-envelope',  'Email',     () => window.open(`mailto:?subject=Invoice ${encodeURIComponent(data.invNum)}&body=${enc}`, '_blank'));
  makeBtn('share-telegram', 'fab fa-telegram',  'Telegram',  () => window.open('https://t.me/share/url?url=' + encodeURIComponent(window.location.href) + '&text=' + enc, '_blank'));
  makeBtn('share-copy',     'fas fa-copy',      'Copy',      () => { navigator.clipboard.writeText(text); showToast('Copied!', 'success'); import('../ui/navigation.js').then(m => m.closeModalDirect()); });

  document.getElementById('modalOverlay').classList.add('active');
}
