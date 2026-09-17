import React, { useEffect, useState } from 'react';
import { ArrowLeft, Puzzle, Wrench } from 'lucide-react';
import { getPortalTool, listEnabledPortalTools } from '../portalTools/registry.js';
import { loadPortalToolSave, savePortalToolSave } from '../portalTools/toolSave.js';

/**
 * Portal Tools tab — hosts pluggable mini-apps registered in portalTools/registry.js.
 */
export default function ClientPortalToolsPanel({ client, user }) {
  const tools = listEnabledPortalTools();
  const [activeToolId, setActiveToolId] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saveLoaded, setSaveLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const activeTool = activeToolId ? getPortalTool(activeToolId) : null;

  useEffect(() => {
    if (!activeTool || !client?.id) {
      setSaved(null);
      setSaveLoaded(false);
      setLoadError('');
      return undefined;
    }
    let cancelled = false;
    setSaveLoaded(false);
    (async () => {
      setLoadError('');
      try {
        const row = await loadPortalToolSave(client.id, activeTool.id);
        if (!cancelled) {
          setSaved(row);
          setSaveLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setSaved(null);
          setSaveLoaded(true);
          setLoadError(err?.message || 'Could not load saved work.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTool?.id, client?.id]);

  const save = async (data, { title = '', saveKey = 'default' } = {}) => {
    if (!client?.id || !activeTool || saving) return null;
    setSaving(true);
    setSaveMessage('');
    try {
      const result = await savePortalToolSave({
        clientId: client.id,
        clientName: client.name || '',
        toolId: activeTool.id,
        data,
        saveKey,
        title,
        updatedByEmail: user?.email || '',
      });
      setSaved({
        id: result.id,
        data,
        title,
        updatedAt: result.updatedAt,
        updatedByEmail: user?.email || '',
      });
      setSaveMessage('Saved to your portal.');
      return result;
    } catch (err) {
      setSaveMessage(err?.message || 'Could not save.');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const load = async (saveKey = 'default') => {
    if (!client?.id || !activeTool) return null;
    const row = await loadPortalToolSave(client.id, activeTool.id, saveKey);
    setSaved(row);
    return row;
  };

  if (activeTool) {
    const Tool = activeTool.component;
    const fullBleed = activeTool.fullBleed === true;
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setActiveToolId(null);
            setSaveMessage('');
            setLoadError('');
          }}
          className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All tools
        </button>
        {fullBleed ? (
          <div className="space-y-2">
            {(loadError || saveMessage || saved?.updatedAt) && (
              <div className="px-1">
                {saved?.updatedAt ? (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Last saved {new Date(saved.updatedAt).toLocaleString()}
                  </p>
                ) : null}
                {loadError ? (
                  <p className="text-xs font-bold text-amber-700 mt-1">{loadError}</p>
                ) : null}
                {saveMessage ? (
                  <p
                    className={`text-xs font-bold mt-1 ${
                      saveMessage.includes('Saved') ? 'text-emerald-600' : 'text-red-500'
                    }`}
                  >
                    {saveMessage}
                  </p>
                ) : null}
              </div>
            )}
            {!saveLoaded ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">
                Loading saved work…
              </div>
            ) : (
              <Tool
                client={client}
                user={user}
                save={save}
                load={load}
                savedData={saved?.data ?? null}
                saving={saving}
              />
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 shadow-sm space-y-4">
            <div>
              <h3 className="font-black text-xl text-slate-900">{activeTool.title}</h3>
              {activeTool.description ? (
                <p className="text-sm text-slate-500 font-medium mt-1">
                  {activeTool.description}
                </p>
              ) : null}
              {saved?.updatedAt ? (
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                  Last saved {new Date(saved.updatedAt).toLocaleString()}
                </p>
              ) : null}
              {loadError ? (
                <p className="text-xs font-bold text-amber-700 mt-2">{loadError}</p>
              ) : null}
              {saveMessage ? (
                <p
                  className={`text-xs font-bold mt-2 ${
                    saveMessage.includes('Saved') ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {saveMessage}
                </p>
              ) : null}
            </div>
            {!saveLoaded ? (
              <p className="text-sm font-bold text-slate-400">Loading saved work…</p>
            ) : (
              <Tool
                client={client}
                user={user}
                save={save}
                load={load}
                savedData={saved?.data ?? null}
                saving={saving}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-[32px] p-4 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
          <Wrench className="w-5 h-5 text-[#fd7414]" />
        </div>
        <div>
          <h3 className="font-black text-xl text-slate-900">Tools</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Custom apps Ignite shares with you. Work is saved to your portal so you can
            pick up where you left off.
          </p>
        </div>
      </div>

      {tools.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center space-y-3">
          <Puzzle className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-500">
            No tools are available yet.
          </p>
          <p className="text-xs text-slate-400 font-medium max-w-md mx-auto">
            When Ignite adds apps like Customer Journey Builder, they’ll show up here.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tools.map((tool) => (
            <li key={tool.id}>
              <button
                type="button"
                onClick={() => setActiveToolId(tool.id)}
                className="w-full text-left rounded-2xl border border-slate-200 bg-slate-50 hover:border-[#fd7414]/50 hover:bg-white p-5 transition-colors"
              >
                <div className="font-black text-slate-900">{tool.title}</div>
                {tool.description ? (
                  <p className="text-xs text-slate-500 font-medium mt-2 line-clamp-3">
                    {tool.description}
                  </p>
                ) : null}
                <span className="inline-block mt-4 text-[10px] font-black uppercase tracking-widest text-[#fd7414]">
                  Open →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
