const { v4: uuidv4 } = require('uuid');

const otps = new Map();          // email -> { code, expiresAt, attempts }
const sessions = new Map();      // token -> { email, expiresAt }
const requestCounts = new Map(); // email -> { count, resetAt }
const verifyFails = new Map();   // ip -> { count, firstAt }
const blockedIPs  = new Map();   // ip -> expiresAt

const OTP_TTL        = 5  * 60 * 1000;
const SESSION_TTL    = 8  * 60 * 60 * 1000;
const REQUEST_WINDOW = 15 * 60 * 1000;
const MAX_REQUESTS   = 3;
const MAX_ATTEMPTS   = 5;
const FAIL_WINDOW    = 15 * 60 * 1000;  // 15 minutes to accumulate failures
const MAX_FAIL_COUNT = 3;               // failures before IP block
const IP_BLOCK_TTL   = 24 * 60 * 60 * 1000; // block for 24 hours

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

function isIPBlocked(ip) {
  if (!ip) return false;
  const exp = blockedIPs.get(ip);
  if (exp === undefined) return false;
  if (Date.now() > exp) { blockedIPs.delete(ip); return false; }
  return true;
}

function recordFailedVerify(ip) {
  if (!ip) return;
  const now  = Date.now();
  const prev = verifyFails.get(ip);
  const inWindow = prev && (now - prev.firstAt) < FAIL_WINDOW;
  const count   = inWindow ? prev.count + 1 : 1;
  const firstAt = inWindow ? prev.firstAt   : now;

  if (count >= MAX_FAIL_COUNT) {
    blockedIPs.set(ip, now + IP_BLOCK_TTL);
    verifyFails.delete(ip);
  } else {
    verifyFails.set(ip, { count, firstAt });
  }
}

module.exports = {
  generateOTP, storeOTP, verifyOTP,
  createSession, validateSession, deleteSession,
  isRateLimited, isIPBlocked, recordFailedVerify,
};
