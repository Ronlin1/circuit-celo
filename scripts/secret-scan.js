import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ignore = new Set(['node_modules', '.git', '.netlify']);
const findings = [];
const patterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, 'private key block'],
  [/\b0x[0-9a-fA-F]{64}\b/g, 'raw 32-byte hex secret candidate'],
  [/(?:PRIVATE_KEY|X402_API_KEY)[ \t]*=[ \t]*[^\s#][^\r\n]*/g, 'populated secret env value']
];
function walk(path) {
  for (const name of readdirSync(path)) {
    if (ignore.has(name)) continue;
    const full = join(path, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (!/\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(full)) {
      const text = readFileSync(full, 'utf8');
      for (const [regex, label] of patterns) {
        regex.lastIndex = 0;
        if (regex.test(text)) findings.push(`${full}: ${label}`);
      }
    }
  }
}
walk('.');
if (findings.length) { console.error(findings.join('\n')); process.exit(1); }
console.log('secret scan ok');
