/**
 * Ledgerix - Dashboard Module
 */

'use strict';

import AppConfig from '../../../config/app.config.js';
import * as State from '../core/state.js';
import { esc, formatMoney, today, daysBetween, getMonthStart, getMonthEnd } from '../utils/helpers.js';

export function updateDashboard() {
  if (!document.getElementById('dashTodaySales')) return;

  const todayStr = today();
  const monthStart = getMonthStart(todayStr);
  const monthEnd   = getMonthEnd(todayStr);
  const yesterday  = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];

  let todaySales = 0, yesterdaySales = 0, monthSales = 0, lastMonthSales = 0;
  let totalGST = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;
  let pendingAmount = 0, paidAmount = 0, totalAmount = 0;
  let paidCount = 0, pendingCount = 0, overdueCount = 0, cancelledCount = 0;
  const recentInvoices = [];
  const pendingInvoices = [];

  State.savedInvoices.forEach(inv => {
    const amt = parseFloat(inv.grandTotal) || 0;
    const gst = parseFloat(inv.totalGST)   || 0;
    totalAmount += amt;

    if (inv.invDate === todayStr) todaySales += amt;
    if (inv.invDate === yStr)     yesterdaySales += amt;
    if (inv.invDate >= monthStart && inv.invDate <= monthEnd) monthSales += amt;

    const lms = getMonthStart(new Date(new Date(monthStart) - 1).toISOString().split('T')[0]);
    const lme = getMonthEnd(lms);
    if (inv.invDate >= lms && inv.invDate <= lme) lastMonthSales += amt;

    totalGST += gst;
    if ((inv.taxType || 'intra') === 'inter') {
      totalIGST += gst;
    } else {
      totalCGST += gst / 2;
      totalSGST += gst / 2;
    }

    if (inv.paymentStatus === 'paid')      { paidAmount += amt; paidCount++; }
    if (inv.paymentStatus === 'pending')   { pendingAmount += amt; pendingCount++; }
    if (inv.paymentStatus === 'overdue')   { pendingAmount += amt; overdueCount++; }
    if (inv.paymentStatus === 'cancelled') cancelledCount++;

    if ((inv.paymentStatus === 'pending' || inv.paymentStatus === 'overdue') && daysBetween(todayStr, inv.dueDate) <= 7) {
      pendingInvoices.push(inv);
    }
  });

  const recentList = [...State.savedInvoices].slice(0, 5);
  const growthPercent = yesterdaySales > 0 ? ((todaySales - yesterdaySales) / yesterdaySales * 100).toFixed(1) : 0;
  const collectionRate = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;

  // Set dashboard values safely
  function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function setInnerHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

  setEl('dashTodaySales',   formatMoney(todaySales));
  setEl('dashMonthSales',   formatMoney(monthSales));
  setEl('dashPending',      formatMoney(pendingAmount));
  setEl('dashPendingCount', `${pendingCount + overdueCount} invoices`);
  setEl('dashCollectionRate', collectionRate + '%');
  setEl('dashPaidAmount',   formatMoney(paidAmount));
  setEl('dashCGST',         formatMoney(totalCGST));
  setEl('dashSGST',         formatMoney(totalSGST));
  setEl('dashIGST',         formatMoney(totalIGST));
  setEl('growthValue',      formatMoney(todaySales));
  setEl('growthPercent',    growthPercent + '%');
  setEl('growthSub',        growthPercent >= 0 ? '▲ vs yesterday' : '▼ vs yesterday');

  // Sales change badge
  const scEl = document.getElementById('dashSalesChange');
  if (scEl) {
    scEl.textContent  = growthPercent + '%';
    scEl.className    = 'badge ' + (growthPercent >= 0 ? 'badge-paid' : 'badge-overdue');
  }
  const mcEl = document.getElementById('dashMonthChange');
  if (mcEl) {
    const mg = lastMonthSales > 0 ? ((monthSales - lastMonthSales) / lastMonthSales * 100).toFixed(1) : 0;
    mcEl.textContent = mg + '%';
    mcEl.className   = 'badge ' + (mg >= 0 ? 'badge-paid' : 'badge-overdue');
  }



  // SVG growth circle
  const circleEl = document.getElementById('growthCircle');
  if (circleEl) {
    const offset = AppConfig.SVG_CIRCLE_CIRC - (AppConfig.SVG_CIRCLE_CIRC * Math.min(Math.abs(growthPercent), 100) / 100);
    circleEl.style.strokeDashoffset = offset;
    circleEl.style.stroke = growthPercent >= 0 ? 'var(--success)' : 'var(--danger)';
  }



  // Recent invoices
  const recentDiv = document.getElementById('recentInvoicesList');
  if (recentDiv) {
    recentDiv.innerHTML = recentList.length === 0
      ? '<p style="color:var(--gray);text-align:center;padding:1rem">No invoices yet</p>'
      : recentList.map(inv => `
        <div class="invoice-list-item" onclick="window._ledgerix.invoice.loadSavedInvoice(${inv.id})">
          <div class="inv-info">
            <strong>${esc(inv.invNum)}</strong>
            <small>${esc(inv.clientName)} &bull; ${inv.itemRows.length} items</small>
          </div>
          <div class="inv-amount">
            <div class="amount">${formatMoney(inv.grandTotal)}</div>
            <div class="date">${esc(inv.invDate)}</div>
          </div>
          <span class="badge badge-${esc(inv.paymentStatus)}">${esc(inv.paymentStatus)}</span>
        </div>`).join('');
  }

  // Pending payments
  const pendingDiv = document.getElementById('pendingPaymentsList');
  if (pendingDiv) {
    pendingDiv.innerHTML = pendingInvoices.length === 0
      ? '<p style="color:var(--gray);text-align:center;padding:1rem">No pending payments</p>'
      : pendingInvoices.slice(0, 5).map(inv => `
        <div class="invoice-list-item">
          <div class="pending-info">
            <strong>${esc(inv.clientName)}</strong>
            <small>${esc(inv.invNum)} &bull; Due: ${esc(inv.dueDate)}</small>
          </div>
          <div class="inv-amount">
            <div class="amount" style="color:var(--warning)">${formatMoney(inv.grandTotal)}</div>
            <span class="badge badge-${esc(inv.paymentStatus)}">${esc(inv.paymentStatus)}</span>
          </div>
        </div>`).join('');
  }

  // Top clients
  const clientMap = {};
  State.savedInvoices.forEach(inv => {
    clientMap[inv.clientName] = (clientMap[inv.clientName] || 0) + (parseFloat(inv.grandTotal) || 0);
  });
  const topClients = Object.entries(clientMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topClientsDiv = document.getElementById('topClientsList');
  if (topClientsDiv) {
    topClientsDiv.innerHTML = topClients.length === 0
      ? '<p style="color:var(--gray);text-align:center;padding:1rem">No data yet</p>'
      : topClients.map(c => `
        <div class="top-item">
          <div class="top-info"><strong>${esc(c[0])}</strong>
            <small>${State.savedInvoices.filter(inv => inv.clientName === c[0]).length} invoices</small>
          </div>
          <div class="top-amount">${formatMoney(c[1])}</div>
        </div>`).join('');
  }

  // Top products
  const productMap = {};
  State.savedInvoices.forEach(inv => {
    (inv.itemRows || []).forEach(item => {
      if (!productMap[item.desc]) productMap[item.desc] = { qty: 0, sales: 0 };
      productMap[item.desc].qty   += parseFloat(item.qty) || 0;
      productMap[item.desc].sales += (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
    });
  });
  const topProducts = Object.entries(productMap).sort((a, b) => b[1].sales - a[1].sales).slice(0, 3);
  const topProductsDiv = document.getElementById('topProductsList');
  if (topProductsDiv) {
    topProductsDiv.innerHTML = topProducts.length === 0
      ? '<p style="color:var(--gray);text-align:center;padding:1rem">No data yet</p>'
      : topProducts.map(p => `
        <div class="top-item">
          <div class="top-info">
            <strong>${esc(p[0].substring(0, 25))}${p[0].length > 25 ? '...' : ''}</strong>
            <small>Qty: ${p[1].qty}</small>
          </div>
          <div class="top-amount">${formatMoney(p[1].sales)}</div>
        </div>`).join('');
  }

  // Recent activity
  const activityDiv = document.getElementById('recentActivity');
  if (activityDiv) {
    activityDiv.innerHTML = recentList.slice(0, 3).map(inv => `
      <div class="activity-item">
        <i class="fas fa-file-invoice" style="color:var(--gold)"></i>
        <div><strong style="color:var(--gold)">${esc(inv.invNum)}</strong> - ${esc(inv.clientName)}
          <br><small style="color:var(--gray)">${esc(inv.invDate)} | ${inv.itemRows.length} items</small>
        </div>
      </div>`).join('');
  }

  // Invoice Overview: center count + legend
  const totalInvoiceCount = State.savedInvoices.length;
  const unpaidCount = pendingCount + overdueCount;
  const unpaidAmount = pendingAmount;

  const puTotal = document.getElementById('paidUnpaidTotal');
  if (puTotal) puTotal.textContent = totalInvoiceCount;

  const puLegend = document.getElementById('paidUnpaidLegend');
  if (puLegend) {
    puLegend.innerHTML =
      `<div class="legend-item">` +
        `<span class="legend-dot" style="background:#4CAF50"></span>` +
        `<span class="legend-label">Paid</span>` +
        `<strong style="font-size:var(--f-xs);color:var(--c-text)">${formatMoney(paidAmount)} (${paidCount})</strong>` +
      `</div>` +
      `<div class="legend-item">` +
        `<span class="legend-dot" style="background:#FF6B6B"></span>` +
        `<span class="legend-label">Pending</span>` +
        `<strong style="font-size:var(--f-xs);color:var(--c-text)">${formatMoney(unpaidAmount)} (${unpaidCount})</strong>` +
      `</div>`;
  }

  renderDashboardCharts(paidAmount, pendingAmount, monthSales, lastMonthSales, totalCGST, totalSGST, totalIGST);
}

function renderDashboardCharts(paidAmount, pendingAmount, monthSales, lastMonthSales, totalCGST, totalSGST, totalIGST) {
  if (typeof Chart === 'undefined') return;

  // Paid/Unpaid doughnut
  const ctx1 = document.getElementById('paidUnpaidChart');
  if (ctx1) {
    if (State.charts.paidUnpaid) State.charts.paidUnpaid.destroy();
    State.charts.paidUnpaid = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: ['Paid', 'Pending/Overdue'],
        datasets: [{ data: [paidAmount, pendingAmount],
          backgroundColor: ['#4CAF50', '#FF6B6B'], borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c9c9c9', font: { size: 11 } } } } },
    });
  }

  // Revenue comparison bar
  const ctx2 = document.getElementById('revenueChart');
  if (ctx2) {
    if (State.charts.revenue) State.charts.revenue.destroy();
    State.charts.revenue = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: ['Last Month', 'This Month'],
        datasets: [{ label: 'Revenue',
          data: [lastMonthSales, monthSales],
          backgroundColor: ['rgba(201,168,76,0.5)', 'rgba(201,168,76,0.9)'],
          borderColor: ['#c9a84c', '#c9a84c'], borderWidth: 1 }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#c9c9c9' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#c9c9c9' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  }

  // GST Breakdown doughnut
  const ctx3 = document.getElementById('gstChart');
  if (ctx3) {
    if (State.charts.gst) State.charts.gst.destroy();
    State.charts.gst = new Chart(ctx3, {
      type: 'doughnut',
      data: {
        labels: ['CGST', 'SGST', 'IGST'],
        datasets: [{ data: [totalCGST, totalSGST, totalIGST],
          backgroundColor: ['#4CAF50', '#2196F3', '#c9a84c'], borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c9c9c9', font: { size: 11 } } } } },
    });
  }
}
