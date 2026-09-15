import React from 'react';
import TodoItemAttachments from './TodoItemAttachments.jsx';
import {
  getProjectAttachments,
  MAX_PROJECT_ATTACHMENTS,
} from '../utils/clientDocuments.js';

/**
 * Project-level Drive attachments (briefs, specs, assets).
 * Reuses the task Drive picker; stores metadata on the project doc.
 */
export default function ProjectAttachments({
  project,
  client,
  disabled = false,
  onAttachDriveFile,
  onRemove,
  compact = false,
}) {
  if (!project?.id) return null;

  const attachments = getProjectAttachments(project);
  const atLimit = attachments.length >= MAX_PROJECT_ATTACHMENTS;
  const syntheticItem = {
    id: project.id,
    text: project.title || 'Custom project',
    attachments,
  };

  const handleAttach = async (cli, driveFile) => {
    if (!onAttachDriveFile) return;
    if (atLimit) {
      throw new Error(`Maximum ${MAX_PROJECT_ATTACHMENTS} attachments per project.`);
    }
    await onAttachDriveFile(cli, project, driveFile);
  };

  const handleRemove = async (cli, documentId) => {
    if (!onRemove) return;
    await onRemove(cli, project, documentId);
  };

  return (
    <div className={compact ? '' : 'mt-3 pt-3 border-t border-slate-100'}>
      {!compact ? (
        <h6 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
          Files
        </h6>
      ) : null}
      <TodoItemAttachments
        item={syntheticItem}
        client={client}
        cycleStart={null}
        categoryKey={null}
        disabled={disabled}
        maxAttachments={MAX_PROJECT_ATTACHMENTS}
        onAttachDriveFile={
          onAttachDriveFile
            ? (cli, file) => handleAttach(cli, file)
            : undefined
        }
        onRemove={onRemove ? handleRemove : undefined}
        compact={compact}
      />
    </div>
  );
}
