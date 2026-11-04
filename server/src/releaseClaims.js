// The H2 2026 release tabs (on-behalf-of, AgentCore gateway governance). Source: Ping's deck "ID4AI Workforce - H2 2026" (slides 45 and 48), release
// dated 2026-11-02, and the console swagger fetched 2026-10-31 (schema only: nothing was called). The release is NOT on our tenant: every product claim
// here is a Ping release claim, UNVERIFIED on our tenant. What each tab does is this lab's own model.

// Every claim, field and rule on the new tabs carries exactly one of these tags.
export const CLAIM_TAGS = {
  deck: 'deck claim',
  swagger: 'console swagger name (schema only)',
  reading: 'lab reading',
  invented: 'lab-invented',
  measured: 'measured (our note)',
};
export const RELEASE_BANNER = 'Ping release claim, UNVERIFIED on our tenant: from the deck "ID4AI Workforce - H2 2026" (release dated 2026-11-02). The release is not on our tenant; what this tab does is the lab\'s own model, not measured on a real gateway.';
export const NO_LIVE = 'Mock only: this app has no Live engine (it refuses APD_MODE=live). Nothing here calls a gateway, an issuer or a cloud account.';
export const RELEASE_TABS = ['obo', 'console'];

// The "Why it matters" lines (PROMPT-ID4AI-H2-2026-FEATURES.md section 10, paraphrased from the deck's value panels). Ping claims, UNVERIFIED on our tenant.
// On-behalf-of sits on slide 48, whose value panel covers Intent, Purpose and Behaviour as a whole; AgentCore governance sits on slide 45.
export const WHY = {
  obo: {
    slide: 48, feature: 'Intent, Purpose, Behaviour (slide 48; on-behalf-of is one of its six rows)',
    challenge: 'A tool name and arguments cannot say what was asked for, whether the agent was ever meant to do it, or whether it normally behaves this way. Policy built on the request alone cannot tell misuse from an agent doing its job.',
    technical: 'Three separable signals: deterministic intent patterns and purpose declarations refuse hard; learned behaviour baselines drive alerts and approval. On-behalf-of gives the backend a token issued to it, with the original caller named in act.',
    business: 'The enforceable declaration "this agent exists to reconcile invoices" unblocks unattended agents in processes that could not otherwise approve them.',
  },
  console: {
    slide: 45, feature: 'AI Platform Agents (slide 45; "Governing the gateway itself" is one of its rows)',
    challenge: 'Agents created in cloud consoles sit outside identity processes: nobody inventoried them and nobody knows what they reach. Each over-privileged agent is a silent breach path that no current review covers.',
    technical: 'Cross-cloud inventory, permission review, 46-finding risk scores and one console to fix or delete.',
    business: 'Cuts agent-audit effort sharply and closes exfiltration paths before they are exploited.',
  },
};

// A talk-track entry for a "Why it matters" line: the challenge, technical and business sentences, marked as Ping's.
export const whyTalk = (id) => {
  const w = WHY[id];
  return { id: `why-${id}`, title: `Why it matters: ${w.feature} (Ping claims)`, say: `Per Ping's deck (slide ${w.slide}), UNVERIFIED on our tenant. Challenge: ${w.challenge} Technical value: ${w.technical} Business value: ${w.business}` };
};
