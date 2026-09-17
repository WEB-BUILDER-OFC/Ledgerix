/**
 * Ledgerix - Utility Helpers
 * Pure functions with no side effects. No DOM, no state.
 */

'use strict';

import * as State from '../core/state.js';

// ── XSS escaping ─────────────────────────────────────────────────────────────

export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Currency / number formatting ─────────────────────────────────────────────

export function formatMoney(amount) {
  const currency = State.settings.currency || 'INR';
  const symbols  = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SGD: 'S$' };
  const symbol   = symbols[currency] || currency;
  return symbol + (parseFloat(amount) || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

export function numberToWords(num) {
  const lang = (State.settings && State.settings.language) || 'en';
  const n = Math.round(num);

  if (n === 0) {
    const zeroMap = { hi: 'शून्य रुपये मात्र', mr: 'शून्य रुपये फक्त', gu: 'શૂન્ય રૂપિયા માત્ર' };
    return (lang !== 'en' && zeroMap[lang]) ? zeroMap[lang] : 'Zero';
  }

  if (lang !== 'en') {
    try {
      const localeMap  = { hi: 'hi-IN', mr: 'mr-IN', gu: 'gu-IN' };
      const suffixMap  = { hi: 'रुपये मात्र', mr: 'रुपये फक्त', gu: 'રૂપિયા માત્ર' };
      const formatted  = new Intl.NumberFormat(localeMap[lang] || 'en-IN').format(n);
      return formatted + ' ' + (suffixMap[lang] || 'Rupees Only');
    } catch (e) { /* fall through */ }
  }

  const ones  = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine'];
  const teens = ['Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens  = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  function convert(n) {
    if (n < 10)        return ones[n];
    if (n < 20)        return teens[n - 10];
    if (n < 100)       return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000)      return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 100000)    return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000)  return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }
  return convert(n);
}

// ── Date helpers ─────────────────────────────────────────────────────────────

export function today() {
  return new Date().toISOString().split('T')[0];
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function daysBetween(from, to) {
  const a = new Date(from), b = new Date(to);
  return Math.round((b - a) / 86400000);
}

export function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

export function getWeekEnd(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + (6 - d.getDay()));
  return d.toISOString().split('T')[0];
}

export function getMonthStart(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

export function getMonthEnd(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
}

export function getYearStart(date) {
  const d = new Date(date);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

export function getYearEnd(date) {
  const d = new Date(date);
  const y = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear();
  return `${y}-03-31`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const fmt = (State.settings && State.settings.dateFormat) || 'DD/MM/YYYY';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return fmt.replace('DD', dd).replace('MM', mm).replace('YYYY', yyyy);
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateGSTIN(gstin) {
  if (!gstin) return true;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin);
}

export function validateEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePhone(phone) {
  if (!phone) return true;
  const digits = phone.replace(/[^0-9]/g, '');
  return /^[\+]?[0-9\s\-\(\)]{10,15}$/.test(phone) && digits.length >= 10;
}

// ── CSV field quoting ─────────────────────────────────────────────────────────

export function csvField(v) {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

// ── Current Indian Financial Year ─────────────────────────────────────────────
// Returns FY string in "YYYY-YY" format.
// Indian FY: April 1 – March 31.
//   Jan–Mar  → previous calendar year is the FY start (e.g. 2027-01 → 2026-27)
//   Apr–Dec  → current calendar year is the FY start  (e.g. 2026-09 → 2026-27)

export function currentFY() {
  const startStr = getYearStart(today()); // e.g. "2026-04-01"
  const startYear = parseInt(startStr.substring(0, 4), 10);
  const endYY = String(startYear + 1).slice(-2);
  return startYear + '-' + endYY;
}
