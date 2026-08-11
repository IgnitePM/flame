import React, { useEffect, useMemo, useState } from 'react';
import { Kanban, Upload, Users } from 'lucide-react';
import HubspotImportModal from './HubspotImportModal.jsx';
import {
  resolvePipelineStages,
  staffDisplayFromEmail,
} from '../../utils/salesPipeline.js';
import SalesFunnelBoard from './SalesFunnelBoard.jsx';
import LeadsPanel from './LeadsPanel.jsx';
import DealDetailDrawer, { NewDealModal } from './DealDetailDrawer.jsx';

function ConvertLeadModal({
  lead,
  onClose,
  addDoc,
  collection,
  updateDoc,
  doc,
  deals,
}) {
  const [values, setValues] = useState({
    name: lead?.companyName || lead?.name || '',
    hourlyRate: '100',
    billingDay: '1',
    status: 'paused',
    clientEmails: lead?.primaryContact?.email || '',
    reassignDeals: true,
  });
  const [saving, setSaving] = useState(false);

  if (!lead) return null;

  const submit = async () => {
    const name = values.name.trim();
    if (!name) {
      window.alert('Client name is required.');
      return;
    }
    setSaving(true);
    try {
      const clientEmails = String(values.clientEmails || '')
        .split(/[,\n;]/g)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const primaryContact = lead.primaryContact || {
        name: '',
        email: '',
        phone: '',
        title: '',
      };
      const clientRef = await addDoc(collection('clients'), {
        name,
        status: values.status === 'active' ? 'active' : 'paused',
        hourlyRate: Number(values.hourlyRate) || 100,
        billingDay: Math.min(31, Math.max(1, Number(values.billingDay) || 1)),
        retainers: {},
        retainerUnits: {},
        clientEmails,
        clientStartDate: Date.now(),
        primaryContact,
        contacts: Array.isArray(lead.contacts) && lead.contacts.length
          ? lead.contacts
          : primaryContact.name || primaryContact.email
            ? [primaryContact]
            : [],
        website: lead.website || '',
        phone: lead.phone || primaryContact.phone || '',
      });
      const clientId = clientRef.id;
      const now = Date.now();
      await updateDoc(doc('leads', lead.id), {
        status: 'converted',
        convertedClientId: clientId,
        updatedAt: now,
        lastActivityAt: now,
      });
      if (values.reassignDeals) {
        const openDeals = (deals || []).filter(
          (d) => d.leadId === lead.id && !d.clientId,
        );
        await Promise.all(
          openDeals.map((d) =>
            updateDoc(doc('deals', d.id), {
              leadId: null,
              clientId,
              updatedAt: now,
              lastActivityAt: now,
            }),
          ),
        );
      }
      onClose?.({ clientId });
    } catch (err) {
      window.alert(
        `Could not convert lead.\n\n${err?.message || String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[28px] w-full max-w-md p-6 space-y-4 shadow-2xl">
        <h3 className="font-black text-lg">Convert lead to client</h3>
        <p className="text-sm text-slate-500">
          Creates a client record. Default status is paused so they stay out of
          the kiosk until billing is configured and you set them active.
        </p>
        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Client name
          <input
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-bold text-slate-500 space-y-1">
            Hourly rate
            <input
              type="number"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={values.hourlyRate}
              onChange={(e) =>
                setValues((v) => ({ ...v, hourlyRate: e.target.value }))
              }
            />
          </label>
          <label className="text-xs font-bold text-slate-500 space-y-1">
            Billing day
            <input
              type="number"
              min="1"
              max="31"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={values.billingDay}
              onChange={(e) =>
                setValues((v) => ({ ...v, billingDay: e.target.value }))
              }
            />
          </label>
        </div>
        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Status
          <select
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={values.status}
            onChange={(e) =>
              setValues((v) => ({ ...v, status: e.target.value }))
            }
          >
            <option value="paused">Paused (hidden from kiosk)</option>
            <option value="active">Active</option>
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Portal emails (optional)
          <input
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={values.clientEmails}
            onChange={(e) =>
              setValues((v) => ({ ...v, clientEmails: e.target.value }))
            }
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={values.reassignDeals}
            onChange={(e) =>
              setValues((v) => ({ ...v, reassignDeals: e.target.checked }))
            }
          />
          Move open deals from this lead to the new client
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => onClose?.()}
            className="px-4 py-2.5 text-xs font-black uppercase text-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="bg-[#fd7414] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase disabled:opacity-50 hover:brightness-95"
          >
            {saving ? 'Converting…' : 'Convert'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SalesFunnelPanel({
  leads = [],
  deals = [],
  salesPipeline = null,
  clients = [],
  adminUsers = [],
  user,
  addDoc,
  updateDoc,
  collection,
  doc,
  setDoc,
  setDeleteConfirm,
}) {
  const [subTab, setSubTab] = useState('board');
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [newDealDefaults, setNewDealDefaults] = useState({});
  const [convertLead, setConvertLead] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const stages = useMemo(
    () => resolvePipelineStages(salesPipeline),
    [salesPipeline],
  );

  const selectedDeal = useMemo(
    () => (deals || []).find((d) => d.id === selectedDealId) || null,
    [deals, selectedDealId],
  );

  useEffect(() => {
    if (selectedDealId && !selectedDeal) setSelectedDealId(null);
  }, [selectedDealId, selectedDeal]);

  const me = String(user?.email || '').trim().toLowerCase();

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="font-black text-2xl text-slate-800">Sales</h2>
            <p className="text-sm text-slate-400 font-medium">
              Track leads and deals. Leads stay out of the kiosk until converted
              to clients.
            </p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-2xl">
            {[
              { id: 'board', label: 'Board', icon: Kanban },
              { id: 'leads', label: 'Leads', icon: Users },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all ${
                  subTab === tab.id
                    ? 'bg-white shadow-md text-[#fd7414]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
        </div>

        {subTab === 'board' && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setMineOnly(false)}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                  !mineOnly ? 'bg-white shadow text-slate-800' : 'text-slate-400'
                }`}
              >
                All deals
              </button>
              <button
                type="button"
                onClick={() => setMineOnly(true)}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                  mineOnly ? 'bg-white shadow text-slate-800' : 'text-slate-400'
                }`}
              >
                My deals
              </button>
            </div>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              <Upload className="w-3.5 h-3.5" /> Import CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setNewDealDefaults({});
                setNewDealOpen(true);
              }}
              className="bg-[#fd7414] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider hover:brightness-95"
            >
              Add deal
            </button>
          </div>
        )}
      </div>

      {subTab === 'board' ? (
        <SalesFunnelBoard
          deals={deals}
          stages={stages}
          leads={leads}
          clients={clients}
          adminUsers={adminUsers}
          user={user}
          mineOnly={mineOnly}
          updateDoc={updateDoc}
          doc={doc}
          onOpenDeal={setSelectedDealId}
          onAddDeal={({ stageId } = {}) => {
            setNewDealDefaults({ stageId });
            setNewDealOpen(true);
          }}
        />
      ) : (
        <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
          <LeadsPanel
            leads={leads}
            deals={deals}
            adminUsers={adminUsers}
            user={user}
            addDoc={addDoc}
            updateDoc={updateDoc}
            collection={collection}
            doc={doc}
            onConvertLead={setConvertLead}
            onImport={() => setImportOpen(true)}
            onOpenDeal={(id) => {
              setSubTab('board');
              setSelectedDealId(id);
            }}
          />
        </div>
      )}

      {selectedDeal && (
        <DealDetailDrawer
          deal={selectedDeal}
          stages={stages}
          leads={leads}
          clients={clients}
          adminUsers={adminUsers}
          user={user}
          onClose={() => setSelectedDealId(null)}
          updateDoc={updateDoc}
          doc={doc}
          setDeleteConfirm={setDeleteConfirm}
        />
      )}

      <NewDealModal
        open={newDealOpen}
        onClose={() => setNewDealOpen(false)}
        stages={stages}
        leads={leads}
        clients={clients}
        adminUsers={adminUsers}
        user={user}
        defaultStageId={newDealDefaults.stageId || ''}
        defaultLeadId={newDealDefaults.leadId || ''}
        defaultClientId={newDealDefaults.clientId || ''}
        addDoc={addDoc}
        collection={collection}
      />

      <HubspotImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        stages={stages}
        deals={deals}
        clients={clients}
        adminUsers={adminUsers}
        user={user}
        setDoc={setDoc}
        doc={doc}
      />

      {convertLead && (
        <ConvertLeadModal
          lead={convertLead}
          deals={deals}
          onClose={() => setConvertLead(null)}
          addDoc={addDoc}
          collection={collection}
          updateDoc={updateDoc}
          doc={doc}
        />
      )}

      {mineOnly && (
        <p className="text-[10px] text-slate-400 text-center">
          Showing deals owned by {staffDisplayFromEmail(me, adminUsers)}
        </p>
      )}
    </div>
  );
}
