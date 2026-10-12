'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const envPath = process.env.CUTDECK_ENV || path.join(ROOT, '.env');

// Prvo pokretanje: napravi .env iz primjera.
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
  console.log('Created .env from .env.example');
}
process.loadEnvFile(envPath);

const env = process.env;

// winget dodaje ffmpeg u PATH tek za programe pokrenute nakon instalacije,
// pa se provjerava i njegov folder sa prečicama.
function findTool(name, override) {
  if (override) return override;
  const linked = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${name}.exe`) : '';
  return linked && fs.existsSync(linked) ? linked : name;
}

module.exports = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  recordingsDir: path.resolve(ROOT, env.RECORDINGS_DIR || 'data/recordings'),
  shortsDir: path.join(ROOT, 'data', 'shorts'),
  thumbsDir: path.join(ROOT, 'data', 'thumbs'),
  thumbnailsDir: path.join(ROOT, 'data', 'thumbnails'),
  ffmpeg: findTool('ffmpeg', env.FFMPEG_PATH),
  ffprobe: findTool('ffprobe', env.FFPROBE_PATH),
  // Nema prijave, pa se aplikacija javlja samo na ovom računaru.
  host: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
  appName: env.APP_NAME || 'CutDeck',
  contactEmail: env.CONTACT_EMAIL || '',
};
