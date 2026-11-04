// Credential-shaped text. Anything a visitor types into the release-update tabs (scope text, a typed confirmation, an endpoint) is checked here
// BEFORE it can enter state, an audit entry, a hop pane, a log line or an error. Masking is a HEURISTIC: it finds the common shapes, not every secret
// (a short random password with no keyword before it is not found), and the page says so. Lab-written detectors; linear patterns only (no nested
// quantifiers), run on input capped at MAX_SCAN characters.
export const MAX_SCAN = 20000;

// Strong keywords may be glued to a word in front of them ("xpassword=abc", "access_token=abc"); "pw" and "pass" are too common inside ordinary
// words (bypass, compass), so they need a word boundary.
const STRONG = 'password|passwd|passcode|passkey|pwd|secret(?:[ _-]?key)?|token|api[_-]?key|apikey|client[_-]?secret|private[_-]?key|access[_-]?key|account[_-]?key|session[_-]?id|sessionid|credential';
const KEYWORDS = `${STRONG}|\\b(?:pw|pass)`;
const D = (id, re) => ({ id, re });
export const DETECTORS = [
  D('private-key', /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[^]{0,4000}?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g),
  D('url-userinfo', /\b[a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^/\s:@]{1,100}:[^@\s]{1,200}@/g),
  D('github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,})/g),
  D('gitlab-token', /\bglpat-[A-Za-z0-9_-]{6,}/g),
  D('slack-token', /\bxox[abprs]-[A-Za-z0-9-]{6,}/g),
  D('aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  D('google-token', /\b(?:ya29\.[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g),
  D('api-key', /\bsk-[A-Za-z0-9_-]{8,}/g),
  D('jwt', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g),
  D('bearer', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,}/gi),
  // "token abcdef1234567890" (an Authorization header): the word needs a digit, so "token requirements" is left alone
  D('token-word', /\btoken\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi),
  D('passphrase', /\bpassphrase\s*(?:[:=]|\bis\b)\s*\S+(?:[ \t]+\S+){0,3}/gi),
  D('authorization', /\bauthorization\s*[:=]\s*\S{3,}(?:[ \t]+\S{6,})?/gi),
  // "my password is Tr0ub4dor", "the passcode was zebra-Quartz-77": plain-language password statements
  D('password-is', /\b(?:password|passwd|passcode|passkey|pwd|pw)s?\s+(?:is|are|was)\s+\S{3,}/gi),
  { id: 'secret-is', re: /\b(?:secret|token|api[ _-]?key|key|credential)s?\s+(?:is|are|was)\s+\S{4,}/gi, accept: (m) => /\d/.test(m.replace(/^\S+\s+\S+\s+/, '')) },
  D('pin', /\bpin(?:[ _-]?(?:code|number))?\s*(?:[:=]|\b(?:is|are|was)\b)\s*\d{3,8}\b/gi),
  // JSON key: {"password":"x"} or 'pw': 'x'. The value may be a single character: the KEY already says what it is.
  // Quotes may arrive backslash-escaped (a JSON value quoted inside a JSON string).
  D('json-key', new RegExp(`["']\\s*(?:${KEYWORDS})s?\\s*\\\\{0,3}["']\\s*:\\s*(?:\\\\{0,3}"[^"]{0,400}"|\\\\{0,3}'[^']{0,400}'|[^\\s,}\\]]{1,200})`, 'gi')),
  // Assignments, including glued ones ("xpassword=abc", "my_token:abc"): no word boundary in front of the keyword on purpose.
  D('assignment', new RegExp(`(?:${KEYWORDS})s?["']?\\s*[:=]\\s*["']?\\S{3,}`, 'gi')),
  D('ssn', /\b\d{3}-\d{2}-\d{4}\b/g),
  D('email', /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g),
  // A long run of key characters (checked in code, not with a look-ahead, to stay linear): 20+ of letters/digits/_/- with both a letter and a digit,
  // or 32+ that is not just lowercase words joined by hyphens; and a 32+ run that also uses + / = (base64) unless it is a lowercase path.
  { id: 'key-like', generic: true, re: /[A-Za-z0-9_-]{20,}/g, accept: (m) => (/\d/.test(m) && /[A-Za-z]/.test(m)) || (m.length >= 32 && !/^[a-z]+(?:-[a-z]+)+$/.test(m)) },
  { id: 'long-blob', generic: true, re: /[A-Za-z0-9+/_=-]{32,}/g, accept: (m) => !/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(m) && !/^[a-z]+(?:-[a-z]+)+$/.test(m) },
];

// NFKC (fullwidth look-alikes become the ASCII they imitate), then DELETE every default-ignorable code point, format character (Cf: zero-width,
// bidi, joiners, soft hyphen, tag characters) and U+FFFD, so a token cannot be hidden by interleaving them; other control characters become spaces.
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Cf}\uFFFD]/gu;
const flatten = (s) => s.normalize('NFKC').replace(HIDDEN, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

// Percent-encoding is decoded up to three rounds ("%2570" is "%70" is "p"), each round followed by the same flattening. Only valid sequences are
// decoded; a stray "%" stays as it is. Returns the text a human or a proxy would end up reading.
export function decodeRounds(input) {
  let s = flatten(String(input ?? '').slice(0, MAX_SCAN));
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => { try { return decodeURIComponent(m); } catch { return m; } });
    if (next === s) break;
    s = flatten(next);
  }
  return s;
}

// Spans { start, end, id } of every credential-shaped run in the (already flattened) text.
function spansOf(t) {
  const spans = [];
  for (const d of DETECTORS) { d.re.lastIndex = 0; for (const m of t.matchAll(d.re)) if (!d.accept || d.accept(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, id: d.id }); }
  return spans;
}
export const findCredentials = (text) => spansOf(decodeRounds(text));
// True when the text, as a person or proxy would read it, holds anything credential-shaped (the generic long-run detectors included).
export const looksLikeCredential = (text) => findCredentials(text).length > 0;

export function maskSpans(text, spans) {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = ''; let at = 0;
  for (const s of sorted) { if (s.start < at) { at = Math.max(at, s.end); continue; } out += `${text.slice(at, s.start)}[masked:${s.id}]`; at = s.end; }
  return out + text.slice(at);
}

// Mask what is credential-shaped in typed text but leave ordinary text EXACTLY as it was (no whitespace collapse, no truncation, no decoding): used where
// a typed value is shown back on purpose (a custom claim in the claim gate). Detection runs on the decoded, hidden-characters-deleted form, so a
// secret hidden by percent-encoding or zero-width characters is found; when something is found the answer is the masked decoded text.
export function maskKeepShape(value) {
  if (typeof value !== 'string' || value === '') return value;
  const t = decodeRounds(value);
  const spans = spansOf(t);
  return spans.length ? maskSpans(t, spans) : value;
}
