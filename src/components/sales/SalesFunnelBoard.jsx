import React, { useMemo, useState } from 'react';
import {
  clearActiveDealDragPayload,
  hasDealDragPayload,
  peekDealDragPayload,
  readDealDragPayload,
  writeDealDragPayload,
} from '../../utils/dealDragDrop.js';
import {
  dealAssociationLabel,
  formatDealAmount,
  formatDealDate,
  formatRelativeActivity,
  isClosedStage,
  staffDisplayFromEmail,
} from '../../utils/salesPipeline.js';

function DealCard({
  deal,
  leads,
  clients,
  adminUsers,
  onOpen,
}) {
  const assoc = dealAssociationLabel(deal, leads, clients);
  const activity = formatRelativeActivity(deal.lastActivityAt || deal.updatedAt);
  const lastNote =
    Array.isArray(deal.notes) && deal.notes.length
      ? deal.notes[deal.notes.length - 1]
      : null;

  return (
    <div
      draggable
      onDragStart={(e) => {
        writeDealDragPayload(e.dataTransfer, deal.id);
      }}
      onDragEnd={() => clearActiveDealDragPayload()}
      onClick={() => onOpen?.(deal.id)}
      className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm cursor-grab active:cursor-grabbing hover:border-[#fd7414]/40 transition-colors text-left w-full"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(deal.id);
        }
      }}
    >
      <div className="font-black text-sm text-slate-900 leading-snug mb-2">
        {deal.name || 'Untitled deal'}
      </div>
      <div className="text-[11px] font-bold text-slate-500 space-y-0.5">
        <div>Amount: {formatDealAmount(deal.amount)}</div>
        <div>Close date: {formatDealDate(deal.closeDate)}</div>
        <div>Create date: {formatDealDate(deal.createDate || deal.createdAt)}</div>
        <div>Owner: {staffDisplayFromEmail(deal.ownerEmail, adminUsers)}</div>
        <div className="text-slate-400">{assoc}</div>
      </div>
      {(activity || lastNote) && (
        <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] font-medium text-slate-400">
          {lastNote
            ? `Note ${activity || ''}`.trim()
            : `Updated ${activity}`}
          {lastNote?.body ? (
            <div className="truncate text-slate-500 mt-0.5">
              {lastNote.body}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function SalesFunnelBoard({
  deals = [],
  stages = [],
  leads = [],
  clients = [],
  adminUsers = [],
  user,
  mineOnly,
  showClosed,
  updateDoc,
  doc,
  onOpenDeal,
  onAddDeal,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [dragOverStageId, setDragOverStageId] = useState(null);

  const filteredDeals = useMemo(() => {
    return (deals || []).filter((d) => {
      if (mineOnly && String(d.ownerEmail || '').toLowerCase() !== me) {
        return false;
      }
      const stage = stages.find((s) => s.id === d.stageId);
      if (!showClosed && isClosedStage(stage)) return false;
      return true;
    });
  }, [deals, mineOnly, me, showClosed, stages]);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(stages.map((s) => [s.id, []]));
    for (const d of filteredDeals) {
      const id = d.stageId && map[d.stageId] ? d.stageId : stages[0]?.id;
      if (!id) continue;
      if (!map[id]) map[id] = [];
      map[id].push(d);
    }
    for (const id of Object.keys(map)) {
      map[id].sort(
        (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
      );
    }
    return map;
  }, [filteredDeals, stages]);

  const moveDeal = async (dealId, stageId) => {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === stageId) return;
    const now = Date.now();
    try {
      await updateDoc(doc('deals', dealId), {
        stageId,
        stageChangedAt: now,
        updatedAt: now,
        lastActivityAt: now,
      });
    } catch (err) {
      window.alert(`Could not move deal.\n\n${err?.message || String(err)}`);
    }
  };

  const visibleStages = showClosed
    ? stages
    : stages.filter((s) => !isClosedStage(s));

  return (
    <div className="overflow-x-auto pb-4 -mx-1 px-1">
      <div className="flex gap-3 min-w-max">
        {visibleStages.map((stage) => {
          const columnDeals = byStage[stage.id] || [];
          const total = columnDeals.reduce(
            (sum, d) => sum + (Number(d.amount) || 0),
            0,
          );
          const isOver = dragOverStageId === stage.id;
          return (
            <div
              key={stage.id}
              className={`w-[260px] flex-shrink-0 rounded-[24px] border bg-slate-50/80 flex flex-col max-h-[70vh] ${
                isOver ? 'border-[#fd7414] ring-2 ring-[#fd7414]/20' : 'border-slate-200'
              }`}
              onDragOver={(e) => {
                if (!hasDealDragPayload(e.dataTransfer) && !peekDealDragPayload()) {
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverStageId(stage.id);
              }}
              onDragLeave={() => {
                setDragOverStageId((cur) => (cur === stage.id ? null : cur));
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOverStageId(null);
                const payload = readDealDragPayload(e.dataTransfer);
                clearActiveDealDragPayload();
                if (payload?.dealId) {
                  await moveDeal(payload.dealId, stage.id);
                }
              }}
            >
              <div className="px-3 py-3 border-b border-slate-200/80 sticky top-0 bg-slate-50/95 rounded-t-[24px] z-10">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-xs text-slate-700 uppercase tracking-wide">
                    {stage.label}
                  </div>
                  <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                    {columnDeals.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onAddDeal?.({ stageId: stage.id })}
                  className="mt-2 text-[10px] font-black uppercase tracking-wider text-[#fd7414] hover:underline"
                >
                  + Add deal
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
                {columnDeals.length === 0 ? (
                  <p className="text-[11px] italic text-slate-400 px-1 py-4 text-center">
                    No deals
                  </p>
                ) : (
                  columnDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      leads={leads}
                      clients={clients}
                      adminUsers={adminUsers}
                      onOpen={onOpenDeal}
                    />
                  ))
                )}
              </div>
              <div className="px-3 py-3 border-t border-slate-200 bg-white/80 rounded-b-[24px] text-[11px] font-bold text-slate-600">
                <div>Total: {formatDealAmount(total)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
