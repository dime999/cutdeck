'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const envPath = process.env.CUTDECK_ENV || path.join(ROOT, '.env');

// Prvo pokretanje: napravi .env iz primjera i generiši tajni ključ za sesije.
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
  console.log('Created .env from .env.example');
}
const text = fs.readFileSync(envPath, 'utf8');
const emptySecret = /^SESSION_SECRET=[ \t]*$/m;
if (emptySecret.test(text)) {
  fs.writeFileSync(envPath, text.replace(emptySecret, `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`));
  console.log('Generated SESSION_SECRET in .env');
}
process.loadEnvFile(envPath);

const env = process.env;
if (!env.SESSION_SECRET) {
  console.error('SESSION_SECRET is missing from .env. Add an empty "SESSION_SECRET=" line and start the app again.');
  process.exit(1);
}

// winget dodaje ffmpeg u PATH tek za programe pokrenute nakon instalacije,
// pa se provjerava i njegov folder sa prečicama.
function findTool(name, override) {
  if (override) return override;
  const linked = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${name}.exe`) : '';
  return linked && fs.existsSync(linked) ? linked : name;
}

const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

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
  appName: env.APP_NAME || 'CutDeck',
  inviteCode: env.INVITE_CODE || '',
  contactEmail: env.CONTACT_EMAIL || '',
  sessionSecret: env.SESSION_SECRET,
};
