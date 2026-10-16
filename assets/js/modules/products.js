/**
 * Ledgerix - Products Module
 * v2.3 fix: searchProducts() now reads from the actual HTML id="productSearch"
 *           (was reading id="productSearchInput" which doesn't exist).
 *           Also accepts the search value as a direct argument (HTML passes this.value).
 */

'use strict';

import * as State from '../core/state.js';
import { nextId } from '../core/state.js';
import { saveProducts } from '../core/storage.js';
import { showToast } from '../ui/toast.js';
import { esc, formatMoney } from '../utils/helpers.js';

export function renderProducts() {
  const list = document.getElementById('productsList');
  if (!list) return;

  // productListSearch = search in Products tab; productSearch = search in Invoice tab
  const q        = (document.getElementById('productListSearch')?.value || document.getElementById('productSearch')?.value || '').toLowerCase();
  const products = q
    ? State.products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.hsn && p.hsn.toLowerCase().includes(q)))
    : State.products;

  list.innerHTML = products.length === 0
    ? `<div class="empty-state"><i class="fas fa-box-open"></i><h3>No products yet</h3><p>Add your first product below.</p></div>`
    : products.map(p => `
      <div class="product-card">
        <div class="card-info">
          <h4>${esc(p.name)}</h4>
          <p>HSN: ${esc(p.hsn || 'N/A')} | Rate: ${formatMoney(p.rate)} | GST: ${p.gst}% | Stock: ${p.stock || 0}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-info btn-sm" onclick="window._ledgerix.products.addProductToInvoice(${p.id})" title="Add to invoice"><i class="fas fa-plus"></i></button>
          <button class="btn btn-danger btn-sm" onclick="window._ledgerix.products.deleteProduct(${p.id})" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
}

function _storageErr(err) {
  if (err && (err.name === 'QuotaExceededError' || err.code === 22)) return 'browser storage is full. Export a backup and free some space.';
  return (err && err.message) ? err.message : 'unknown storage error';
}

export function addNewProduct() {
  const name  = document.getElementById('newProductName')?.value.trim();
  const hsn   = document.getElementById('newProductHSN')?.value.trim()  || '';
  const rateS = document.getElementById('newProductRate')?.value;
  const gstS  = document.getElementById('newProductGST')?.value;
  const stockS = document.getElementById('newProductStock')?.value;

  if (!name) { showToast('Product name is required', 'warning'); return; }

  const rate  = rateS === '' || rateS == null ? 0 : parseFloat(rateS);
  // GST 0 % is a valid rate (exempt goods) — the old `|| 18` turned it into 18 %.
  const gst   = gstS === '' || gstS == null ? 18 : parseFloat(gstS);
  const stock = stockS === '' || stockS == null ? 0 : parseInt(stockS, 10);

  if (!Number.isFinite(rate) || rate < 0)            { showToast('Rate must be a number of 0 or more', 'warning'); return; }
  if (!Number.isFinite(gst) || gst < 0 || gst > 100) { showToast('GST % must be between 0 and 100', 'warning'); return; }
  if (!Number.isFinite(stock) || stock < 0)          { showToast('Stock must be 0 or more', 'warning'); return; }

  if (State.products.some(p => p.name.trim().toLowerCase() === name.toLowerCase() && (p.hsn || '').trim() === hsn)) {
    showToast('This product already exists (same name and HSN).', 'warning');
    return;
  }

  const prev = State.products;
  try {
    State.setProducts([...prev, { id: nextId(), name, hsn, rate, gst, stock }]);
    saveProducts();
  } catch (err) {
    State.setProducts(prev);
    console.error('[Products] save failed:', err);
    showToast('Product NOT saved: ' + _storageErr(err), 'error');
    return;
  }

  ['newProductName','newProductHSN','newProductRate','newProductGST','newProductStock']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  renderProducts();
  showToast('Product saved!', 'success');
}

export function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  const prev = State.products;
  State.setProducts(prev.filter(p => p.id !== id));
  try { saveProducts(); } catch (err) {
    State.setProducts(prev);
    showToast('Product NOT deleted: ' + _storageErr(err), 'error');
    return;
  }
  renderProducts();
  showToast('Product deleted', 'warning');
}

export function addProductToInvoice(id) {
  const p = State.products.find(p => p.id === id);
  if (!p) return;
  import('./invoice.js').then(m => {
    m.addItem(p.name, p.hsn || '', 1, p.rate, p.gst, 0);
    closeProductSearch();
    // Clear the search input
    const inp = document.getElementById('productSearch');
    if (inp) inp.value = '';
    showToast(`"${p.name}" added to invoice`, 'success');
  }).catch(err => {
    console.error('[Products] addProductToInvoice failed:', err);
    showToast('Could not add product to invoice', 'error');
  });
}

/**
 * searchProducts — called from HTML as: oninput="searchProducts(this.value)"
 * Accepts the search query directly as argument (more reliable than re-reading DOM).
 * Also works when called with no argument (reads from #productSearch).
 */
export function searchProducts(queryArg) {
  const results = document.getElementById('productSearchResults');
  if (!results) return;

  // Accept value passed directly from oninput, or read from the input element
  const q = (queryArg !== undefined
    ? String(queryArg)
    : (document.getElementById('productSearch')?.value || '')
  ).toLowerCase().trim();

  if (q.length < 1) { results.style.display = 'none'; return; }

  const matches = State.products.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.hsn && p.hsn.toLowerCase().includes(q)));

  if (!matches.length) {
    results.style.display = 'block';
    results.innerHTML = `<div class="product-item" style="color:var(--c-text-mute);cursor:default">
      <span>No products match "${esc(q)}"</span>
    </div>`;
    return;
  }

  results.style.display = 'block';
  results.innerHTML = matches.map(p => `
    <div class="product-item" onclick="window._ledgerix.products.addProductToInvoice(${p.id})" style="cursor:pointer">
      <div>
        <strong>${esc(p.name)}</strong>
        <br><small style="color:var(--c-text-mute)">HSN: ${esc(p.hsn || '—')} · ${formatMoney(p.rate)} · GST ${p.gst}%</small>
      </div>
      <i class="fas fa-plus-circle" style="color:var(--c-gold)"></i>
    </div>`).join('');
}

export function closeProductSearch() {
  const el = document.getElementById('productSearchResults');
  if (el) el.style.display = 'none';
}

export function filterProductList() {
  renderProducts();
}
