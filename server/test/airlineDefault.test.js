// AirGuard Airlines (a fictional airline) is the default story. These cases fail on the retail default and pass on the airlines one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, DEFAULT_VERTICAL, VERTICALS, loadCast, verticalFrom } from '../src/cast.js';
import { renderTalkTrackMarkdown } from '../src/story.js';
import { call, isolateSharedEnv, withServer } from './helpers.js';

isolateSharedEnv();

// Retired names: the other packs' brands and agents, and the earlier airline brand. None may appear in the airline run.
const RETIRED = ['Northwind', 'Contoso', 'Fabrikam', 'Harbor', 'Vellum', 'Meridian Air', 'orders-agent', 'claims-agent', 'payments-agent'];
const leaks = (text) => RETIRED.filter((w) => text.toLowerCase().includes(w.toLowerCase()));

// Every answer the airline run can show: the three stories, the three diagrams, every scenario's evaluation and trace.
async function renderedRun(url, query = '') {
  const parts = [];
  const get = async (p) => parts.push((await call(url, 'GET', p + query)).text);
  await get('/api/scenarios'); await get('/api/three-lo'); await get('/api/obo');
  for (const n of ['m2m-gate', 'three-lo', 'obo']) parts.push((await call(url, 'GET', `/api/diagram${query ? `${query}&` : '?'}name=${n}`)).text);
  const scen = JSON.parse(parts[0]).scenarios.map((s) => s.id);
  for (const id of scen) parts.push((await call(url, 'POST', `/api/evaluate${query}`, { scenario: id })).text);
  for (const id of JSON.parse(parts[1]).scenarios.map((s) => s.id)) parts.push((await call(url, 'POST', `/api/three-lo/evaluate${query}`, { scenario: id })).text);
  for (const id of JSON.parse(parts[2]).scenarios.map((s) => s.id)) parts.push((await call(url, 'POST', `/api/obo/evaluate${query}`, { scenario: id })).text);
  return parts.join('\n');
}

test('the default vertical is airlines: AirGuard Airlines, host airguard, no config needed', () => {
  assert.equal(DEFAULT_VERTICAL, 'airlines');
  assert.equal(DEFAULT_CAST.castBrand, 'AirGuard Airlines');
  assert.equal(DEFAULT_CAST.castHost, 'airguard');
  assert.equal(loadCast(null).castBrand, 'AirGuard Airlines');
  assert.equal(verticalFrom(undefined), 'airlines');
});

test('an unknown vertical id falls back to the airline default and does not crash', async () => {
  assert.equal(verticalFrom('nope'), 'airlines');
  assert.equal(verticalFrom('__proto__'), 'airlines');
  await withServer(async (url) => {
    const r = await call(url, 'GET', '/api/scenarios?vertical=nope');
    assert.equal(r.status, 200);
    assert.equal(r.json.cast.castBrand, 'AirGuard Airlines');
    assert.deepEqual(r.json.verticals.slice().sort(), ['airlines', 'finance', 'health', 'retail']);
  });
});

test('the airline run, rendered end to end with no vertical chosen, shows AirGuard Airlines and no retired name', async () => {
  await withServer(async (url) => {
    const text = await renderedRun(url);
    assert.ok(text.includes('AirGuard Airlines'), 'the brand is shown');
    assert.ok(text.includes('passenger-chat-agent'), 'the agent is shown');
    assert.ok(text.includes('.airguard.example'), 'the host is shown');
    assert.deepEqual(leaks(text), []);
  });
});

test('the generated talk track for the default carries an airline example and no retired name or invoice wording', () => {
  const md = renderTalkTrackMarkdown(DEFAULT_CAST);
  assert.ok(md.includes('rebook disrupted passengers'));
  assert.ok(!/invoice/i.test(md));
  assert.deepEqual(leaks(md), []);
});

test('the three older packs still work: each renders its own brand and none shows AirGuard', async () => {
  await withServer(async (url) => {
    for (const [id, brand] of [['retail', 'Northwind Retail'], ['health', 'Contoso Health'], ['finance', 'Fabrikam Bank']]) {
      assert.equal(VERTICALS[id].castBrand, brand);
      const text = await renderedRun(url, `?vertical=${id}`);
      assert.ok(text.includes(brand), id);
      assert.ok(!/AirGuard/i.test(text), `${id} has no airline wording`);
    }
  });
});

test('a saved config still overrides the airline default, and a config naming another vertical keeps working', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apd-air-')), 'customer.config.json');
  fs.writeFileSync(file, JSON.stringify({ cast: { brand: 'Northwind Retail', agentId: 'orders-agent', clientId: 'orders-agent', host: 'northwind' } }));
  await withServer(async (url) => {
    const j = (await call(url, 'GET', '/api/scenarios')).json;
    assert.equal(j.cast.castBrand, 'Northwind Retail');
    assert.equal(j.rule.requiredClaims[1].equals, 'orders-agent');
  }, { configFile: file });
});
