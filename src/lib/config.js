'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const envPath = process.env.MULTIPOST_ENV || path.join(ROOT, '.env');

// Prvo pokretanje: napravi .env iz primjera i generiši tajne ključeve.
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
  console.log('Created .env from .env.example');
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
  console.log('Generated SESSION_SECRET and ENCRYPTION_KEY in .env');
}
process.loadEnvFile(envPath);

const env = process.env;
if (!/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY || '')) {
  console.error('ENCRYPTION_KEY in .env must be exactly 64 hexadecimal characters.');
  process.exit(1);
}

// winget dodaje ffmpeg u PATH tek za programe pokrenute nakon instalacije,
// pa se provjerava i njegov folder sa prečicama.
function findTool(name, override) {
  if (override) return override;
  const linked = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${name}.exe`) : '';
  return linked && fs.existsSync(linked) ? linked : name;
}

const baseUrl =(env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

module.exports = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  recordingsDir: path.resolve(ROOT, env.RECORDINGS_DIR || 'data/recordings'),
  shortsDir: path.join(ROOT, 'data', 'shorts'),
  thumbsDir: path.join(ROOT, 'data', 'thumbs'),
  ffmpeg: findTool('ffmpeg', env.FFMPEG_PATH),
  ffprobe: findTool('ffprobe', env.FFPROBE_PATH),
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
