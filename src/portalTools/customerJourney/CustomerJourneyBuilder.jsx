import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import {
  generateFinalDeliverables,
  generateStepContent,
  generateTargetPortrait,
  generateWebsiteAudit,
  sanitizeJourneyStateForSave,
} from './api.js';
import {
  getPlaceholders,
  INITIAL_STATE,
  JOURNEY_ICONS,
  journeyReducer,
  STEPS,
} from './constants.js';

const AppContext = createContext(null);
const UIContext = createContext(null);

const ACCENT = '#fd7414';

function Button({
  children,
  variant = 'primary',
  icon: Icon,
  onClick,
  disabled,
  isLoading,
  className = '',
  type = 'button',
}) {
  const base =
    'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = {
    primary:
      'bg-[#fd7414] hover:bg-[#e8680f] text-white shadow-sm focus:ring-[#fd7414]',
    secondary:
      'bg-white hover:bg-stone-50 text-stone-700 border border-stone-200 shadow-sm focus:ring-stone-500',
    ghost: 'bg-transparent hover:bg-orange-50 text-[#fd7414] focus:ring-[#fd7414]',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {isLoading ? (
        <JOURNEY_ICONS.Sparkles className="w-5 h-5 animate-spin" />
      ) : Icon ? (
        <Icon className="w-5 h-5" />
      ) : null}
      {children}
    </button>
  );
}

function FormField({ id, label, placeholder, as = 'input', helperText }) {
  const { state, dispatch } = useContext(AppContext);
  const stepId = STEPS[state.currentStep].id;
  const value = state.data[stepId].inputs[id] || '';

  const handleChange = (e) => {
    dispatch({
      type: 'UPDATE_INPUTS',
      payload: { stepId, values: { [id]: e.target.value } },
    });
  };

  const className =
    'w-full p-3.5 bg-white border border-stone-200 rounded-xl shadow-sm focus:ring-2 focus:ring-[#fd7414] focus:border-[#fd7414] transition-all text-stone-900 placeholder-stone-400 font-normal';

  return (
    <div className="mb-5">
      <label htmlFor={id} className="block text-sm font-bold text-stone-900 mb-1.5">
        {label}
      </label>
      {helperText ? <p className="text-xs text-stone-500 mb-2">{helperText}</p> : null}
      {as === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className={`${className} min-h-[110px] resize-y`}
        />
      ) : (
        <input
          type="text"
          id={id}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className={className}
        />
      )}
    </div>
  );
}

function StepLayout({ stepId, config, children, fieldsToValidate = [] }) {
  const { state, dispatch, clientId } = useContext(AppContext);
  const { showToast } = useContext(UIContext);
  const [isGenerating, setIsGenerating] = useState(false);

  const stepData = state.data[stepId];
  const businessType = state.data.target.inputs.businessType;
  const targetImage = state.data.target?.output?.imageUrl;
  const idealCustomer =
    state.data.target?.inputs?.idealCustomer || 'Your Target Audience';
  const Icon = config.icon;

  const handleGenerateClick = async () => {
    let isValid = true;
    fieldsToValidate.forEach((field) => {
      if (!stepData.inputs[field] || String(stepData.inputs[field]).trim() === '') {
        isValid = false;
      }
    });
    if (!isValid) {
      showToast('Please fill in the strategic inputs to generate your narrative.', 'error');
      return;
    }
    if (!clientId) {
      showToast('Missing client context.', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const output = await generateStepContent(clientId, {
        stepTitle: config.title,
        businessType,
        inputs: stepData.inputs,
      });
      if (!output?.mainCopy) throw new Error('Failed to generate content');

      if (stepId === 'target') {
        showToast('Creating target audience visualization…', 'info');
        try {
          const portrait = await generateTargetPortrait(clientId, {
            businessType,
            idealCustomer: stepData.inputs.idealCustomer,
            urgentDesire: stepData.inputs.urgentDesire,
          });
          if (portrait?.imageUrl) output.imageUrl = portrait.imageUrl;
          else if (portrait?.warning) {
            showToast('Narrative ready (portrait unavailable).', 'info');
          }
        } catch {
          /* portrait optional */
        }
      }

      dispatch({ type: 'UPDATE_OUTPUT', payload: { stepId, output } });
      showToast('Strategic narrative synthesized successfully!');
    } catch (error) {
      showToast(error?.message || 'Something went wrong during generation.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-8 border-b border-stone-200 pb-6 flex items-start gap-4">
        <div
          className="p-3.5 rounded-2xl shadow-sm text-white"
          style={{ backgroundColor: ACCENT }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-stone-900 tracking-tight">
            {config.title}
          </h2>
          <p className="text-sm sm:text-base text-stone-500 mt-1 font-medium">
            {config.desc}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
        <div className="space-y-6">
          <div className="bg-stone-50 p-6 sm:p-7 rounded-2xl border border-stone-200 shadow-sm">
            {stepId !== 'target' && targetImage ? (
              <div className="mb-6 bg-white p-3.5 rounded-xl border border-orange-200 shadow-sm flex items-center gap-3.5">
                <img
                  src={targetImage}
                  alt="Hero"
                  className="w-14 h-14 rounded-full object-cover border-2 border-[#fd7414] shadow-sm shrink-0"
                />
                <div className="overflow-hidden">
                  <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-[#fd7414] uppercase tracking-widest">
                    <JOURNEY_ICONS.Target className="w-3.5 h-3.5" /> Your Hero Anchor
                  </div>
                  <p className="text-stone-900 font-bold text-sm truncate mt-0.5">
                    {idealCustomer}
                  </p>
                </div>
              </div>
            ) : null}

            <h3 className="text-lg font-bold text-stone-900 mb-5 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#fd7414] text-white text-xs font-bold flex items-center justify-center shadow-sm">
                1
              </span>
              Raw Strategic Inputs
            </h3>
            {children}
            <div className="mt-8 pt-6 border-t border-stone-200">
              <Button
                onClick={handleGenerateClick}
                isLoading={isGenerating}
                icon={JOURNEY_ICONS.Sparkles}
                className="w-full text-base py-3.5 shadow-md"
              >
                {isGenerating
                  ? 'Synthesizing with AI…'
                  : 'Generate Narrative & Sound Bites'}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 sm:p-7 rounded-2xl border border-orange-200 shadow-lg shadow-orange-100/40 min-h-[420px]">
            <h3 className="text-lg font-bold text-[#c45a0f] mb-6 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-100 text-[#fd7414] text-xs flex items-center justify-center font-bold">
                <JOURNEY_ICONS.Sparkles className="w-3.5 h-3.5" />
              </span>
              AI Strategic Synthesis
            </h3>

            {!stepData.output ? (
              <div className="flex flex-col items-center justify-center h-[280px] text-center px-6 border-2 border-dashed border-stone-200 rounded-xl bg-stone-50/50">
                <div className="w-12 h-12 rounded-full bg-orange-50 text-[#fd7414] flex items-center justify-center mb-3">
                  <JOURNEY_ICONS.Sparkles className="w-6 h-6" />
                </div>
                <h4 className="text-stone-700 font-bold mb-1">
                  Awaiting Your Strategic Inputs
                </h4>
                <p className="text-stone-500 text-sm max-w-sm">
                  Complete the prompts on the left and click Generate to transform your
                  thoughts into high-converting copy.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {stepData.output.imageUrl ? (
                  <div className="mb-6">
                    <h4 className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <JOURNEY_ICONS.Target className="text-[#fd7414] w-4 h-4" /> Audience
                      Persona Portrait
                    </h4>
                    <img
                      src={stepData.output.imageUrl}
                      alt="Target Audience"
                      className="w-full h-56 object-cover rounded-xl shadow-sm border border-stone-200"
                    />
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor={`${stepId}-mainCopy`}
                    className="block text-xs font-bold uppercase tracking-wider text-stone-500 mb-2"
                  >
                    Narrative Copy Block
                  </label>
                  <textarea
                    id={`${stepId}-mainCopy`}
                    value={stepData.output.mainCopy}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_OUTPUT',
                        payload: {
                          stepId,
                          output: { ...stepData.output, mainCopy: e.target.value },
                        },
                      })
                    }
                    className="w-full p-4 bg-stone-50/80 border border-stone-200 rounded-xl shadow-inner focus:ring-2 focus:ring-[#fd7414] focus:border-[#fd7414] min-h-[170px] resize-y text-stone-800 text-base leading-relaxed"
                  />
                </div>

                {Array.isArray(stepData.output.soundBites) ? (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-3">
                      Strategic Sound Bites
                    </h4>
                    <ul className="space-y-2.5">
                      {stepData.output.soundBites.map((bite, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 p-3 bg-orange-50/40 rounded-xl border border-orange-100/80"
                        >
                          <JOURNEY_ICONS.Check className="w-5 h-5 text-[#fd7414] shrink-0 mt-0.5" />
                          <input
                            type="text"
                            value={bite}
                            onChange={(e) => {
                              const next = [...stepData.output.soundBites];
                              next[i] = e.target.value;
                              dispatch({
                                type: 'UPDATE_OUTPUT',
                                payload: {
                                  stepId,
                                  output: { ...stepData.output, soundBites: next },
                                },
                              });
                            }}
                            className="flex-1 bg-transparent text-stone-900 font-medium text-sm leading-snug border-0 focus:ring-0 p-0"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetStep() {
  const { state, dispatch } = useContext(AppContext);
  const businessType = state.data.target.inputs.businessType;
  const p = getPlaceholders(businessType).target;

  return (
    <StepLayout stepId="target" config={STEPS[0]} fieldsToValidate={['idealCustomer', 'urgentDesire']}>
      <div className="mb-6">
        <label className="block text-sm font-bold text-stone-900 mb-1">
          Primary Business Model
        </label>
        <p className="text-xs text-stone-500 mb-3">
          This toggle adapts every prompt and example across the entire journey.
        </p>
        <div className="flex bg-stone-200/80 p-1 rounded-xl">
          {['B2B', 'B2C'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() =>
                dispatch({
                  type: 'UPDATE_INPUTS',
                  payload: { stepId: 'target', values: { businessType: type } },
                })
              }
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                businessType === type
                  ? 'bg-white shadow text-[#fd7414]'
                  : 'text-stone-600 hover:bg-stone-300/60'
              }`}
            >
              {type === 'B2B' ? 'B2B (Business to Business)' : 'B2C (Business to Consumer)'}
            </button>
          ))}
        </div>
      </div>
      <FormField
        id="idealCustomer"
        label="Who is your exact ideal customer?"
        placeholder={p.idealCustomer}
      />
      <FormField
        id="urgentDesire"
        label="What is their most urgent, burning desire right now?"
        placeholder={p.urgentDesire}
        as="textarea"
      />
      <FormField
        id="triedAndTired"
        label="What have they already tried that failed them?"
        placeholder={p.triedAndTired}
        as="textarea"
      />
    </StepLayout>
  );
}

function CharacterStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).character;
  return (
    <StepLayout
      stepId="character"
      config={STEPS[1]}
      fieldsToValidate={['specificResult', 'emotionalMeaning']}
    >
      <FormField
        id="specificResult"
        label="What concrete, measurable result do they want?"
        placeholder={p.specificResult}
      />
      <FormField
        id="visualSuccess"
        label="What does that success physically look like?"
        placeholder={p.visualSuccess}
        as="textarea"
      />
      <FormField
        id="emotionalMeaning"
        label="What does achieving this mean to them emotionally?"
        placeholder={p.emotionalMeaning}
        as="textarea"
      />
    </StepLayout>
  );
}

function ProblemStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).problem;
  return (
    <StepLayout
      stepId="problem"
      config={STEPS[2]}
      fieldsToValidate={['external', 'internal', 'philosophical']}
    >
      <FormField
        id="external"
        label="External Problem (The visible, tactical obstacle)"
        placeholder={p.external}
        as="textarea"
      />
      <FormField
        id="internal"
        label="Internal Problem (How that obstacle makes them feel)"
        placeholder={p.internal}
        as="textarea"
      />
      <FormField
        id="philosophical"
        label="Philosophical Problem (Why is this situation 'just plain wrong'?)"
        placeholder={p.philosophical}
        as="textarea"
      />
    </StepLayout>
  );
}

function GuideStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).guide;
  return (
    <StepLayout stepId="guide" config={STEPS[3]} fieldsToValidate={['empathy', 'authority']}>
      <FormField
        id="empathy"
        label="Empathy Statement (How do you demonstrate genuine care?)"
        placeholder={p.empathy}
        as="textarea"
      />
      <FormField
        id="authority"
        label="Authority Proof (Proof points, numbers, track record)"
        placeholder={p.authority}
        as="textarea"
      />
      <FormField
        id="method"
        label="Your Proprietary Method or Framework Name"
        placeholder={p.method}
      />
    </StepLayout>
  );
}

function PlanStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).plan;
  return (
    <StepLayout
      stepId="plan"
      config={STEPS[4]}
      fieldsToValidate={['step1', 'step2', 'step3']}
    >
      <FormField id="step1" label="Step 1: The Initial Action" placeholder={p.step1} />
      <FormField
        id="step2"
        label="Step 2: The Core Engagement / Process"
        placeholder={p.step2}
      />
      <FormField
        id="step3"
        label="Step 3: The Resulting Transformation"
        placeholder={p.step3}
      />
    </StepLayout>
  );
}

function CtaStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).cta;
  return (
    <StepLayout stepId="cta" config={STEPS[5]} fieldsToValidate={['primary']}>
      <FormField
        id="primary"
        label="Direct Call to Action (The primary conversion button)"
        placeholder={p.primary}
      />
      <FormField
        id="secondary"
        label="Transitional Call to Action (Lead magnet, free guide)"
        placeholder={p.secondary}
      />
      <FormField
        id="commitment"
        label="The Low-Risk Commitment Guarantee"
        placeholder={p.commitment}
        as="textarea"
      />
    </StepLayout>
  );
}

function SuccessStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).success;
  return (
    <StepLayout
      stepId="success"
      config={STEPS[6]}
      fieldsToValidate={['immediateChange', 'identityShift']}
    >
      <FormField
        id="immediateChange"
        label="What immediate victory will they experience?"
        placeholder={p.immediateChange}
        as="textarea"
      />
      <FormField
        id="emotionalRelief"
        label="What emotional burden is lifted from their shoulders?"
        placeholder={p.emotionalRelief}
        as="textarea"
      />
      <FormField
        id="identityShift"
        label="Identity Shift (From who they were -> To who they become)"
        placeholder={p.identityShift}
        as="textarea"
      />
    </StepLayout>
  );
}

function FailureStep() {
  const { state } = useContext(AppContext);
  const p = getPlaceholders(state.data.target.inputs.businessType).failure;
  return (
    <StepLayout stepId="failure" config={STEPS[7]} fieldsToValidate={['doNothing']}>
      <FormField
        id="doNothing"
        label="What happens if they do absolutely nothing?"
        placeholder={p.doNothing}
        as="textarea"
      />
      <FormField
        id="missedOpportunity"
        label="What specific opportunities will they miss out on?"
        placeholder={p.missedOpportunity}
      />
      <FormField
        id="emotionalToll"
        label="What is the continuous emotional toll of staying stuck?"
        placeholder={p.emotionalToll}
        as="textarea"
      />
    </StepLayout>
  );
}

function FinalView() {
  const { state, dispatch, clientId, client } = useContext(AppContext);
  const { showToast } = useContext(UIContext);
  const [isGenerating, setIsGenerating] = useState(false);
  const [auditUrl, setAuditUrl] = useState(client?.website || '');
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditData, setAuditData] = useState(state.data.final?.output?.audit || null);

  const data = state.data;
  const finalOutput = data.final?.output
    ? {
        tagline: data.final.output.tagline,
        elevatorPitch: data.final.output.elevatorPitch,
        cohesiveStory: data.final.output.cohesiveStory,
      }
    : null;
  const targetImage = data.target?.output?.imageUrl;
  const targetCustomer = data.target?.inputs?.idealCustomer || 'Your Ideal Customer';
  const allSoundBites = STEPS.slice(0, 8).flatMap(
    (step) => data[step.id]?.output?.soundBites || [],
  );

  const handleGenerateFinal = async () => {
    setIsGenerating(true);
    try {
      const sections = STEPS.slice(0, 8)
        .map((step) => {
          const output = data[step.id]?.output?.mainCopy || 'Not completed';
          return `--- ${step.title} ---\n${output}`;
        })
        .join('\n\n');
      const output = await generateFinalDeliverables(clientId, sections);
      if (!output) throw new Error('Empty output');
      dispatch({
        type: 'UPDATE_OUTPUT',
        payload: {
          stepId: 'final',
          output: { ...output, audit: auditData || null },
        },
      });
      showToast('Customer Journey finalized!');
    } catch (e) {
      showToast(e?.message || 'Failed to generate final deliverables.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (!finalOutput?.tagline) {
      return showToast('Please generate the final deliverables first.', 'error');
    }
    const textToCopy = `CUSTOMER JOURNEY FRAMEWORK\n----------------------\n\nTAGLINE:\n${finalOutput.tagline}\n\nELEVATOR PITCH:\n${finalOutput.elevatorPitch}\n\nCOHESIVE JOURNEY NARRATIVE:\n${finalOutput.cohesiveStory}\n\nSOUND BITES:\n${allSoundBites.map((b) => `- ${b}`).join('\n')}`.trim();
    navigator.clipboard.writeText(textToCopy);
    showToast('Full Journey copied to clipboard!');
  };

  const handlePrint = () => {
    if (!finalOutput?.tagline) {
      return showToast('Please generate the final deliverables first.', 'error');
    }
    window.print();
  };

  const handleAudit = async () => {
    if (!auditUrl || !String(auditUrl).includes('.')) {
      return showToast('Please enter a valid URL (e.g. https://yoursite.com).', 'error');
    }
    if (!finalOutput?.tagline) {
      return showToast('Generate final deliverables before running an audit.', 'error');
    }
    setIsAuditing(true);
    try {
      showToast('Fetching page and running AI audit…', 'info');
      const auditResult = await generateWebsiteAudit(clientId, {
        framework: finalOutput,
        url: auditUrl,
      });
      setAuditData(auditResult);
      dispatch({
        type: 'UPDATE_OUTPUT',
        payload: {
          stepId: 'final',
          output: { ...data.final.output, audit: auditResult },
        },
      });
      showToast('Webpage audit complete!');
    } catch (err) {
      showToast(err?.message || 'Unable to audit that URL.', 'error');
    } finally {
      setIsAuditing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 pb-16">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-stone-900 flex items-center gap-3">
            <JOURNEY_ICONS.Sparkles className="text-[#fd7414] w-7 h-7" /> Your Customer
            Journey Assets
          </h2>
          <p className="text-sm sm:text-base text-stone-500 mt-1 font-medium">
            Cohesive AI narrative, deliverables, and CRO toolkit.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            icon={JOURNEY_ICONS.Copy}
            onClick={copyToClipboard}
            disabled={!finalOutput?.tagline}
          >
            Copy All
          </Button>
          <Button
            variant="primary"
            icon={JOURNEY_ICONS.Download}
            onClick={handlePrint}
            disabled={!finalOutput?.tagline}
          >
            Save PDF / Print
          </Button>
        </div>
      </div>

      {!finalOutput?.tagline ? (
        <div className="p-10 sm:p-12 text-center flex flex-col items-center justify-center border-2 border-dashed border-orange-200 bg-orange-50/40 rounded-3xl">
          <div className="w-16 h-16 rounded-full bg-orange-100 text-[#fd7414] flex items-center justify-center mb-4 shadow-sm">
            <JOURNEY_ICONS.Sparkles className="w-8 h-8" />
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-stone-900 mb-2">
            Ready to Synthesize Your Master Journey
          </h3>
          <p className="text-stone-600 max-w-lg mb-8 leading-relaxed text-sm sm:text-base">
            Harmonize every step into your Tagline, Elevator Pitch, and Complete Journey
            Narrative.
          </p>
          <Button
            onClick={handleGenerateFinal}
            isLoading={isGenerating}
            icon={JOURNEY_ICONS.Sparkles}
            className="text-base px-8 py-4 shadow-lg"
          >
            {isGenerating ? 'Synthesizing…' : 'Generate Final Deliverables'}
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {targetImage ? (
            <div className="relative w-full h-56 sm:h-72 rounded-3xl overflow-hidden shadow-lg border border-stone-200">
              <img
                src={targetImage}
                alt="Target Audience Hero"
                className="w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/40 to-transparent flex flex-col justify-end p-6 sm:p-10">
                <span className="text-xs font-bold text-orange-400 mb-1.5 uppercase tracking-widest flex items-center gap-2">
                  <JOURNEY_ICONS.Target className="w-4 h-4" /> The Hero of This Journey
                </span>
                <p className="text-xl sm:text-3xl font-extrabold text-white leading-tight">
                  {targetCustomer}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 md:col-span-1 bg-gradient-to-br from-[#fd7414] to-[#c2410c] text-white rounded-2xl shadow-lg flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-orange-100 mb-2 uppercase tracking-widest">
                  Brand Tagline
                </h3>
                <p className="text-xl font-extrabold leading-snug">
                  &ldquo;{finalOutput.tagline}&rdquo;
                </p>
              </div>
            </div>
            <div className="p-6 md:col-span-2 bg-white border-t-4 border-t-[#fd7414] rounded-2xl shadow-md border border-stone-200/80">
              <h3 className="text-xs font-bold text-stone-500 mb-2 uppercase tracking-widest">
                3-Sentence Elevator Pitch
              </h3>
              <p className="text-base sm:text-lg text-stone-800 leading-relaxed">
                {finalOutput.elevatorPitch}
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-8 bg-white border border-stone-200 rounded-2xl shadow-md">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-stone-100 gap-3 flex-wrap">
              <h3 className="text-xl sm:text-2xl font-extrabold text-stone-900">
                Cohesive Journey Narrative
              </h3>
              <Button
                variant="ghost"
                icon={JOURNEY_ICONS.Sparkles}
                onClick={handleGenerateFinal}
                isLoading={isGenerating}
              >
                Regenerate
              </Button>
            </div>
            <div className="text-stone-700 leading-relaxed whitespace-pre-wrap text-base">
              {finalOutput.cohesiveStory}
            </div>
          </div>

          {allSoundBites.length > 0 ? (
            <div className="p-6 sm:p-8 bg-stone-50 border border-stone-200 rounded-2xl shadow-sm">
              <h3 className="text-xl font-extrabold text-stone-900 mb-5">
                Strategic Sound Bites for Ads & Social
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {allSoundBites.map((bite, i) => (
                  <div
                    key={i}
                    className="bg-white p-4 rounded-xl shadow-sm border border-stone-200 flex items-start gap-3"
                  >
                    <JOURNEY_ICONS.Check className="w-5 h-5 text-[#fd7414] shrink-0 mt-0.5" />
                    <span className="text-sm text-stone-800 font-semibold leading-snug">
                      &ldquo;{bite}&rdquo;
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="p-6 sm:p-8 bg-white border border-stone-200 rounded-2xl shadow-md">
            <div className="flex items-center gap-3.5 mb-6 pb-4 border-b border-stone-100">
              <div className="p-3 bg-orange-100 text-[#fd7414] rounded-xl">
                <JOURNEY_ICONS.Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-stone-900">
                  Landing Page Journey Analyzer
                </h3>
                <p className="text-stone-500 text-sm">
                  Audit a live URL against your new framework.
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 mb-8">
              <div className="flex-1 relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-stone-400">
                  <JOURNEY_ICONS.Search className="w-5 h-5" />
                </div>
                <input
                  type="url"
                  value={auditUrl}
                  onChange={(e) => setAuditUrl(e.target.value)}
                  placeholder="https://yoursite.com"
                  className="w-full pl-12 pr-4 py-4 bg-stone-50 border border-stone-200 rounded-xl shadow-inner focus:ring-2 focus:ring-[#fd7414] focus:border-[#fd7414] transition-all text-stone-800 font-medium"
                />
              </div>
              <Button
                onClick={handleAudit}
                isLoading={isAuditing}
                icon={JOURNEY_ICONS.Sparkles}
                className="py-4 px-8 whitespace-nowrap shadow-md"
              >
                {isAuditing ? 'Auditing…' : 'Run Journey Audit'}
              </Button>
            </div>

            {auditData ? (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row items-center gap-6 bg-stone-50 p-6 rounded-2xl border border-stone-200">
                  <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-white shadow-md border-4 border-orange-100 shrink-0">
                    <span className="text-3xl font-black text-[#fd7414]">
                      {auditData.score}
                    </span>
                    <span className="absolute -bottom-2 bg-stone-900 text-white text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full">
                      Score
                    </span>
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-stone-900 mb-1">
                      Executive Assessment
                    </h4>
                    <p className="text-stone-600 text-sm leading-relaxed">
                      {auditData.summary}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white border border-orange-200/80 p-6 rounded-2xl shadow-sm">
                    <h4 className="text-xs font-bold text-[#fd7414] uppercase tracking-widest mb-3">
                      Narrative Alignment
                    </h4>
                    <p className="text-stone-700 text-sm leading-relaxed">
                      {auditData.journeyFeedback}
                    </p>
                  </div>
                  <div className="bg-white border border-orange-200/80 p-6 rounded-2xl shadow-sm">
                    <h4 className="text-xs font-bold text-[#fd7414] uppercase tracking-widest mb-3">
                      SEO & Heading Hierarchy
                    </h4>
                    <p className="text-stone-700 text-sm leading-relaxed">
                      {auditData.seoFeedback}
                    </p>
                  </div>
                </div>

                <div className="bg-stone-900 text-white p-6 sm:p-7 rounded-2xl shadow-lg">
                  <h4 className="text-xs font-bold text-orange-400 uppercase tracking-widest mb-4">
                    Action Plan
                  </h4>
                  <ul className="space-y-3">
                    {(auditData.actionItems || []).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#fd7414] text-white text-xs font-bold shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="text-stone-200 text-sm leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const STEP_COMPONENTS = [
  TargetStep,
  CharacterStep,
  ProblemStep,
  GuideStep,
  PlanStep,
  CtaStep,
  SuccessStep,
  FailureStep,
  FinalView,
];

/**
 * Portal Tools mini-app. Props from ClientPortalToolsPanel:
 * { client, user, save, load, savedData, saving }
 */
export default function CustomerJourneyBuilder({
  client,
  save,
  savedData,
  saving,
}) {
  const [state, dispatch] = useReducer(journeyReducer, INITIAL_STATE);
  const [toast, setToast] = useState(null);
  const hydratedRef = useRef(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    if (hydratedRef.current) return;
    if (savedData && typeof savedData === 'object') {
      dispatch({ type: 'HYDRATE', payload: savedData });
      hydratedRef.current = true;
    } else if (savedData === null) {
      hydratedRef.current = true;
    }
  }, [savedData]);

  const handleSave = async () => {
    if (!save) return;
    try {
      await save(sanitizeJourneyStateForSave(state), {
        title: 'Customer Journey',
      });
      showToast('Saved to your portal.');
    } catch (err) {
      showToast(err?.message || 'Could not save.', 'error');
    }
  };

  const handleNext = () =>
    dispatch({
      type: 'SET_STEP',
      payload: Math.min(state.currentStep + 1, STEPS.length - 1),
    });
  const handlePrev = () =>
    dispatch({
      type: 'SET_STEP',
      payload: Math.max(state.currentStep - 1, 0),
    });

  const CurrentStepComponent = STEP_COMPONENTS[state.currentStep];

  return (
    <AppContext.Provider
      value={{ state, dispatch, clientId: client?.id, client }}
    >
      <UIContext.Provider value={{ showToast }}>
        <div className="flex flex-col md:flex-row h-[min(78vh,860px)] bg-stone-100 text-stone-900 rounded-2xl overflow-hidden border border-stone-200 shadow-sm">
          <aside className="w-full md:w-72 bg-white border-b md:border-b-0 md:border-r border-stone-200 flex flex-col shrink-0 max-h-48 md:max-h-none">
            <div className="p-5 border-b border-stone-100 bg-stone-50/80 flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Ignite"
                className="h-9 w-auto object-contain shrink-0"
              />
              <div className="min-w-0">
                <h1 className="font-black text-base text-stone-900 tracking-tight truncate">
                  Journey Builder
                </h1>
                <p className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">
                  Ignite Strategy Tool
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1 hidden md:block">
              {STEPS.map((step, index) => {
                const isActive = state.currentStep === index;
                const isCompleted = state.data[step.id]?.output != null;
                const Icon = step.icon;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => dispatch({ type: 'SET_STEP', payload: index })}
                    className={`w-full text-left p-2.5 rounded-xl flex items-center gap-2.5 transition-all ${
                      isActive
                        ? 'bg-orange-50 text-[#c45a0f] shadow-sm border border-orange-200'
                        : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900 border border-transparent'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg ${
                        isActive
                          ? 'bg-orange-100 text-[#fd7414]'
                          : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-xs flex-1">{step.title}</span>
                    {isCompleted && !isActive ? (
                      <JOURNEY_ICONS.Check className="text-[#fd7414] w-4 h-4 shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-h-0 relative">
            <header className="bg-white border-b border-stone-200 p-3 sm:p-4 flex justify-between items-center gap-2 shrink-0">
              <div className="flex-1 flex justify-center items-center gap-1.5 min-w-0">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded-full transition-all ${
                      i === state.currentStep
                        ? 'w-7 bg-[#fd7414]'
                        : i < state.currentStep
                          ? 'w-2 bg-orange-300'
                          : 'w-2 bg-stone-200'
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="secondary"
                  icon={Save}
                  onClick={handleSave}
                  isLoading={saving}
                  className="px-3 py-2 text-xs sm:text-sm"
                >
                  Save
                </Button>
                <Button
                  variant="secondary"
                  icon={ChevronLeft}
                  onClick={handlePrev}
                  disabled={state.currentStep === 0}
                  className="px-3 py-2 text-sm"
                >
                  Prev
                </Button>
                <Button
                  variant="primary"
                  icon={ChevronRight}
                  onClick={handleNext}
                  disabled={state.currentStep === STEPS.length - 1}
                  className="px-3 py-2 text-sm"
                >
                  Next
                </Button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto">
              <CurrentStepComponent />
            </div>

            {toast ? (
              <div className="absolute bottom-4 right-4 z-50">
                <div
                  className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-xl border ${
                    toast.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : toast.type === 'info'
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  }`}
                >
                  <span className="font-bold text-sm">{toast.message}</span>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      </UIContext.Provider>
    </AppContext.Provider>
  );
}
