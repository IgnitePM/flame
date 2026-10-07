import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Receipt } from 'lucide-react';
import { auth } from '../firebase.js';
import { authedFetch } from '../utils/authedFetch.js';

function formatMoney(amount, currency) {
  const n = Number(amount);
  const code = String(currency || 'CAD').slice(0, 8) || 'CAD';
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
  } catch {
    return `${n.toFixed(2)} ${code}`;
  }
}

function formatDate(ymd) {
  const raw = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '—';
  const [y, m, d] = raw.split('-').map(Number);
  try {
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return raw;
  }
}

const STATUS_LABEL = {
  paid: 'Paid',
  open: 'Open',
  partial: 'Partial',
  overdue: 'Overdue',
};

function statusClass(status) {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700';
  if (status === 'overdue') return 'bg-rose-50 text-rose-700';
  if (status === 'partial') return 'bg-amber-50 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

/**
 * Client portal Billing tab: read-only QuickBooks invoices, balance, and payments.
 */
export default function PortalQuickBooksPanel({ client }) {
  const clientId = String(client?.id || '').trim();
  const [state, setState] = useState({ loading: true });
  const [pdfBusy, setPdfBusy] = useState('');
  const [pdfError, setPdfError] = useState('');

  const load = useCallback(async () => {
    if (!clientId) {
      setState({ loading: false, error: 'Missing client.' });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const resp = await authedFetch('/.netlify/functions/portal-quickbooks', { clientId });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not load billing.');
      setState({ loading: false, ...data });
    } catch (err) {
      setState({ loading: false, error: err?.message || String(err) });
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadPdf = async (invoice) => {
    if (!invoice?.id || pdfBusy) return;
    setPdfBusy(invoice.id);
    setPdfError('');
    try {
      const current = auth.currentUser;
      if (!current) throw new Error('You are signed out — sign in again to continue.');
      const token = await current.getIdToken();
      const resp = await fetch('/.netlify/functions/quickbooks-invoice-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, invoiceId: invoice.id }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Could not download the invoice.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoice.number || invoice.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err?.message || String(err));
    } finally {
      setPdfBusy('');
    }
  };

  const currency = state.currency || 'CAD';
  const invoices = Array.isArray(state.invoices) ? state.invoices : [];
  const payments = Array.isArray(state.payments) ? state.payments : [];

  return (
    <section className="space-y-6">
      <div className="bg-white border border-slate-100 rounded-[28px] p-6 sm:p-8 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5 text-[#fd7414]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-black text-xl text-slate-900">Billing</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Invoices and payments from QuickBooks. This view is read-only.
            </p>
          </div>
        </div>
      </div>

      {state.loading ? (
        <p className="text-sm font-bold text-slate-400 px-2">Loading billing…</p>
      ) : null}

      {state.error ? (
        <p className="text-sm font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {state.error}
        </p>
      ) : null}

      {!state.loading && !state.error && state.available === false ? (
        <p className="text-sm font-bold text-slate-600 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
          {state.warning || 'Billing is not available for this account yet.'}
        </p>
      ) : null}

      {state.available ? (
        <>
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 sm:p-8 rounded-[28px] shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#fd7414]">
              Balance due
            </p>
            <p className="text-3xl sm:text-4xl font-black mt-2">
              {formatMoney(state.customer?.balance, currency)}
            </p>
            {state.customer?.name ? (
              <p className="text-sm font-medium text-slate-300 mt-2">{state.customer.name}</p>
            ) : null}
          </div>

          <div className="bg-white border border-slate-100 rounded-[28px] p-6 shadow-sm space-y-4">
            <h3 className="font-black text-slate-900">Invoices</h3>
            {pdfError ? (
              <p className="text-xs font-bold text-amber-800">{pdfError}</p>
            ) : null}
            {invoices.length === 0 ? (
              <p className="text-sm font-medium text-slate-400">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <li key={inv.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-black text-slate-900">#{inv.number}</p>
                        <span
                          className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusClass(inv.status)}`}
                        >
                          {STATUS_LABEL[inv.status] || inv.status}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-500 mt-1">
                        {formatDate(inv.date)}
                        {inv.dueDate ? ` · due ${formatDate(inv.dueDate)}` : ''}
                      </p>
                    </div>
                    <div className="sm:text-right">
                      <p className="font-black text-slate-900">{formatMoney(inv.total, currency)}</p>
                      {inv.balance > 0 ? (
                        <p className="text-xs font-bold text-slate-500">
                          {formatMoney(inv.balance, currency)} due
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => downloadPdf(inv)}
                        disabled={pdfBusy === inv.id}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {pdfBusy === inv.id ? '…' : 'PDF'}
                      </button>
                      {inv.payUrl ? (
                        <a
                          href={inv.payUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#fd7414] text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Pay
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border border-slate-100 rounded-[28px] p-6 shadow-sm space-y-4">
            <h3 className="font-black text-slate-900">Payments</h3>
            {payments.length === 0 ? (
              <p className="text-sm font-medium text-slate-400">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {payments.map((pmt) => (
                  <li key={pmt.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800">{formatDate(pmt.date)}</p>
                      {pmt.ref ? (
                        <p className="text-xs font-medium text-slate-400">Ref {pmt.ref}</p>
                      ) : null}
                    </div>
                    <p className="font-black text-slate-900 shrink-0">
                      {formatMoney(pmt.amount, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
