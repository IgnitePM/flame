import React from 'react';
import { staffDisplayName, staffHandle } from '../utils/staffDirectory.js';

export default function MentionTextarea({
  value,
  onChange,
  staffEmails = [],
  adminUsers = [],
  placeholder = 'Write a note. Use @name to tag someone…',
  disabled = false,
  onSubmit,
  className = '',
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const ref = React.useRef(null);

  const directory = React.useMemo(() => {
    const byEmail = new Map();
    for (const row of adminUsers || []) {
      const email = String(row?.email || row?.id || '').trim().toLowerCase();
      if (email) byEmail.set(email, staffDisplayName(row));
    }
    for (const email of staffEmails || []) {
      const key = String(email || '').trim().toLowerCase();
      if (key && !byEmail.has(key)) byEmail.set(key, staffHandle(key));
    }
    return [...byEmail.entries()].map(([email, name]) => ({
      email,
      name,
      handle: staffHandle(email),
    }));
  }, [adminUsers, staffEmails]);

  const matches = React.useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    return directory
      .filter(
        (row) =>
          !q ||
          row.handle.includes(q) ||
          row.name.toLowerCase().includes(q) ||
          row.email.includes(q),
      )
      .slice(0, 6);
  }, [directory, open, query]);

  const insertMention = (handle) => {
    const el = ref.current;
    const text = String(value || '');
    const caret = el ? el.selectionStart : text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const replaced = before.replace(/@([a-z0-9._+-]*)$/i, `@${handle} `);
    onChange?.(replaced + after);
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onInput = (e) => {
    const next = e.target.value;
    onChange?.(next);
    const caret = e.target.selectionStart || next.length;
    const before = next.slice(0, caret);
    const m = before.match(/@([a-z0-9._+-]*)$/i);
    if (m) {
      setOpen(true);
      setQuery(m[1] || '');
      setActive(0);
    } else {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className={`relative ${className}`}>
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={onInput}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]/40 disabled:opacity-50"
        onKeyDown={(e) => {
          if (open && matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => (i + 1) % matches.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insertMention(matches[active]?.handle);
              return;
            }
            if (e.key === 'Escape') {
              setOpen(false);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="absolute bottom-full z-20 mb-1 max-h-40 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {matches.map((row, idx) => (
            <li key={row.email}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(row.handle);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                  idx === active ? 'bg-orange-50 text-[#fd7414]' : 'text-slate-700'
                }`}
              >
                <span className="font-black">@{row.handle}</span>
                <span className="truncate pl-2 text-[10px] text-slate-400">{row.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
