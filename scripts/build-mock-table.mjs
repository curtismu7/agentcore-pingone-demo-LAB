// Writes server/src/consoleTable.json from the engine, so the Mock walkthrough tables cannot drift from it (a test and a doctor check compare them).
import fs from 'node:fs';
import { buildMockTable } from '../server/src/consoleScenarios.js';

fs.writeFileSync(new URL('../server/src/consoleTable.json', import.meta.url), `${JSON.stringify(buildMockTable())}\n`);
console.log('wrote server/src/consoleTable.json');
