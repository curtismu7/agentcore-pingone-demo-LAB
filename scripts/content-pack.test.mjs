import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

const root = new URL('..', import.meta.url);
const committed = JSON.parse(fs.readFileSync(new URL('content-pack.json', root), 'utf8'));

test('the pack validates against the schema and its cross-references hold', () => {
  assert.deepEqual(validatePack(buildPack()), []);
});

test('the committed content-pack.json is exactly what the builder makes (no drift)', () => {
  assert.deepEqual(committed, buildPack());
});

test('every scenario has a story and a try-it card that opens it', () => {
  const pack = buildPack();
  assert.equal(pack.stories.length, 12);
  // The five M2M scenarios each have a try-it card that opens them; the seven 3LO stories open the three-lo tab.
  for (const s of pack.stories.slice(0, 5)) {
    const card = pack.cards.find((c) => c.story === s.id);
    assert.ok(card, s.id);
    assert.equal(card.action.href, `/#scenario-${pack.cards.find((c) => c.story === s.id).id.replace('try-', '')}`);
  }
  for (const s of pack.stories.slice(5)) assert.ok(s.say, s.id);
});

test('a broken pack is caught: unknown term and unknown story', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['nope'];
  pack.cards[1].story = 'ghost';
  const errors = validatePack(pack).join('\n');
  assert.match(errors, /unknown term nope/);
  assert.match(errors, /unknown story ghost/);
});

test('the pack names no real company or tenant and shows no real credential', () => {
  const t = JSON.stringify(buildPack()).toLowerCase();
  for (const w of ['united', 'mileageplus', 'datapower', 'optum', 'uhg', 'member', 'benefit']) assert.ok(!t.includes(w), w);
  assert.ok(!/https?:\/\/(?!(www\.rfc-editor\.org|localhost))/.test(t), 'only rfc-editor links and localhost');
});

test('the release tab and the 3LO tab have cards marked as claims, UNVERIFIED on our tenant', () => {
  const pack = buildPack();
  const card = (id) => pack.cards.find((c) => c.id === id);
  for (const id of ['concept-obo', 'why-obo']) { assert.ok(card(id), id); assert.match(card(id).description, /UNVERIFIED on our tenant/, id); }
  assert.ok(card('concept-three-lo'), 'concept-three-lo');
  assert.match(card('why-obo').label, /Ping claims, slide 48/); assert.match(card('why-obo').description, /Challenge: .* Technical value: .* Business value: /);
  assert.equal(card('concept-obo').action.href, '/#obo'); assert.equal(card('concept-three-lo').action.href, '/#three-lo');
  for (const t of ['token-exchange', 'act-chain']) assert.ok(pack.glossary.some((g) => g.id === t && /UNVERIFIED on our tenant/.test(g.definition)), t);
});

test('the USER_FEDERATION card exists and the pack keeps catalog D99', () => {
  const pack = buildPack();
  assert.ok(pack.cards.find((c) => c.id === 'concept-three-lo'));
  assert.ok(pack.glossary.find((g) => g.id === 'user-federation'));
  assert.equal(pack.demo.catalog, 'D99');
});
