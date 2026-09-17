import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Full-viewport-safe modal shell for phones and desktop.
 * Sticky header/footer keep actions reachable; body scrolls within max-h.
 */
export default function MobileSafeModal({
  open,
  onClose,
  title,
  subtitle = null,
  children,
  footer = null,
  maxWidthClass = 'max-w-lg',
  panelClassName = '',
  zClass = 'z-[200]',
  showClose = true,
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

  return createPortal(
    <div
      className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 safe-pt safe-pb`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        className={`w-full ${maxWidthClass} max-h-[min(92dvh,100%)] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden safe-pb ${panelClassName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || showClose) && (
          <div className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-100 px-4 sm:px-6 py-3 sm:py-4 bg-slate-50/80">
            <div className="min-w-0">
              {title ? (
                <h3 className="font-black text-lg sm:text-xl text-slate-900 leading-tight">
                  {title}
                </h3>
              ) : null}
              {subtitle ? (
                <p className="text-[11px] font-bold text-slate-400 mt-1">{subtitle}</p>
              ) : null}
            </div>
            {showClose ? (
              <button
                type="button"
                onClick={onClose}
                className="touch-target shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            ) : null}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4">
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-slate-100 bg-white px-4 sm:px-6 py-3 sm:py-4 safe-pb">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
