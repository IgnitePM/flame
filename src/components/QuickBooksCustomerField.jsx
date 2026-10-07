import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

function money(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CAD' }).format(n);
}

/**
 * CRM client field: link this client to a QuickBooks Online customer.
 */
export default function QuickBooksCustomerField({
  customerId = '',
  customerName = '',
  suggestedQuery = '',
  onChange,
}) {
  const [query, setQuery] = useState(suggestedQuery || '');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickedName, setPickedName] = useState(customerName || '');

  const search = async () => {
    setBusy(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/quickbooks-list-customers', {
        q: query,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Search failed');
      setResults(Array.isArray(data.customers) ? data.customers : []);
      if (!data.customers?.length) setError('No QuickBooks customers matched that search.');
    } catch (err) {
      setResults([]);
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const setId = (nextId, nextName) => {
    const id = String(nextId || '').replace(/[^\d]/g, '');
    const name = id && nextName ? String(nextName) : id === String(customerId || '') ? pickedName : '';
    setPickedName(name);
    onChange?.({
      quickbooksCustomerId: id,
      quickbooksCustomerName: name,
    });
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
        QuickBooks customer
      </label>
      <input
        type="text"
        inputMode="numeric"
        value={customerId || ''}
        onChange={(e) => setId(e.target.value, '')}
        className="w-full bg-white border border-slate-200 p-4 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
        placeholder="Customer ID, or search below"
      />
      {(customerName || pickedName) && customerId ? (
        <p className="text-[10px] font-bold text-emerald-700 ml-1">
          Linked to {customerName || pickedName}
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
          className="flex-1 bg-white border border-slate-200 p-3 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
          placeholder="Search QuickBooks by customer name"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
        >
          <Search className="w-3.5 h-3.5" />
          {busy ? '…' : 'Search'}
        </button>
      </div>
      <p className="text-[10px] font-bold text-slate-400">
        Used for the portal Billing tab after QuickBooks is connected in Admin → Config. Save the
        client after you pick a customer.
      </p>
      {error ? <p className="text-[10px] font-bold text-amber-700">{error}</p> : null}
      {results.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50 text-sm">
          {results.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  setId(row.id, row.name || row.company || '');
                  setResults([]);
                  setError('');
                }}
                className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="font-bold text-slate-800 block truncate">
                    {row.name || row.company || 'Customer'}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    ID {row.id}
                    {row.email ? ` · ${row.email}` : ''}
                  </span>
                </span>
                <span className="text-[10px] font-black text-slate-500 shrink-0">
                  {money(row.balance)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
