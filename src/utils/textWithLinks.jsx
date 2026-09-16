import React from 'react';

const URL_SPLIT = /(https?:\/\/[^\s<>"']+)/gi;

/**
 * Render plain text with http(s) URLs as safe external links.
 */
export function TextWithLinks({ text, className = '' }) {
  const raw = String(text || '');
  if (!raw) return null;
  const parts = raw.split(URL_SPLIT);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (/^https?:\/\//i.test(part)) {
          const trimmed = part.replace(/[.,);:!?\]]+$/g, '');
          const trailing = part.slice(trimmed.length);
          return (
            <React.Fragment key={`${i}-${trimmed.slice(0, 24)}`}>
              <a
                href={trimmed}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#fd7414] font-bold underline break-all hover:brightness-95"
              >
                {trimmed}
              </a>
              {trailing}
            </React.Fragment>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}
