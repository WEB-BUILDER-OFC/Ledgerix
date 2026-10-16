/**
 * Ledgerix - OCR / PDF-text invoice parser (v2.11.2)
 *
 * Pure functions, no DOM, no State — unit-testable in Node and in the browser.
 *
 * Why this exists: the previous parser took "the first line" as the vendor, the first
 * "no/#" token as the bill number and every line ending in a digit as an item. On a real
 * invoice that picks up status words, table headers and unrelated numbers.
 *
 * This parser works from LABELS and TABLE STRUCTURE, validates every number, cross-checks
 * subtotal + tax + extras against the grand total (and the amount in words), and returns
 * explicit `flags` for anything uncertain. It never invents a value: a field it cannot
 * read is returned empty and flagged.
 *
 * Input  : { text, lines? }  where lines = [{ text, words:[{text,conf,x0,y0,x1,y1}], conf }]
 *          (Tesseract `data.lines`, or text lines rebuilt from a PDF text layer).
 *          If `lines` is missing the plain `text` is split on newlines.
 * Output : see parseInvoiceOCR() — { vendor, invoiceNo, date, dueDate, gstin, items,
 *          totals, flags, kind, confidence, needsReview }
 */

'use strict';

// ── Number helpers ───────────────────────────────────────────────────────────

const CURRENCY_RX = /(?:rs\.?|inr|₹|¹|\$|€|£|usd|eur)/gi;

/**
 * Parse a money / quantity string. Handles Indian (1,18,030.00) and Western
 * (1,039,800.00) grouping, plain decimals, a trailing "Rs." / "INR" / ₹ and the
 * common OCR confusions O→0, l/I/|→1 *inside otherwise numeric tokens*.
 * Returns { value, ambiguous } or null if the string is not a number.
 */
export function parseAmount(str) {
  if (str == null) return null;
  let s = String(str).trim();
  if (!s) return null;
  s = s.replace(CURRENCY_RX, '').replace(/[\s\u00a0]/g, '');
  s = s.replace(/^[^\dA-Za-z.|]+/, '').replace(/^[RrZzTtXxYyFf](?=\d)/, '').replace(/[^\dA-Za-z|]+$/, '');   // OCR leaves ' ‘ * : - (or a look-alike letter) around numbers
  // OCR confusions only when the token is otherwise digit-like
  if (/^[\dOolI|,.]+$/.test(s) && /\d/.test(s)) s = s.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1');
  s = s.replace(/,\.(?=\d)|\.,(?=\d)/g, ',');                        // OCR speck between digits: "49,.500" → "49,500"
  if (!/^\d[\d,.]*$/.test(s) && !/^\.\d+$/.test(s)) return null;

  let ambiguous = false;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let intPart = s, frac = '';
  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) {                    // 1,234.56   (Western / Indian)
      intPart = s.slice(0, lastDot).replace(/,/g, ''); frac = s.slice(lastDot + 1);
    } else {                                      // 1.234,56   (European)
      intPart = s.slice(0, lastComma).replace(/\./g, ''); frac = s.slice(lastComma + 1); ambiguous = true;
    }
  } else if (lastDot > -1) {
    const parts = s.split('.');
    if (parts.length > 2) {                       // 1.234.567  → dots are thousands separators
      intPart = parts.join(''); ambiguous = true;
    } else { intPart = parts[0]; frac = parts[1]; }
  } else if (lastComma > -1) {
    const parts = s.split(',');
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length !== 3 && last.length <= 2) {   // 10,50 → decimal comma
      intPart = parts[0]; frac = last; ambiguous = true;
    } else {
      // thousands commas: every group after the first must be 2 or 3 digits (Indian/Western)
      if (!parts.slice(1).every(g => g.length === 2 || g.length === 3)) return null;
      intPart = parts.join('');
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const value = parseFloat((intPart || '0') + (frac ? '.' + frac : ''));
  return Number.isFinite(value) ? { value, ambiguous } : null;
}

/** Last money amount on a line (ignores GST rates such as "@ 18%"), or null. */
function lastAmountIn(text) {
  const toks = text.replace(/(\d)\s*%/g, '$1%').split(/\s+/).filter(Boolean);
  for (let i = toks.length - 1; i >= 0; i--) {
    if (/%$/.test(toks[i])) continue;
    const a = parseAmount(toks[i]);
    if (a && (/[.,]/.test(toks[i]) || toks[i].replace(/\D/g, '').length >= 1)) return { ...a, alt: _altAmount(toks[i]) };
  }
  return null;
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

function _validYMD(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const _iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Returns { iso, ambiguous } or null. Day-first is assumed for numeric dd/mm/yyyy (India). */
export function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (m && _validYMD(+m[1], +m[2], +m[3])) return { iso: _iso(+m[1], +m[2], +m[3]), ambiguous: false };
  m = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (_validYMD(y, b, a)) return { iso: _iso(y, b, a), ambiguous: a <= 12 && b <= 12 && a !== b };
    if (_validYMD(y, a, b)) return { iso: _iso(y, a, b), ambiguous: false };
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[\s,\-]+(\d{2,4})\b/);
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] || (m && MONTHS[m[2].slice(0, 3).toLowerCase()])) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()] || MONTHS[m[2].slice(0, 4).toLowerCase()];
    let y = +m[3]; if (y < 100) y += 2000;
    if (_validYMD(y, mon, +m[1])) return { iso: _iso(y, mon, +m[1]), ambiguous: false };
  }
  m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] && _validYMD(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])) {
    return { iso: _iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]), ambiguous: false };
  }
  return null;
}

// ── GSTIN ────────────────────────────────────────────────────────────────────

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check-character (mod-36 Luhn variant). */
export function gstinChecksumOK(g) {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** Finds GSTIN candidates; repairs digit/letter OCR swaps by position. */
export function findGSTINs(text) {
  const out = [];
  const rx = /\b([0-9OIlSBZDQG]{2}[A-Z0-9]{5}[0-9OIlSBZDQG]{4}[A-Z0-9][A-Z0-9]Z[A-Z0-9])\b/gi;
  let m;
  while ((m = rx.exec(text))) {
    const raw = m[1].toUpperCase();
    const D = { O: '0', D: '0', Q: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };   // letter→digit
    const L = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' }; // digit→letter
    const fixed = raw.split('').map((c, i) => {
      const digitPos = i < 2 || (i >= 7 && i <= 10);
      const letterPos = (i >= 2 && i <= 6) || i === 11;
      if (digitPos && D[c]) return D[c];
      if (letterPos && L[c]) return L[c];
      return c;
    }).join('');
    if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(fixed) && +fixed.slice(0, 2) >= 1 && +fixed.slice(0, 2) <= 38) {
      out.push({ value: fixed, checksum: gstinChecksumOK(fixed), repaired: fixed !== raw, index: m.index });
    }
  }
  return out;
}

// ── Amount in words → number (validates the grand total independently) ─────

const W_ONES = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11,
  twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19 };
const W_TENS = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };

export function wordsToNumber(str) {
  if (!str) return null;
  const words = String(str).toLowerCase().replace(/\b(?:rupees?|only|and|paise)\b|[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let total = 0, current = 0, seen = false;
  for (const w of words) {
    if (w in W_ONES)       { current += W_ONES[w]; seen = true; }
    else if (w in W_TENS)  { current += W_TENS[w]; seen = true; }
    else if (w === 'hundred')  { current = (current || 1) * 100; seen = true; }
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; seen = true; }
    else if (w === 'lakh' || w === 'lakhs' || w === 'lac') { total += (current || 1) * 100000; current = 0; seen = true; }
    else if (w === 'crore' || w === 'crores') { total += (current || 1) * 10000000; current = 0; seen = true; }
    else return null;                              // an unknown word → not a clean amount-in-words line
  }
  return seen ? total + current : null;
}

// ── Line building ────────────────────────────────────────────────────────────

function _toLines(input) {
  if (Array.isArray(input.lines) && input.lines.length) {
    return input.lines
      .map(l => {
        const words = (l.words || []).filter(w => w && String(w.text).trim());
        const text = (l.text != null ? String(l.text) : words.map(w => w.text).join(' ')).replace(/\s+/g, ' ').trim();
        const hs = words.map(w => (w.y1 - w.y0)).filter(h => h > 0);
        return {
          text, words,
          conf: l.conf != null ? l.conf : (words.length ? words.reduce((a, w) => a + (w.conf || 0), 0) / words.length : null),
          y0: words.length ? Math.min(...words.map(w => w.y0)) : null,
          h: hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null,
        };
      })
      .filter(l => l.text.length > 0);
  }
  return String(input.text || '').split(/\r?\n/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map(t => ({ text: t, words: [], conf: null, y0: null, h: null }));
}

const TOTAL_STOP = /^(sub\s*-?\s*total|taxable|total|grand|net\s*(amount|payable)|cgst|sgst|igst|utgst|shipping|freight|packag|packing|handling|round|amount\s*(in\s*words|payable|due)|balance|tax\s*summary|discount\s*total)/i;
const HEADER_KEYS = [
  ['desc', /^(description|item|items|particulars|product|goods|details|name)$/i],
  ['hsn',  /^(hsn|sac|hsn\/sac|hsn\/sac:?)$/i],
  ['qty',  /^(qty|quantity|qnty|nos|units?)$/i],
  ['rate', /^(rate|price|mrp|unit\s*price|unitprice)$/i],
  ['gst',  /^(gst|gst%|tax%|igst%|cgst%|vat%|gst\s*%)$/i],
  ['disc', /^(disc|disc%|discount|disc\s*%|discount%)$/i],
  ['taxAmt', /^(tax\s*amt|taxamt|tax|gst\s*amt|gstamt|tax\s*amount)$/i],
  ['total', /^(total|amount|amt|line\s*total|value)$/i],
];

function _headerColumns(line) {
  // Returns [{key, x}] in left→right order if the line looks like a table header (≥3 known columns)
  const cols = [];
  const toks = line.words && line.words.length ? line.words.map(w => ({ t: w.text, x: (w.x0 + w.x1) / 2, x0: w.x0, x1: w.x1 }))
                                               : line.text.split(/\s+/).map((t, i) => ({ t, x: i, x0: i, x1: i + 1 }));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].t.replace(/[^\w%\/]/g, '');
    let key = null;
    for (const [k, rx] of HEADER_KEYS) { if (rx.test(t)) { key = k; break; } }
    // "Tax Amt" is two tokens — merge to taxAmt
    if (key === 'taxAmt' || (key === 'gst' && /^(tax|gst)$/i.test(t) && toks[i + 1] && /^amt|amount$/i.test(toks[i + 1].t.replace(/[^\w]/g, '')))) {
      if (toks[i + 1] && /^(amt|amount)$/i.test(toks[i + 1].t.replace(/[^\w]/g, ''))) { cols.push({ key: 'taxAmt', x: (toks[i].x + toks[i + 1].x) / 2, x0: toks[i].x0, x1: toks[i + 1].x1 }); i++; continue; }
    }
    if (key) cols.push({ key, x: toks[i].x, x0: toks[i].x0, x1: toks[i].x1 });
  }
  // de-duplicate keys, keep first
  const seen = new Set(); const uniq = cols.filter(c => (seen.has(c.key) ? false : seen.add(c.key)));
  return uniq.length >= 3 && uniq.some(c => ['rate', 'qty', 'total'].includes(c.key)) ? uniq : null;
}

// ── Main entry ───────────────────────────────────────────────────────────────

const KNOWN_GST = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28, 40]);

export function parseInvoiceOCR(input, opts = {}) {
  const defaultGST = opts.defaultGST != null ? opts.defaultGST : 18;
  const lines = _toLines(input);
  const flags = [];   // { level:'error'|'warn'|'info', field, message }
  const flag = (level, field, message) => flags.push({ level, field, message });
  const result = {
    vendor: { value: '', conf: 'none' }, invoiceNo: { value: '', conf: 'none' },
    date: { value: '', conf: 'none' }, dueDate: { value: '', conf: 'none' }, gstin: { value: '', conf: 'none' },
    items: [], totals: {}, flags, kind: 'unknown', confidence: 'low', needsReview: true,
    ocrConfidence: input.confidence != null ? input.confidence : null,
  };
  if (!lines.length) { flag('error', 'document', 'No text could be read from this file.'); return result; }

  const fullText = lines.map(l => l.text).join('\n');

  // ── document type signals ──
  const hasInvoiceWord = /\b(tax\s*invoice|invoice|bill\s*of\s*supply|cash\s*memo|receipt|bill)\b/i.test(fullText);
  const hasGSTIN = findGSTINs(fullText).length > 0;
  const hasTotalLabel = /\b(grand\s*total|total\s*amount|amount\s*payable|net\s*payable|invoice\s*total|total)\b/i.test(fullText);
  const hasTableHdr = lines.some(l => _headerColumns(l));
  const hasRupees = /\b(rs\.?|inr|₹)\s*\d|\d[\d,]*\.\d{2}\b/i.test(fullText);
  const signals = [hasInvoiceWord, hasGSTIN, hasTotalLabel, hasTableHdr, hasRupees].filter(Boolean).length;
  result.kind = /ledgerix/i.test(fullText) || (hasTableHdr && /payment\s*details/i.test(fullText)) ? 'ledgerix' : (signals >= 2 ? 'generic' : 'unknown');
  if (signals < 2) {
    flag('error', 'document', 'This does not look like an invoice or bill (no invoice wording, totals, table or GSTIN found). Nothing was extracted.');
    return result;
  }

  // ── GSTIN (prefer a checksum-valid one near the top; vendor's, not the buyer's) ──
  const gst = [];
  lines.forEach((l, i) => findGSTINs(l.text).forEach(g => gst.push({ ...g, line: i, ctx: l.text })));
  if (gst.length) {
    const buyerWords = /(bill\s*to|billed\s*to|buyer|ship\s*to|customer|consignee|recipient)/i;
    let pick = gst.find(g => !buyerWords.test(g.ctx) && !(g.line > 0 && buyerWords.test(lines[g.line - 1].text)));
    pick = pick || gst[0];
    result.gstin = { value: pick.value, conf: pick.checksum ? 'high' : 'medium' };
    if (!pick.checksum) flag('warn', 'gstin', 'GSTIN format is valid but its check-digit does not match — verify it.');
    if (pick.repaired) flag('warn', 'gstin', 'GSTIN had OCR look-alike characters that were corrected — verify it.');
    if (gst.length > 1) flag('info', 'gstin', `${gst.length} GSTINs found; the seller's one was chosen.`);
  } else {
    flag('info', 'gstin', 'No GSTIN found.');
  }

  // ── Label → value resolution (value on the same line OR on the next line under the label) ──
  const meta = {};   // lower-case label → raw value
  const LABELS = ['invoice date', 'bill date', 'date', 'due', 'due date', 'status', 'invoice no', 'invoice number', 'bill no', 'bill number', 'inv no'];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    // "DATE  DUE DATE  STATUS" header row (labels only) → match the next line's values to labels.
    // Values are matched by horizontal POSITION when word boxes exist, so an empty first column
    // (no bill date) cannot shift the due date into the bill-date slot.
    const rawW = (lines[i].words && lines[i].words.length) ? lines[i].words.filter(w => /[A-Za-z0-9]/.test(w.text)) : null;
    const labelToks = [];
    const rawToks = t.toUpperCase().split(/\s+/).filter(w => /[A-Z0-9]/.test(w));   // ignore stray | / — specks
    for (let k = 0; k < rawToks.length; k++) {
      if ((rawToks[k] === 'DUE' || rawToks[k] === 'INVOICE' || rawToks[k] === 'BILL') && rawToks[k + 1] === 'DATE') {
        const x = rawW && rawW[k] && rawW[k + 1] ? (rawW[k].x0 + rawW[k + 1].x1) / 2 : null;
        labelToks.push({ lb: rawToks[k] === 'DUE' ? 'DUE' : 'DATE', x }); k++;
      } else labelToks.push({ lb: rawToks[k], x: rawW && rawW[k] ? (rawW[k].x0 + rawW[k].x1) / 2 : null });
    }
    if (labelToks.length >= 2 && labelToks.length <= 5 && labelToks.every(w => /^(DATE|DUE|STATUS)$/.test(w.lb)) && lines[i + 1]) {
      const vl = lines[i + 1];
      const DRX = /^(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})$/;
      const dateVals = (vl.words && vl.words.length)
        ? vl.words.filter(w => DRX.test(w.text)).map(w => ({ v: w.text, x: (w.x0 + w.x1) / 2 }))
        : (vl.text.match(/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/g) || []).map(v => ({ v, x: null }));
      const dateLabels = labelToks.filter(w => w.lb !== 'STATUS');
      if (dateVals.every(v => v.x != null) && dateLabels.every(l => l.x != null)) {
        const taken = {};
        dateVals.forEach(v => { let best = null, bd = Infinity; dateLabels.forEach(l => { const d = Math.abs(v.x - l.x); if (d < bd) { bd = d; best = l; } }); if (best) (taken[best.lb + '@' + best.x] = taken[best.lb + '@' + best.x] || []).push(v.v); });
        dateLabels.forEach(l => { const got = taken[l.lb + '@' + l.x]; if (got && got.length === 1) meta[l.lb === 'DATE' ? 'date' : 'due'] = got[0]; });
      } else if (dateVals.length === dateLabels.length) {
        dateLabels.forEach((l, k) => { meta[l.lb === 'DATE' ? 'date' : 'due'] = dateVals[k].v; });
      } // fewer values than labels and no positions → ambiguous: assign nothing
      const vals = vl.text.split(/\s{1,}/);
      if (labelToks.some(w => w.lb === 'STATUS')) meta['status'] = (vals[vals.length - 1] || '');
      continue;
    }
    // inline  "Invoice Date: 12/04/2026"
    LABELS.forEach(lb => {
      const rx = new RegExp('(?:^|\\b)' + lb.replace(/ /g, '\\s*') + '\\s*[:\\-#.]*\\s*(\\S.*)?$', 'i');
      const m = t.match(rx);
      if (m && m[1] && !(lb in meta)) meta[lb] = m[1];
      else if (m && !m[1] && lines[i + 1] && !(lb in meta)) meta[lb] = lines[i + 1].text;
    });
  }

  // ── Invoice / bill number ──
  const noCands = [];
  const labelRx = /\b(?:invoice|inv|bill|receipt|voucher|memo)\s*(?:no\.?|number|num|#)\s*[:\-.#]*\s*([A-Z0-9][A-Z0-9\-\/_.]{1,24})/i;
  lines.forEach((l, i) => {
    const m = l.text.match(labelRx);
    if (m && /\d/.test(m[1])) noCands.push({ v: m[1].replace(/[.,;:]+$/, ''), conf: 'high', line: i });
    const h = l.text.match(/#\s*([A-Z0-9][A-Z0-9\-\/_.]{2,24})/i);
    if (h && /\d/.test(h[1]) && !/^\d{1,2}$/.test(h[1])) noCands.push({ v: h[1].replace(/[.,;:]+$/, ''), conf: 'medium', line: i });
    const s = l.text.match(/\b([A-Z]{2,6}[\/\-]\d{2,4}(?:[\-\/]\d{2,4})?[\/\-]\d{1,6})\b/);
    if (s) noCands.push({ v: s[1], conf: 'medium', line: i });
    else {
      // OCR often reads the first '/' of PREFIX/2026-27/0007 as I, l or |
      const f = l.text.match(/\b([A-Z]{2,5})[Il|]((?:19|20)\d{2}-\d{2}[\/\-]\d{1,6})\b/);
      if (f) noCands.push({ v: f[1] + '/' + f[2], conf: 'low', line: i, fuzzy: true });
    }
  });
  if (noCands.length) {
    const best = noCands.find(c => c.conf === 'high') || noCands[0];
    result.invoiceNo = { value: best.v, conf: best.conf };
    if (best.fuzzy) flag('warn', 'invoiceNo', `Bill number "${best.v}" was reconstructed (a "/" was read as a letter) — verify it.`);
    const distinct = [...new Set(noCands.map(c => c.v))];
    if (distinct.length > 1) flag('info', 'invoiceNo', `Several bill-number candidates (${distinct.slice(0, 3).join(', ')}); "${best.v}" was chosen.`);
  } else {
    flag('warn', 'invoiceNo', 'Bill / invoice number not found — enter it manually.');
  }

  // ── Dates (labelled first; unlabelled dates are NOT assumed to be the bill date) ──
  const dLabel = meta['invoice date'] || meta['bill date'] || meta['date'];
  const dp = dLabel ? parseDate(dLabel) : null;
  if (dp) { result.date = { value: dp.iso, conf: dp.ambiguous ? 'medium' : 'high' }; if (dp.ambiguous) flag('warn', 'date', `Date read as day/month/year (${dp.iso}) — check day vs month.`); }
  const dd = meta['due date'] || meta['due'] ? parseDate(meta['due date'] || meta['due']) : null;
  if (dd) result.dueDate = { value: dd.iso, conf: dd.ambiguous ? 'medium' : 'high' };
  if (!dp) {
    const all = lines.map((l, i) => ({ l, i })).flatMap(({ l, i }) => (l.text.match(/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/g) || []).map(s => ({ s, i, ctx: l.text })));
    const cand = all.filter(a => !/due|payable by|valid\s*till/i.test(a.ctx) && !/due/i.test((lines[a.i - 1] || { text: '' }).text)).map(a => ({ ...a, p: parseDate(a.s) })).filter(a => a.p);
    if (cand.length === 1) {
      result.date = { value: cand[0].p.iso, conf: 'low' };
      flag('warn', 'date', `Only an unlabelled date was found (${cand[0].p.iso}) — confirm it is the bill date.`);
    } else {
      flag('warn', 'date', cand.length ? 'Several dates found but none labelled as the bill date — enter it manually.' : 'Bill date not found.');
    }
  }

  // ── Table: item rows (header optional — OCR often loses a light-on-dark header) ──
  let hdrIdx = -1, cols = null;
  for (let i = 0; i < lines.length; i++) { const c = _headerColumns(lines[i]); if (c) { hdrIdx = i; cols = c; break; } }
  let totalsStart = lines.length;
  for (let i = Math.max(hdrIdx + 1, 0); i < lines.length; i++) {
    const t = lines[i].text.replace(/^[#\d.\s|]+(?=[A-Za-z])/, '');
    if (TOTAL_STOP.test(t) && !/^\s*\d+\s+\w/.test(lines[i].text)) { totalsStart = i; break; }
  }

  const items = [];
  const scanFrom = hdrIdx >= 0 ? hdrIdx + 1 : 0;
  for (let i = scanFrom; i < totalsStart; i++) {
    const l = lines[i];
    const row = _parseRow(l, cols, items.length + 1, hdrIdx >= 0);
    if (row) { row.line = i; items.push(row); }
    else if (items.length && !/\d/.test(l.text) && l.text.length < 60 && i === items[items.length - 1].line + 1) {
      items[items.length - 1].desc = (items[items.length - 1].desc + ' ' + l.text).trim();   // wrapped description
    }
  }
  if (hdrIdx < 0 && items.length) flag('info', 'items', 'The table header was not readable; rows were recognised from their numbers instead.');
  if (hdrIdx < 0 && !items.length) flag('warn', 'items', 'No item table was recognised.');

  // per-row validation
  items.forEach((it, n) => {
    it.flags = it.flags || [];
    if (!it.desc || it.desc.replace(/[^A-Za-z]/g, '').length < 2) { it.flags.push('description unclear'); }
    if (it.qty == null) { it.qty = 1; it.flags.push('quantity not found — 1 assumed'); }
    if (it.rate == null && it.total != null && it.qty && !it.flags.some(f => /quantity not found/.test(f))) {
      const g = it.gst != null ? it.gst : defaultGST, d = it.disc || 0;
      it.rate = +((it.total / (1 + g / 100)) / (it.qty * (1 - d / 100))).toFixed(2);
      it.flags.push('rate derived from total — verify');
    }
    if (it.gst == null) { it.gst = defaultGST; it.flags.push(`GST % not on bill — ${defaultGST}% default applied`); }
    else if (!KNOWN_GST.has(it.gst)) it.flags.push(`unusual GST rate ${it.gst}%`);
    if (it.disc == null) it.disc = 0;
    if (it.rate == null) it.flags.push('rate not found');
    if (it.rate != null && it.total != null && !_rowReconciles(it)) {
      const net = it.qty * it.rate * (1 - it.disc / 100);
      it.flags.push(`row does not add up (qty×rate gives ${net.toFixed(2)}, bill shows ${it.total.toFixed(2)})`);
    }
    if (it.flags.length) flag('warn', 'items', `Item ${n + 1} (${(it.desc || '?').slice(0, 24)}): ${it.flags.join('; ')}.`);
  });
  result.items = items;
  if (hdrIdx >= 0 && !items.length) flag('warn', 'items', 'Table header found but no item rows could be read.');

  // ── Totals (label based, searched below the table) ──
  const T = {};
  const ALT = {};     // alternative reading of a total with a leading (misread ₹) digit removed
  const tl = lines.slice(Math.min(totalsStart, lines.length)).map(l => l.text);
  const pickAmt = (lineIdx) => {
    const a = lastAmountIn(tl[lineIdx]);
    if (a) return a;
    const nxt = tl[lineIdx + 1];
    if (nxt && /^[\s\d.,₹¹rsRSINR:]+$/.test(nxt)) return lastAmountIn(nxt);
    return null;
  };
  const TOT_RX = [
    ['subtotal',  /^(sub\s*-?\s*total|taxable\s*(value|amount)?|net\s*amount)\b/i],
    ['cgst',      /^cgst\b/i], ['sgst', /^(sgst|utgst)\b/i], ['igst', /^igst\b/i],
    ['shipping',  /^(shipping|freight|delivery)\b/i], ['packaging', /^(packaging|packing)\b/i], ['handling', /^handling\b/i],
    ['roundOff',  /^round\s*-?\s*off\b/i],
    ['grand',     /^(grand\s*total|total\s*amount|amount\s*payable|net\s*payable|invoice\s*total|balance\s*due|total\s*payable|total\s*invoice\s*value)\b/i],
  ];
  tl.forEach((t, i) => {
    const s = t.replace(/^[|\s]+/, '');
    for (const [k, rx] of TOT_RX) {
      if (rx.test(s) && !(k in T)) { const a = pickAmt(i); if (a) { T[k] = a.value; if (a.alt != null) ALT[k] = a.alt; if (a.ambiguous) flag('warn', 'totals', `${k}: number format ambiguous — verify.`); } break; }
    }
  });
  // plain "Total   12,345.00" (no grand/amount word) — only if no grand total found and it is below the table
  if (!('grand' in T)) {
    const i = tl.findIndex(t => /^total\b/i.test(t.replace(/^[|\s]+/, '')) && lastAmountIn(t));
    if (i >= 0) { T.grand = lastAmountIn(tl[i]).value; flag('info', 'totals', 'Grand total taken from a plain "Total" line.'); }
  }
  // amount in words (may wrap over several lines: "... Ninety Two" / "Rupees Only")
  {
    const NUMW = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|lakhs|lac|crore|crores|and|rupees?|only|paise|-)$/i;
    const allNumWords = (t) => { const w = t.replace(/[^A-Za-z\s-]/g, ' ').split(/\s+/).filter(Boolean); return w.length > 0 && w.every(x => NUMW.test(x)); };
    for (let i = 0; i < lines.length; i++) {
      if (!/\b(rupees?\s*only|only)\b/i.test(lines[i].text)) continue;
      // keep the number-words part of this line (OCR may append footer text)
      let own = lines[i].text.replace(/\b(rupees?\s*only|only).*$/i, 'Rupees Only');
      const parts = [own]; let k = i - 1;
      while (k >= 0 && allNumWords(lines[k].text) && parts.length < 4) { parts.unshift(lines[k].text); k--; }
      const wn = wordsToNumber(parts.join(' '));
      if (wn != null) { T.words = wn; break; }
    }
  }

  // ₹ is frequently read by OCR as a leading 7 / 2 / 1 / 4 ("₹850.00" → "7850.00"). Such a value is
  // only corrected when the bill's own arithmetic (subtotal + tax + extras = grand total = amount in
  // words, CGST = SGST, items) holds with the correction and does NOT hold without it.
  {
    const sumKeys = ['subtotal', 'cgst', 'sgst', 'igst', 'shipping', 'packaging', 'handling', 'roundOff', 'grand'];
    const varKeys = sumKeys.filter(k => k in T && ALT[k] != null);
    const itemSub = items.length && items.every(it => it.rate != null) ? items.reduce((a, it) => a + it.qty * it.rate * (1 - (it.disc || 0) / 100), 0) : null;
    const closeTo = (a, b, t) => Math.abs(a - b) <= t;
    const consistent = (V) => {
      const g = V.grand != null ? V.grand : (T.words != null ? T.words : null);
      if (V.subtotal == null || g == null) return false;
      const sum = V.subtotal + (V.cgst || 0) + (V.sgst || 0) + (V.igst || 0) + (V.shipping || 0) + (V.packaging || 0) + (V.handling || 0) + (V.roundOff || 0);
      if (!closeTo(sum, g, Math.max(1.01, g * 0.0005))) return false;
      if (V.grand != null && T.words != null && Math.round(V.grand) !== T.words) return false;
      if (V.cgst != null && V.sgst != null && !closeTo(V.cgst, V.sgst, 0.02)) return false;
      if (itemSub != null && !closeTo(V.subtotal, itemSub, Math.max(1.01, itemSub * 0.0005))) return false;
      return true;
    };
    if (varKeys.length && !consistent(T) && varKeys.length <= 9) {
      let best = null, bestN = 99, ambiguous = false;
      for (let mask = 1; mask < (1 << varKeys.length); mask++) {
        const V = { ...T }; let n = 0;
        varKeys.forEach((k, b) => { if (mask & (1 << b)) { V[k] = ALT[k]; n++; } });
        if (n > bestN || !consistent(V)) continue;
        if (n < bestN) { best = V; bestN = n; ambiguous = false; }
        else if (n === bestN && varKeys.some(k => V[k] !== best[k])) ambiguous = true;
      }
      if (best && !ambiguous) {
        const changed = varKeys.filter(k => best[k] !== T[k]);
        changed.forEach(k => { T[k] = best[k]; });
        flag('warn', 'totals', `${changed.join(', ')} began with an extra digit that looks like a misread ₹ symbol; corrected because the bill only adds up that way — verify.`);
      }
    }
  }

  result.totals = T;

  // ── Cross-validation ──
  const computedSub = items.length ? items.reduce((a, it) => a + (it.qty * (it.rate || 0) * (1 - (it.disc || 0) / 100)), 0) : null;
  const computedTax = items.length ? items.reduce((a, it) => a + (it.qty * (it.rate || 0) * (1 - (it.disc || 0) / 100) * (it.gst || 0) / 100), 0) : null;
  const tax = (T.cgst || 0) + (T.sgst || 0) + (T.igst || 0);
  const extras = (T.shipping || 0) + (T.packaging || 0) + (T.handling || 0) + (T.roundOff || 0);
  result.computed = { subtotal: computedSub, tax: computedTax, extras, grand: computedSub != null ? computedSub + computedTax + extras : null };
  const tol = (v) => Math.max(1.01, Math.abs(v) * 0.0005);
  if (T.subtotal != null && computedSub != null && Math.abs(T.subtotal - computedSub) > tol(T.subtotal)) {
    flag('error', 'totals', `Subtotal on the bill (${T.subtotal.toFixed(2)}) differs from the items (${computedSub.toFixed(2)}) — an item or amount was probably misread.`);
  }
  if ('cgst' in T && 'sgst' in T && Math.abs(T.cgst - T.sgst) > 0.011) flag('warn', 'totals', 'CGST and SGST differ — one is probably misread.');
  if (T.subtotal != null && T.grand != null) {
    const expect = T.subtotal + tax + extras;
    if (Math.abs(expect - T.grand) > tol(T.grand)) {
      flag('error', 'totals', `Subtotal + tax + extras (${expect.toFixed(2)}) does not equal the grand total (${T.grand.toFixed(2)}).`);
    }
  }
  if (T.grand != null && T.subtotal != null && T.grand < T.subtotal - 0.01) flag('error', 'totals', 'Grand total is smaller than the subtotal — a number was misread.');
  if (T.words != null && T.grand != null && Math.round(T.grand) !== T.words) {
    flag('error', 'totals', `Amount in words (${T.words.toLocaleString('en-IN')}) does not match the grand total (${T.grand.toFixed(2)}).`);
  }
  if (T.words != null && T.grand == null) flag('info', 'totals', `Grand total not read; the amount in words says ${T.words.toLocaleString('en-IN')}.`);
  // Independent check when the numeric grand total is unreadable: the amount in words
  // must still match subtotal + tax + extras (tax taken from the bill, or from the items).
  if (T.grand == null && T.words != null && T.subtotal != null) {
    const e1 = T.subtotal + tax + extras;
    const e2 = computedTax != null ? T.subtotal + computedTax + extras : null;
    const near = (x) => x != null && Math.abs(Math.round(x) - T.words) <= Math.max(1, T.words * 0.0005);
    if (!near(e1) && !near(e2)) {
      flag('error', 'totals', `Subtotal + tax + extras read from the bill (${e1.toFixed(2)}) does not match the amount in words (${T.words.toLocaleString('en-IN')}) — a charge or tax amount was probably misread.`);
    }
  }
  if (T.grand == null && computedSub != null) flag('warn', 'totals', 'Grand total was not found on the bill; the app will calculate it from the items.');
  if (T.grand != null && computedSub != null && T.subtotal == null) {
    const expect = computedSub + computedTax + extras;
    if (Math.abs(expect - T.grand) > tol(T.grand)) flag('warn', 'totals', `Items + tax + extras add up to ${expect.toFixed(2)} but the bill's total is ${T.grand.toFixed(2)}.`);
  }
  if (extras) result.extras = { shipping: T.shipping || 0, packaging: T.packaging || 0, handling: T.handling || 0 };

  // ── Vendor (seller) ──
  const v = _pickVendor(lines, hdrIdx, gst);
  result.vendor = v;
  if (v.value) {
    if (v.conf === 'low') flag('warn', 'vendor', `Vendor "${v.value}" is a low-confidence guess — verify it.`);
  } else flag('warn', 'vendor', 'Vendor / seller name could not be identified — enter it manually.');

  // ── Overall confidence ──
  const errors = flags.filter(f => f.level === 'error').length;
  const warns  = flags.filter(f => f.level === 'warn').length;
  const required = [result.vendor.value, result.invoiceNo.value, result.date.value, items.length, T.grand != null];
  const missing = required.filter(x => !x).length;
  result.confidence = errors ? 'low' : (warns > 2 || missing > 1 ? 'low' : (warns || missing ? 'medium' : 'high'));
  if (result.ocrConfidence != null && result.ocrConfidence < 55 && result.confidence === 'high') result.confidence = 'medium';
  if (result.ocrConfidence != null && result.ocrConfidence < 55) flag('warn', 'document', `Overall OCR confidence is low (${Math.round(result.ocrConfidence)}%). Use a sharper, larger image or a text-based PDF.`);
  result.needsReview = result.confidence !== 'high';
  return result;
}

// ── Row parsing ──────────────────────────────────────────────────────────────

// Strip currency-ish junk only: punctuation, and a single look-alike letter glued to the digits ("Z850.00").
// Letters elsewhere ("12mm", "A4", "40W") must keep the token NON-numeric.
const _normNum = (t) => String(t).replace(CURRENCY_RX, '').replace(/^[^\dA-Za-z.|]+/, '').replace(/^[RrZzTtXxYyFf](?=\d)/, '').replace(/[^A-Za-z\d%|]+$/, '');
const _isNumTok = (t) => { const n = _normNum(t); return /^[\dOolI|][\dOolI|,.]*%?$/.test(n) && /\d/.test(n); };

/** Value if a leading (misread ₹) digit were dropped: "7850.00" → 850, "124,750.00" → 24750. */
function _altAmount(tok) {
  const n = _normNum(tok).replace('%', '');
  if (!/^[7241]\d/.test(n)) return null;
  const a = parseAmount(n.slice(1));
  return a ? a.value : null;
}

// { total: bool|null, tax: bool|null } — null = that figure is not on the row
function _rowCheck(it) {
  if (it.rate == null || it.qty == null) return { total: null, tax: null };
  const d = it.disc || 0, g = it.gst, net = it.qty * it.rate * (1 - d / 100);
  const tol = (v) => Math.max(1, Math.abs(v) * 0.002);
  const out = { total: null, tax: null };
  if (it.taxAmt != null && g != null) out.tax = Math.abs(net * g / 100 - it.taxAmt) <= Math.max(1, it.taxAmt * 0.01);
  if (it.total != null) {
    const withTax = net * (1 + (g || 0) / 100);
    out.total = Math.abs(withTax - it.total) <= tol(it.total) || Math.abs(net - it.total) <= tol(it.total);
  }
  return out;
}
function _rowReconciles(it) { const c = _rowCheck(it); return (c.total !== null || c.tax !== null) && c.total !== false && c.tax !== false; }

const ROW_LAYOUTS = [
  ['hsn', 'qty', 'rate', 'gst', 'disc', 'tax', 'total'],
  ['qty', 'rate', 'gst', 'disc', 'tax', 'total'],
  ['hsn', 'qty', 'rate', 'gst', 'disc', 'total'],
  ['qty', 'rate', 'gst', 'disc', 'total'],
  ['hsn', 'qty', 'rate', 'gst', 'tax', 'total'],
  ['qty', 'rate', 'gst', 'tax', 'total'],
  ['hsn', 'qty', 'rate', 'gst', 'total'],
  ['qty', 'rate', 'gst', 'total'],
  ['hsn', 'qty', 'rate', 'total'],
  ['qty', 'rate', 'total'],
];

function _tryLayout(layout, nums, strictHsn) {
  if (!layout || layout.length !== nums.length) return null;
  const f = {}; const pctOK = [];
  for (let i = 0; i < layout.length; i++) {
    const k = layout[i], t = nums[i];
    if (t.pct && k !== 'gst' && k !== 'disc') return null;          // a % token can only be GST or Disc
    f[k] = t;
  }
  if (f.hsn && !/^\d{4,8}$/.test(f.hsn.clean)) { if (strictHsn) return null; }
  if (f.gst && (f.gst.v == null || f.gst.v > 100)) return null;
  if (f.disc && (f.disc.v == null || f.disc.v > 100)) return null;
  if (f.qty && (f.qty.v == null || f.qty.v <= 0 || f.qty.v > 1e7)) return null;
  // enumerate ₹-misread repairs on the money fields (fewest repairs wins)
  const money = ['rate', 'tax', 'total'].filter(k => f[k] && f[k].alt != null);
  let best = null;
  for (let mask = 0; mask < (1 << money.length); mask++) {
    const pick = (k) => { if (!f[k]) return null; const b = money.indexOf(k); return b >= 0 && (mask & (1 << b)) ? f[k].alt : f[k].v; };
    const it = { qty: f.qty ? f.qty.v : null, rate: pick('rate'), gst: f.gst ? f.gst.v : null, disc: f.disc ? f.disc.v : null,
                 taxAmt: pick('tax'), total: pick('total'), hsn: f.hsn ? f.hsn.clean : '' };
    const repairs = money.filter((k, b) => mask & (1 << b));
    const c = it.rate != null ? _rowCheck(it) : { total: null, tax: null };
    // full agreement = 100; total agrees but the (often garbled) tax column does not = 85 (tax is recomputed anyway)
    let score = 0;
    if (c.total !== false && c.tax !== false && (c.total !== null || c.tax !== null)) score = 100;
    else if (c.total === true && c.tax === false) score = 85;
    score = score ? score - repairs.length * 10 : 0;
    const taxIgnored = c.total === true && c.tax === false;
    if (!best || score > best.score) best = { score, it, repairs, taxIgnored };
  }
  return best;
}

function _parseRow(line, cols, expectedSerial, hasHeader) {
  let tokens = line.words && line.words.length
    ? line.words.map(w => ({ t: String(w.text), x: (w.x0 + w.x1) / 2 }))
    : line.text.split(/\s+/).map(t => ({ t, x: null }));
  tokens = tokens.filter(k => !/^[|‘’'`".,;:~_\-—–=*]+$/.test(k.t));          // OCR specks
  const merged = [];                                                       // lone currency token joins the next number
  for (let i = 0; i < tokens.length; i++) {
    if (/^(rs\.?|inr|₹|¹)$/i.test(tokens[i].t) && tokens[i + 1]) { merged.push(tokens[i + 1]); i++; } else merged.push(tokens[i]);
  }
  let firstNum = merged.length;
  for (let i = merged.length - 1; i >= 0; i--) { if (_isNumTok(merged[i].t)) firstNum = i; else break; }
  const tail = merged.slice(firstNum);
  if (tail.length < 3) return null;
  let descToks = merged.slice(0, firstNum).map(t => t.t);
  if (descToks.length > 1 && descToks[0] === String(expectedSerial)) descToks = descToks.slice(1);   // serial number column
  const desc = descToks.join(' ').replace(/^[|:\-\s]+|[|\s]+$/g, '');
  const letters = (desc.match(/[A-Za-z]/g) || []).length;
  if (!hasHeader && letters < 2) return null;                              // without a header a row needs a name

  const nums = tail.map(t => {
    const clean = _normNum(t.t); const a = parseAmount(clean.replace('%', ''));
    return { raw: t.t, clean: clean.replace(/%/g, '').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1'), pct: /\d\s*%$/.test(t.t), v: a ? a.value : null, alt: _altAmount(t.t) };
  });
  const hdr = cols ? cols.map(c => (c.key === 'taxAmt' ? 'tax' : c.key)).filter(k => k !== 'desc') : null;

  let best = null;
  const consider = (layout, pri) => {
    const r = _tryLayout(layout, nums, !hdr);
    if (r && (!best || r.score > best.score || (r.score === best.score && pri > best.pri))) best = { ...r, pri, layout };
  };
  if (hdr && hdr.length >= nums.length) consider(hdr.slice(hdr.length - nums.length), 1);
  ROW_LAYOUTS.filter(L => L.length === nums.length).forEach(L => consider(L, 0));
  if (!best) return null;
  if (best.score < 60 && !(hasHeader && best.pri === 1)) return null;      // unreconciled rows only trusted with a real header

  const it = best.it;
  const row = { desc, hsn: it.hsn || '', qty: it.qty, rate: it.rate, gst: it.gst, disc: it.disc, taxAmt: it.taxAmt, total: it.total, flags: [] };
  if (best.repairs.length) row.flags.push(`${best.repairs.join('/')} began with an extra digit (misread ₹) — corrected because the row only adds up that way`);
  if (best.score < 60) row.flags.push('columns taken from the header order; figures do not reconcile');
  if (best.taxIgnored) { row.taxAmt = null; row.flags.push('tax amount unreadable — ignored (it is recalculated from the GST %)'); }
  return row;
}

// ── Vendor ───────────────────────────────────────────────────────────────────

const VENDOR_STOP = /^(tax\s*invoice|invoice|bill\s*of\s*supply|bill|receipt|cash\s*memo|original|duplicate|triplicate|copy|page|date|due|status|pending|paid|overdue|gstin|gst|pan|phone|ph|mob|mobile|tel|email|e-mail|www|bill\s*to|billed\s*to|ship\s*to|payment\s*details|bank|a\/c|ifsc|upi|#|no\b|sl|s\.no|description|hsn|qty|rate|subtotal|total|thank|terms|authori[sz]ed|signature|amount)/i;
const COMPANY_RX = /\b(pvt|private|ltd|limited|llp|inc|corp|co\.?|company|traders?|enterprises?|industries|stores?|agency|agencies|associates|services|solutions|textiles?|foods?|electronics|motors|hardware|pharma|distributors?|suppliers?|exports?|imports?|works|mart|bazaar|wholesale|&)\b/i;

function _cells(line) {
  // Split a line into cells at wide horizontal gaps (OCR merges neighbouring columns into one line)
  if (!line.words || line.words.length < 2) return [line.text];
  const hs = line.words.map(w => w.y1 - w.y0).filter(h => h > 0);
  const gap = (hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 10) * 2.2;
  const out = []; let cur = [line.words[0].text];
  for (let i = 1; i < line.words.length; i++) {
    if (line.words[i].x0 - line.words[i - 1].x1 > gap) { out.push(cur.join(' ')); cur = []; }
    cur.push(line.words[i].text);
  }
  out.push(cur.join(' '));
  return out;
}

function _pickVendor(lines, hdrIdx, gstins) {
  // The seller's name sits ABOVE the date/status strip, the "Bill to" block and the table.
  let cutoff = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text.toUpperCase().trim();
    const labelsOnly = t.split(/\s+/).filter(Boolean);
    if ((labelsOnly.length >= 2 && labelsOnly.every(w => /^(DATE|DUE|STATUS)$/.test(w))) ||
        /^(BILL\s*TO|BILLED\s*TO|SHIP\s*TO|PAYMENT\s*DETAILS)\b/.test(t) || _headerColumns(lines[i])) { cutoff = i; break; }
  }
  const limit = Math.min(lines.length, cutoff, 14);
  const cands = [];
  for (let i = 0; i < limit; i++) {
    for (const cell of _cells(lines[i])) {
    let t = cell.replace(/^[^A-Za-z0-9(]+|[|\s]+$/g, '');
    t = t.replace(/\b(tax\s*invoice|invoice|bill\s*of\s*supply|original|duplicate|copy)\b/ig, ' ').replace(/\s{2,}/g, ' ').trim();   // header words sharing the line
    if (t.length < 3) continue;
    if (VENDOR_STOP.test(t)) continue;
    if (/\b(bank|ifsc|upi|a\/c|aic|account)\b/i.test(t)) continue;                // payment details
    if (/^\W*#?\s*[A-Z]{2,6}[\/\-]\d/.test(t)) continue;                 // invoice number line
    if (/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/.test(t)) continue;   // contains a date
    if (/@|\.com|\.in\b|https?:/i.test(t)) continue;                      // e-mail / web
    if (/\b\d{10}\b|\+?\d[\d\s-]{9,}/.test(t)) continue;                  // phone
    if (findGSTINs(t).length) continue;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters < 3 || letters / t.length < 0.6) continue;               // mostly digits / symbols
    if (/(?:rs\.?|₹|¹)\s*\d|\d[\d,]*\.\d{2}\b/i.test(t)) continue;       // contains an amount
    if (/^(bill\s*to|customer|client|buyer)\b/i.test(lines[i - 1] ? lines[i - 1].text : '')) continue;
    let score = 0;
    score += Math.max(0, 6 - i);                                          // nearer the top is better
    if (COMPANY_RX.test(t)) score += 4;
    if (lines[i].h) { const hs = lines.slice(0, limit).map(l => l.h || 0); const mx = Math.max(...hs); if (mx && lines[i].h >= mx * 0.9) score += 2; }
    if (gstins.length && Math.abs(gstins[0].line - i) <= 3) score += 3;   // close to the seller's GSTIN
    if (lines[i].conf != null && lines[i].conf < 60) score -= 3;
    if (/^[A-Z][A-Za-z0-9&.,'\- ]+$/.test(t)) score += 1;
    cands.push({ t, i, score, conf: lines[i].conf });
    }
  }
  if (!cands.length) return { value: '', conf: 'none' };
  cands.sort((a, b) => b.score - a.score);
  const b = cands[0];
  const strong = COMPANY_RX.test(b.t) || (gstins.length && Math.abs(gstins[0].line - b.i) <= 3);
  let conf = strong ? 'high' : (b.i <= 2 ? 'medium' : 'low');
  const letters = (b.t.match(/[A-Za-z]/g) || []).length;
  if (letters < 4 || (b.conf != null && b.conf < 60)) conf = 'low';
  if (/^[a-z]/.test(b.t) && b.t.length < 12) conf = 'low';          // starts mid-word → probably cropped
  return { value: b.t, conf };
}
