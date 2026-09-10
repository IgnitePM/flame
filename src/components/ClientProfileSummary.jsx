import { ExternalLink, Mail, MapPin, Phone, User } from 'lucide-react';
import {
  normalizePrimaryContact,
  normalizeClientContacts,
} from '../utils/clientDocuments.js';
import { clientConnectionLinks } from '../utils/clientConnections.js';
import {
  formatCompanyAddress,
  normalizeCompanyProfileFields,
} from '../utils/clientCompanyProfile.js';

function LinkChip({ href, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:bg-orange-50"
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  );
}

function ContactBlock({ title, contact }) {
  if (!contact?.name && !contact?.email && !contact?.phone && !contact?.title) {
    return null;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{title}</div>
      {contact.name && (
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>{contact.name}</span>
          {contact.title && (
            <span className="text-xs font-medium text-slate-500">· {contact.title}</span>
          )}
        </div>
      )}
      {contact.email && (
        <a
          href={`mailto:${contact.email}`}
          className="flex items-center gap-2 text-xs font-bold text-[#fd7414] hover:underline"
        >
          <Mail className="w-3.5 h-3.5 shrink-0" />
          {contact.email}
        </a>
      )}
      {contact.phone && (
        <a
          href={`tel:${contact.phone.replace(/\s/g, '')}`}
          className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:underline"
        >
          <Phone className="w-3.5 h-3.5 shrink-0" />
          {contact.phone}
        </a>
      )}
    </div>
  );
}

export default function ClientProfileSummary({ client, onComposeEmail = null }) {
  const phone = String(client?.phone || '').trim();
  const primary = normalizePrimaryContact(client?.primaryContact);
  const contacts = normalizeClientContacts(client?.contacts);
  const connectionLinks = clientConnectionLinks(client);
  const profile = normalizeCompanyProfileFields(client);
  const addressLine = formatCompanyAddress(client);

  const hasLinks = connectionLinks.length > 0 || phone || addressLine;
  const hasContacts =
    primary.name ||
    primary.email ||
    primary.phone ||
    contacts.length > 0;
  const hasAbout = Boolean(profile.companyDescription || profile.industry);

  if (!hasLinks && !hasContacts && !hasAbout && !onComposeEmail) {
    return (
      <p className="text-xs italic text-slate-400">
        No company profile yet. Open client settings to add website, contacts, and links — or use Enrich.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {hasAbout && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
          {profile.industry ? (
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">
              {profile.industry}
            </div>
          ) : null}
          {profile.companyDescription ? (
            <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap">
              {profile.companyDescription}
            </p>
          ) : null}
        </div>
      )}
      {(hasLinks || onComposeEmail) && (
        <div className="flex flex-wrap gap-2 items-center">
          {connectionLinks.map((link) => (
            <LinkChip key={link.key} href={link.href} label={link.label} />
          ))}
          {phone && (
            <a
              href={`tel:${phone.replace(/\s/g, '')}`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
            >
              <Phone className="w-3 h-3" />
              {phone}
            </a>
          )}
          {addressLine ? (
            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 max-w-full">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{addressLine}</span>
            </span>
          ) : null}
          {onComposeEmail && (
            <button
              type="button"
              onClick={onComposeEmail}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
            >
              <Mail className="w-3 h-3" />
              Email client
            </button>
          )}
        </div>
      )}
      {hasContacts && (
        <div className="grid gap-2 sm:grid-cols-2">
          <ContactBlock title="Primary contact" contact={primary} />
          {contacts.map((contact) => (
            <ContactBlock
              key={contact.id}
              title={contact.title || 'Contact'}
              contact={contact}
            />
          ))}
        </div>
      )}
    </div>
  );
}
