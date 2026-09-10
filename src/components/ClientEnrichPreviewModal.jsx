import React, { useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import {
  COMPANY_ENRICH_FIELD_LABELS,
  applyCompanyEnrichment,
} from '../utils/clientCompanyProfile.js';

function flattenSuggestion(suggestion) {
  const rows = [];
  const s = suggestion || {};
  for (const key of Object.keys(COMPANY_ENRICH_FIELD_LABELS)) {
    if (key.startsWith('primaryContact.')) continue;
    const val = String(s[key] ?? '').trim();
    if (val) rows.push({ key, label: COMPANY_ENRICH_FIELD_LABELS[key], value: val });
  }
  const pc = s.primaryContact || {};
  for (const sub of ['name', 'email', 'phone', 'title']) {
    const val = String(pc[sub] ?? '').trim();
    if (!val) continue;
    const key = `primaryContact.${sub}`;
    rows.push({ key, label: COMPANY_ENRICH_FIELD_LABELS[key], value: val });
  }
  return rows;
}

function currentValue(client, key) {
  if (key.startsWith('primaryContact.')) {
    const sub = key.split('.')[1];
    return String(client?.primaryContact?.[sub] ?? '').trim();
  }
  return String(client?.[key] ?? '').trim();
}

/**
 * Preview AI company enrichment before applying to the client editor draft.
 */
export default function ClientEnrichPreviewModal({
  client,
  suggestion,
  meta = null,
  onClose,
  onApply,
}) {
  const [overwrite, setOverwrite] = useState(false);
  const rows = useMemo(() => flattenSuggestion(suggestion), [suggestion]);

  const preview = useMemo(() => {
    return rows.map((row) => {
      const prev = currentValue(client, row.key);
      const willFill = overwrite || !prev;
      const changing = willFill && prev !== row.value;
      return { ...row, prev, willFill, changing };
    });
  }, [rows, client, overwrite]);

  const changeCount = preview.filter((r) => r.changing).length;

  const apply = () => {
    const next = applyCompanyEnrichment(client, suggestion, { overwrite });
    onApply?.(next);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[140] animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
          <div>
            <h3 className="font-black text-xl text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#fd7414]" />
              Enrich from website
            </h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Review AI suggestions · empty fields only by default
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {meta?.confidenceNotes ? (
            <p className="text-xs font-medium text-slate-500 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
              {meta.confidenceNotes}
            </p>
          ) : null}

          {preview.length === 0 ? (
            <p className="text-sm font-bold text-slate-500">
              No public company details found for that website.
            </p>
          ) : (
            <ul className="space-y-2">
              {preview.map((row) => (
                <li
                  key={row.key}
                  className={`rounded-xl border px-3 py-2.5 ${
                    row.changing
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-slate-100 bg-slate-50/50 opacity-70'
                  }`}
                >
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    {row.label}
                    {!row.willFill ? ' · keep existing' : row.prev ? ' · replace' : ' · fill'}
                  </div>
                  <div className="text-sm font-bold text-slate-800 break-words mt-0.5">
                    {row.value}
                  </div>
                  {row.prev && row.prev !== row.value ? (
                    <div className="text-[11px] font-medium text-slate-400 mt-1 line-through break-words">
                      {row.prev}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite fields that already have values
          </label>
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-2xl font-black text-slate-600 bg-white border border-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={changeCount === 0}
            onClick={apply}
            className="px-8 py-3 rounded-2xl font-black bg-black text-white disabled:opacity-40"
          >
            Apply {changeCount || ''} field{changeCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
