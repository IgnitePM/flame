import React from 'react';
import { Plus, Timer, X } from 'lucide-react';
import {
  shortWorkspaceLabel,
  isTimingWorkspace,
} from '../utils/kioskWorkspaces.js';

/**
 * Browser-style tabs for pinned client + retainer workspaces.
 */
export default function KioskWorkspaceTabs({
  workspaces = [],
  activeId = null,
  activeTask = null,
  activeTasks = null,
  generalLabel = 'General / Unclassified',
  onSelect,
  onClose,
  onAdd,
}) {
  const timingTasks = activeTasks?.length ? activeTasks : activeTask;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
        <div className="flex items-stretch gap-1 min-w-min pr-1">
          {(workspaces || []).map((ws) => {
            const active = ws.id === activeId;
            const timing = isTimingWorkspace(timingTasks, ws, { generalLabel });
            const label = shortWorkspaceLabel(ws, {
              generalLabel:
                generalLabel === 'General / Unclassified' ? 'General' : generalLabel,
            });
            return (
              <div
                key={ws.id}
                className={`group flex items-center gap-1 max-w-[220px] rounded-xl border pl-2.5 pr-1 py-1.5 transition-all ${
                  active
                    ? 'bg-[#fd7414] border-[#fd7414] text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect?.(ws.id)}
                  className="min-w-0 flex-1 flex items-center gap-1.5 text-left"
                  title={label}
                >
                  {timing ? (
                    <Timer
                      className={`w-3.5 h-3.5 shrink-0 ${
                        active ? 'text-white' : 'text-[#fd7414]'
                      }`}
                      aria-label="Timer running on this tab"
                    />
                  ) : null}
                  <span className="truncate text-[10px] font-black uppercase tracking-wider">
                    {label}
                  </span>
                </button>
                <button
                  type="button"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.(ws.id);
                  }}
                  className={`shrink-0 p-1 rounded-lg transition-colors ${
                    active
                      ? 'text-white/80 hover:bg-white/15 hover:text-white'
                      : 'text-slate-300 hover:bg-slate-100 hover:text-slate-600'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAdd?.()}
        title="New client tab"
        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Tab</span>
      </button>
    </div>
  );
}
