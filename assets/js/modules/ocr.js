/**
 * Ledgerix - OCR Bill Scanner Module
 * v2.4 fixes:
 *
 * 1. btnStartOCR was permanently `disabled` — handleOCRUpload now enables it.
 * 2. DOM ID mismatches fixed:
 *    ocrPreviewSection → no wrapper (img is directly in zone, display managed via ocrPreviewImg)
 *    ocrResultsSection → ocrDetectedPanel
 *    ocrDetectedDate   → ocrBillDate
 *    ocrDetectedBillNo → ocrBillNumber
 * 3. Tesseract.js v5 API incompatibility fixed:
 *    v4 API: Tesseract.recognize(image, lang) — REMOVED in v5
 *    v5 API: createWorker() → worker.recognize(image) — required
 *    Pinned to tesseract.js@4.1.1 which still exposes the simple recognize() API
 *    AND works on GitHub Pages (CDN workers, no local file needed).
 * 4. ocrGSTINBox shown/hidden based on whether GSTIN was detected.
 * 5. Error state now always shows a useful message and cleans up loading state.
 *
 * v2.11.2 — accuracy rewrite (see ocr-parser.js):
 *  - images are enlarged 2–3x, converted to grey and sharpened before recognition
 *    (measured: 8/46 → 36/46 expected tokens on a phone screenshot of an invoice)
 *  - Tesseract worker uses single-block page segmentation and returns word boxes
 *  - fields come from labels / table columns and are cross-checked (subtotal + tax +
 *    extras vs grand total vs amount-in-words); anything uncertain is flagged
 *  - PDFs with a text layer are read directly (exact), without OCR
 *  - nothing is created until the user presses Create and confirms uncertain data
 */

'use strict';

import * as State from '../core/state.js';
import { nextId } from '../core/state.js';
import { showToast } from '../ui/toast.js';
import { esc } from '../utils/helpers.js';
import { parseInvoiceOCR } from './ocr-parser.js';

let _tesseractPromise = null;
let _pdfLines  = null;      // text-layer lines when a PDF with real text was uploaded
let _lastParse = null;      // most recent parser result (drives the review panel)
let _lastRawText = '';

// Tesseract.js v4.1.1 — GitHub-Pages friendly CDN build
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js';
// pdf.js (legacy ES-module build, lazy-loaded only when a PDF is uploaded)
const PDFJS_VERSION = '5.6.205';
const PDFJS_URL     = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.mjs`;
const PDFJS_WORKER  = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`;

async function _loadTesseract() {
  if (window.Tesseract && typeof window.Tesseract.recognize === 'function') return true;
  if (_tesseractPromise) return _tesseractPromise;

  _tesseractPromise = new Promise((resolve, reject) => {
    const s    = document.createElement('script');
    s.src      = TESSERACT_CDN;
    s.onload   = () => {
      if (window.Tesseract && typeof window.Tesseract.recognize === 'function') resolve(true);
      else { _tesseractPromise = null; reject(new Error('Tesseract loaded but API is missing')); }
    };
    s.onerror  = () => { _tesseractPromise = null; reject(new Error('Could not download the OCR engine — check your internet connection')); };
    document.head.appendChild(s);
  });
  return _tesseractPromise;
}

let _pdfjsPromise = null;
async function _loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then(mod => {
    const lib = mod && mod.getDocument ? mod : (mod.default || mod);
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  }).catch(err => { _pdfjsPromise = null; console.error('[OCR] pdf.js load failed:', err); throw new Error('Could not load the PDF reader (needs internet the first time)'); });
  return _pdfjsPromise;
}

// ── Image preprocessing (enlarge → grey → unsharp) ───────────────────────────

function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image'));
    img.src = src;
  });
}

function _boxBlur(src, w, h, r) {
  // two-pass running-sum box blur on a Float32Array (3 passes ≈ gaussian)
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / d;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / d;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Returns { dataUrl, scale }. Tesseract wants text ≥ ~30 px tall (≈300 DPI); phone
 * screenshots are usually 700–1100 px wide, so small images are enlarged 2–3x.
 * Grey + unsharp-mask measurably improved recognition and dark header bands are inverted;
 * global thresholding, CLAHE and auto-levels did not help, so they are NOT applied.
 */
export async function preprocessForOCR(dataUrl) {
  const img = await _loadImage(dataUrl);
  const sw = img.naturalWidth, sh = img.naturalHeight;
  let scale = sw < 1000 ? 3 : (sw < 1700 ? 2 : 1);
  if (sw > 3200) scale = 3000 / sw;                                   // very large photo → down to ~300 DPI
  const MAX_PIXELS = 14e6;
  while (scale > 1 && sw * sh * scale * scale > MAX_PIXELS) scale -= 0.25;
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));

  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);                       // flatten transparency onto white
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);

  const id = x.getImageData(0, 0, w, h), px = id.data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) g[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

  const r = Math.max(1, Math.round(scale)) ;                           // ≈ sigma 3 at 3x
  let b = _boxBlur(g, w, h, r + 1); b = _boxBlur(b, w, h, r + 1); b = _boxBlur(b, w, h, r + 1);
  const out = new Float32Array(w * h);
  for (let j = 0; j < out.length; j++) out[j] = Math.max(0, Math.min(255, g[j] * 1.8 - b[j] * 0.8));   // unsharp, amount 0.8

  // Light-on-dark bands (e.g. a navy invoice header with white text) are invisible to Tesseract,
  // which expects dark text on a light page. Invert every dark horizontal band (>= 1.8 % of the
  // height, mean brightness < 110). Measured: 51/59 → 59/59 tokens on a navy-header invoice.
  const minRun = Math.max(4, Math.round(h * 0.018));
  let y = 0;
  while (y < h) {
    let sum = 0; for (let xx = 0; xx < w; xx += 4) sum += g[y * w + xx];
    if (sum / Math.ceil(w / 4) < 110) {
      let y2 = y + 1;
      while (y2 < h) { let s2 = 0; for (let xx = 0; xx < w; xx += 4) s2 += g[y2 * w + xx]; if (s2 / Math.ceil(w / 4) < 110) y2++; else break; }
      if (y2 - y >= minRun) for (let yy = y; yy < y2; yy++) for (let xx = 0; xx < w; xx++) out[yy * w + xx] = 255 - out[yy * w + xx];
      y = y2;
    } else y++;
  }
  for (let i = 0, j = 0; i < px.length; i += 4, j++) { px[i] = px[i + 1] = px[i + 2] = out[j]; px[i + 3] = 255; }
  x.putImageData(id, 0, 0);
  return { dataUrl: c.toDataURL('image/png'), scale, width: w, height: h };
}

// ── Upload ───────────────────────────────────────────────────────────────────

function _isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''); }

function _markReady(file, extra) {
  const zone = document.getElementById('ocrUploadZone');
  if (zone) {
    const icon = zone.querySelector('i.fas');
    const h3   = zone.querySelector('h3');
    const p    = zone.querySelector('p');
    if (icon) icon.className  = 'fas fa-check-circle';
    if (h3)   h3.textContent  = file.name;
    if (p)    p.textContent   = `${(file.size / 1024).toFixed(0)} KB — ${extra || 'ready to scan'}`;
    zone.classList.add('has-image');
  }
  const btn = document.getElementById('btnStartOCR');
  if (btn) btn.disabled = false;
}

export function handleOCRUpload(e) {
  const file = e && e.target && e.target.files && e.target.files[0];
  if (!file) return;
  _pdfLines = null;

  if (_isPdf(file)) { _handlePdfUpload(file); return; }
  if (!/^image\//.test(file.type || '')) {
    setOCRStatus('Unsupported file type. Choose a JPG, PNG, WEBP image or a PDF.', 'error');
    showToast('Unsupported file type', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function (ev) {
    State.setOcrImageData(ev.target.result);
    const img = document.getElementById('ocrPreviewImg');
    if (img) { img.src = ev.target.result; img.style.display = 'block'; }
    _markReady(file);
    setOCRStatus('Image loaded. Click "Start Scanning" to extract data.', 'neutral');
  };
  reader.onerror = function () {
    setOCRStatus('Failed to read image file.', 'error');
    showToast('Could not read the image file', 'error');
  };
  reader.readAsDataURL(file);
}

// Builds parser "lines" (with word boxes) from a pdf.js text layer.
function _linesFromTextContent(items, pageHeight, yOffset) {
  const words = [];
  items.forEach(it => {
    const str = it.str;
    if (!str || !str.trim()) return;
    // rotated text (e.g. the vertical "Ledgerix" watermark) is not part of any table line
    if (Math.abs(it.transform[1]) > 0.1 * Math.abs(it.transform[0]) || Math.abs(it.transform[2]) > 0.1 * Math.abs(it.transform[3])) return;
    const x = it.transform[4], base = it.transform[5], hgt = it.height || Math.abs(it.transform[3]) || 8;
    const total = Math.max(1, str.length), w = it.width || total * hgt * 0.5;
    let pos = 0;
    str.split(/(\s+)/).forEach(part => {
      if (part && part.trim()) {
        words.push({ text: part, conf: 100, x0: x + (pos / total) * w, x1: x + ((pos + part.length) / total) * w,
                     y0: yOffset + pageHeight - base - hgt, y1: yOffset + pageHeight - base });
      }
      pos += part.length;
    });
  });
  words.sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);
  const lines = [];
  words.forEach(w => {
    const hgt = Math.max(1, w.y1 - w.y0);
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.yb - w.y1) <= hgt * 0.5) { last.words.push(w); last.yb = (last.yb + w.y1) / 2; }
    else lines.push({ yb: w.y1, words: [w] });
  });
  return lines.map(l => { l.words.sort((a, b) => a.x0 - b.x0); return { text: l.words.map(w => w.text).join(' '), words: l.words, conf: 100 }; });
}

async function _handlePdfUpload(file) {
  setOCRStatus('Reading PDF...', 'scanning');
  try {
    const pdfjs = await _loadPdfJs();
    const buf   = await file.arrayBuffer();
    const pdf   = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = Math.min(pdf.numPages, 3);
    let lines = [], yOff = 0, previewUrl = null, firstPage = null;
    for (let n = 1; n <= pages; n++) {
      const page = await pdf.getPage(n);
      const vp   = page.getViewport({ scale: 1 });
      const tc   = await page.getTextContent();
      lines = lines.concat(_linesFromTextContent(tc.items, vp.height, yOff));
      yOff += vp.height + 20;
      if (n === 1) firstPage = page;
    }
    // preview (and OCR fallback image) = first page rendered
    const vp1 = firstPage.getViewport({ scale: 1 });
    const rs  = Math.min(3, Math.max(1.5, 2400 / vp1.width));
    const vp  = firstPage.getViewport({ scale: rs });
    const cv  = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await firstPage.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    previewUrl = cv.toDataURL('image/png');
    State.setOcrImageData(previewUrl);
    const img = document.getElementById('ocrPreviewImg');
    if (img) { img.src = previewUrl; img.style.display = 'block'; }

    const chars = lines.reduce((a, l) => a + l.text.replace(/\s/g, '').length, 0);
    if (chars >= 40) {
      _pdfLines = lines;
      _markReady(file, 'text PDF — will be read exactly (no OCR)');
      setOCRStatus('PDF text found. Click "Start Scanning" — it is read directly, not guessed by OCR.', 'neutral');
    } else {
      _markReady(file, 'scanned PDF — OCR will be used');
      setOCRStatus('This PDF has no text layer (scanned). OCR will be used and may be less accurate.', 'neutral');
    }
  } catch (err) {
    console.error('[OCR] PDF load failed:', err);
    State.setOcrImageData(null);
    setOCRStatus('Could not read this PDF: ' + (err && err.message ? err.message : 'unknown error') + '. Upload a screenshot/image instead.', 'error');
    showToast('PDF could not be read', 'error');
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

function _toParserInput(data) {
  const lines = (data.lines || []).map(l => ({
    text: l.text, conf: l.confidence,
    words: (l.words || []).map(w => ({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })),
  }));
  return { text: data.text, lines, confidence: data.confidence };
}

function _signalScore(p) {
  return (p.items.length * 3) + Object.keys(p.totals).length + (p.invoiceNo.value ? 1 : 0) + (p.date.value ? 1 : 0) + (p.vendor.value ? 1 : 0)
         - p.flags.filter(f => f.level === 'error').length * 2;
}

async function _recognize(imageUrl) {
  const T = window.Tesseract;
  const logger = m => {
    if (m.status === 'recognizing text') {
      const pct = Math.round((m.progress || 0) * 100);
      setOCRStatus(`Reading text... ${pct}%`, 'scanning'); setOCRProgress(20 + pct * 0.75);
    } else if (m.status === 'loading language traineddata') { setOCRStatus('Loading language data...', 'scanning'); setOCRProgress(15); }
    else if (m.status === 'initializing api') { setOCRStatus('Initializing OCR engine...', 'scanning'); setOCRProgress(10); }
  };
  if (typeof T.createWorker !== 'function') {          // very old API: single-shot, default page mode
    const r = await T.recognize(imageUrl, 'eng', { logger });
    return [r.data];
  }
  const worker = await T.createWorker({ logger });
  try {
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    const out = [];
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    out.push((await worker.recognize(imageUrl)).data);
    return { worker, first: out[0], rerun: async () => {
      await worker.setParameters({ tessedit_pageseg_mode: '4' });
      return (await worker.recognize(imageUrl)).data;
    } };
  } catch (e) { try { await worker.terminate(); } catch (_) {} throw e; }
}

export async function startOCRScan() {
  if (!State.ocrImageData && !_pdfLines) {
    showToast('Please upload an image first', 'warning');
    return;
  }

  const btn = document.getElementById('btnStartOCR');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...'; }
  const progressWrap = document.getElementById('ocrProgressWrap');
  if (progressWrap) progressWrap.style.display = 'block';
  setOCRProgress(0);

  const opts = { defaultGST: (State.settings && State.settings.defaultGST != null) ? State.settings.defaultGST : 18 };
  try {
    let parsed;
    if (_pdfLines) {
      setOCRStatus('Reading PDF text...', 'scanning'); setOCRProgress(60);
      const text = _pdfLines.map(l => l.text).join('\n');
      _lastRawText = text;
      parsed = parseInvoiceOCR({ text, lines: _pdfLines, confidence: 100 }, opts);
      parsed.source = 'pdf-text';
    } else {
      setOCRStatus('Preparing image...', 'scanning'); setOCRProgress(5);
      const prepped = await preprocessForOCR(State.ocrImageData);
      if (!window.Tesseract || typeof window.Tesseract.recognize !== 'function') {
        setOCRStatus('Loading OCR engine...', 'scanning');
        await _loadTesseract();
      }
      setOCRStatus('Initializing scanner...', 'scanning');
      const rec = await _recognize(prepped.dataUrl);
      let data;
      if (Array.isArray(rec)) data = rec[0];
      else data = rec.first;
      _lastRawText = data.text || '';
      parsed = parseInvoiceOCR(_toParserInput(data), opts);
      // Second opinion with automatic column detection only when the first pass found no items
      if (!Array.isArray(rec)) {
        if (!parsed.items.length && parsed.kind !== 'unknown') {
          setOCRStatus('Trying a second reading mode...', 'scanning');
          try {
            const d2 = await rec.rerun();
            const p2 = parseInvoiceOCR(_toParserInput(d2), opts);
            if (_signalScore(p2) > _signalScore(parsed)) { parsed = p2; _lastRawText = d2.text || ''; }
          } catch (e) { console.warn('[OCR] second pass failed', e); }
        }
        try { await rec.worker.terminate(); } catch (_) {}
      }
      parsed.source = 'ocr';
    }

    setOCRProgress(100);
    setOCRStatus('Scan complete! Parsing data...', 'scanning');
    _applyParsed(parsed);
    const errs = parsed.flags.filter(f => f.level === 'error').length;
    if (parsed.kind === 'unknown') setOCRStatus('No invoice detected in this file. Nothing was extracted.', 'error');
    else if (parsed.needsReview) setOCRStatus(`Data extracted — ${errs ? 'CHECK THE HIGHLIGHTED PROBLEMS' : 'please verify the highlighted fields'} before creating an invoice.`, 'error');
    else setOCRStatus('Data extracted and consistent. Review details and create invoice.', 'success');

  } catch (err) {
    console.error('[OCR] Scan failed:', err);
    const msg = err && err.message ? err.message : 'Unknown error';
    setOCRStatus(`Scan failed: ${msg}`, 'error');
    showToast('OCR scan failed. Check internet connection and try again.', 'error');
    if (progressWrap) progressWrap.style.display = 'none';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> Start Scanning'; }
  }
}

export function setOCRStatus(msg, type) {
  const el = document.getElementById('ocrStatus');
  if (!el) return;
  el.className = 'ocr-status ' + (type || '');
  const icons = {
    scanning: '<i class="fas fa-spinner fa-spin"></i>',
    success:  '<i class="fas fa-check-circle"></i>',
    error:    '<i class="fas fa-times-circle"></i>',
    neutral:  '<i class="fas fa-hourglass-start"></i>',
  };
  el.innerHTML = (icons[type] || icons.neutral) + ' <span>' + msg + '</span>';
}

export function setOCRProgress(pct) {
  const bar = document.getElementById('ocrProgressBar');
  if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
}

// Copies the parser result into State and renders it. Nothing is invented: fields the
// parser could not read stay empty and are flagged in the review panel.
function _applyParsed(p) {
  _lastParse = p;
  State.setOcrDetectedVendor(p.vendor.value || '');
  State.setOcrDetectedGSTIN(p.gstin.value || '');
  State.setOcrDetectedDate(p.date.value || '');
  State.setOcrDetectedBillNo(p.invoiceNo.value || '');
  State.setOcrDetectedItems(p.items.map(it => ({
    id: nextId(), desc: it.desc || '', hsn: it.hsn || '', qty: it.qty || 1, rate: it.rate || 0,
    gst: it.gst != null ? it.gst : 18, disc: it.disc || 0, flags: it.flags || [],
  })));
  _renderOCRResults();
}

// Kept for backward compatibility with any caller of the old parser entry point.
function parseOCRText(text) {
  _applyParsed(parseInvoiceOCR({ text }, { defaultGST: (State.settings && State.settings.defaultGST) || 18 }));
}

function _renderReview(p) {
  const panel = document.getElementById('ocrDetectedPanel');
  if (!panel) return;
  let box = document.getElementById('ocrReviewNotes');
  if (!box) {
    box = document.createElement('div'); box.id = 'ocrReviewNotes';
    box.style.cssText = 'margin-bottom:1rem;padding:.75rem 1rem;border-radius:8px;font-size:.85rem;line-height:1.45';
    panel.insertBefore(box, panel.firstChild);
  }
  const colour = { error: '#c0392b', warn: '#b9770e', info: '#5d6d7e' };
  const icon   = { error: 'fa-times-circle', warn: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const heads  = { high: 'Looks consistent — still check the details', medium: 'Please verify the highlighted fields', low: 'LOW CONFIDENCE — verify everything before using' };
  const flags  = p.flags.filter(f => f.level !== 'info' || p.flags.length < 6);
  box.style.background = p.needsReview ? 'rgba(192,57,43,.08)' : 'rgba(39,174,96,.08)';
  box.style.border = '1px solid ' + (p.needsReview ? 'rgba(192,57,43,.35)' : 'rgba(39,174,96,.35)');
  const T = p.totals || {}, C = p.computed || {};
  const cmp = (T.grand != null || C.grand != null)
    ? `<div style="margin-top:.4rem;color:var(--c-text-mute)">Total on the bill: <b>${T.grand != null ? T.grand.toFixed(2) : 'not read'}</b> &nbsp;|&nbsp; Items + tax + charges: <b>${C.grand != null ? C.grand.toFixed(2) : 'n/a'}</b>${T.words != null ? ` &nbsp;|&nbsp; In words: <b>${T.words}</b>` : ''}</div>` : '';
  box.innerHTML =
    `<div style="font-weight:600;color:${p.needsReview ? '#c0392b' : '#1e8449'}"><i class="fas ${p.needsReview ? 'fa-exclamation-triangle' : 'fa-check-circle'}"></i> ${esc(heads[p.confidence] || heads.low)}${p.source === 'pdf-text' ? ' (read from PDF text)' : ''}</div>` +
    (flags.length ? '<ul style="margin:.4rem 0 0 1.1rem;padding:0">' + flags.map(f =>
      `<li style="color:${colour[f.level]}"><i class="fas ${icon[f.level]}"></i> ${esc(f.message)}</li>`).join('') + '</ul>' : '') +
    cmp +
    (_lastRawText ? `<details style="margin-top:.5rem"><summary style="cursor:pointer">Show recognised text</summary><pre style="white-space:pre-wrap;font-size:.75rem;max-height:200px;overflow:auto;margin:.4rem 0 0">${esc(_lastRawText)}</pre></details>` : '');
}

// Highlights inputs whose value is missing / low confidence
function _markField(id, conf, fieldFlags) {
  const el = document.getElementById(id); if (!el) return;
  const bad = conf === 'none' || conf === 'low' || fieldFlags;
  el.style.outline = bad ? '2px solid #e67e22' : '';
  el.title = bad ? 'Please verify this value' : '';
}

function _renderOCRResults() {
  // Populate vendor name
  const vendorEl = document.getElementById('ocrVendorName');
  if (vendorEl) vendorEl.value = State.ocrDetectedVendor;

  // GSTIN — show/hide box
  const gstinEl  = document.getElementById('ocrDetectedGSTIN');
  const gstinBox = document.getElementById('ocrGSTINBox');
  if (gstinEl) gstinEl.value = State.ocrDetectedGSTIN;
  if (gstinBox) gstinBox.style.display = State.ocrDetectedGSTIN ? 'flex' : 'none';

  // Date (HTML id: ocrBillDate, was ocrDetectedDate)
  const dateEl = document.getElementById('ocrBillDate');
  if (dateEl) dateEl.value = State.ocrDetectedDate;

  // Bill number (HTML id: ocrBillNumber, was ocrDetectedBillNo)
  const billNoEl = document.getElementById('ocrBillNumber');
  if (billNoEl) billNoEl.value = State.ocrDetectedBillNo;

  // Highlight uncertain fields + show the review panel
  if (_lastParse) {
    const f = (name) => _lastParse.flags.some(x => x.field === name && x.level !== 'info');
    _markField('ocrVendorName', _lastParse.vendor.conf, f('vendor'));
    _markField('ocrBillDate', _lastParse.date.conf, f('date'));
    _markField('ocrBillNumber', _lastParse.invoiceNo.conf, f('invoiceNo'));
    _markField('ocrDetectedGSTIN', _lastParse.gstin.conf === 'none' ? 'high' : _lastParse.gstin.conf, f('gstin'));
    _renderReview(_lastParse);
  }

  // Items table
  renderOCRItems();
  updateOCRCalculations();

  // Show detected panel (HTML id: ocrDetectedPanel, was ocrResultsSection)
  const panel     = document.getElementById('ocrDetectedPanel');
  const emptyState = document.getElementById('ocrEmptyState');
  if (panel)      panel.style.display      = 'block';
  if (emptyState) emptyState.style.display = 'none';
}

export function renderOCRItems() {
  const tbody = document.getElementById('ocrItemsBody');
  if (!tbody) return;
  if (State.ocrDetectedItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--c-text-mute);padding:1rem">No items detected</td></tr>';
    return;
  }
  tbody.innerHTML = State.ocrDetectedItems.map((it, idx) => `
    <tr${it.flags && it.flags.length ? ` style="background:rgba(230,126,34,.12)" title="${esc(it.flags.join('; '))}"` : ''}>
      <td><input type="text"   value="${esc(it.desc)}"         onchange="window._ledgerix.ocr.updateOCRItem(${idx},'desc',this.value)"  placeholder="Product name"></td>
      <td><input type="number" value="${esc(String(it.qty))}"  onchange="window._ledgerix.ocr.updateOCRItem(${idx},'qty',this.value)"   min="1" style="text-align:center"></td>
      <td><input type="number" value="${esc(String(it.rate))}" onchange="window._ledgerix.ocr.updateOCRItem(${idx},'rate',this.value)"  min="0" style="text-align:right"></td>
      <td><input type="number" value="${esc(String(it.gst))}"  onchange="window._ledgerix.ocr.updateOCRItem(${idx},'gst',this.value)"   min="0" max="28" style="text-align:center"></td>
      <td><button class="btn btn-danger btn-sm" onclick="window._ledgerix.ocr.removeOCRItem(${idx})"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('');
}

export function addOCRItem() {
  State.ocrDetectedItems.push({
    id: nextId(), desc: '', hsn: '', qty: 1,
    rate: 0, gst: State.settings?.defaultGST || 18, disc: 0,
  });
  renderOCRItems();
  updateOCRCalculations();
}

export function removeOCRItem(idx) {
  State.ocrDetectedItems.splice(idx, 1);
  renderOCRItems();
  updateOCRCalculations();
}

export function updateOCRItem(idx, field, value) {
  if (!State.ocrDetectedItems[idx]) return;
  State.ocrDetectedItems[idx][field] = ['qty','rate','gst','disc'].includes(field)
    ? parseFloat(value) || 0
    : value;
  updateOCRCalculations();
}

export function updateOCRCalculations() {
  let subtotal = 0, totalGST = 0;
  State.ocrDetectedItems.forEach(it => {
    const amt = (it.qty * it.rate) * (1 - (it.disc || 0) / 100);
    subtotal  += amt;
    totalGST  += amt * (it.gst / 100);
  });
  const sub = document.getElementById('ocrSubtotal');
  const tax = document.getElementById('ocrTotalGST');
  const grd = document.getElementById('ocrGrandTotal');
  if (sub) sub.value = subtotal.toFixed(2);
  if (tax) tax.value = totalGST.toFixed(2);
  if (grd) grd.value = (subtotal + totalGST).toFixed(2);
}

export function createInvoiceFromOCR() {
  if (State.ocrDetectedItems.length === 0) {
    showToast('No items to create invoice from', 'warning');
    return;
  }
  // Explicit confirmation whenever the scan is uncertain or conflicting
  if (_lastParse && _lastParse.needsReview) {
    const lines = _lastParse.flags.filter(f => f.level !== 'info').slice(0, 6).map(f => '• ' + f.message).join('\n');
    if (!confirm('Some scanned details are uncertain or conflict:\n\n' + lines +
                 '\n\nCreate the invoice from these details anyway? Nothing is saved yet — you can edit everything afterwards.')) return;
  }
  if (State.items.length > 0 && !confirm('Replace current invoice items with OCR results?')) return;

  import('../ui/navigation.js').then(m => m.switchTab('invoice'));

  setTimeout(() => {
    const vendor  = document.getElementById('ocrVendorName')?.value.trim();
    const gstin   = document.getElementById('ocrDetectedGSTIN')?.value.trim();
    const date    = document.getElementById('ocrBillDate')?.value.trim();
    const billNo  = document.getElementById('ocrBillNumber')?.value.trim();

    if (vendor) { const el = document.getElementById('invClient');      if (el) el.value = vendor; }
    if (gstin)  { const el = document.getElementById('invClientGSTIN'); if (el) el.value = gstin; }
    if (date)   { const el = document.getElementById('invDate');        if (el) el.value = date; }
    if (billNo) { const el = document.getElementById('invNumber');      if (el) el.value = billNo; }

    // Charges that were read from the bill AND reconcile with its total are carried over
    const ex = _lastParse && _lastParse.extras;
    if (ex && !_lastParse.flags.some(f => f.level === 'error' && f.field === 'totals')) {
      [['invShipping', ex.shipping], ['invPackaging', ex.packaging], ['invHandling', ex.handling]].forEach(([id, v]) => {
        const el = document.getElementById(id); if (el && v) el.value = v;
      });
    }

    State.setItems(State.ocrDetectedItems.map(({ flags, ...it }) => ({ ...it, id: nextId() })));
    import('./invoice.js').then(m => {
      m.renderItems();
      showToast('Invoice form filled from the scan — review it, then press Save.', 'success');
    });
  }, 200);
}

/** Last parser result (used by the review panel and by tests). */
export function getLastOCRResult() { return _lastParse; }

export function clearOCR() {
  _pdfLines = null; _lastParse = null; _lastRawText = '';
  const rn = document.getElementById('ocrReviewNotes'); if (rn) rn.remove();
  ['ocrVendorName','ocrBillDate','ocrBillNumber','ocrDetectedGSTIN'].forEach(id => { const el = document.getElementById(id); if (el) { el.style.outline = ''; el.title = ''; } });
  State.setOcrImageData(null);
  State.setOcrDetectedItems([]);
  State.setOcrDetectedVendor('');
  State.setOcrDetectedGSTIN('');
  State.setOcrDetectedDate('');
  State.setOcrDetectedBillNo('');

  // Hide panels
  const panel     = document.getElementById('ocrDetectedPanel');
  const emptyState = document.getElementById('ocrEmptyState');
  const progressWrap = document.getElementById('ocrProgressWrap');
  if (panel)        panel.style.display      = 'none';
  if (emptyState)   emptyState.style.display = 'block';
  if (progressWrap) progressWrap.style.display = 'none';

  // Reset preview image
  const img = document.getElementById('ocrPreviewImg');
  if (img) { img.src = ''; img.style.display = 'none'; }

  // Reset upload zone
  const zone = document.getElementById('ocrUploadZone');
  if (zone) {
    const icon = zone.querySelector('i.fas');
    const h3   = zone.querySelector('h3');
    const p    = zone.querySelector('p');
    if (icon) icon.className = 'fas fa-cloud-upload-alt';
    if (h3)   h3.textContent = 'Click to Upload Bill Image';
    if (p)    p.textContent  = 'Supports JPG, PNG, WEBP';
    zone.classList.remove('has-image');
  }

  // Reset file input so same file can be re-uploaded
  const fileInput = document.getElementById('ocrFileInput');
  if (fileInput) fileInput.value = '';

  // Disable scan button
  const btn = document.getElementById('btnStartOCR');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-bolt"></i> Start Scanning'; }

  setOCRProgress(0);
  setOCRStatus('Waiting for image...', 'neutral');
}
