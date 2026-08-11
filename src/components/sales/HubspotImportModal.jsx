import React, { useMemo, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { parseHubspotDealsCsv } from '../../utils/hubspotDealsImport.js';
import {
  formatDealAmount,
  staffDisplayFromEmail,
  todayYmd,
} from '../../utils/salesPipeline.js';

export default function HubspotImportModal({
  open,
  onClose,
  stages = [],
  deals = [],
  clients = [],
  adminUsers = [],
  user,
  setDoc,
  doc,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const existingIds = useMemo(() => {
    const ids = new Set();
    for (const deal of deals || []) {
      if (deal?.hubspotRecordId) ids.add(String(deal.hubspotRecordId));
      if (deal?.id) ids.add(String(deal.id));
    }
    return ids;
  }, [deals]);

  const preview = useMemo(() => {
    return (rows || []).map((row) => ({
      ...row,
      skipped:
        existingIds.has(String(row.recordId)) ||
        existingIds.has(String(row.dealDocId)),
    }));
  }, [rows, existingIds]);

  const newCount = preview.filter((r) => !r.skipped).length;
  const skipCount = preview.filter((r) => r.skipped).length;

  const reset = () => {
    setRows([]);
    setFileName('');
    setError('');
    setResult(null);
  };

  const onFile = async (file) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseHubspotDealsCsv(text, {
        stages,
        adminUsers,
        clients,
        fallbackOwnerEmail: me,
      });
      if (!parsed.length) {
        setError('No deals found in that CSV.');
        return;
      }
      setRows(parsed);
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const runImport = async () => {
    const toImport = preview.filter((r) => !r.skipped);
    if (!toImport.length) {
      setError('Nothing new to import — those HubSpot record IDs are already in Sales.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const now = Date.now();
      let created = 0;
      for (const row of toImport) {
        const assoc = row.clientId
          ? { leadId: null, clientId: row.clientId }
          : { leadId: row.leadDocId, clientId: null };
        if (!row.clientId) {
          await setDoc(doc('leads', row.leadDocId), {
            name: row.name,
            companyName: row.name,
            website: '',
            phone: '',
            notes: `Imported from HubSpot (Record ID ${row.recordId}).`,
            ownerEmail: row.ownerEmail || me,
            primaryContact: { name: '', email: '', phone: '', title: '' },
            contacts: [],
            status: 'open',
            convertedClientId: null,
            hubspotRecordId: row.recordId,
            createdAt: now,
            updatedAt: now,
            lastActivityAt: now,
          });
        }
        await setDoc(doc('deals', row.dealDocId), {
          name: row.name,
          amount: row.amount || 0,
          stageId: row.stageId,
          ownerEmail: row.ownerEmail || me,
          closeDate: row.closeDate,
          createDate: todayYmd(),
          leadId: assoc.leadId,
          clientId: assoc.clientId,
          lostReason: '',
          notes: [],
          hubspotRecordId: row.recordId,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
          stageChangedAt: now,
        });
        created += 1;
      }
      setResult({ created, skipped: skipCount });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[28px] w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-6 pb-3">
          <div>
            <h3 className="font-black text-lg text-slate-800">Import HubSpot deals</h3>
            <p className="text-sm text-slate-400 font-medium">
              Upload a HubSpot deals CSV (Deal Name, Stage, Amount, Close Date, Owner).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose?.();
            }}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4 overflow-y-auto">
          <label className="flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-2xl px-4 py-6 text-xs font-black uppercase tracking-wider text-slate-500 cursor-pointer hover:border-[#fd7414] hover:text-[#fd7414]">
            <Upload className="w-4 h-4" />
            {fileName || 'Choose CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>

          {error ? (
            <p className="text-sm font-bold text-red-600">{error}</p>
          ) : null}

          {result ? (
            <p className="text-sm font-bold text-emerald-700">
              Imported {result.created} deal{result.created === 1 ? '' : 's'}
              {result.skipped
                ? ` · skipped ${result.skipped} already in Sales`
                : ''}
              .
            </p>
          ) : null}

          {preview.length > 0 && (
            <>
              <p className="text-xs font-bold text-slate-500">
                {newCount} new · {skipCount} already imported
                {preview.some((r) => r.clientId)
                  ? ' · matching existing clients when the deal name includes the client name'
                  : ''}
              </p>
              <div className="overflow-x-auto border border-slate-100 rounded-2xl max-h-72">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Deal</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Owner</th>
                      <th className="px-3 py-2">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr
                        key={row.dealDocId}
                        className={`border-t border-slate-100 ${
                          row.skipped ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2 font-bold text-slate-800">
                          {row.name}
                          {row.skipped ? (
                            <span className="ml-2 text-[9px] uppercase tracking-wider text-slate-400">
                              skip
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {stages.find((s) => s.id === row.stageId)?.label ||
                            row.stageLabel}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {formatDealAmount(row.amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {staffDisplayFromEmail(row.ownerEmail, adminUsers)}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {row.clientId ? 'Existing client' : 'New lead'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose?.();
            }}
            className="px-4 py-2.5 text-xs font-black uppercase text-slate-500"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              disabled={importing || newCount === 0}
              onClick={runImport}
              className="bg-[#fd7414] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase disabled:opacity-40 hover:brightness-95"
            >
              {importing ? 'Importing…' : `Import ${newCount || ''}`.trim()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
