// Pure engine for the USER_FEDERATION (3LO) tab. No I/O, no real clock: every step is read against the lab clock.
// The inputs that decide a verdict are checked in the fixed step order; the first failing step refuses.
import { refuse } from './errors.js';
import { newTrace, formatTraceparent } from './trace.js';

export class ThreeLoInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

// The exact callback URL strings. A mismatch is a DIFFERENT STRING, not a parse: scheme, host, port and path must all match.
export const callbackMatches = (a, b) => a === b;

// The code lifetime, in lab seconds. A code older than this is invalid_grant.
export const CODE_LIFETIME = 60;

export function findSession(table, sessionUri) {
  return table.find((s) => s.sessionUri === sessionUri) || null;
}

// The check ids, in the order they run, with the lab-reading tag each carries.
export const CHECKS = [
  { id: 'iam-get-token', tag: 'measured', label: 'The runtime role can call GetResourceOauth2Token' },
  { id: 'callback-match', tag: 'measured', label: 'The two callback URLs match exactly' },
  { id: 'session-preregistered', tag: 'measured', label: 'The session was pre-registered by sessionUri' },
  { id: 'token-auth-method', tag: 'measured', label: 'The token endpoint accepted the auth method (POST)' },
  { id: 'code-fresh', tag: 'invented', label: 'The authorization code is still fresh' },
  { id: 'per-invocation-user', tag: 'measured', label: 'The token names the human who invoked (per-invocation registration)' },
];

export const stepIndex = (id) => CHECKS.indexOf(CHECKS.find((c) => c.id === id));

// A scenario breaks at a FLOW step (the STEPS ids in threeLoData.js); map each step to the check that decides it.
const STEP_TO_CHECK = {
  authorize: 'iam-get-token',
  callback: 'callback-match', // the callback step is where both callback-shape breaks land (the session lookup misses for the same reason)
  exchange: 'token-auth-method',
  runtime: 'per-invocation-user',
};

/** Pure. Returns { decision, checks, token, user, steps }. Throws ThreeLoInputError on unknown scenario. */
export function evaluateThreeLo(scenario, now, preRegistered) {
  if (!scenario) throw new ThreeLoInputError('unknown_scenario', 'no such scenario');
  const breakAt = scenario.breakAt;
  const breakIdx = breakAt ? stepIndex(STEP_TO_CHECK[breakAt] || breakAt) : -1;
  // The steps before the break pass; the breaking step fails; the rest are not reached (null).
  const checks = CHECKS.map((c, i) => ({
    id: c.id,
    label: c.label,
    tag: c.tag,
    ok: breakIdx === -1 || i < breakIdx ? true : i === breakIdx ? false : null,
  }));
  const failing = breakIdx >= 0 ? CHECKS[breakIdx] : null;
  const allow = breakIdx === -1;
  const code = allow ? null : scenario.code;
  // no-user-context: the breaking check (per-invocation-user) fails, but the exchange itself succeeded, so a token exists —
  // it just carries the deploy-time registration user instead of the human who invoked.
  const user = allow ? scenario.user : null;
  const shownToken = allow || scenario.id === 'no-user-context'
    ? (scenario.idToken || {
        header: { alg: 'RS256', kid: 'mock-key-1', typ: 'at+jwt' },
        claims: { iss: 'https://auth.pingone.example/as', sub: 'deploy-user', aud: 'example-client', client_id: 'example-client' },
        signature: '<MOCK-SIGNATURE: not a real signature>',
      })
    : null;
  return {
    decision: allow ? 'allow' : 'deny',
    code,
    checks,
    failedCheck: failing ? failing.id : null,
    token: shownToken,
    user,
    detail: scenario.detail || null,
    steps: allow ? CHECKS.map((c) => c.id) : CHECKS.slice(0, breakIdx + 1).map((c) => c.id),
  };
}

/** Route-level wrapper: scenario id -> result, with a trace. Throws ThreeLoInputError. */
export function evaluateThreeLoScenario(story, id, incomingTraceparent) {
  const scenario = typeof id === 'string' ? story.scenarios.find((s) => s.id === id) : null;
  const out = evaluateThreeLo(scenario, story.labNow, story.preRegistered);
  const trace = newTrace(incomingTraceparent);
  return { ...out, scenario: scenario ? scenario.id : null, expected: scenario ? scenario.expected : null, lesson: scenario ? scenario.lesson : null, traceId: trace.traceId, traceparent: formatTraceparent(trace.traceId, trace.span()) };
}
