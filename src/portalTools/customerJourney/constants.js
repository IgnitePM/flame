import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Flag,
  Globe,
  Heart,
  Map,
  Search,
  Skull,
  Sparkles,
  Target,
  Trophy,
  Users,
} from 'lucide-react';

export const STEPS = [
  {
    id: 'target',
    title: 'Target Audience',
    icon: Users,
    desc: 'Define your audience. Specificity is key.',
  },
  {
    id: 'character',
    title: 'Core Desire',
    icon: Target,
    desc: 'Clarify what the customer wants in emotional terms.',
  },
  {
    id: 'problem',
    title: 'The Obstacle',
    icon: AlertTriangle,
    desc: 'Define the 3 layers of conflict holding them back.',
  },
  {
    id: 'guide',
    title: 'The Mentor',
    icon: Heart,
    desc: 'Position your brand as the empathetic, authoritative mentor.',
  },
  {
    id: 'plan',
    title: 'The Roadmap',
    icon: Map,
    desc: 'Provide a simple 3-step plan to reduce overwhelm.',
  },
  {
    id: 'cta',
    title: 'The Catalyst',
    icon: Flag,
    desc: 'Make action obvious, bold, and low-risk.',
  },
  {
    id: 'success',
    title: 'The Victory',
    icon: Trophy,
    desc: 'Make the transformation vivid and compelling.',
  },
  {
    id: 'failure',
    title: 'The Stakes',
    icon: Skull,
    desc: 'Create stakes. What happens if they do nothing?',
  },
  {
    id: 'final',
    title: 'Final Deliverables',
    icon: Sparkles,
    desc: 'Review your cohesive narrative, deliverables & audit.',
  },
];

export const JOURNEY_ICONS = {
  Sparkles,
  Check: CheckCircle2,
  Copy,
  Download,
  Globe,
  Search,
  Alert: AlertTriangle,
  Target,
};

export const INITIAL_STATE = {
  currentStep: 0,
  data: {
    target: {
      inputs: {
        businessType: 'B2B',
        idealCustomer: '',
        urgentDesire: '',
        triedAndTired: '',
      },
      output: null,
    },
    character: {
      inputs: { specificResult: '', visualSuccess: '', emotionalMeaning: '' },
      output: null,
    },
    problem: {
      inputs: { external: '', internal: '', philosophical: '' },
      output: null,
    },
    guide: {
      inputs: { empathy: '', authority: '', method: '' },
      output: null,
    },
    plan: {
      inputs: { step1: '', step2: '', step3: '' },
      output: null,
    },
    cta: {
      inputs: { primary: '', secondary: '', commitment: '' },
      output: null,
    },
    success: {
      inputs: { immediateChange: '', emotionalRelief: '', identityShift: '' },
      output: null,
    },
    failure: {
      inputs: { doNothing: '', missedOpportunity: '', emotionalToll: '' },
      output: null,
    },
    final: { output: null },
  },
};

export function journeyReducer(state, action) {
  switch (action.type) {
    case 'HYDRATE': {
      const incoming = action.payload;
      if (!incoming || typeof incoming !== 'object') return state;
      return {
        ...INITIAL_STATE,
        ...incoming,
        data: {
          ...INITIAL_STATE.data,
          ...(incoming.data || {}),
        },
        currentStep: Math.max(
          0,
          Math.min(
            STEPS.length - 1,
            Number(incoming.currentStep) || 0,
          ),
        ),
      };
    }
    case 'SET_STEP':
      return { ...state, currentStep: action.payload };
    case 'UPDATE_INPUTS':
      return {
        ...state,
        data: {
          ...state.data,
          [action.payload.stepId]: {
            ...state.data[action.payload.stepId],
            inputs: {
              ...state.data[action.payload.stepId].inputs,
              ...action.payload.values,
            },
          },
        },
      };
    case 'UPDATE_OUTPUT':
      return {
        ...state,
        data: {
          ...state.data,
          [action.payload.stepId]: {
            ...state.data[action.payload.stepId],
            output: action.payload.output,
          },
        },
      };
    default:
      return state;
  }
}

export function getPlaceholders(type) {
  const isB2B = type === 'B2B';
  return {
    target: {
      idealCustomer: isB2B
        ? 'e.g., B2B SaaS Founders scaling from $1M to $5M ARR'
        : 'e.g., Busy working parents looking for healthy weeknight family dinners',
      urgentDesire: isB2B
        ? 'e.g., A predictable, automated customer acquisition engine'
        : 'e.g., Nutritious, stress-free meals on the table in under 20 minutes',
      triedAndTired: isB2B
        ? 'e.g., Costly lead-gen agencies that deliver unqualified ghost leads'
        : 'e.g., Complex grocery plans that take 4 hours of prep on Sundays',
    },
    character: {
      specificResult: isB2B
        ? 'e.g., 25 qualified demos booked every month on autopilot'
        : 'e.g., A reliable 5-day weeknight dinner rotation the kids love',
      visualSuccess: isB2B
        ? 'e.g., A live CRM dashboard showing predictable green pipeline growth'
        : 'e.g., Clean plates, happy kids, and zero 5 PM dinner panic',
      emotionalMeaning: isB2B
        ? 'e.g., True confidence that the business can scale without burnout'
        : 'e.g., The peace of mind of feeling like a present, capable parent',
    },
    problem: {
      external: isB2B
        ? 'e.g., Unpredictable pipeline and inconsistent month-to-month revenue'
        : 'e.g., Exhaustion and zero energy to plan meals after a 9-hour workday',
      internal: isB2B
        ? 'e.g., Anxiety that the entire sales process depends solely on you'
        : 'e.g., Lingering guilt over ordering greasy takeout three nights a week',
      philosophical: isB2B
        ? "e.g., Exceptional founders shouldn't have to suffer from feast-or-famine growth."
        : "e.g., Nourishing your family shouldn't require a culinary degree or endless time.",
    },
    guide: {
      empathy: isB2B
        ? "e.g., We know what it feels like to pour your heart into a product that isn't getting seen."
        : 'e.g., We know how draining the daily dinner scramble can be when life is moving fast.',
      authority: isB2B
        ? "e.g., We've helped over 80 high-growth companies generate $45M+ in pipeline."
        : 'e.g., Formulated by pediatric nutritionists and trusted by 25,000+ families.',
      method: isB2B
        ? "e.g., The 'Ignite Growth Engine' Playbook."
        : "e.g., The '20-Minute Kitchen' Blueprint.",
    },
    plan: {
      step1: isB2B
        ? 'e.g., Schedule a 20-minute Growth Blueprint Call.'
        : 'e.g., Take the 2-minute family taste & dietary quiz.',
      step2: isB2B
        ? 'e.g., We install your tailored multi-channel acquisition funnel.'
        : 'e.g., Receive chef-crafted, pre-portioned ingredients at your door.',
      step3: isB2B
        ? 'e.g., Watch your pipeline scale with qualified buyers.'
        : 'e.g., Enjoy healthy, delicious dinners in under 20 minutes.',
    },
    cta: {
      primary: isB2B ? 'e.g., Claim Your Growth Audit' : 'e.g., Start Your 14-Day Free Trial',
      secondary: isB2B
        ? 'e.g., Download the 2026 SaaS Pipeline Playbook'
        : "e.g., Get the '5 Fast Family Dinners' Free Recipe Pack",
      commitment: isB2B
        ? 'e.g., Just a 15-minute diagnostic. No high-pressure pitch.'
        : 'e.g., Cancel anytime with a single click. Zero commitment.',
    },
    success: {
      immediateChange: isB2B
        ? 'e.g., 8-12 qualified sales calls on your calendar in the first 14 days.'
        : 'e.g., Groceries delivered, meals pre-planned, zero grocery store lines.',
      emotionalRelief: isB2B
        ? "e.g., Sleeping soundly knowing next quarter's revenue targets are safe."
        : 'e.g., Deep relief knowing your family is thriving on clean, healthy food.',
      identityShift: isB2B
        ? 'e.g., From an overworked founder to an empowered, visionary CEO.'
        : 'e.g., From an overwhelmed cook to the relaxed, confident family hero.',
    },
    failure: {
      doNothing: isB2B
        ? 'e.g., You will remain stuck on the revenue rollercoaster while competitors take market share.'
        : "e.g., You'll keep spending $600/month on unhealthy takeout and feeling exhausted.",
      missedOpportunity: isB2B
        ? 'e.g., Missing your target exit window or having to cut headcount.'
        : 'e.g., Missing out on calm, connected evening conversations with your kids.',
      emotionalToll: isB2B
        ? 'e.g., Constant Sunday-evening dread looking at an empty pipeline.'
        : 'e.g., The chronic background stress of feeling perpetually disorganized.',
    },
  };
}
