import React from 'react';
import {
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  LayoutGrid,
  Link2,
  List,
  Paperclip,
  Search,
  Share2,
  Upload,
} from 'lucide-react';
import { formatFileSize } from '../utils/clientDocuments.js';
import { clientConnectionLinks } from '../utils/clientConnections.js';
import {
  driveFileViewUrl,
  ensureClientDriveFolder,
  isDriveFolder,
  linkClientDriveFolder,
  listDriveFolder,
  searchClientDriveFolder,
  shareClientDriveFolder,
  uploadFileToDriveFolder,
} from '../utils/clientDrive.js';

const VIEW_STORAGE_KEY = 'ignite.clientFiles.view';
const SIZE_STORAGE_KEY = 'ignite.clientFiles.gridSize';

function ExternalOpenButton({ href, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:bg-orange-50"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}

function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v || fallback;
  } catch {
    return fallback;
  }
}

function FileThumb({ file, sizeClass }) {
  const folder = isDriveFolder(file);
  const thumb = String(file?.thumbnailLink || '').trim();
  if (!folder && thumb) {
    return (
      <img
        src={thumb}
        alt=""
        className={`${sizeClass} rounded-lg object-cover bg-slate-100`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  if (folder) {
    return <Folder className={`${sizeClass} text-[#fd7414]`} />;
  }
  if (file?.iconLink) {
    return (
      <img
        src={file.iconLink}
        alt=""
        className={`${sizeClass} object-contain`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return <FileText className={`${sizeClass} text-slate-400`} />;
}

/**
 * Browse / upload the client's Google Drive folder (company Drive connection).
 */
export default function ClientFilesPanel({
  client,
  disabled = false,
  canShare = true,
  onClientDriveLinked,
}) {
  const folderId = String(client?.googleDriveFolderId || '').trim();
  const [path, setPath] = React.useState([]); // [{id,name}]
  const [files, setFiles] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [linkUrl, setLinkUrl] = React.useState(client?.googleDriveFolderUrl || '');
  const [shareEmails, setShareEmails] = React.useState('');
  const [searchInput, setSearchInput] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState(null);
  const [viewMode, setViewMode] = React.useState(() =>
    readStored(VIEW_STORAGE_KEY, 'list') === 'grid' ? 'grid' : 'list',
  );
  const [gridSize, setGridSize] = React.useState(() => {
    const s = readStored(SIZE_STORAGE_KEY, 'md');
    return ['sm', 'md', 'lg'].includes(s) ? s : 'md';
  });

  const currentFolderId = path.length ? path[path.length - 1].id : folderId;
  const searching = Boolean(searchQuery.trim());

  const connectionLinks = clientConnectionLinks(client).filter(
    (l) =>
      ['drive', 'hubspot', 'slack', 'calendar', 'perplexity'].includes(l.key) ||
      String(l.key).startsWith('doc_'),
  );

  const setView = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const setSize = (size) => {
    setGridSize(size);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, size);
    } catch {
      /* ignore */
    }
  };

  const refresh = React.useCallback(
    async (id) => {
      if (!id) {
        setFiles([]);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await listDriveFolder(id);
        setFiles(Array.isArray(data.files) ? data.files : []);
        setPath((prev) => {
          if (prev.length) return prev;
          if (data.folder) {
            return [
              { id: data.folder.id, name: data.folder.name || client?.name || 'Drive' },
            ];
          }
          return prev;
        });
      } catch (err) {
        setError(err?.message || 'Could not load Drive folder.');
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [client?.name],
  );

  React.useEffect(() => {
    setPath([]);
    setLinkUrl(client?.googleDriveFolderUrl || '');
    setError('');
    setSearchInput('');
    setSearchQuery('');
    setSearchResults(null);
  }, [client?.id, client?.googleDriveFolderId, client?.googleDriveFolderUrl]);

  React.useEffect(() => {
    if (!currentFolderId || searching) return;
    refresh(currentFolderId);
  }, [currentFolderId, refresh, searching]);

  React.useEffect(() => {
    if (!folderId || !searchQuery.trim()) {
      setSearchResults(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await searchClientDriveFolder(folderId, searchQuery.trim());
        if (!cancelled) setSearchResults(Array.isArray(data.files) ? data.files : []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Search failed.');
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, searchQuery]);

  const handleCreate = async () => {
    if (!client?.id || busy) return;
    setBusy('create');
    setError('');
    try {
      const data = await ensureClientDriveFolder(client);
      onClientDriveLinked?.(client.id, data);
      setPath([{ id: data.folderId, name: client.name || 'Drive' }]);
    } catch (err) {
      setError(err?.message || 'Could not create folder.');
    } finally {
      setBusy('');
    }
  };

  const handleLink = async () => {
    if (!client?.id || !linkUrl.trim() || busy) return;
    setBusy('link');
    setError('');
    try {
      const data = await linkClientDriveFolder(client, linkUrl.trim());
      onClientDriveLinked?.(client.id, data);
      setPath([{ id: data.folderId, name: data.folderName || client.name || 'Drive' }]);
    } catch (err) {
      setError(err?.message || 'Could not link folder.');
    } finally {
      setBusy('');
    }
  };

  const handleUpload = async (file) => {
    if (!file || !currentFolderId || busy) return;
    setBusy('upload');
    setError('');
    try {
      await uploadFileToDriveFolder(currentFolderId, file);
      if (searching) {
        setSearchQuery('');
        setSearchInput('');
      }
      await refresh(currentFolderId);
    } catch (err) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setBusy('');
    }
  };

  const handleShare = async () => {
    if (!client?.id || busy) return;
    const emails = shareEmails
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'));
    if (!emails.length) {
      setError('Enter at least one email to share the client folder with.');
      return;
    }
    setBusy('share');
    setError('');
    try {
      const data = await shareClientDriveFolder(client, emails, 'reader');
      const failed = (data.results || []).filter((r) => !r.ok);
      if (failed.length) {
        setError(
          `Shared with some contacts; failed: ${failed.map((f) => f.email).join(', ')}`,
        );
      } else {
        window.alert(
          `Shared “Shared with client” with ${emails.join(', ')}. They only see that subfolder, not the whole Drive.`,
        );
        setShareEmails('');
      }
      onClientDriveLinked?.(client.id, data);
    } catch (err) {
      setError(err?.message || 'Share failed.');
    } finally {
      setBusy('');
    }
  };

  const openFolder = (file) => {
    if (!isDriveFolder(file)) return;
    setSearchQuery('');
    setSearchInput('');
    setSearchResults(null);
    setPath((prev) => {
      if (prev.some((p) => p.id === file.id)) {
        const idx = prev.findIndex((p) => p.id === file.id);
        return prev.slice(0, idx + 1);
      }
      return [...prev, { id: file.id, name: file.name || 'Folder' }];
    });
  };

  const navigateTo = (index) => {
    setSearchQuery('');
    setSearchInput('');
    setSearchResults(null);
    setPath((prev) => prev.slice(0, index + 1));
  };

  const runSearch = (e) => {
    e?.preventDefault?.();
    setSearchQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
    setSearchResults(null);
  };

  if (!folderId) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Client files (Google Drive)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {connectionLinks.map((link) => (
              <ExternalOpenButton key={link.key} href={link.href} label={link.label} />
            ))}
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">
          No Drive folder linked. Create one under the company Drive root, or link an
          existing client folder.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || !!busy}
            onClick={handleCreate}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <FolderPlus className="w-3.5 h-3.5 text-[#fd7414]" />
            {busy === 'create' ? 'Creating…' : 'Create folder'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            disabled={disabled || !!busy}
            placeholder="Paste existing Drive folder URL"
            className="flex-1 min-w-[180px] bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
          />
          <button
            type="button"
            disabled={disabled || !!busy || !linkUrl.trim()}
            onClick={handleLink}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
          >
            <Link2 className="w-3.5 h-3.5" />
            {busy === 'link' ? 'Linking…' : 'Link folder'}
          </button>
        </div>
        {error ? <p className="text-xs font-bold text-red-600">{error}</p> : null}
      </div>
    );
  }

  const displayFiles = searching ? searchResults || [] : files;
  const sorted = [...displayFiles].sort((a, b) => {
    const af = isDriveFolder(a) ? 0 : 1;
    const bf = isDriveFolder(b) ? 0 : 1;
    if (af !== bf) return af - bf;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      sensitivity: 'base',
    });
  });

  const gridThumbClass =
    gridSize === 'sm' ? 'h-10 w-10' : gridSize === 'lg' ? 'h-24 w-24' : 'h-16 w-16';
  const gridCols =
    gridSize === 'sm'
      ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5'
      : gridSize === 'lg'
        ? 'grid-cols-2 sm:grid-cols-3'
        : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4';

  const renderFileItem = (file) => {
    const folder = isDriveFolder(file);
    const href = driveFileViewUrl(file);
    const meta = (
      <div className="mt-0.5 text-[10px] font-bold text-slate-400 truncate">
        {folder ? 'Folder' : formatFileSize(Number(file.size || 0))}
        {file.modifiedTime ? ` · ${new Date(file.modifiedTime).toLocaleDateString()}` : ''}
      </div>
    );
    const nameEl = folder ? (
      <button
        type="button"
        onClick={() => openFolder(file)}
        className="block w-full truncate text-left text-sm font-bold text-slate-800 hover:text-[#fd7414]"
      >
        {file.name}
      </button>
    ) : href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block truncate text-sm font-bold text-[#fd7414] hover:underline"
      >
        {file.name}
      </a>
    ) : (
      <span className="block truncate text-sm font-bold text-slate-800">{file.name}</span>
    );

    if (viewMode === 'grid') {
      return (
        <li
          key={file.id}
          className="flex flex-col items-stretch gap-2 rounded-xl border border-slate-200 bg-white p-3"
        >
          <button
            type="button"
            onClick={() => {
              if (folder) openFolder(file);
              else if (href) window.open(href, '_blank', 'noopener,noreferrer');
            }}
            className="flex flex-col items-center gap-2 text-center"
          >
            <FileThumb file={file} sizeClass={gridThumbClass} />
            <span className="w-full truncate text-xs font-bold text-slate-800">{file.name}</span>
          </button>
          {meta}
        </li>
      );
    }

    return (
      <li
        key={file.id}
        className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3"
      >
        <FileThumb file={file} sizeClass="h-8 w-8 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          {nameEl}
          {meta}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Client files (Google Drive)
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connectionLinks.map((link) => (
            <ExternalOpenButton key={link.key} href={link.href} label={link.label} />
          ))}
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 ${
              disabled || busy ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {busy === 'upload' ? 'Uploading…' : 'Upload file'}
            <input
              type="file"
              className="sr-only"
              disabled={disabled || !!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                handleUpload(file);
              }}
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={runSearch} className="flex flex-1 min-w-[180px] gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search in this client’s Drive…"
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white"
          >
            Search
          </button>
          {searching ? (
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600"
            >
              Clear
            </button>
          ) : null}
        </form>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setView('list')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest ${
              viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500'
            }`}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => setView('grid')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest ${
              viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-500'
            }`}
            title="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Grid
          </button>
        </div>
        {viewMode === 'grid' ? (
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            {['sm', 'md', 'lg'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                  gridSize === s ? 'bg-[#fd7414] text-white' : 'text-slate-500'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!searching && path.length > 0 ? (
        <nav className="flex flex-wrap items-center gap-1 text-[11px] font-bold text-slate-500">
          {path.map((crumb, i) => (
            <React.Fragment key={`${crumb.id}_${i}`}>
              {i > 0 ? <ChevronRight className="w-3 h-3 text-slate-300" /> : null}
              <button
                type="button"
                onClick={() => navigateTo(i)}
                className={`truncate max-w-[140px] ${
                  i === path.length - 1 ? 'text-[#fd7414]' : 'hover:underline'
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      {searching ? (
        <p className="text-[10px] font-bold text-slate-400">
          Search results in client folder{searchResults ? ` (${sorted.length})` : '…'}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs italic text-slate-400">
          {searching ? 'Searching Drive…' : 'Loading Drive…'}
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-xs italic text-slate-400">
          {searching
            ? 'No matching files in this client’s Drive folder.'
            : 'This folder is empty. Upload files here or attach from tasks.'}
        </p>
      ) : viewMode === 'grid' ? (
        <ul className={`grid gap-2 ${gridCols}`}>{sorted.map(renderFileItem)}</ul>
      ) : (
        <ul className="space-y-2">{sorted.map(renderFileItem)}</ul>
      )}

      {canShare ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/80 p-3 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Share “Shared with client” subfolder
          </div>
          <p className="text-[10px] font-medium text-slate-400">
            Clients only get that subfolder — not the whole client folder or Shared Drive.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={shareEmails}
              onChange={(e) => setShareEmails(e.target.value)}
              disabled={disabled || !!busy}
              placeholder="client@email.com"
              className="flex-1 min-w-[160px] bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
            <button
              type="button"
              disabled={disabled || !!busy}
              onClick={handleShare}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40"
            >
              <Share2 className="w-3.5 h-3.5" />
              {busy === 'share' ? 'Sharing…' : 'Share'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs font-bold text-red-600">{error}</p> : null}

      <p className="flex items-start gap-1.5 text-[10px] font-medium text-slate-400">
        <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
        Files live in Google Drive. Max 25 MB per upload from the CRM. Task attachments pick
        from this folder.
      </p>
    </div>
  );
}
