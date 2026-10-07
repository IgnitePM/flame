import React from 'react';
import { assigneeChoiceGroups } from '../utils/clientAssignees.js';

function ChoiceRow({ email, checked, onToggle, tone }) {
  const light = tone !== 'dark';
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold ${
        light ? 'text-slate-800 hover:bg-slate-50' : 'text-zinc-100 hover:bg-white/10'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={() => onToggle(email)} />
      <span className="truncate">{email}</span>
    </label>
  );
}

/**
 * Staff assignees, plus portal users from the client currently being edited.
 */
export default function AssigneeChoiceList({
  staffEmails = [],
  client = null,
  selected = [],
  onChange,
  tone = 'light',
}) {
  const cleaned = (selected || [])
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean);
  const groups = assigneeChoiceGroups({
    staffEmails,
    client,
    selected: cleaned,
  });
  const heading =
    tone === 'dark'
      ? 'text-[9px] font-black uppercase tracking-widest text-zinc-500'
      : 'text-[9px] font-black uppercase tracking-widest text-slate-400';

  const toggle = (email) => {
    const has = cleaned.includes(email);
    const next = has ? cleaned.filter((item) => item !== email) : [...cleaned, email];
    onChange?.([...next].sort((a, b) => a.localeCompare(b)));
  };

  const section = (label, emails) =>
    emails.length ? (
      <div className="mb-2">
        <div className={`mb-1 px-2 ${heading}`}>{label}</div>
        {emails.map((email) => (
          <ChoiceRow
            key={`${label}-${email}`}
            email={email}
            checked={cleaned.includes(email)}
            onToggle={toggle}
            tone={tone}
          />
        ))}
      </div>
    ) : null;

  return (
    <div>
      {section('Staff', groups.staff)}
      {groups.showClients ? (
        groups.clients.length ? (
          section('This client', groups.clients)
        ) : (
          <p className={`mb-2 px-2 ${heading}`}>No portal users on this client</p>
        )
      ) : null}
      {section('Already assigned', groups.other)}
    </div>
  );
}
