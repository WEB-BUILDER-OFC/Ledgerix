/**
 * Ledgerix - Reports Module
 */

'use strict';

import * as State from '../core/state.js';
import { showToast } from '../ui/toast.js';
import { formatMoney, formatDate, getWeekStart, getWeekEnd, getMonthStart,
         getMonthEnd, getYearStart, getYearEnd, today, csvField, esc } from '../utils/helpers.js';

export function generateReport() {
  const type     = document.getElementById('reportType')?.value     || 'monthly';
  const fromDate = document.getElementById('reportFromDate')?.value || '';
  const toDate   = document.getElementById('reportToDate')?.value   || '';

  const filtered = State.savedInvoices.filter(inv => {
    const d = inv.invDate;
    return d >= fromDate && d <= toDate;
  });

  State.setCurrentReportData({ type, fromDate, toDate, invoices: filtered });

  // Show report area and export bar, hide empty state
  const reportContent   = document.getElementById('reportContent');
  const reportEmpty     = document.getElementById('reportEmpty');
  const reportExportBar = document.getElementById('reportExportBar');
  if (reportContent)   reportContent.style.display   = 'block';
  if (reportEmpty)     reportEmpty.style.display     = 'none';
  if (reportExportBar) reportExportBar.style.display = 'flex';

  switch (type) {
    case 'daily':    renderDailyReport(filtered, fromDate, toDate);   break;
    case 'weekly':   renderWeeklyReport(filtered, fromDate, toDate);  break;
    case 'monthly':  renderMonthlyReport(filtered, fromDate, toDate); break;
    case 'yearly':   renderYearlyReport(filtered, fromDate, toDate);  break;
    case 'gst':      renderGSTReport(filtered, fromDate, toDate);     break;
    case 'client':   renderClientReport(filtered, fromDate, toDate);  break;
    case 'product':  renderProductReport(filtered, fromDate, toDate); break;
    default: break;
  }

  showToast('Report generated!', 'success');
}

function _tableHeader(title, fromDate, toDate, headRow) {
  return `<div class="report-header" style="margin-bottom:1rem">
    <h3 style="color:var(--gold)">${title}</h3>
    <p style="color:var(--gray);font-size:0.85rem">${formatDate(fromDate)} to ${formatDate(toDate)}</p>
  </div>
  <table class="report-table" id="reportTable">
    <thead><tr>${headRow}</tr></thead>
    <tbody id="reportTableBody"></tbody>
    <tfoot id="reportTableFoot"></tfoot>
  </table>`;
}

function _setBody(rows) { document.getElementById('reportTableBody').innerHTML = rows; }
function _setFoot(rows) { document.getElementById('reportTableFoot').innerHTML = rows; }
function _setContent(html) { document.getElementById('reportContent').innerHTML = html; }
function _th(label) { return `<th>${label}</th>`; }
function _td(v, style='') { return `<td${style ? ` style="${style}"` : ''}>${v}</td>`; }

export function renderDailyReport(invoices, from, to) {
  const dayMap = {};
  invoices.forEach(inv => {
    if (!dayMap[inv.invDate]) dayMap[inv.invDate] = { count: 0, sales: 0, gst: 0, paid: 0, pending: 0 };
    const d = dayMap[inv.invDate];
    d.count++; d.sales += parseFloat(inv.grandTotal)||0; d.gst += parseFloat(inv.totalGST)||0;
    if (inv.paymentStatus === 'paid') d.paid += parseFloat(inv.grandTotal)||0;
    else d.pending += parseFloat(inv.grandTotal)||0;
  });
  const days = Object.keys(dayMap).sort();
  const summary = days.reduce((a,d) => {
    a.count += dayMap[d].count; a.sales += dayMap[d].sales; a.gst += dayMap[d].gst;
    a.paid += dayMap[d].paid; a.pending += dayMap[d].pending; return a;
  }, { count:0, sales:0, gst:0, paid:0, pending:0 });

  _setContent(_tableHeader('Daily Sales Report', from, to,
    [_th('Date'),_th('Invoices'),_th('Sales'),_th('GST'),_th('Paid'),_th('Pending')].join('')));
  _setBody(days.map(d => `<tr>${[_td(formatDate(d)),_td(dayMap[d].count),_td(formatMoney(dayMap[d].sales)),_td(formatMoney(dayMap[d].gst)),_td(formatMoney(dayMap[d].paid),'color:var(--success)'),_td(formatMoney(dayMap[d].pending),'color:var(--warning)')].join('')}</tr>`).join(''));
  _setFoot(`<tr><td><strong>Total (${days.length} days)</strong></td>${[summary.count,formatMoney(summary.sales),formatMoney(summary.gst),formatMoney(summary.paid),formatMoney(summary.pending)].map(v=>`<td>${v}</td>`).join('')}</tr>`);
}

export function renderWeeklyReport(invoices, from, to) {
  const weekMap = {};
  invoices.forEach(inv => {
    const wk = getWeekStart(inv.invDate) + ' to ' + getWeekEnd(inv.invDate);
    if (!weekMap[wk]) weekMap[wk] = { count:0, sales:0, gst:0, paid:0, pending:0 };
    const w = weekMap[wk];
    w.count++; w.sales += parseFloat(inv.grandTotal)||0; w.gst += parseFloat(inv.totalGST)||0;
    if (inv.paymentStatus === 'paid') w.paid += parseFloat(inv.grandTotal)||0;
    else w.pending += parseFloat(inv.grandTotal)||0;
  });
  const weeks = Object.keys(weekMap).sort();
  const summary = weeks.reduce((a,wk) => {
    a.count += weekMap[wk].count; a.sales += weekMap[wk].sales; a.gst += weekMap[wk].gst;
    a.paid += weekMap[wk].paid; a.pending += weekMap[wk].pending; return a;
  }, { count:0, sales:0, gst:0, paid:0, pending:0 });

  _setContent(_tableHeader('Weekly Sales Report', from, to,
    [_th('Week'),_th('Invoices'),_th('Sales'),_th('GST'),_th('Paid'),_th('Pending')].join('')));
  _setBody(weeks.map(wk => `<tr>${[_td(wk),_td(weekMap[wk].count),_td(formatMoney(weekMap[wk].sales)),_td(formatMoney(weekMap[wk].gst)),_td(formatMoney(weekMap[wk].paid)),_td(formatMoney(weekMap[wk].pending))].join('')}</tr>`).join(''));
  _setFoot(`<tr><td><strong>Total (${weeks.length} weeks)</strong></td>${[summary.count,formatMoney(summary.sales),formatMoney(summary.gst),formatMoney(summary.paid),formatMoney(summary.pending)].map(v=>`<td>${v}</td>`).join('')}</tr>`);
}

export function renderMonthlyReport(invoices, from, to) {
  const monthMap = {};
  invoices.forEach(inv => {
    const mo = inv.invDate.substring(0, 7);
    if (!monthMap[mo]) monthMap[mo] = { count:0, sales:0, gst:0, cgst:0, sgst:0, igst:0, paid:0, pending:0 };
    const m = monthMap[mo];
    m.count++; m.sales += parseFloat(inv.grandTotal)||0;
    const gst = parseFloat(inv.totalGST)||0; m.gst += gst;
    if ((inv.taxType||'intra') === 'inter') m.igst += gst;
    else { m.cgst += gst/2; m.sgst += gst/2; }
    if (inv.paymentStatus === 'paid') m.paid += parseFloat(inv.grandTotal)||0;
    else m.pending += parseFloat(inv.grandTotal)||0;
  });
  const months = Object.keys(monthMap).sort();
  const summary = months.reduce((a,mo) => {
    const m = monthMap[mo];
    a.count += m.count; a.sales += m.sales; a.cgst += m.cgst; a.sgst += m.sgst; a.igst += m.igst; a.paid += m.paid; a.pending += m.pending; return a;
  }, { count:0, sales:0, cgst:0, sgst:0, igst:0, paid:0, pending:0 });

  _setContent(_tableHeader('Monthly Sales Report', from, to,
    [_th('Month'),_th('Invoices'),_th('Sales'),_th('CGST'),_th('SGST'),_th('IGST'),_th('Paid'),_th('Pending')].join('')));
  _setBody(months.map(mo => {
    const m = monthMap[mo];
    return `<tr>${[_td(mo),_td(m.count),_td(formatMoney(m.sales)),_td(formatMoney(m.cgst)),_td(formatMoney(m.sgst)),_td(formatMoney(m.igst)),_td(formatMoney(m.paid)),_td(formatMoney(m.pending))].join('')}</tr>`;
  }).join(''));
  _setFoot(`<tr><td><strong>Total (${months.length} months)</strong></td>${[summary.count,formatMoney(summary.sales),formatMoney(summary.cgst),formatMoney(summary.sgst),formatMoney(summary.igst),formatMoney(summary.paid),formatMoney(summary.pending)].map(v=>`<td>${v}</td>`).join('')}</tr>`);
}

export function renderYearlyReport(invoices, from, to) {
  const yearMap = {};
  invoices.forEach(inv => {
    const ys = getYearStart(inv.invDate);
    const label = ys.substring(0,4) + '-' + (parseInt(ys.substring(0,4))+1).toString().substring(2);
    if (!yearMap[label]) yearMap[label] = { count:0, sales:0, gst:0, paid:0, pending:0 };
    const y = yearMap[label];
    y.count++; y.sales += parseFloat(inv.grandTotal)||0; y.gst += parseFloat(inv.totalGST)||0;
    if (inv.paymentStatus === 'paid') y.paid += parseFloat(inv.grandTotal)||0;
    else y.pending += parseFloat(inv.grandTotal)||0;
  });
  const years = Object.keys(yearMap).sort();

  _setContent(_tableHeader('Yearly Sales Report (Indian FY)', from, to,
    [_th('Financial Year'),_th('Invoices'),_th('Sales'),_th('GST'),_th('Paid'),_th('Pending')].join('')));
  _setBody(years.map(yr => `<tr>${[_td('FY '+yr),_td(yearMap[yr].count),_td(formatMoney(yearMap[yr].sales)),_td(formatMoney(yearMap[yr].gst)),_td(formatMoney(yearMap[yr].paid)),_td(formatMoney(yearMap[yr].pending))].join('')}</tr>`).join(''));
}

export function renderGSTReport(invoices, from, to) {
  _setContent(_tableHeader('GST Collection Summary', from, to,
    [_th('Invoice#'),_th('Date'),_th('Client'),_th('Type'),_th('CGST'),_th('SGST'),_th('IGST'),_th('Total GST')].join('')));
  let totCGST=0, totSGST=0, totIGST=0, totGST=0;
  _setBody(invoices.map(inv => {
    const gst = parseFloat(inv.totalGST)||0;
    const cgst = inv.taxType === 'inter' ? 0 : gst/2;
    const sgst = inv.taxType === 'inter' ? 0 : gst/2;
    const igst = inv.taxType === 'inter' ? gst : 0;
    totCGST += cgst; totSGST += sgst; totIGST += igst; totGST += gst;
    return `<tr>${[_td(esc(inv.invNum)),_td(formatDate(inv.invDate)),_td(esc(inv.clientName)),_td(inv.taxType==='inter'?'IGST':'CGST+SGST'),_td(formatMoney(cgst)),_td(formatMoney(sgst)),_td(formatMoney(igst)),_td(formatMoney(gst))].join('')}</tr>`;
  }).join(''));
  _setFoot(`<tr><td colspan="4"><strong>Total</strong></td>${[totCGST,totSGST,totIGST,totGST].map(v=>`<td>${formatMoney(v)}</td>`).join('')}</tr>`);
}

export function renderClientReport(invoices, from, to) {
  const clientMap = {};
  invoices.forEach(inv => {
    if (!clientMap[inv.clientName]) clientMap[inv.clientName] = { count:0, sales:0, gst:0, paid:0, pending:0 };
    const c = clientMap[inv.clientName];
    c.count++; c.sales += parseFloat(inv.grandTotal)||0; c.gst += parseFloat(inv.totalGST)||0;
    if (inv.paymentStatus === 'paid') c.paid += parseFloat(inv.grandTotal)||0;
    else c.pending += parseFloat(inv.grandTotal)||0;
  });
  const names = Object.keys(clientMap).sort();
  const summary = names.reduce((a,n) => {
    a.count += clientMap[n].count; a.sales += clientMap[n].sales; a.gst += clientMap[n].gst;
    a.paid += clientMap[n].paid; a.pending += clientMap[n].pending; return a;
  }, { count:0, sales:0, gst:0, paid:0, pending:0 });

  _setContent(_tableHeader('Client-wise Sales Report', from, to,
    [_th('Client'),_th('Invoices'),_th('Sales'),_th('GST'),_th('Paid'),_th('Pending')].join('')));
  _setBody(names.map(n => `<tr>${[_td(`<strong>${esc(n)}</strong>`),_td(clientMap[n].count),_td(formatMoney(clientMap[n].sales)),_td(formatMoney(clientMap[n].gst)),_td(formatMoney(clientMap[n].paid),'color:var(--success)'),_td(formatMoney(clientMap[n].pending),'color:var(--warning)')].join('')}</tr>`).join(''));
  _setFoot(`<tr><td><strong>Total (${names.length} clients)</strong></td>${[summary.count,formatMoney(summary.sales),formatMoney(summary.gst),formatMoney(summary.paid),formatMoney(summary.pending)].map(v=>`<td>${v}</td>`).join('')}</tr>`);
}

export function renderProductReport(invoices, from, to) {
  const productMap = {};
  invoices.forEach(inv => {
    (inv.itemRows||[]).forEach(it => {
      if (!productMap[it.desc]) productMap[it.desc] = { qty:0, sales:0, gst:0, count:0 };
      const p = productMap[it.desc];
      p.qty += parseFloat(it.qty)||0;
      p.sales += parseFloat(it.amount || ((it.qty*it.rate)*(1-(it.disc||0)/100)))||0;
      p.gst += parseFloat(it.gstAmount || (p.sales*(it.gst/100)))||0;
      p.count++;
    });
  });
  const names = Object.keys(productMap).sort((a,b) => productMap[b].sales - productMap[a].sales);

  _setContent(_tableHeader('Product-wise Sales Report', from, to,
    [_th('Product'),_th('Qty Sold'),_th('Sales'),_th('GST'),_th('Invoices')].join('')));
  _setBody(names.map(n => `<tr>${[_td(`<strong>${esc(n)}</strong>`),_td(productMap[n].qty),_td(formatMoney(productMap[n].sales)),_td(formatMoney(productMap[n].gst)),_td(productMap[n].count)].join('')}</tr>`).join(''));
}

export function exportReportCSV() {
  if (!State.currentReportData) { showToast('Generate a report first', 'warning'); return; }
  const table = document.getElementById('reportTable');
  if (!table) return;
  let csv = '';
  const headers = [...table.querySelectorAll('thead th')].map(th => csvField(th.textContent)).join(',');
  csv += headers + '\n';
  [...table.querySelectorAll('tbody tr')].forEach(tr => {
    csv += [...tr.querySelectorAll('td')].map(td => csvField(td.textContent)).join(',') + '\n';
  });
  [...table.querySelectorAll('tfoot tr')].forEach(tr => {
    csv += [...tr.querySelectorAll('td')].map(td => csvField(td.textContent)).join(',') + '\n';
  });
  _download(csv, `Report_${State.currentReportData.type}_${State.currentReportData.fromDate}.csv`, 'text/csv');
  showToast('Report exported as CSV!', 'success');
}

export function exportReportExcel() {
  if (!State.currentReportData) { showToast('Generate a report first', 'warning'); return; }
  const table = document.getElementById('reportTable');
  if (!table) return;
  let tsv = '';
  [...table.querySelectorAll('thead tr, tbody tr, tfoot tr')].forEach(tr => {
    tsv += [...tr.querySelectorAll('th,td')].map(td => td.textContent).join('\t') + '\n';
  });
  _download(tsv, `Report_${State.currentReportData.type}_${State.currentReportData.fromDate}.xls`, 'application/vnd.ms-excel');
  showToast('Report exported as Excel!', 'success');
}

export function printReport() {
  // Use window.print() directly — avoids popup blocker issues on mobile.
  // The report content is visible in the current tab; @media print CSS hides
  // the sidebar, header, and action buttons.
  window.print();
}

function _download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
