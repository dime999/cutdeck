'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const envPath = process.env.MULTIPOST_ENV || path.join(ROOT, '.env');

// Prvo pokretanje: napravi .env iz primjera i generiši tajne ključeve.
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
  console.log('Napravljen .env fajl iz .env.example');
}
let text = fs.readFileSync(envPath, 'utf8');
let changed = false;
for (const key of ['SESSION_SECRET', 'ENCRYPTION_KEY']) {
  const re = new RegExp(`^${key}=[ \\t]*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${crypto.randomBytes(32).toString('hex')}`);
    changed = true;
  }
}
if (changed) {
  fs.writeFileSync(envPath, text);
  console.log('Generisani SESSION_SECRET i ENCRYPTION_KEY u .env');
}
process.loadEnvFile(envPath);

const env = process.env;
if (!/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY || '')) {
  console.error('ENCRYPTION_KEY u .env mora imati tačno 64 heksadecimalna znaka.');
  process.exit(1);
}

const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

module.exports = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  port: Number(env.PORT || 3000),
  baseUrl,
  secureCookies: baseUrl.startsWith('https://'),
  appName: env.APP_NAME || 'MultiPost',
  inviteCode: env.INVITE_CODE || '',
  contactEmail: env.CONTACT_EMAIL || '',
  sessionSecret: env.SESSION_SECRET,
  encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'hex'),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
  ytAudited: env.YT_PROJECT_AUDITED === 'true',
  concurrency: Math.max(1, Number(env.UPLOAD_CONCURRENCY || 2)),
  maxUploadBytes: 20 * 1024 ** 3, // 20 GB
};
