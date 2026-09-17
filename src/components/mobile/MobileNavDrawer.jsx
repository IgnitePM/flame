import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Slide-over / sheet for mobile navigation menus.
 * side: 'left' | 'right' | 'bottom'
 */
export default function MobileNavDrawer({
  open,
  onClose,
  title = 'Menu',
  children,
  side = 'left',
  zClass = 'z-[180]',
}) {
  React.useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const isBottom = side === 'bottom';
  const isRight = side === 'right';

  const panelPos = isBottom
    ? 'inset-x-0 bottom-0 max-h-[min(85dvh,100%)] rounded-t-3xl'
    : isRight
      ? 'inset-y-0 right-0 w-[min(20rem,88vw)] rounded-l-3xl'
      : 'inset-y-0 left-0 w-[min(20rem,88vw)] rounded-r-3xl';

  return createPortal(
    <div className={`fixed inset-0 ${zClass}`} role="presentation">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute ${panelPos} flex flex-col bg-white shadow-2xl overflow-hidden safe-pt safe-pb`}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h3 className="font-black text-base text-slate-900 uppercase tracking-wider">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="touch-target rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-1">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Shared nav row for drawer menus. */
export function MobileNavItem({
  label,
  icon: Icon,
  active = false,
  onClick,
  disabled = false,
  badge = null,
  danger = false,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`touch-target relative w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-black uppercase tracking-wider transition-colors disabled:opacity-40 ${
        danger
          ? 'text-red-600 hover:bg-red-50'
          : active
            ? 'bg-[#fd7414] text-white shadow-sm'
            : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {Icon ? <Icon className="w-5 h-5 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </button>
  );
}
