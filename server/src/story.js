import { fillDeep } from './cast.js';
import { OBO_SCENARIOS } from './oboData.js';
import { THREE_LO_SCENARIOS } from './threeLoData.js';
import { BANNER, FACTS, INTRO, RULE, SCENARIOS, TALK_TRACK, TITLE } from './claimsData.js';

export const rawStory = () => ({ title: TITLE, intro: INTRO, banner: BANNER, rule: RULE, scenarios: SCENARIOS, facts: FACTS, talkTrack: TALK_TRACK });

// The story with the cast filled in. `claims` of a scenario token is the decoded JSON shown raw (education, mock-issued).
export function buildStory(cast) {
  const s = fillDeep(rawStory(), cast);
  return {
    title: s.title,
    intro: s.intro,
    banner: s.banner,
    tokenLabel: 'MOCK-ISSUED teaching token, decoded for education, never a real credential',
    rule: s.rule,
    scenarios: s.scenarios,
    facts: s.facts,
    talkTrack: s.talkTrack,
    cast,
  };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast);
  const parts = ['# Talk track', '', '<!-- Generated from server/src/claimsData.js by `npm run talk-track`. Do not edit by hand. -->', ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The five scenarios', '');
  s.scenarios.forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}.** ${sc.lesson}`));
  parts.push('', '## The USER_FEDERATION (3LO) scenarios', '');
  fillDeep(THREE_LO_SCENARIOS, cast).forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}.** ${sc.lesson}`));
  parts.push('', '## The on-behalf-of scenarios (Ping release claim, UNVERIFIED on our tenant)', '');
  fillDeep(OBO_SCENARIOS, cast).forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}.** ${sc.lesson}`));
  return `${parts.join('\n')}\n`;
}
