import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, VERTICALS, fill, unfilled } from '../src/cast.js';
import { rawStory, buildStory } from '../src/story.js';
import { rawThreeLoStory } from '../src/threeLoStory.js';
import { evaluateClaims } from '../src/claims.js';
import { scanHosts } from '../src/safety.js';
import { rawDiagram } from '../src/diagramData.js';

const all = () => JSON.stringify([rawStory(), rawThreeLoStory(), rawDiagram()]);

test('every {{token}} in the story, posture and diagram data is defined by every vertical (fails on an undefined token)', () => {
  for (const [name, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(all(), cast), [], name);
  assert.equal(Object.keys(VERTICALS).length, 3);
});

test('the check itself catches an undefined token and leaves it visible', () => {
  assert.deepEqual(unfilled('a {{castBrand}} {{nope}}', DEFAULT_CAST), ['nope']);
  assert.equal(fill('{{nope}}', DEFAULT_CAST), '{{nope}}');
  assert.equal(fill('{{__proto__}}', DEFAULT_CAST), '{{__proto__}}');
});

test('each scenario gives its expected decision in every vertical', () => {
  for (const cast of Object.values(VERTICALS)) {
    const s = buildStory(cast);
    for (const sc of s.scenarios) assert.equal(evaluateClaims(sc.token.claims, s.rule).decision, sc.expected, sc.id);
  }
});

test('the act-text scenario really carries the text "{}", and the others carry an object or none', () => {
  const s = buildStory(DEFAULT_CAST).scenarios;
  assert.equal(s.find((x) => x.id === 'act-text').token.claims.act, '{}');
  assert.equal(typeof s.find((x) => x.id === 'allowed').token.claims.act, 'object');
  assert.ok(!('act' in s.find((x) => x.id === 'no-act').token.claims));
});

test('only .example hosts, only fake account ids, no key-looking values', () => {
  assert.deepEqual(scanHosts(JSON.stringify(buildStory(DEFAULT_CAST))), []);
  const ids = JSON.stringify(rawThreeLoStory()).match(/arn:aws:[a-z-]+:[a-z0-9-]*:(\d+):/g);
  assert.equal(ids, null, 'no arns in the story data');
});

test('every M2M and 3LO fact is labelled, and no copy says "door"', () => {
  for (const f of rawStory().facts) assert.ok(['measured', 'inferred', 'UNVERIFIED'].includes(f.status), f.id);
  for (const f of rawThreeLoStory().facts) assert.ok(f.tag, f.id);
  assert.ok(!/\bdoors?\b/i.test(all()));
});

test('docs/talk-track.md is exactly what the talk-track data renders (no drift; run `npm run talk-track`)', async () => {
  const { readFileSync } = await import('node:fs');
  const { renderTalkTrackMarkdown } = await import('../src/story.js');
  const doc = readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');
  assert.equal(doc, renderTalkTrackMarkdown(DEFAULT_CAST));
  for (const t of rawStory().talkTrack) assert.ok(doc.includes(`## ${t.title}`), t.id);
});
