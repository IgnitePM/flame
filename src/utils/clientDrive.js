import { authedFetch } from './authedFetch.js';
import { MAX_CLIENT_FILE_BYTES, validateClientUploadFile } from './clientDocuments.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function isDriveFolder(file) {
  return file?.mimeType === FOLDER_MIME;
}

export function driveFileViewUrl(file) {
  if (!file) return '';
  return (
    file.webViewLink ||
    (file.id ? `https://drive.google.com/file/d/${file.id}/view` : '')
  );
}

/**
 * Upload a browser File into a Drive folder via resumable upload
 * (Netlify starts the session; bytes go straight to Google).
 */
export async function uploadFileToDriveFolder(folderId, file) {
  const validationError = validateClientUploadFile(file);
  if (validationError) throw new Error(validationError);
  if (!folderId) throw new Error('No Drive folder linked for this client.');

  const start = await authedFetch('/.netlify/functions/drive-upload-start', {
    folderId,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  });
  const startData = await start.json().catch(() => ({}));
  if (!start.ok || !startData.uploadUrl) {
    throw new Error(startData.error || 'Could not start Drive upload.');
  }

  const put = await fetch(startData.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': String(file.size),
    },
    body: file,
  }).catch((err) => {
    throw new Error(
      err?.message === 'Failed to fetch'
        ? 'Upload blocked by the browser (CORS). Try again after refresh — if it keeps failing, use a smaller file or attach an existing Drive file.'
        : err?.message || 'Upload failed.',
    );
  });
  const meta = await put.json().catch(() => ({}));
  if (!put.ok) {
    throw new Error(meta?.error?.message || 'Drive upload failed.');
  }
  return meta;
}

export async function listDriveFolder(folderId, pageToken = '') {
  const resp = await authedFetch('/.netlify/functions/drive-list', {
    folderId,
    pageToken: pageToken || undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Could not list Drive files.');
  return data;
}

export async function ensureClientDriveFolder(client) {
  const resp = await authedFetch('/.netlify/functions/drive-ensure-client-folder', {
    clientId: client.id,
    clientName: client.name || '',
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Could not create Drive folder.');
  return data;
}

export async function linkClientDriveFolder(client, folderUrlOrId) {
  const resp = await authedFetch('/.netlify/functions/drive-link-folder', {
    clientId: client.id,
    folderUrl: folderUrlOrId,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Could not link Drive folder.');
  return data;
}

export async function shareClientDriveFolder(client, emails, role = 'reader') {
  const resp = await authedFetch('/.netlify/functions/drive-share-client-folder', {
    clientId: client.id,
    emails,
    role,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Could not share folder.');
  return data;
}

export async function searchClientDriveFolder(folderId, query) {
  const resp = await authedFetch('/.netlify/functions/drive-search', {
    folderId,
    query,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Drive search failed.');
  return data;
}

export { MAX_CLIENT_FILE_BYTES, FOLDER_MIME };
