import { fillDeep } from './cast.js';
import { THREE_LO_SCENARIOS, THREE_LO_TITLE, THREE_LO_INTRO, THREE_LO_FACTS, THREE_LO_CLAIM_ROWS, THREE_LO_TALK, PRE_REGISTERED, LAB_NOW, STEPS, PINGONE_APP, CREDENTIAL_PROVIDER } from './threeLoData.js';

export const rawThreeLoStory = () => ({ title: THREE_LO_TITLE, intro: THREE_LO_INTRO, scenarios: THREE_LO_SCENARIOS, facts: THREE_LO_FACTS, claimRows: THREE_LO_CLAIM_ROWS, talk: THREE_LO_TALK, steps: STEPS, pingoneApp: PINGONE_APP, credentialProvider: CREDENTIAL_PROVIDER, preRegistered: PRE_REGISTERED, labNow: LAB_NOW });

export function buildThreeLoStory(cast) {
  return fillDeep(rawThreeLoStory(), cast);
}
