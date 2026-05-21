import React from 'react';
import { Paperclip, Trash2 } from 'lucide-react';
import {
  formatFileSize,
  getTodoAttachments,
  MAX_TODO_ATTACHMENTS,
} from '../utils/clientDocuments.js';

export default function TodoItemAttachments({
  item,
  client,
  cycleStart,
  categoryKey,
  disabled = false,
  onAttach,
  onRemove,
  compact = false,
}) {
  const [uploading, setUploading] = React.useState(false);
  const attachments = getTodoAttachments(item);
  const atLimit = attachments.length >= MAX_TODO_ATTACHMENTS;

  const handleFile = async (file) => {
    if (!file || !onAttach || !client) return;
    setUploading(true);
    try {
      await onAttach(client, file, {
        linkedTodoId: item.id,
        linkedTodoText: item.text || '',
        linkedCategoryKey: categoryKey,
        linkedCycleStart: cycleStart,
      });
    } catch (err) {
      window.alert(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  if (!onAttach && attachments.length === 0) return null;

  return (
    <div
      className={`${compact ? 'ml-8' : 'ml-10'} space-y-1.5 pb-1 ${compact ? '' : 'border-l border-slate-200 pl-3'}`}
    >
      {attachments.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5 text-xs"
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {doc.url ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate font-bold text-[#fd7414] hover:underline"
            >
              {doc.name}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate font-bold text-slate-700">
              {doc.name}
            </span>
          )}
          <span className="shrink-0 text-[9px] font-bold text-slate-400">
            {formatFileSize(doc.sizeBytes)}
          </span>
          {onRemove && (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={async () => {
                if (!window.confirm(`Remove "${doc.name}"?`)) return;
                try {
                  await onRemove(client, doc.id);
                } catch (err) {
                  window.alert(err?.message || 'Could not remove file.');
                }
              }}
              className="shrink-0 rounded p-1 text-slate-300 hover:text-red-500 disabled:opacity-40"
              title="Remove attachment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {onAttach && !disabled && !atLimit && (
        <label
          className={`inline-flex cursor-pointer items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:underline ${
            uploading ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          <Paperclip className="h-3 w-3" />
          {uploading ? 'Uploading…' : 'Attach file'}
          <input
            type="file"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              handleFile(file);
            }}
          />
        </label>
      )}
      {atLimit && onAttach && (
        <p className="text-[9px] font-bold text-slate-400">
          Max {MAX_TODO_ATTACHMENTS} attachments per task.
        </p>
      )}
    </div>
  );
}
