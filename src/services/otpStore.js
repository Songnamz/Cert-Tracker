const { v4: uuidv4 } = require('uuid');

const otps = new Map();          // email -> { code, expiresAt, attempts }
const sessions = new Map();      // token -> { email, expiresAt }
const requestCounts = new Map(); // email -> { count, resetAt }

const OTP_TTL        = 5  * 60 * 1000;  // 5 minutes
const SESSION_TTL    = 8  * 60 * 60 * 1000; // 8 hours
const REQUEST_WINDOW = 15 * 60 * 1000;  // 15 minutes
const MAX_REQUESTS   = 3;
const MAX_ATTEMPTS   = 5;

function isRateLimited(email) {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = requestCounts.get(key);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + REQUEST_WINDOW });
    return false;
  }
  if (entry.count >= MAX_REQUESTS) return true;
  entry.count++;
  return false;
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOTP(email, code) {
  otps.set(email.toLowerCase(), { code, expiresAt: Date.now() + OTP_TTL, attempts: 0 });
}

function verifyOTP(email, code) {
  const key = email.toLowerCase();
  const entry = otps.get(key);
  if (!entry) return { valid: false, reason: 'no_code' };
  if (Date.now() > entry.expiresAt) {
    otps.delete(key);
    return { valid: false, reason: 'expired' };
  }
  entry.attempts++;
  if (entry.attempts > MAX_ATTEMPTS) {
    otps.delete(key);
    return { valid: false, reason: 'too_many_attempts' };
  }
  if (entry.code !== code) return { valid: false, reason: 'invalid' };
  otps.delete(key);
  return { valid: true };
}

function createSession(email) {
  const token = uuidv4();
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function deleteSession(token) {
  sessions.delete(token);
}

module.exports = { generateOTP, storeOTP, verifyOTP, createSession, validateSession, deleteSession, isRateLimited };
