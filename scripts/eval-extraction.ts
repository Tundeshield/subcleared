// Local accuracy run: ANTHROPIC_API_KEY=... npx tsx scripts/eval-extraction.ts [file ...]
// Writes eval-results/<timestamp>.md and .json. DEV_AI=mock runs the plumbing offline
// (the mock cannot read real layouts, so its scores mean nothing).
import fs from 'node:fs';
import { AnthropicProvider, MockAiProvider } from '../server/ai';
import { MemoryDb } from '../server/db';
import { runEval, toMarkdown } from '../server/eval';
import { readEnv, type Services } from '../server/services';

const env = readEnv(process.env);
const svc = {
  mode: 'memory', db: new MemoryDb(), env, now: () => new Date(),
  ai: process.env.DEV_AI === 'mock' ? new MockAiProvider() : env.anthropicKey ? new AnthropicProvider(env.anthropicKey) : undefined,
} as unknown as Services;
if (!svc.ai) { console.error('Set ANTHROPIC_API_KEY (or DEV_AI=mock for a dry run).'); process.exit(1); }
const report = await runEval(svc, { only: process.argv.slice(2) });
fs.mkdirSync('eval-results', { recursive: true });
const stamp = report.at.replace(/[:.]/g, '-');
fs.writeFileSync(`eval-results/${stamp}.json`, JSON.stringify(report, null, 2));
fs.writeFileSync(`eval-results/${stamp}.md`, toMarkdown(report));
console.log(toMarkdown(report).split('\n').slice(0, 18).join('\n'));
