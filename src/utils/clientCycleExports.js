import { formatTime, getTaskDuration } from './billingEngine.js';

/**
 * Per-client billing-cycle exports (print-window PDFs + CSV pack).
 * Extracted from AdminDashboard.jsx; pure DOM/window helpers, no React state.
 */

  export const exportClientCyclePDF = ({
    client,
    mStart,
    mEnd,
    stats,
    periodTasks,
    periodExps,
    periodProjectTasks,
    periodProjectExps,
    clientProjects,
    taskLogs,
    expenses,
  }) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const fmtDate = (ms) => new Date(ms).toLocaleDateString();
    const fmtMoney = (n) =>
      Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const projectTitle = (pid) =>
      (clientProjects || []).find((p) => p.id === pid)?.title || 'Project';

    const projectRows = (clientProjects || []).map((p) => {
      const pTasks = (taskLogs || []).filter(
        (t) =>
          t.projectId === p.id && t.clockInTime >= mStart && t.clockInTime <= mEnd,
      );
      const pExps = (expenses || []).filter(
        (e) => e.projectId === p.id && e.date >= mStart && e.date <= mEnd,
      );
      const hours =
        pTasks.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000;
      const cost = pExps.reduce((acc, e) => acc + (e.finalCost || 0), 0);
      return {
        title: p.title,
        status: p.status,
        hours,
        cost,
      };
    });

    const html = `
      <html>
        <head>
          <title>Ignite PM - ${client?.name || 'Client'} Cycle Report</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 32px; color: #111827; }
            h1 { color: #fd7414; margin: 0 0 6px 0; }
            .meta { color: #475569; margin-bottom: 22px; font-size: 13px; }
            h2 { margin: 22px 0 10px 0; font-size: 16px; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
            th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; vertical-align: top; }
            th { background-color: #f8fafc; color: #334155; }
            .muted { color: #64748b; }
            .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; font-size: 11px; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>${client?.name || 'Client'} - Billing Cycle Report</h1>
          <div class="meta">
            Cycle: ${fmtDate(mStart)} - ${fmtDate(mEnd)}<br/>
            Generated on: ${new Date().toLocaleString()}<br/>
            Billing day: ${(client?.billingDay || 1)}
          </div>

          <h2>Retainer Summary</h2>
          <table>
            <thead>
              <tr>
                <th>Base</th>
                <th>Carryover</th>
                <th>Add-ons</th>
                <th>Allotted</th>
                <th>Used</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${stats ? stats.base?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.carryover?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.currentAddons?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.adjustedAllotted?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.currentUsed?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? (stats.adjustedAllotted - stats.currentUsed).toFixed?.(2) ?? '' : ''}</td>
              </tr>
            </tbody>
          </table>

          <h2>Retainer Tasks (this cycle)</h2>
          ${
            (periodTasks || []).length === 0
              ? `<div class="muted">No retainer tasks logged.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Task</th>
                      <th>Duration</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(periodTasks || [])
                      .map(
                        (t) => `
                          <tr>
                            <td>${fmtDate(t.clockInTime)}</td>
                            <td>${t.projectName || ''}</td>
                            <td>${formatTime(getTaskDuration(t))}</td>
                            <td>${t.notes ? t.notes : ''}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Expenses (this cycle)</h2>
          ${
            (periodExps || []).length === 0
              ? `<div class="muted">No expenses logged.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(periodExps || [])
                      .map(
                        (e) => `
                          <tr>
                            <td>${fmtDate(e.date)}</td>
                            <td>${e.description || ''}</td>
                            <td>$${fmtMoney(e.finalCost || e.amount || 0)}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Custom Project Tasks (line items, this cycle)</h2>
          ${
            (periodProjectTasks || []).length === 0
              ? `<div class="muted">No custom project time logged.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Project</th>
                      <th>Duration</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(periodProjectTasks || [])
                      .slice()
                      .sort((a, b) => a.clockInTime - b.clockInTime)
                      .map(
                        (t) => `
                          <tr>
                            <td>${fmtDate(t.clockInTime)}</td>
                            <td>${projectTitle(t.projectId)}</td>
                            <td>${formatTime(getTaskDuration(t))}</td>
                            <td>${t.notes ? t.notes : ''}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Custom Project Expenses (line items, this cycle)</h2>
          ${
            (periodProjectExps || []).length === 0
              ? `<div class="muted">No custom project expenses.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Project</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(periodProjectExps || [])
                      .slice()
                      .sort((a, b) => a.date - b.date)
                      .map(
                        (e) => `
                          <tr>
                            <td>${fmtDate(e.date)}</td>
                            <td>${projectTitle(e.projectId)}</td>
                            <td>${e.description || ''}</td>
                            <td>$${fmtMoney(e.finalCost || e.amount || 0)}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Custom Projects (this cycle)</h2>
          ${
            projectRows.length === 0
              ? `<div class="muted">No custom projects.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Hours</th>
                      <th>Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${projectRows
                      .map(
                        (p) => `
                          <tr>
                            <td>${p.title}</td>
                            <td><span class="pill">${p.status || ''}</span></td>
                            <td>${p.hours.toFixed(2)}h</td>
                            <td>$${fmtMoney(p.cost)}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  // Invoice-style summary of billable items for a cycle. Reference only —
  // the official invoice is generated and sent through QuickBooks.
  export const exportClientInvoicePDF = ({
    client,
    mStart,
    mEnd,
    stats,
    periodExps,
    periodProjectTasks,
    periodProjectExps,
    clientProjects,
    addons,
  }) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('Pop-up blocked. Allow pop-ups for this site to export the invoice PDF.');
      return;
    }

    const esc = (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const fmtDate = (ms) => new Date(ms).toLocaleDateString();
    const fmtMoney = (n) =>
      Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const HST_RATE = 0.13;
    const hourlyRate = Number(client?.hourlyRate || 0);
    const projectTitle = (pid) =>
      (clientProjects || []).find((p) => p.id === pid)?.title || 'Project';

    // 1. Add-on hour blocks billed into this cycle (already priced w/ HST).
    const cycleAddons = (addons || []).filter(
      (a) => a.clientId === client?.id && a.billingCycleStart === mStart,
    );

    // 2. Custom project time this cycle, priced at the client's hourly rate.
    const projectHoursById = {};
    (periodProjectTasks || []).forEach((t) => {
      if (!t.projectId) return;
      projectHoursById[t.projectId] =
        (projectHoursById[t.projectId] || 0) + getTaskDuration(t) / 3600000;
    });
    const projectTimeLines = Object.entries(projectHoursById).map(([pid, hours]) => ({
      label: `${projectTitle(pid)} — project time`,
      detail: `${hours.toFixed(2)}h × $${fmtMoney(hourlyRate)}/h`,
      amount: hours * hourlyRate,
    }));

    // 3. Pass-through expenses (project + retainer dollar expenses).
    const expenseLines = [
      ...(periodProjectExps || []).map((e) => ({
        label: `${projectTitle(e.projectId)} — ${e.description || 'expense'}`,
        detail: fmtDate(e.date),
        amount: Number(e.finalCost || e.amount || 0),
      })),
      ...(periodExps || [])
        .filter((e) => !e.projectId && !(Number(e.equivalentHours || 0) > 0))
        .map((e) => ({
          label: e.description || 'Expense',
          detail: fmtDate(e.date),
          amount: Number(e.finalCost || e.amount || 0),
        })),
    ];

    const addonsTotal = cycleAddons.reduce(
      (acc, a) => acc + Number(a.priceBreakdown?.total || 0),
      0,
    );
    const projectSubtotal = projectTimeLines.reduce((acc, l) => acc + l.amount, 0);
    const projectHst = projectSubtotal * HST_RATE;
    const expensesTotal = expenseLines.reduce((acc, l) => acc + l.amount, 0);
    const grandTotal = addonsTotal + projectSubtotal + projectHst + expensesTotal;

    const lineRows = (lines) =>
      lines
        .map(
          (l) => `
            <tr>
              <td>${esc(l.label)}</td>
              <td class="muted">${esc(l.detail)}</td>
              <td class="num">$${fmtMoney(l.amount)}</td>
            </tr>`,
        )
        .join('');

    const html = `
      <html>
        <head>
          <title>Ignite PM — ${esc(client?.name || 'Client')} Invoice Reference</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 32px; color: #111827; }
            h1 { color: #fd7414; margin: 0 0 4px 0; }
            .ref-banner { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 10px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; margin: 14px 0 20px 0; }
            .meta { color: #475569; margin-bottom: 22px; font-size: 13px; }
            h2 { margin: 22px 0 8px 0; font-size: 15px; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
            th, td { border: 1px solid #e2e8f0; padding: 9px 10px; text-align: left; vertical-align: top; }
            th { background-color: #f8fafc; color: #334155; }
            td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
            .muted { color: #64748b; }
            .totals { margin-top: 26px; width: 320px; margin-left: auto; }
            .totals td { border: none; padding: 5px 10px; font-size: 13px; }
            .totals .grand td { border-top: 2px solid #0f172a; font-weight: 800; font-size: 15px; }
          </style>
        </head>
        <body>
          <h1>${esc(client?.name || 'Client')} — Invoice Summary</h1>
          <div class="ref-banner">
            Reference only — the official invoice is generated and sent through QuickBooks.
          </div>
          <div class="meta">
            Billing period: ${fmtDate(mStart)} – ${fmtDate(mEnd)}<br/>
            Generated: ${new Date().toLocaleString()}<br/>
            Hourly rate on file: $${fmtMoney(hourlyRate)}/h
          </div>

          <h2>Retainer (covered by monthly agreement)</h2>
          <table>
            <thead>
              <tr><th>Allotted</th><th>Used</th><th>Remaining / Carryover</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>${stats ? `${(stats.adjustedAllotted ?? 0).toFixed(2)}h` : '—'}</td>
                <td>${stats ? `${(stats.currentUsed ?? 0).toFixed(2)}h` : '—'}</td>
                <td>${stats ? `${((stats.adjustedAllotted ?? 0) - (stats.currentUsed ?? 0)).toFixed(2)}h` : '—'}</td>
              </tr>
            </tbody>
          </table>

          <h2>Add-on hour blocks (this cycle)</h2>
          ${
            cycleAddons.length === 0
              ? `<div class="muted">None.</div>`
              : `<table>
                  <thead>
                    <tr><th>Date</th><th>Category</th><th class="num">Hours</th><th class="num">Subtotal</th><th class="num">HST</th><th class="num">Total</th></tr>
                  </thead>
                  <tbody>
                    ${cycleAddons
                      .map(
                        (a) => `
                          <tr>
                            <td>${fmtDate(a.date)}</td>
                            <td>${esc(a.category || 'Additional Hours')}</td>
                            <td class="num">${Number(a.hours || 0).toFixed(2)}</td>
                            <td class="num">$${fmtMoney(a.priceBreakdown?.subtotal)}</td>
                            <td class="num">$${fmtMoney(a.priceBreakdown?.hst)}</td>
                            <td class="num">$${fmtMoney(a.priceBreakdown?.total)}</td>
                          </tr>`,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Custom project time (this cycle)</h2>
          ${
            projectTimeLines.length === 0
              ? `<div class="muted">None.</div>`
              : `<table>
                  <thead><tr><th>Item</th><th>Detail</th><th class="num">Amount</th></tr></thead>
                  <tbody>${lineRows(projectTimeLines)}</tbody>
                </table>`
          }

          <h2>Billable expenses (this cycle)</h2>
          ${
            expenseLines.length === 0
              ? `<div class="muted">None.</div>`
              : `<table>
                  <thead><tr><th>Item</th><th>Date</th><th class="num">Amount</th></tr></thead>
                  <tbody>${lineRows(expenseLines)}</tbody>
                </table>`
          }

          <table class="totals">
            <tbody>
              <tr><td>Add-on blocks (incl. HST)</td><td class="num">$${fmtMoney(addonsTotal)}</td></tr>
              <tr><td>Project time subtotal</td><td class="num">$${fmtMoney(projectSubtotal)}</td></tr>
              <tr><td>HST (13%) on project time</td><td class="num">$${fmtMoney(projectHst)}</td></tr>
              <tr><td>Billable expenses</td><td class="num">$${fmtMoney(expensesTotal)}</td></tr>
              <tr class="grand"><td>Total</td><td class="num">$${fmtMoney(grandTotal)}</td></tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  export const exportClientCycleCSV = ({
    client,
    mStart,
    mEnd,
    stats,
    periodTasks,
    periodExps,
    periodProjectTasks,
    periodProjectExps,
    clientProjects,
    taskLogs,
    expenses,
    addons,
  }) => {
    const rows = [];
    rows.push([
      'Type',
      'Client',
      'CycleStart',
      'CycleEnd',
      'Item',
      'Hours',
      'Cost',
      'Notes',
      'Date',
    ]);

    const cycleStartStr = new Date(mStart).toLocaleDateString();
    const cycleEndStr = new Date(mEnd).toLocaleDateString();

    // Summary row
    if (stats) {
      rows.push([
        'RetainerSummary',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        'Total Pool',
        (stats.adjustedAllotted ?? 0).toFixed?.(2) ?? '',
        '',
        `Used ${stats.currentUsed?.toFixed?.(2) ?? ''}h`,
        '',
      ]);
    }

    (periodTasks || []).forEach((t) => {
      rows.push([
        'RetainerTask',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        t.projectName || '',
        (getTaskDuration(t) / 3600000).toFixed(2),
        '',
        t.notes ? t.notes.replace(/\\n/g, ' ') : '',
        new Date(t.clockInTime).toLocaleDateString(),
      ]);
    });

    (periodExps || []).forEach((e) => {
      rows.push([
        'Expense',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        e.description || '',
        (e.equivalentHours || 0).toFixed(2),
        (e.finalCost || e.amount || 0).toFixed(2),
        '',
        new Date(e.date).toLocaleDateString(),
      ]);
    });

    const projTitle = (pid) =>
      (clientProjects || []).find((p) => p.id === pid)?.title || 'Project';

    (periodProjectTasks || []).forEach((t) => {
      rows.push([
        'ProjectTask',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        projTitle(t.projectId),
        (getTaskDuration(t) / 3600000).toFixed(2),
        '',
        t.notes ? String(t.notes).replace(/\n/g, ' ') : '',
        new Date(t.clockInTime).toLocaleDateString(),
      ]);
    });

    (periodProjectExps || []).forEach((e) => {
      rows.push([
        'ProjectExpense',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        `${projTitle(e.projectId)} — ${e.description || ''}`,
        (e.equivalentHours || 0).toFixed(2),
        (e.finalCost || e.amount || 0).toFixed(2),
        '',
        new Date(e.date).toLocaleDateString(),
      ]);
    });

    // Add-ons that bill into this cycle
    (addons || [])
      .filter((a) => a.clientId === client?.id && a.billingCycleStart === mStart)
      .forEach((a) => {
        rows.push([
          'AddOn',
          client?.name || '',
          cycleStartStr,
          cycleEndStr,
          a.category || 'Additional Hours',
          Number(a.hours || 0).toFixed(2),
          (a.priceBreakdown?.total || 0).toFixed(2),
          a.notes || '',
          new Date(a.date).toLocaleDateString(),
        ]);
      });

    // Projects (rollup within cycle)
    (clientProjects || []).forEach((p) => {
      const pTasks = (taskLogs || []).filter(
        (t) =>
          t.projectId === p.id && t.clockInTime >= mStart && t.clockInTime <= mEnd,
      );
      const pExps = (expenses || []).filter(
        (e) => e.projectId === p.id && e.date >= mStart && e.date <= mEnd,
      );
      const hours = pTasks.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000;
      const cost = pExps.reduce((acc, e) => acc + (e.finalCost || 0), 0);
      rows.push([
        'Project',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        p.title || '',
        hours.toFixed(2),
        cost.toFixed(2),
        p.description || p.requestDescription || '',
        p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '',
      ]);
    });

    const csvContent = rows
      .map((r) =>
        r
          .map((cell) =>
            `"${String(cell ?? '')
              .replace(/"/g, '""')
              .trim()}"`,
          )
          .join(','),
      )
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `Ignite_InvoicePack_${client?.name || 'Client'}_${cycleStartStr}_${cycleEndStr}.csv`.replace(
        /\s+/g,
        '_',
      ),
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
