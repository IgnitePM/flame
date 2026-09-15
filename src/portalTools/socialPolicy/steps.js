import {
  AlertTriangle,
  BookOpen,
  Eye,
  Grid2x2,
  MessageCircle,
  Shield,
  Smartphone,
  Users,
} from 'lucide-react';

export const POLICY_STEPS = [
  {
    id: 'basics',
    title: 'Company & Platforms',
    subtitle: 'Core organization profile and target channels',
    guidance:
      'Detailed guidance on how each channel should be used prevents practical errors. Probing Questions: What is the specific frequency for LinkedIn vs Instagram? What types of content perform best on each? How do we securely handle account login details?',
    icon: Grid2x2,
    fields: [
      {
        key: 'companyName',
        label: 'Company Name',
        type: 'text',
        placeholder: 'e.g. Acme Corporation',
      },
      {
        key: 'industry',
        label: 'Industry Sector',
        type: 'text',
        placeholder: 'e.g. Fintech, Healthcare, SaaS',
      },
      {
        key: 'primaryChannels',
        label: 'Primary Social Channels',
        type: 'text',
        placeholder: 'e.g. LinkedIn, Instagram, X (Twitter), YouTube',
      },
      {
        key: 'loginManagement',
        label: 'Account Login & Credential Security',
        type: 'text',
        placeholder: 'e.g. Centralized 1Password vault with mandatory 2FA',
      },
    ],
  },
  {
    id: 'training',
    title: '1. Training & Adherence',
    subtitle: 'Empowering staff and eliminating accidental posts',
    guidance:
      'Step-by-step instructions help prevent accidental posting. Probing Questions: Do we use a "sandbox" or staging environment for new hires? Is there a checklist employees must follow before every post?',
    icon: BookOpen,
    fields: [
      {
        key: 'trainingFrequency',
        label: 'Training Frequency',
        type: 'select',
        options: [
          'Quarterly mandatory workshops',
          'Monthly refresher sessions',
          'Bi-annually during review cycles',
          'Annual compliance briefing',
        ],
      },
      {
        key: 'safetyChecklist',
        label: 'Pre-Posting Protocols & Staging',
        type: 'textarea',
        placeholder:
          'e.g. Mandatory staging in Sprout Social; two-set-of-eyes rule for brand announcements; verification of personal vs corporate profile.',
      },
    ],
  },
  {
    id: 'roles',
    title: '2. Roles & Responsibilities',
    subtitle: 'Authorization paths and editorial hierarchies',
    guidance:
      'Define who has the authority to speak. Probing Questions: If a department lead wants a post, what is the exact sign-off path? Who is the backup if the primary admin is unavailable?',
    icon: Users,
    fields: [
      {
        key: 'contentRoles',
        label: 'Content Creation vs Sign-off Roles',
        type: 'textarea',
        placeholder:
          'e.g. Social Team authors copy; Marketing Director signs off; Legal reviews high-risk claims.',
      },
      {
        key: 'approvalPath',
        label: 'Standard Approval Workflow',
        type: 'textarea',
        placeholder:
          'e.g. Notion editorial calendar -> Slack notification -> Final approval in CMS 24h before scheduling.',
      },
    ],
  },
  {
    id: 'monitoring',
    title: '3. Social Listening & Monitoring',
    subtitle: 'Sentiment tracking and off-hours coverage',
    guidance:
      'Probing Questions: Are we tracking brand sentiment or just direct mentions? Who monitors during out-of-office hours or public holidays?',
    icon: Eye,
    fields: [
      {
        key: 'monitoringFrequency',
        label: 'Active Monitoring Cadence',
        type: 'select',
        options: [
          'Real-time continuous alerting',
          'Daily scheduled check-ins (Morning & Evening)',
          'Weekly review cycles',
        ],
      },
      {
        key: 'monitoringTools',
        label: 'Tooling & Sentiment Strategy',
        type: 'text',
        placeholder:
          'e.g. Brandwatch, Mention, Google Alerts; tracking brand name & product keywords.',
      },
    ],
  },
  {
    id: 'tone',
    title: '4. Tone & Disclosures (State Interests)',
    subtitle: 'Authenticity, voice, and transparent employee affiliations',
    guidance:
      'State Interests: Employees must make their connection to the brand clear. Probing Questions: Do we require "Opinions are my own" in personal bios? How should employees disclose positive reviews of our products?',
    icon: MessageCircle,
    fields: [
      {
        key: 'brandVoice',
        label: 'Brand Voice & Tone Standard',
        type: 'textarea',
        placeholder:
          'e.g. Professional, authoritative, empathetic, with zero snark or defensive retorts.',
      },
      {
        key: 'stateInterestsRules',
        label: 'Mandatory Affiliation & Endorsement Disclosures',
        type: 'textarea',
        placeholder:
          'e.g. Mandatory "Views expressed are my own" in public profiles; staff must tag #Employee or #CompanyAdvocate when endorsing products.',
      },
      {
        key: 'prohibitedTopics',
        label: 'Strictly Prohibited Subjects',
        type: 'textarea',
        placeholder:
          'e.g. Unreleased roadmaps, financial metrics, non-public client rosters, political polarization.',
      },
    ],
  },
  {
    id: 'moderation',
    title: '5. Moderation & Community Rules',
    subtitle: 'Handling trolls, spam, and customer service inquiries',
    guidance:
      'Community management boundaries. Probing Questions: How do we engage with "trolls" vs. legitimate complaints? What is the maximum allowed response time for a customer inquiry?',
    icon: Shield,
    fields: [
      {
        key: 'moderationStyle',
        label: 'Public Moderation Posture',
        type: 'select',
        options: [
          'Active Engagement (Respond transparently to all queries)',
          'Selective Defense (Address factual claims, ignore bad-faith bait)',
          'Strict Filtering (Block slurs, hide offensive profanity automatically)',
        ],
      },
      {
        key: 'communityRules',
        label: 'Response Guidelines & Maximum SLAs',
        type: 'textarea',
        placeholder:
          'e.g. Acknowledge customer complaints in under 2 hours; move sensitive disputes to direct messages or support tickets.',
      },
    ],
  },
  {
    id: 'escalation',
    title: '6. Crisis & Escalation Protocol',
    subtitle: 'Thresholds for crises and rapid chain-of-command',
    guidance:
      'Clear guidance on when to escalate is vital. Probing Questions: At what number of negative comments does an "issue" become a "crisis"? Do comments from influencers or journalists trigger immediate escalation? What is the timeframe for an initial response during a crisis?',
    icon: AlertTriangle,
    fields: [
      {
        key: 'escalationLead',
        label: 'Designated Crisis Commander',
        type: 'text',
        placeholder: 'e.g. Head of Public Relations / Chief Communications Officer',
      },
      {
        key: 'crisisTriggers',
        label: 'Specific Trigger Thresholds',
        type: 'textarea',
        placeholder:
          'e.g. Inquiries from tier-1 journalists; verified accounts (>50k followers); surges exceeding 20 negative mentions/hour.',
      },
      {
        key: 'firstHourProtocol',
        label: 'Immediate 60-Minute Crisis Protocol',
        type: 'textarea',
        placeholder:
          'e.g. Pause all scheduled marketing posts; convene rapid-response council; draft holding statement within 45 minutes.',
      },
    ],
  },
  {
    id: 'personal',
    title: '7. Personal Use & Workplace Devices',
    subtitle: 'Personal activity, company computers, and HR integration',
    guidance:
      'Policy must cover workplace behavior. Probing Questions: Is personal social media allowed on work computers? Does the policy apply to personal accounts that "tag" or mention the company? What are the consequences for workplace distractions?',
    icon: Smartphone,
    fields: [
      {
        key: 'personalUseHours',
        label: 'Personal Use During Work Hours',
        type: 'select',
        options: [
          'Incidental and minimal personal use allowed during breaks',
          'Strictly prohibited during contracted working hours',
          'Permitted within discretionary common-sense limits',
        ],
      },
      {
        key: 'workDeviceRules',
        label: 'Company-Owned Laptop & Phone Expectations',
        type: 'textarea',
        placeholder:
          'e.g. Personal social accounts must not be logged in on company devices without VPN; no company material or screens photographed.',
      },
      {
        key: 'hrIntegration',
        label: 'Contractual Enforcement & Disciplinary Link',
        type: 'textarea',
        placeholder:
          'e.g. Breach constitutes violation of Section 8 in the Employee Handbook and may result in formal disciplinary action up to termination.',
      },
    ],
  },
];

export function createEmptyFormData() {
  const data = {};
  POLICY_STEPS.forEach((step) => {
    step.fields.forEach((field) => {
      data[field.key] = field.type === 'select' ? field.options[0] : '';
    });
  });
  return data;
}

export function buildPolicyDocument(formData) {
  const company = formData.companyName || 'The Organization';
  const industry = formData.industry || 'General Business';
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `================================================================================
           COMPREHENSIVE SOCIAL MEDIA GOVERNANCE POLICY
================================================================================
Organization: ${company}
Industry:     ${industry}
Issued Date:  ${date}
Framework:    Operational Risk, Personal Conduct & Platform Governance

--------------------------------------------------------------------------------
1. EXECUTIVE SUMMARY & OBJECTIVE
--------------------------------------------------------------------------------
This Social Media Policy establishes formal guidelines for official representation,
content production, personal usage, and crisis mitigation. Adherence protects
${company}'s brand integrity and proprietary assets while empowering legitimate
advocacy across public digital channels.

--------------------------------------------------------------------------------
2. PLATFORM GOVERNANCE & ACCESS CONTROL
--------------------------------------------------------------------------------
- Authorized Primary Channels:
  ${formData.primaryChannels || 'Official corporate profiles as registered with Marketing.'}

- Credential & Access Management:
  ${formData.loginManagement || 'Credentials are restricted to designated admins via secure enterprise vaults.'}

- Platform Execution & Security:
  Team members must verify active profile switching prior to publishing to eliminate
  accidental posting between personal and organizational accounts.

--------------------------------------------------------------------------------
3. TRAINING & ERROR-PREVENTION CHECKLISTS
--------------------------------------------------------------------------------
- Training Cadence:
  ${formData.trainingFrequency || 'Mandatory on-boarding and scheduled annual reviews.'}

- Safety Protocols & Pre-Posting Controls:
  ${formData.safetyChecklist || 'All public posts require proofreading, peer verification, and previewing in staging tools.'}

--------------------------------------------------------------------------------
4. ROLES, RESPONSIBILITIES & APPROVAL WORKFLOW
--------------------------------------------------------------------------------
- Content Ownership & Delegation:
  ${formData.contentRoles || 'Content created by authorized media managers and approved by department heads.'}

- Editorial Sign-off Path:
  ${formData.approvalPath || 'All outbound campaigns must receive verified authorization before scheduling.'}

--------------------------------------------------------------------------------
5. SOCIAL LISTENING & SENTIMENT MONITORING
--------------------------------------------------------------------------------
- Monitoring Cadence:
  ${formData.monitoringFrequency || 'Continuous alert monitoring during work hours.'}

- Tooling & Sentiment Strategy:
  ${formData.monitoringTools || 'Listening software utilized to track direct mentions, competitors, and sentiment trends.'}

--------------------------------------------------------------------------------
6. BRAND VOICE & DISCLOSURES ("STATE INTERESTS")
--------------------------------------------------------------------------------
- Brand Tone of Voice:
  ${formData.brandVoice || 'Professional, authoritative, transparent, and respectful across all forums.'}

- Employee Affiliation Disclosures (FTC Compliance):
  ${formData.stateInterestsRules || 'Staff referencing company products or competitors must disclose their employment affiliation (e.g., #Employee, #TeamMember) and state that personal views do not represent the brand.'}

- Prohibited Content & Blacklisted Themes:
  ${formData.prohibitedTopics || 'Classified customer data, financial forecasts, trade secrets, harassment, or defamatory remarks.'}

--------------------------------------------------------------------------------
7. COMMUNITY MANAGEMENT & MODERATION
--------------------------------------------------------------------------------
- Moderation Style:
  ${formData.moderationStyle || 'Active engagement with high-quality responses.'}

- Engagement Rules & SLAs:
  ${formData.communityRules || 'Public inquiries must receive standard resolution or acknowledgment within specified response targets.'}

--------------------------------------------------------------------------------
8. CRISIS ESCALATION PROTOCOL
--------------------------------------------------------------------------------
- Designated Escalation Lead:
  ${formData.escalationLead || 'Head of Corporate Communications / Executive Director.'}

- Crisis Trigger Thresholds:
  ${formData.crisisTriggers || 'High-volume sentiment drops, inquiries from journalists, or viral complaints from verified accounts.'}

- First 60-Minute Response Plan:
  ${formData.firstHourProtocol || 'Immediately notify command council, suspend active marketing schedules, and deploy pre-approved holding statements.'}

--------------------------------------------------------------------------------
9. PERSONAL USE IN THE WORKPLACE & WORK DEVICES
--------------------------------------------------------------------------------
- Personal Social Media at Work:
  ${formData.personalUseHours || 'Limited incidental use during rest periods only.'}

- Expectations on Company-Owned Hardware:
  ${formData.workDeviceRules || 'Devices remain property of the organization; personal activity must respect corporate IT security policies.'}

- Disciplinary & Contractual Integration:
  ${formData.hrIntegration || 'Violations of this policy will be reviewed under standard company disciplinary proceedings up to and including termination.'}

================================================================================
ACKNOWLEDGED AND INCORPORATED INTO THE EMPLOYEE HANDBOOK.
================================================================================`;
}
