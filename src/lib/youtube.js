'use strict';
// YouTube Data API v3 preko direktnih HTTP poziva (bez googleapis biblioteke).
const fs = require('node:fs');
const cfg = require('./config');

// Adrese se mogu zamijeniti varijablama okruženja (koristi se samo za testiranje).
const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const REVOKE_URL = process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const API = process.env.YT_API_BASE || 'https://www.googleapis.com/youtube/v3';
const UPLOAD = process.env.YT_UPLOAD_BASE || 'https://www.googleapis.com/upload/youtube/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const CHUNK = 8 * 1024 * 1024; // mora biti višekratnik od 256 KB

const redirectUri = () => `${cfg.baseUrl}/oauth/youtube/callback`;

class ApiError extends Error {
  constructor(message, { status = 0, reason = '', reconnect = false } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.reconnect = reconnect;
  }
}

function isConfigured() {
  return Boolean(cfg.googleClientId && cfg.googleClientSecret);
}

function authUrl(state) {
  const p = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      ...params,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ApiError(data.error_description || data.error || `HTTP ${r.status}`, {
      status: r.status,
      reason: data.error || '',
      reconnect: data.error === 'invalid_grant',
    });
  }
  return data;
}

function normalizeTokens(data, prev = {}) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev.refresh_token,
    scope: data.scope || prev.scope || '',
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

async function exchangeCode(code) {
  const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  return normalizeTokens(data);
}

/** Vraća {tokens, changed}. Osvježava access token ako ističe za manje od 2 minute. */
async function ensureFresh(tokens) {
  if (tokens.access_token && tokens.expires_at - 120000 > Date.now()) return { tokens, changed: false };
  if (!tokens.refresh_token) throw new ApiError('Nema refresh tokena.', { reconnect: true });
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  return { tokens: normalizeTokens(data, tokens), changed: true };
}

async function apiError(r) {
  let data = {};
  try {
    data = await r.json();
  } catch {}
  const e = data.error || {};
  const reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || '';
  return new ApiError(e.message || `HTTP ${r.status}`, { status: r.status, reason });
}

async function getMyChannel(accessToken) {
  const r = await fetch(`${API}/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw await apiError(r);
  const data = await r.json();
  const ch = data.items && data.items[0];
  if (!ch) return null;
  const thumbs = ch.snippet.thumbnails || {};
  return {
    id: ch.id,
    title: ch.snippet.title,
    thumbnail: (thumbs.default || thumbs.medium || {}).url || null,
  };
}

async function revoke(tokens) {
  const token = tokens.refresh_token || tokens.access_token;
  if (!token) return;
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  } catch {}
}

function videoResource(video) {
  const status = {
    privacyStatus: video.publish_at ? 'private' : video.privacy,
    selfDeclaredMadeForKids: Boolean(video.made_for_kids),
  };
  if (video.publish_at) status.publishAt = video.publish_at;
  const tags = JSON.parse(video.tags || '[]');
  return {
    snippet: {
      title: video.title,
      description: video.description,
      categoryId: video.category_id,
      ...(tags.length ? { tags } : {}),
    },
    status,
  };
}

/** Otvara resumable upload sesiju i vraća njen URL. */
async function startUpload(accessToken, video, size) {
  const url = `${UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(size),
      'x-upload-content-type': video.mime || 'video/*',
    },
    body: JSON.stringify(videoResource(video)),
  });
  if (!r.ok) throw await apiError(r);
  const location = r.headers.get('location');
  if (!location) throw new ApiError('YouTube nije vratio adresu za upload.', { status: 500 });
  return location;
}

function nextOffset(rangeHeader) {
  const m = /bytes=\d+-(\d+)/.exec(rangeHeader || '');
  return m ? Number(m[1]) + 1 : 0;
}

/** Provjerava dokle je stigao prekinuti upload. */
async function queryStatus(uploadUrl, size, accessToken) {
  const r = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-range': `bytes */${size}` },
    body: '',
  });
  if (r.status === 200 || r.status === 201) return { done: true, video: await r.json() };
  if (r.status === 308) return { done: false, offset: nextOffset(r.headers.get('range')) };
  if (r.status === 404 || r.status === 410) return { expired: true };
  throw await apiError(r);
}

/** Šalje fajl u dijelovima od 8 MB, od zadanog offseta. Vraća YouTube video resurs. */
async function uploadChunks(uploadUrl, filePath, size, offset, getToken, onProgress) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const r = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${await getToken()}`,
          'content-range': `bytes ${offset}-${offset + len - 1}/${size}`,
        },
        body: buf,
      });
      if (r.status === 308) {
        offset = nextOffset(r.headers.get('range'));
        onProgress(offset / size);
        continue;
      }
      if (r.ok) {
        onProgress(1);
        return await r.json();
      }
      throw await apiError(r);
    }
    const st = await queryStatus(uploadUrl, size, await getToken());
    if (st.done) return st.video;
    throw new ApiError('Upload nije potvrđen od YouTubea.', { status: 500 });
  } finally {
    await fh.close();
  }
}

const CATEGORIES = [
  ['22', 'Ljudi i blogovi'],
  ['24', 'Zabava'],
  ['23', 'Komedija'],
  ['10', 'Muzika'],
  ['20', 'Igrice'],
  ['17', 'Sport'],
  ['26', 'Kako da / stil'],
  ['27', 'Obrazovanje'],
  ['28', 'Nauka i tehnologija'],
  ['1', 'Film i animacija'],
  ['2', 'Automobili'],
  ['15', 'Ljubimci i životinje'],
  ['19', 'Putovanja i događaji'],
  ['25', 'Vijesti i politika'],
];

module.exports = {
  SCOPES,
  CATEGORIES,
  ApiError,
  isConfigured,
  authUrl,
  exchangeCode,
  ensureFresh,
  getMyChannel,
  revoke,
  startUpload,
  queryStatus,
  uploadChunks,
  redirectUri,
};
