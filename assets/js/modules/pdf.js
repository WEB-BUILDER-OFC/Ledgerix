/**
 * Ledgerix - PDF Generation Module
 * v2.6 fix: replaced doc.html() (requires missing html2canvas) with
 *           jsPDF + autoTable — reliable on mobile without extra dependencies.
 *           Preview uses style.display (not classList) to override inline display:none.
 * v2.11: Professional PDF — logo, signature, watermark, improved layout.
 *         HTML preview also updated: signature area improved, watermark added.
 * v2.11.1: PDF currency fix — ₹ (U+20B9) is outside CP1252/WinAnsi, the encoding
 *           used by jsPDF's built-in helvetica font. Passing ₹ to doc.text() causes
 *           jsPDF to fall back to character-by-character glyph positioning, producing
 *           "₹ 1 0 , 0 0 0 . 0 0" spacing artifacts. Fixed with a PDF-local formatter
 *           that substitutes "Rs." for the INR symbol in all doc.text() calls only.
 *           HTML preview and formatMoney() are completely unchanged.
 * v2.11.1 (cont.): _pdfMoney now also strips any char >0xFF (safety net);
 *           totals block rewritten as a deterministic panel (panelX/padL/padR,
 *           rowH-based height, Grand Total inside panel, amount-only font shrink).
 *           sw.js cache names bumped so the fixed pdf.js actually reaches devices.
 */

'use strict';

import * as State from '../core/state.js';
import { showToast } from '../ui/toast.js';
import { esc, formatMoney, numberToWords } from '../utils/helpers.js';

// ── PDF-safe currency formatter ───────────────────────────────────────────────
// jsPDF 2.5.1 uses WinAnsi (CP1252) encoding for built-in fonts (helvetica, courier, times).
// The Indian Rupee sign ₹ (U+20B9) is NOT in CP1252 (range 0x00–0xFF only, decimal 0–255).
// Passing ₹ to doc.text() causes jsPDF to switch to per-glyph positioning,
// producing spaced/broken rendering like "₹ 1 0 , 0 0 0 . 0 0".
// This formatter is used ONLY inside downloadPDFFromData() — never in HTML preview.
// $ (U+0024) and £ (U+00A3) are in CP1252 and work fine with jsPDF — kept as-is.
// € (U+20AC) is also outside standard CP1252 but jsPDF maps it via CP1252's 0x80 slot — kept.
function _pdfMoney(amount) {
  const raw = formatMoney(amount);
  // 1) INR symbol -> "Rs. " (CP1252-safe, keeps the currency visible)
  // 2) Safety net: any remaining char outside Latin-1 (>0xFF) would push jsPDF into
  //    16-bit encoding and re-create the spaced-glyph bug, so it is replaced by '?'.
  //    € and the AED symbol are also written as text codes (EUR / AED) for the same reason.
  return raw
    .replace('\u20B9', 'Rs. ')
    .replace('\u20AC', 'EUR ')
    .replace('\u062F.\u0625', 'AED ')
    .replace(/[^\u0000-\u00FF]/g, '?');
}

// ── Preview ──────────────────────────────────────────────────────────────────

export function previewInvoice() {
  const data = _getInvoiceData();
  if (!data) return;

  const content = document.getElementById('invoicePreviewContent');
  const wrapper = document.getElementById('invoicePreview');
  if (!content || !wrapper) { showToast('Preview area not found', 'warning'); return; }

  content.innerHTML = generateInvoiceHTML(data);
  wrapper.style.display = 'block';
  setTimeout(() => wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

export function closePreview() {
  const wrapper = document.getElementById('invoicePreview');
  if (wrapper) wrapper.style.display = 'none';
}

// ── PDF — jsPDF + autoTable (no html2canvas required) ────────────────────────

export async function downloadPDF() {
  const data = _getInvoiceData();
  if (!data) return;
  await downloadPDFFromData(data);
}

// Detect image format from a base64 data URI
// Load an image from a data URI and return { img, w, h }.
// Always resolves — returns { img:null, w:1, h:1 } on error.
// The loaded Image element is reused for canvas conversion, avoiding a second decode.
function _loadImg(dataUri) {
  return new Promise(resolve => {
    if (!dataUri || !dataUri.startsWith('data:image/')) {
      resolve({ img: null, w: 1, h: 1 });
      return;
    }
    const img = new Image();
    img.onload  = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => { console.warn('[PDF] Image load failed'); resolve({ img: null, w: 1, h: 1 }); };
    img.src = dataUri;
  });
}

// Normalise a loaded Image to a jsPDF-safe PNG data URI.
// - PNG and JPEG are passed directly (already supported by jsPDF 2.5.1).
// - WEBP, GIF, and any other format are drawn onto an off-screen canvas
//   and exported as PNG — avoiding jsPDF's lack of native WEBP support
//   (critical on Android where camera images are typically WEBP).
// Returns { dataUri: string, format: 'PNG'|'JPEG' } or null on failure.
function _normaliseImg(loadedImg, originalUri) {
  if (!loadedImg) return null;
  try {
    const isPNG  = originalUri.startsWith('data:image/png');
    const isJPEG = originalUri.startsWith('data:image/jpeg') || originalUri.startsWith('data:image/jpg');
    if (isPNG)  return { dataUri: originalUri, format: 'PNG'  };
    if (isJPEG) return { dataUri: originalUri, format: 'JPEG' };

    // For WEBP, GIF, or anything else: convert via canvas → PNG
    const canvas = document.createElement('canvas');
    canvas.width  = loadedImg.naturalWidth  || 1;
    canvas.height = loadedImg.naturalHeight || 1;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(loadedImg, 0, 0);
    const pngUri = canvas.toDataURL('image/png');
    return { dataUri: pngUri, format: 'PNG' };
  } catch (e) {
    console.warn('[PDF] Image normalisation failed:', e);
    return null;
  }
}

// Embed a pre-loaded, pre-normalised image into the jsPDF document.
// loadedObj = result of _loadImg(); normalised = result of _normaliseImg().
// Aspect ratio is computed from the loaded image's natural dimensions.
// Returns true on success, false on any failure (never throws).
function _addImg(doc, normalised, loadedObj, x, y, maxW, maxH) {
  if (!normalised || !normalised.dataUri) return false;
  try {
    const { w, h } = loadedObj;
    const aspect = w / Math.max(h, 1);
    // Fit inside the bounding box (maxW × maxH) without distortion
    let dw = maxW;
    let dh = dw / aspect;
    if (dh > maxH) { dh = maxH; dw = dh * aspect; }
    doc.addImage(normalised.dataUri, normalised.format, x, y, dw, dh);
    return true;
  } catch (e) {
    console.warn('[PDF] addImage failed:', e);
    return false;
  }
}

export async function downloadPDFFromData(data) {
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFCtor) {
    showToast('PDF library not loaded — use Print instead', 'warning');
    window.print();
    return;
  }

  try {
    const profile  = State.profile || {};
    const W        = 210;
    const H        = 297;
    const margin   = 14;
    const innerW   = W - margin * 2;
    const NAVY     = [10, 22, 40];
    const GOLD     = [201, 168, 76];
    const DARK     = [26, 34, 54];
    const MID      = [80, 90, 110];
    const LIGHT    = [230, 235, 242];

    // Pre-load logo/signature — fully awaited before doc creation (no race possible)
    let logoLoaded = { img: null, w: 1, h: 1 };
    let logoNorm   = null;
    let sigLoaded  = { img: null, w: 1, h: 1 };
    let sigNorm    = null;
    if (profile.logo) {
      logoLoaded = await _loadImg(profile.logo);
      logoNorm   = _normaliseImg(logoLoaded.img, profile.logo);
    }
    if (profile.signature) {
      sigLoaded = await _loadImg(profile.signature);
      sigNorm   = _normaliseImg(sigLoaded.img, profile.signature);
    }

    const doc = new jsPDFCtor({ orientation: 'p', unit: 'mm', format: 'a4' });
    let y = 0;

    // ── Subtle side watermark (drawn first, behind everything) ────────────────
    doc.saveGraphicsState();
    doc.setTextColor(220, 224, 232);          // very light navy-tint gray
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    // Rotate 90°, positioned along the right edge at mid-page
    doc.text('Ledgerix', W - 4, H / 2, { angle: 90, align: 'center' });
    doc.restoreGraphicsState();

    // ── Header band ───────────────────────────────────────────────────────────
    // Full-width navy band at top
    const bandH = profile.logo ? 32 : 24;
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, bandH, 'F');

    // Gold accent line under band
    doc.setFillColor(...GOLD);
    doc.rect(0, bandH, W, 0.8, 'F');

    y = 6;

    // Logo in header band (left side)
    const LOGO_MAX_H = bandH - 8;   // 24mm or 20mm max
    let logoW = 0;
    if (logoNorm) {
      const ok = _addImg(doc, logoNorm, logoLoaded, margin, y, 36, LOGO_MAX_H);
      if (ok) {
        // Compute the actual drawn width from the normalised aspect ratio
        const aspect = logoLoaded.w / Math.max(logoLoaded.h, 1);
        const drawnH = Math.min(LOGO_MAX_H, logoLoaded.h > 0 ? LOGO_MAX_H : 20);
        const drawnW = Math.min(drawnH * aspect, 36);
        logoW = drawnW + 4;
      }
    }

    // Business name + details in band (white text, after logo)
    const nameX = margin + logoW;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(profile.name || 'Your Business', nameX, y + 6);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 190, 210);
    let detY = y + 11;
    if (profile.address) {
      const addrLines = doc.splitTextToSize(profile.address, innerW - logoW - 60);
      doc.text(addrLines, nameX, detY);
      detY += addrLines.length * 3.5;
    }
    const gstPhone = [
      profile.gstin ? 'GSTIN: ' + profile.gstin : '',
      profile.phone ? profile.phone : '',
    ].filter(Boolean).join('   |   ');
    if (gstPhone) doc.text(gstPhone, nameX, detY);

    // INVOICE title + meta (right of band)
    const metaRX = W - margin;
    doc.setTextColor(201, 168, 76);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', metaRX, y + 6, { align: 'right' });

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 190, 210);
    doc.text('#' + (data.invNum || ''), metaRX, y + 12, { align: 'right' });

    y = bandH + 8;  // below band + gold line

    // ── Invoice meta row ──────────────────────────────────────────────────────
    const metaItems = [
      ['Date',   data.invDate     || '—'],
      ['Due',    data.dueDate     || '—'],
      ['Status', (data.paymentStatus || 'pending').toUpperCase()],
    ];
    const metaCellW = innerW / metaItems.length;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, y, innerW, 10, 1.5, 1.5, 'F');
    metaItems.forEach(([lbl, val], i) => {
      const cx = margin + i * metaCellW + metaCellW / 2;
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MID);
      doc.text(lbl.toUpperCase(), cx, y + 3.5, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      // Status gets color coding
      if (lbl === 'Status') {
        doc.setTextColor(data.paymentStatus === 'paid' ? 0 : 150,
                         data.paymentStatus === 'paid' ? 100 : 30,
                         data.paymentStatus === 'paid' ? 60 : 30);
      } else {
        doc.setTextColor(...DARK);
      }
      doc.text(val, cx, y + 8, { align: 'center' });
    });
    y += 14;

    // ── Bill To + Bank side-by-side ───────────────────────────────────────────
    const colW = (innerW - 4) / 2;
    const boxH = 28;

    // Bill To box
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, colW, boxH, 'F');
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.rect(margin, y, colW, boxH);
    let bx = margin + 4, by = y + 5;
    doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GOLD);
    doc.text('BILL TO', bx, by);
    by += 4;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
    doc.text(data.clientName || '—', bx, by);
    by += 4;
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MID);
    if (data.clientAddr) {
      const al = doc.splitTextToSize(data.clientAddr, colW - 8);
      doc.text(al, bx, by); by += al.length * 3.5;
    }
    if (data.clientGSTIN) { doc.text('GSTIN: ' + data.clientGSTIN, bx, by); by += 3.5; }
    if (data.clientPhone)  { doc.text(data.clientPhone, bx, by); }

    // Bank Details box
    const bkX = margin + colW + 4;
    doc.setFillColor(248, 250, 252);
    doc.rect(bkX, y, colW, boxH, 'F');
    doc.setDrawColor(...LIGHT);
    doc.rect(bkX, y, colW, boxH);
    let bkbx = bkX + 4, bkby = y + 5;
    doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GOLD);
    doc.text('PAYMENT DETAILS', bkbx, bkby);
    bkby += 4;
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MID);
    if (profile.bank)    { doc.text('Bank: '  + profile.bank,    bkbx, bkby); bkby += 4; }
    if (profile.account) { doc.text('A/C: '   + profile.account, bkbx, bkby); bkby += 4; }
    if (profile.ifsc)    { doc.text('IFSC: '  + profile.ifsc,    bkbx, bkby); bkby += 4; }
    if (profile.upi)     { doc.text('UPI: '   + profile.upi,     bkbx, bkby); }
    y += boxH + 6;

    // ── Items table ───────────────────────────────────────────────────────────
    const tableRows = (data.itemRows || []).map((it, i) => {
      const amt    = parseFloat(it.amount    || 0) || ((it.qty || 0) * (it.rate || 0)) * (1 - ((it.disc || 0) / 100));
      const gstAmt = parseFloat(it.gstAmount || 0) || (amt * ((it.gst || 0) / 100));
      return [
        String(i + 1),
        it.desc || '',
        it.hsn  || '',
        String(it.qty  || 1),
        _pdfMoney(it.rate || 0),
        (it.gst  || 0) + '%',
        (it.disc || 0) + '%',
        _pdfMoney(gstAmt),
        _pdfMoney(amt + gstAmt),
      ];
    });

    const MONEY_COLS     = [4, 7, 8];                 // Rate, Tax Amt, Total
    const MONEY_PAD      = { top: 3, bottom: 3, left: 2, right: 2 };
    const MONEY_USABLE_W = 22 - MONEY_PAD.left - MONEY_PAD.right;

    doc.autoTable({
      startY: y,
      head: [['#', 'Description', 'HSN', 'Qty', 'Rate', 'GST%', 'Disc%', 'Tax Amt', 'Total']],
      body: tableRows.length ? tableRows : [['', 'No items', '', '', '', '', '', '', '']],
      theme: 'grid',
      headStyles: {
        fillColor: NAVY, textColor: GOLD,
        fontSize: 7, fontStyle: 'bold', cellPadding: 3,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      bodyStyles:  { fontSize: 7, textColor: [40, 50, 70], cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 47 },
        2: { cellWidth: 18 },
        3: { cellWidth: 10, halign: 'center' },
        4: { cellWidth: 22, halign: 'right', cellPadding: MONEY_PAD },
        5: { cellWidth: 14, halign: 'center' },
        6: { cellWidth: 14, halign: 'center' },
        7: { cellWidth: 22, halign: 'right', cellPadding: MONEY_PAD },
        8: { cellWidth: 22, halign: 'right', cellPadding: MONEY_PAD },
      },
      margin: { left: margin, right: margin },
      // Money cells ("Rs. 1,039,500.00") can be wider than a fixed 22 mm column.
      // Shrink only that cell's font so it fits on one line (no wrap, no spill).
      didParseCell: (h) => {
        if (h.section !== 'body' || !MONEY_COLS.includes(h.column.index)) return;
        const txt = (h.cell.text || []).join('');
        if (!txt) return;
        let size = 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(size);
        while (size > 5 && doc.getTextWidth(txt) > MONEY_USABLE_W) {
          size -= 0.25;
          doc.setFontSize(size);
        }
        h.cell.styles.fontSize = size;
      },
    });

    y = doc.lastAutoTable.finalY + 5;

    // ── Totals panel (deterministic geometry) ─────────────────────────────────
    // One rectangle contains every row AND the Grand Total bar.
    //   panelX   = W - margin - panelW
    //   labelX   = panelX + padL
    //   amountX  = panelX + panelW - padR   (right-aligned anchor, never exceeded)
    const taxType  = data.taxType || 'intra';
    const totalGST = parseFloat(data.totalGST  || 0);
    const subtotal = parseFloat(data.subtotal   || 0);
    const grandTotal = parseFloat(data.grandTotal || 0);
    const shipping   = parseFloat(data.shipping   || 0);
    const packaging  = parseFloat(data.packaging  || 0);
    const handling   = parseFloat(data.handling   || 0);

    const panelW   = 80;
    const panelX   = W - margin - panelW;
    const padL     = 4;
    const padR     = 4;
    const labelX   = panelX + padL;
    const amountX  = panelX + panelW - padR;
    const rowH     = 6;          // every normal row
    const padTop   = 2;          // inside top edge
    const gtH      = 11;         // Grand Total bar height
    const availW   = panelW - padL - padR;
    const GAP      = 3;          // min gap between label and amount

    const totLines = [
      ['Subtotal',   _pdfMoney(subtotal)],
      ...(taxType === 'inter'
        ? [['IGST', _pdfMoney(totalGST)]]
        : [['CGST', _pdfMoney(totalGST / 2)], ['SGST', _pdfMoney(totalGST / 2)]]),
      ...(shipping   ? [['Shipping',  _pdfMoney(shipping)]]  : []),
      ...(packaging  ? [['Packaging', _pdfMoney(packaging)]] : []),
      ...(handling   ? [['Handling',  _pdfMoney(handling)]]  : []),
    ];
    const gtText    = _pdfMoney(grandTotal);
    const rowsH     = padTop + totLines.length * rowH;
    const panelH    = rowsH + gtH;
    const panelTop  = y;

    // Draws right-aligned amount; shrinks the AMOUNT font only if label+gap+amount
    // would not fit inside availW. Restores the original size afterwards.
    const _fitAmount = (label, amount, baseSize, labelSize) => {
      doc.setFontSize(labelSize);
      const lw = doc.getTextWidth(label);
      let size = baseSize;
      doc.setFontSize(size);
      while (size > 5 && lw + GAP + doc.getTextWidth(amount) > availW) {
        size -= 0.5;
        doc.setFontSize(size);
      }
      return size;
    };

    // Panel background + single outer border
    doc.setFillColor(248, 250, 252);
    doc.rect(panelX, panelTop, panelW, panelH, 'F');

    // Normal rows
    doc.setFont('helvetica', 'normal');
    totLines.forEach(([lbl, val], i) => {
      const baseline = panelTop + padTop + i * rowH + rowH / 2 + 1.1;
      const size = _fitAmount(lbl, val, 7.5, 7.5);
      doc.setFontSize(7.5);
      doc.setTextColor(...MID);
      doc.text(lbl, labelX, baseline);
      doc.setFontSize(size);
      doc.setTextColor(...DARK);
      doc.text(val, amountX, baseline, { align: 'right' });
    });

    // Grand Total bar — inside the same panel, same left/right edges
    const gtTop = panelTop + rowsH;
    doc.setFillColor(...NAVY);
    doc.rect(panelX, gtTop, panelW, gtH, 'F');
    doc.setFont('helvetica', 'bold');
    const gtBase = gtTop + gtH / 2 + 1.3;
    const gtSize = _fitAmount('Grand Total', gtText, 10, 10);
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text('Grand Total', labelX, gtBase);
    doc.setFontSize(gtSize);
    doc.setTextColor(...GOLD);
    doc.text(gtText, amountX, gtBase, { align: 'right' });

    // Outer border drawn last so it sits cleanly over both fills
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.rect(panelX, panelTop, panelW, panelH);

    y = panelTop + panelH + 6;

    // Amount in words
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...MID);
    doc.text(numberToWords(Math.round(grandTotal)) + ' Rupees Only',
             W - margin, y, { align: 'right' });
    y += 8;

    // ── Terms + Notes ─────────────────────────────────────────────────────────
    if (data.terms || data.notes) {
      doc.setDrawColor(...LIGHT);
      doc.setLineWidth(0.3);
      doc.line(margin, y, W - margin, y);
      y += 4;
      if (data.terms) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...DARK);
        doc.text('Terms & Conditions:', margin, y);
        y += 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MID);
        const tl = doc.splitTextToSize(data.terms, innerW);
        doc.text(tl, margin, y);
        y += tl.length * 4;
      }
      if (data.notes) {
        y += 2;
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...DARK);
        doc.text('Notes:', margin, y);
        y += 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MID);
        const nl = doc.splitTextToSize(data.notes, innerW);
        doc.text(nl, margin, y);
        y += nl.length * 4;
      }
      y += 4;
    }

    // ── Signature ─────────────────────────────────────────────────────────────
    if (sigNorm) {
      const SIG_MAX_H = 16;
      const SIG_MAX_W = 48;
      // Compute display dimensions for positioning (aspect ratio computed inside _addImg)
      const aspect = sigLoaded.w / Math.max(sigLoaded.h, 1);
      const sh = SIG_MAX_H;
      const sw = Math.min(sh * aspect, SIG_MAX_W);
      const sigX = W - margin - sw;

      // Check page space — add new page if needed
      if (y + sh + 12 > H - 16) {
        doc.addPage();
        y = margin;
      }

      const sigOk = _addImg(doc, sigNorm, sigLoaded, sigX, y, SIG_MAX_W, SIG_MAX_H);
      if (sigOk) {
        doc.setLineWidth(0.3);
        doc.setDrawColor(...LIGHT);
        doc.line(sigX - 4, y + sh + 2, W - margin, y + sh + 2);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MID);
        doc.text('Authorised Signature', W - margin, y + sh + 6, { align: 'right' });
        if (profile.name) doc.text(profile.name, W - margin, y + sh + 10, { align: 'right' });
        y += sh + 14;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const pageH = doc.internal.pageSize.height;
    doc.setFillColor(...NAVY);
    doc.rect(0, pageH - 12, W, 12, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 190, 210);
    doc.text('This is a computer-generated invoice. Thank you for your business.',
             W / 2, pageH - 5.5, { align: 'center' });
    // Footer watermark label
    doc.setTextColor(...GOLD);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Ledgerix', W - margin, pageH - 5.5, { align: 'right' });

    doc.save((data.invNum || 'invoice') + '.pdf');
    showToast('PDF downloaded!', 'success');

  } catch (e) {
    console.error('[PDF] Generation failed:', e);
    showToast('PDF failed — opening print view', 'warning');
    previewInvoice();
    setTimeout(() => window.print(), 500);
  }
}

// ── Invoice HTML for browser preview ─────────────────────────────────────────

export function generateInvoiceHTML(data) {
  const profile  = State.profile || {};
  const taxType  = data.taxType || 'intra';
  const totalGST = parseFloat(data.totalGST || 0);

  const itemsHTML = (data.itemRows || []).map((it, i) => {
    const amount = parseFloat(it.amount || 0) || ((it.qty || 0) * (it.rate || 0)) * (1 - ((it.disc || 0) / 100));
    const gstAmt = parseFloat(it.gstAmount || 0) || (amount * ((it.gst || 0) / 100));
    return `<tr style="background:${i%2?'#f8fafc':'#fff'}">
      <td style="padding:7px 6px;font-size:12px;color:#556">${i+1}</td>
      <td style="padding:7px 6px;font-size:12px;color:#1a2236;font-weight:500">${esc(it.desc||'Item')}</td>
      <td style="padding:7px 6px;font-size:11px;color:#778">${esc(it.hsn||'—')}</td>
      <td style="padding:7px 6px;font-size:12px;text-align:center;color:#334">${it.qty||1}</td>
      <td style="padding:7px 6px;font-size:12px;text-align:right;color:#334">${formatMoney(it.rate||0)}</td>
      <td style="padding:7px 6px;font-size:11px;text-align:center;color:#778">${it.gst||0}%</td>
      <td style="padding:7px 6px;font-size:11px;text-align:center;color:#778">${it.disc||0}%</td>
      <td style="padding:7px 6px;font-size:12px;text-align:right;color:#445">${formatMoney(gstAmt)}</td>
      <td style="padding:7px 6px;font-size:12px;text-align:right;font-weight:700;color:#1a2236">${formatMoney(amount+gstAmt)}</td>
    </tr>`;
  }).join('');

  const gstBlock = taxType === 'inter'
    ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556"><span>IGST</span><span>${formatMoney(totalGST)}</span></div>`
    : `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556"><span>CGST</span><span>${formatMoney(totalGST/2)}</span></div>
       <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556"><span>SGST</span><span>${formatMoney(totalGST/2)}</span></div>`;

  const statusColor = data.paymentStatus === 'paid'
    ? 'background:#d1fae5;color:#065f46'
    : data.paymentStatus === 'overdue'
      ? 'background:#fee2e2;color:#991b1b'
      : 'background:#fef3c7;color:#92400e';

  const logoHTML = profile.logo
    ? `<img src="${profile.logo}" style="max-height:48px;max-width:120px;object-fit:contain;display:block;margin-bottom:6px" alt="logo">`
    : '';
  const sigHTML = profile.signature
    ? `<div style="margin-top:24px;text-align:right">
        <img src="${profile.signature}" style="max-height:52px;max-width:140px;object-fit:contain;display:block;margin-left:auto" alt="signature">
        <div style="border-top:1px solid #d1d9e6;margin-top:6px;padding-top:4px">
          <p style="font-size:11px;color:#778;margin:0">Authorised Signature</p>
          ${profile.name ? `<p style="font-size:11px;color:#334;margin:2px 0 0 0;font-weight:600">${esc(profile.name)}</p>` : ''}
        </div>
       </div>`
    : '';

  return `<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;background:#fff;color:#1a2236;position:relative;overflow:hidden">

  <!-- Subtle watermark -->
  <div style="position:absolute;right:-18px;top:50%;transform:translateY(-50%) rotate(90deg);font-size:11px;font-weight:700;color:#e8edf5;letter-spacing:3px;pointer-events:none;user-select:none;white-space:nowrap">Ledgerix</div>

  <!-- Header band -->
  <div style="background:#0a1628;padding:18px 24px 14px;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      ${logoHTML}
      <div style="font-size:16px;font-weight:700;color:#fff">${esc(profile.name||'Your Business')}</div>
      <div style="color:#99a8c0;font-size:10px;margin-top:3px">${esc(profile.address||'')}</div>
      <div style="color:#99a8c0;font-size:10px;margin-top:2px">
        ${profile.gstin ? `GSTIN: ${esc(profile.gstin)}` : ''}
        ${profile.gstin && profile.phone ? '&nbsp;|&nbsp;' : ''}
        ${profile.phone ? esc(profile.phone) : ''}
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:800;color:#c9a84c;letter-spacing:3px">INVOICE</div>
      <div style="color:#c9a84c;font-size:11px;font-weight:700;margin-top:3px">${esc(data.invNum||'')}</div>
    </div>
  </div>
  <!-- Gold rule -->
  <div style="height:3px;background:#c9a84c"></div>

  <!-- Meta row -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:#f0f4f9;border-bottom:1px solid #dde3ed">
    ${[['DATE', data.invDate||'—'],['DUE DATE', data.dueDate||'—'],['STATUS', (data.paymentStatus||'PENDING').toUpperCase()]].map(([l,v],i)=>`
    <div style="padding:8px 14px;${i<2?'border-right:1px solid #dde3ed':''}">
      <div style="font-size:8px;color:#8892a8;font-weight:700;letter-spacing:0.8px">${l}</div>
      <div style="font-size:12px;font-weight:700;color:#1a2236;margin-top:2px">${l==='STATUS'?`<span style="display:inline-block;padding:1px 8px;border-radius:3px;font-size:10px;${statusColor}">${v}</span>`:v}</div>
    </div>`).join('')}
  </div>

  <!-- Bill To + Bank -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #e8edf5">
    <div style="padding:14px 14px 14px 24px;border-right:1px solid #e8edf5">
      <div style="font-size:8px;font-weight:700;color:#c9a84c;letter-spacing:1px;margin-bottom:5px">BILL TO</div>
      <div style="font-size:14px;font-weight:700;color:#1a2236">${esc(data.clientName||'')}</div>
      <div style="font-size:11px;color:#556;margin-top:3px">${esc(data.clientAddr||'')}</div>
      ${data.clientGSTIN?`<div style="font-size:11px;color:#778;margin-top:2px">GSTIN: ${esc(data.clientGSTIN)}</div>`:''}
      ${data.clientPhone?`<div style="font-size:11px;color:#778;margin-top:2px">${esc(data.clientPhone)}</div>`:''}
      ${data.clientEmail?`<div style="font-size:11px;color:#778">${esc(data.clientEmail)}</div>`:''}
    </div>
    <div style="padding:14px 24px 14px 14px">
      <div style="font-size:8px;font-weight:700;color:#c9a84c;letter-spacing:1px;margin-bottom:5px">PAYMENT DETAILS</div>
      ${profile.bank    ?`<div style="font-size:11px;color:#556"><strong style="color:#334">Bank:</strong> ${esc(profile.bank)}</div>`:''}
      ${profile.account ?`<div style="font-size:11px;color:#556"><strong style="color:#334">A/C:</strong> ${esc(profile.account)}</div>`:''}
      ${profile.ifsc    ?`<div style="font-size:11px;color:#556"><strong style="color:#334">IFSC:</strong> ${esc(profile.ifsc)}</div>`:''}
      ${profile.upi     ?`<div style="font-size:11px;color:#556"><strong style="color:#334">UPI:</strong> ${esc(profile.upi)}</div>`:''}
    </div>
  </div>

  <!-- Items table -->
  <div style="overflow-x:auto;margin:0">
    <table style="width:100%;border-collapse:collapse;min-width:560px">
      <thead>
        <tr style="background:#0a1628;color:#c9a84c">
          <th style="padding:8px 6px;text-align:left;font-size:10px;white-space:nowrap">#</th>
          <th style="padding:8px 6px;text-align:left;font-size:10px">Description</th>
          <th style="padding:8px 6px;text-align:left;font-size:10px">HSN</th>
          <th style="padding:8px 6px;text-align:center;font-size:10px">Qty</th>
          <th style="padding:8px 6px;text-align:right;font-size:10px">Rate</th>
          <th style="padding:8px 6px;text-align:center;font-size:10px">GST%</th>
          <th style="padding:8px 6px;text-align:center;font-size:10px">Disc%</th>
          <th style="padding:8px 6px;text-align:right;font-size:10px">Tax</th>
          <th style="padding:8px 6px;text-align:right;font-size:10px">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHTML||'<tr><td colspan="9" style="text-align:center;padding:16px;color:#888;font-size:12px">No items</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;padding:16px 24px;border-top:1px solid #e8edf5">
    <div style="width:260px">
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556;border-bottom:1px solid #eef0f5">
        <span>Subtotal</span><span style="color:#1a2236">${formatMoney(data.subtotal||0)}</span>
      </div>
      ${gstBlock}
      ${parseFloat(data.shipping) ?`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556"><span>Shipping</span><span>${formatMoney(data.shipping)}</span></div>`:''}
      ${parseFloat(data.packaging)?`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556"><span>Packaging</span><span>${formatMoney(data.packaging)}</span></div>`:''}
      ${parseFloat(data.handling) ?`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#556"><span>Handling</span><span>${formatMoney(data.handling)}</span></div>`:''}
      <div style="display:flex;justify-content:space-between;padding:10px 14px;margin-top:4px;background:#0a1628;border-radius:4px">
        <span style="font-size:13px;font-weight:700;color:#fff">Grand Total</span>
        <span style="font-size:14px;font-weight:800;color:#c9a84c">${formatMoney(data.grandTotal||0)}</span>
      </div>
      <div style="font-size:10px;color:#778;font-style:italic;text-align:right;margin-top:5px;padding-right:2px">${esc(numberToWords(Math.round(parseFloat(data.grandTotal)||0)))} Rupees Only</div>
    </div>
  </div>

  ${data.terms||data.notes ? `
  <div style="padding:14px 24px;border-top:1px solid #e8edf5;background:#f8fafc">
    ${data.terms?`<p style="font-size:10px;color:#556;margin:0 0 4px"><strong style="color:#334">Terms:</strong> ${esc(data.terms)}</p>`:''}
    ${data.notes?`<p style="font-size:10px;color:#556;margin:0"><strong style="color:#334">Notes:</strong> ${esc(data.notes)}</p>`:''}
  </div>`:''}

  <!-- Signature -->
  <div style="padding:0 24px 16px">
    ${sigHTML}
  </div>

  <!-- Footer -->
  <div style="background:#0a1628;padding:10px 24px;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:10px;color:#6b7fa0">This is a computer-generated invoice.</div>
    <div style="font-size:10px;font-weight:700;color:#c9a84c;letter-spacing:1px">Ledgerix</div>
  </div>

</div>`;
}

function _getInvoiceData() {
  try {
    const fn = window._ledgerix?.invoice?.getInvoiceData || window.getInvoiceData;
    if (typeof fn === 'function') return fn();
  } catch (e) { console.error('[PDF] getInvoiceData:', e); }
  showToast('Could not read invoice data', 'warning');
  return null;
}
