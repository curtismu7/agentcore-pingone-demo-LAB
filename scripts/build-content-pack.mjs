// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';
import { WHY } from '../server/src/releaseClaims.js';
import { THREE_LO_SCENARIOS } from '../server/src/threeLoData.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = { allowed: ['required-claims', 'flattened-claims'], 'wrong-act-sub': ['act-claim'], 'no-act': ['act-claim'], 'act-text': ['act-claim', 'flattened-claims'], 'wrong-client': ['required-claims'] };
  const loTerms = { allowed: ['user-federation'], 'callback-mismatch': ['user-federation'], 'session-not-preregistered': ['user-federation'], 'basic-auth': ['user-federation'], 'iam-missing': ['user-federation'], 'expired-code': ['user-federation'], 'no-user-context': ['user-federation'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'agentcore-pingone-demo',
    title: 'AgentCore PingOne LAB',
    version,
    demo: { id: 'agentcore-pingone-demo', name: 'AgentCore PingOne LAB', catalog: 'D99', baseUrl: 'http://localhost:7601', doctor: '/api/health', tags: ['mcp', 'agent', 'claims', 'privilege', 'mock-only', 'token-exchange', 'agentcore'] },
    glossary: [
      { id: 'act-claim', term: 'act claim (actor)', definition: 'A token claim naming the party acting on behalf of the subject (RFC 8693). In this lab it must be an OBJECT with a sub, such as {"sub": "orders-agent"}. The text "{}" is not an object and act.sub then does not exist.', aliases: ['act.sub', 'RFC 8693'] },
      { id: 'required-claims', term: 'RequiredClaims', definition: 'A mock Privilege policy rule shape: a list of claim paths and the values they must equal. All must match or the call is denied.', aliases: ['required claims'] },
      { id: 'token-exchange', term: 'Token exchange (on-behalf-of)', definition: 'Ping release claim, UNVERIFIED on our tenant: the gateway swaps the caller\'s verified token (RFC 8693) for one minted for the downstream MCP server, so the backend validates a token issued to it instead of trusting a shared service account. In this lab it is the lab\'s own model, with a keyed-hash stand-in for a signature.', aliases: ['RFC 8693', 'OBO', 'on-behalf-of'] },
      { id: 'act-chain', term: 'act claim chain', definition: 'Ping release claim, UNVERIFIED on our tenant: the act claim preserves who the original caller was. When the caller token already carried an act, the lab nests it beneath the new one (one level per hop, capped at three actors: a lab-invented cap).', aliases: ['delegation chain'] },
      { id: 'user-federation', term: 'USER_FEDERATION (3LO)', definition: 'AgentCore Identity starts a real human login through PingOne: pi.flow sign-in, a code to the callback, an exchange, and a token whose sub is the human. The four shapes that decide it: the two callback URLs match exactly, the session is pre-registered by sessionUri, the token endpoint takes POST auth, and the runtime role holds GetResourceOauth2Token on the workload identity directory.', aliases: ['3LO', 'authorization code', 'workload identity'] },
      { id: 'flattened-claims', term: 'Flattened claims', definition: 'A token turned into dotted paths such as act.sub, so a rule can address a nested claim. That nested matching is new in gateway v1.261024 is an INFERENCE from binary symbols: UNVERIFIED.', aliases: ['dotted path', 'FlatClaims'] },
    ],
    // The two release tabs (H2 2026): glossary terms, a concept card each and a "why it matters" card each, all marked as Ping release claims.
    sources: [
      { id: 'rfc8693', title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693', kind: 'standard', use: 'Defines the act (actor) claim.', status: 'not-read', checked: '2026-10-27' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-obo', label: 'On-behalf-of (RFC 8693): the backend gets its own token', description: 'Ping release claim, UNVERIFIED on our tenant. Thirteen scenarios: the exchanged token (aud is the backend, act names the caller), a chain, and every check that refuses. Each row says whether it is a deck claim, a swagger name, a lab reading or lab-invented.', group: 'concept', action: { type: 'route', href: '/#obo' }, terms: ['token-exchange', 'act-chain'] },
      { id: 'why-obo', label: 'Why it matters: on-behalf-of (Ping claims, slide 48)', description: `Per Ping's deck (slide ${WHY.obo.slide}), UNVERIFIED on our tenant. Challenge: ${WHY.obo.challenge} Technical value: ${WHY.obo.technical} Business value: ${WHY.obo.business}`, group: 'concept', action: { type: 'route', href: '/#obo' }, terms: ['token-exchange'] },
      { id: 'concept-three-lo', label: 'USER_FEDERATION (3LO): the agent logs a human in through PingOne', description: 'The agent on AgentCore Runtime starts a real PingOne login: pi.flow sign-in, a code to the callback, an exchange, and a token whose sub is the human. Seven scenarios: each breaks one of the four shapes, and the page shows which step decided.', group: 'try-it', action: { type: 'route', href: '/#three-lo' }, terms: ['user-federation'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: [
      ...story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
      ...THREE_LO_SCENARIOS.map((sc, i) => ({ id: sid(story.scenarios.length + i + 1), title: sc.title, say: sc.lesson })),
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
