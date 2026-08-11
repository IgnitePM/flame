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
  staffDisplayFromEmail,
} from '../../utils/salesPipeline.js';

function DealCard({
  deal,
  leads,
  clients,
  adminUsers,
  onOpen,
  closedTone = null,
}) {
  const assoc = dealAssociationLabel(deal, leads, clients);
  const activity = formatRelativeActivity(deal.lastActivityAt || deal.updatedAt);
  const lastNote =
    Array.isArray(deal.notes) && deal.notes.length
      ? deal.notes[deal.notes.length - 1]
      : null;

  const toneBorder =
    closedTone === 'won'
      ? 'border-emerald-200 hover:border-emerald-400/60'
      : closedTone === 'lost'
        ? 'border-red-200 hover:border-red-400/60'
        : 'border-slate-200 hover:border-[#fd7414]/40';

  return (
    <div
      draggable
      onDragStart={(e) => {
        writeDealDragPayload(e.dataTransfer, deal.id);
      }}
      onDragEnd={() => clearActiveDealDragPayload()}
      onClick={() => onOpen?.(deal.id)}
      className={`bg-white border rounded-2xl p-3 shadow-sm cursor-grab active:cursor-grabbing transition-colors text-left w-full ${toneBorder}`}
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

function columnShellClass(stage, isOver) {
  if (isOver) return 'border-[#fd7414] ring-2 ring-[#fd7414]/20';
  if (stage.isWon) return 'border-emerald-200';
  if (stage.isLost) return 'border-red-200';
  return 'border-slate-200';
}

function columnHeaderClass(stage) {
  if (stage.isWon) return 'bg-emerald-100/80 border-emerald-200/80';
  if (stage.isLost) return 'bg-red-50 border-red-100';
  return 'bg-slate-50 border-slate-200/80';
}

function columnTitleClass(stage) {
  if (stage.isWon) return 'text-emerald-700';
  if (stage.isLost) return 'text-red-700';
  return 'text-slate-700';
}

export default function SalesFunnelBoard({
  deals = [],
  stages = [],
  leads = [],
  clients = [],
  adminUsers = [],
  user,
  mineOnly,
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
      return true;
    });
  }, [deals, mineOnly, me]);

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

  return (
    <div className="overflow-x-auto pb-4 -mx-1 px-1">
      <div className="flex gap-3 min-w-max">
        {stages.map((stage) => {
          const columnDeals = byStage[stage.id] || [];
          const total = columnDeals.reduce(
            (sum, d) => sum + (Number(d.amount) || 0),
            0,
          );
          const isOver = dragOverStageId === stage.id;
          const closedTone = stage.isWon ? 'won' : stage.isLost ? 'lost' : null;
          return (
            <div
              key={stage.id}
              className={`w-[260px] flex-shrink-0 rounded-[24px] border bg-slate-50/80 flex flex-col max-h-[70vh] ${columnShellClass(stage, isOver)}`}
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
              <div
                className={`px-3 py-3 border-b sticky top-0 rounded-t-[24px] z-10 ${columnHeaderClass(stage)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`font-black text-xs uppercase tracking-wide ${columnTitleClass(stage)}`}
                  >
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
                      closedTone={closedTone}
                    />
                  ))
                )}
              </div>
              <div className="px-3 py-3 border-t border-slate-200 bg-white rounded-b-[24px] text-[11px] font-bold text-slate-600">
                <div>Total: {formatDealAmount(total)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
