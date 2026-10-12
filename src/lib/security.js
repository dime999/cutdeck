'use strict';
const crypto = require('node:crypto');
const cfg = require('./config');

// ── Lozinke (scrypt) ───────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ── Potpisani kolačić za sesiju ────────────────────────────
function hmac(data) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(data).digest('base64url');
}

function signSession(obj) {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${data}.${hmac(data)}`;
}

function readSession(value) {
  if (!value || !value.includes('.')) return {};
  const [data, sig] = value.split('.');
  const expected = hmac(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return {};
  try {
    const obj = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (obj.exp && obj.exp < Date.now()) return {};
    return obj;
  } catch {
    return {};
  }
}

const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

module.exports = { hashPassword, verifyPassword, signSession, readSession, randomId };
