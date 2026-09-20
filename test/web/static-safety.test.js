import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const recipientInput = html.match(/<input\s+id="recipient"[^>]*>/i)?.[0] || '';

test('treasury form never prefills the demo recipient for a real wallet flow', () => {
  assert.match(recipientInput, /id="recipient"/i);
  assert.match(recipientInput, /required/i);
  assert.match(recipientInput, /placeholder=/i);
  assert.doesNotMatch(recipientInput, /value\s*=\s*"0x1111111111111111111111111111111111111111"/i);
  assert.doesNotMatch(recipientInput, /value\s*=/i);
});
