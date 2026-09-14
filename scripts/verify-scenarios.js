import { runJudgeScenarios } from '../src/celo/judge-scenarios.js';
const results = runJudgeScenarios();
const failed = results.filter((entry) => !entry.passed);
for (const item of results) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.id}: expected ${item.expected}, got ${item.actual}`);
if (failed.length) process.exit(1);
console.log(`${results.length}/${results.length} judge scenarios matched expected containment verdicts.`);
