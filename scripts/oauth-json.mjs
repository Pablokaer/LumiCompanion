// Creates google-oauth.json (git-ignored) from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env,
// so installers built with `npm run dist` can sign in to Google without a .env file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'google-oauth.json');

const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: fall through to the error below */ }

const clientId = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret || clientId.startsWith('your-')) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (see README).');
  process.exit(1);
}
fs.writeFileSync(target, JSON.stringify({ installed: { client_id: clientId, client_secret: clientSecret } }, null, 2));
console.log('Wrote google-oauth.json (git-ignored; it is bundled into the installer).');
