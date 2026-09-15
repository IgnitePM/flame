import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Info,
  Save,
  Shield,
} from 'lucide-react';
import {
  buildPolicyDocument,
  createEmptyFormData,
  POLICY_STEPS,
} from './steps.js';

/**
 * Portal Tools mini-app: Social Media Policy Architect.
 * Props from ClientPortalToolsPanel: { client, user, save, savedData, saving }
 */
export default function SocialPolicyArchitect({ client, save, savedData, saving }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [formData, setFormData] = useState(() => createEmptyFormData());
  const [view, setView] = useState('wizard'); // wizard | result
  const [policyText, setPolicyText] = useState('');
  const [toast, setToast] = useState(null);
  const [copyLabel, setCopyLabel] = useState('Copy Policy');
  const hydratedRef = useRef(false);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    if (hydratedRef.current) return;
    if (savedData && typeof savedData === 'object') {
      const base = createEmptyFormData();
      setFormData({ ...base, ...(savedData.formData || {}) });
      setStepIndex(
        Math.max(0, Math.min(POLICY_STEPS.length - 1, Number(savedData.stepIndex) || 0)),
      );
      if (savedData.policyText) {
        setPolicyText(String(savedData.policyText));
        setView(savedData.view === 'result' ? 'result' : 'wizard');
      }
      hydratedRef.current = true;
      return;
    }
    if (savedData === null) {
      // Prefill from client profile on first open.
      setFormData((prev) => ({
        ...prev,
        companyName: prev.companyName || client?.name || '',
        industry: prev.industry || client?.industry || '',
      }));
      hydratedRef.current = true;
    }
  }, [savedData, client?.name, client?.industry]);

  const step = POLICY_STEPS[stepIndex];
  const progressPercent = ((stepIndex + 1) / POLICY_STEPS.length) * 100;
  const StepIcon = step.icon;

  const setField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const persistPayload = (overrides = {}) => ({
    stepIndex,
    formData,
    policyText,
    view,
    ...overrides,
  });

  const handleSave = async (overrides = {}) => {
    if (!save) return;
    try {
      await save(persistPayload(overrides), { title: 'Social Media Policy' });
      showToast('Saved to your portal');
    } catch (err) {
      showToast(err?.message || 'Could not save');
    }
  };

  const handleNext = () => {
    if (stepIndex < POLICY_STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      return;
    }
    const doc = buildPolicyDocument(formData);
    setPolicyText(doc);
    setView('result');
    showToast('Policy generated successfully');
  };

  const handlePrevious = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const copyDocument = async () => {
    try {
      await navigator.clipboard.writeText(policyText);
      setCopyLabel('Copied!');
      showToast('Policy copied to clipboard');
      setTimeout(() => setCopyLabel('Copy Policy'), 2000);
    } catch {
      showToast('Could not copy — select and copy manually');
    }
  };

  const downloadPolicy = () => {
    const company = (formData.companyName || 'Company').replace(/\s+/g, '_');
    const blob = new Blob([policyText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${company}_Social_Media_Policy.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Download started');
  };

  const editAgain = () => setView('wizard');

  const resetAll = () => {
    const fresh = createEmptyFormData();
    fresh.companyName = client?.name || '';
    fresh.industry = client?.industry || '';
    setFormData(fresh);
    setStepIndex(0);
    setPolicyText('');
    setView('wizard');
    showToast('Form reset');
  };

  return (
    <div className="w-full bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <header className="p-5 sm:p-6 md:p-8 bg-black text-white border-b-4 border-[#fd7414]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src="/logo.png"
              alt="Ignite"
              className="h-10 w-auto object-contain shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white flex flex-wrap items-center gap-2">
                Policy Architect
                <span className="text-[10px] bg-[#fd7414] text-white font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest">
                  Social
                </span>
              </h1>
              <p className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-[0.16em]">
                Risk Management & Governance Engine
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest">
              {view === 'result' ? 'Document' : 'Section'}
            </span>
            {view === 'wizard' ? (
              <div className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-baseline justify-end gap-1">
                <span className="text-[#fd7414]">{stepIndex + 1}</span>
                <span className="text-neutral-600 text-sm font-bold">/</span>
                <span className="text-neutral-500 text-sm font-bold">
                  {POLICY_STEPS.length}
                </span>
              </div>
            ) : (
              <Shield className="w-7 h-7 text-[#fd7414] ml-auto mt-1" />
            )}
          </div>
        </div>

        {view === 'wizard' ? (
          <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden mt-6">
            <div
              className="h-full bg-[#fd7414] transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}
      </header>

      {view === 'wizard' ? (
        <>
          <main className="flex flex-col md:flex-row bg-white">
            <aside className="w-full md:w-80 bg-neutral-50 p-6 md:p-8 border-b md:border-b-0 md:border-r border-neutral-200 md:sticky md:top-24 md:self-start">
              <div className="flex items-center gap-2 mb-3 text-[#fd7414]">
                <Info className="w-4 h-4" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-900">
                  Strategic Context
                </h3>
              </div>
              <div className="text-xs text-neutral-600 leading-relaxed font-medium bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm">
                {step.guidance}
              </div>
              <div className="hidden md:block mt-6 pt-6 border-t border-neutral-200 text-neutral-400 text-[11px] font-semibold">
                <span className="text-neutral-800 font-bold">Framework Pillars:</span>{' '}
                Personal Use, Escalation, State Interests, & Platform Governance.
              </div>
            </aside>

            <section className="flex-grow p-6 sm:p-8 md:p-10 min-w-0">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-2.5 rounded-xl bg-[#fff2e9] text-[#fd7414] border border-orange-200">
                  <StepIcon className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-black tracking-tight">
                    {step.title}
                  </h2>
                  <p className="text-xs text-neutral-500 font-medium mt-0.5">
                    {step.subtitle}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                {step.fields.map((field) => (
                  <div key={field.key} className="space-y-2 group">
                    <label className="block text-[11px] font-black text-neutral-500 uppercase tracking-[0.15em] group-focus-within:text-black transition-colors">
                      {field.label}
                    </label>
                    {field.type === 'text' ? (
                      <input
                        type="text"
                        value={formData[field.key] || ''}
                        onChange={(e) => setField(field.key, e.target.value)}
                        placeholder={field.placeholder || ''}
                        className="w-full px-5 py-3.5 rounded-xl border-2 border-neutral-200 bg-neutral-50/50 focus:bg-white focus:border-[#fd7414] outline-none transition font-medium text-sm text-black"
                      />
                    ) : null}
                    {field.type === 'textarea' ? (
                      <textarea
                        rows={3}
                        value={formData[field.key] || ''}
                        onChange={(e) => setField(field.key, e.target.value)}
                        placeholder={field.placeholder || ''}
                        className="w-full px-5 py-3.5 rounded-xl border-2 border-neutral-200 bg-neutral-50/50 focus:bg-white focus:border-[#fd7414] outline-none transition font-medium text-sm text-black resize-y leading-relaxed min-h-[96px]"
                      />
                    ) : null}
                    {field.type === 'select' ? (
                      <select
                        value={formData[field.key] || field.options[0]}
                        onChange={(e) => setField(field.key, e.target.value)}
                        className="w-full px-5 py-3.5 rounded-xl border-2 border-neutral-200 bg-white focus:border-[#fd7414] outline-none transition font-bold text-sm text-black cursor-pointer"
                      >
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </main>

          <footer className="p-5 sm:p-6 md:p-8 bg-neutral-50 border-t border-neutral-200 flex flex-wrap justify-between items-center gap-3">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={stepIndex === 0}
              className="flex items-center gap-2 px-5 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest text-neutral-400 hover:text-black hover:bg-neutral-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>

            <div className="flex items-center gap-2 sm:gap-3 ml-auto">
              <button
                type="button"
                onClick={() => handleSave()}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 transition disabled:opacity-60"
              >
                <Save className="w-4 h-4 text-[#fd7414]" />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-3 bg-[#fd7414] hover:bg-[#d85904] text-white px-6 sm:px-10 py-3.5 sm:py-4 rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-500/20 transition-all active:scale-95"
              >
                <span>
                  {stepIndex === POLICY_STEPS.length - 1
                    ? 'Generate Final Policy'
                    : 'Continue'}
                </span>
                {stepIndex === POLICY_STEPS.length - 1 ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            </div>
          </footer>
        </>
      ) : (
        <div className="flex flex-col p-6 sm:p-10 bg-white">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-neutral-200">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 text-[#fd7414] text-xs font-black uppercase tracking-wider mb-2">
                <Check className="w-3.5 h-3.5" />
                Generated Document
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-black tracking-tight">
                {formData.companyName || 'Company'} Policy Framework
              </h2>
              <p className="text-xs text-neutral-500 font-medium">
                Formally aligned with Social Policy Factors & Compliance Rules
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => handleSave({ view: 'result', policyText })}
                disabled={saving}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-white hover:bg-neutral-100 text-black font-extrabold text-xs uppercase tracking-wider py-3.5 px-5 rounded-xl transition border border-neutral-300"
              >
                <Save className="w-4 h-4 text-[#fd7414]" />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={copyDocument}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-black font-extrabold text-xs uppercase tracking-wider py-3.5 px-5 rounded-xl transition border border-neutral-300"
              >
                <Copy className="w-4 h-4 text-[#fd7414]" />
                {copyLabel}
              </button>
              <button
                type="button"
                onClick={downloadPolicy}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-[#fd7414] hover:bg-[#d85904] text-white font-extrabold text-xs uppercase tracking-wider py-3.5 px-5 rounded-xl shadow-lg shadow-orange-500/25 transition active:scale-95"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            </div>
          </div>

          <textarea
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            className="my-6 p-6 sm:p-8 bg-neutral-50 rounded-2xl border border-neutral-200 font-mono text-neutral-800 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap shadow-inner min-h-[420px] w-full outline-none focus:border-[#fd7414]"
          />

          <div className="flex items-center justify-between pt-4 border-t border-neutral-200 gap-3 flex-wrap">
            <button
              type="button"
              onClick={editAgain}
              className="flex items-center gap-2 text-neutral-600 hover:text-black font-extrabold text-xs uppercase tracking-wider py-2 px-4 rounded-lg"
            >
              <ChevronLeft className="w-4 h-4" />
              Modify Inputs
            </button>
            <button
              type="button"
              onClick={resetAll}
              className="text-neutral-400 hover:text-red-500 font-extrabold text-xs uppercase tracking-wider py-2 px-4 transition"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {toast ? (
        <div className="fixed bottom-6 right-6 bg-black text-white px-5 py-3 rounded-2xl shadow-2xl border border-neutral-800 text-xs font-bold flex items-center gap-3 z-50">
          <span className="w-2.5 h-2.5 rounded-full bg-[#fd7414]" />
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
