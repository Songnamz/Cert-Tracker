const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const emailAlert = require('../services/emailAlert');
const {
  generateOTP, storeOTP, verifyOTP,
  createSession, validateSession, deleteSession, isRateLimited,
} = require('../services/otpStore');

const COOKIE_NAME  = 'ct_session';
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'settings.json');

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
};

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')); }
  catch (_) { return {}; }
}

function isEmailAllowed(email, settings) {
  const allowed = (settings.allowedEmails || []).map(e => e.toLowerCase());
  if (allowed.length === 0) {
    const alertTo = settings.email && settings.email.to;
    return !!(alertTo && email === alertTo.toLowerCase());
  }
  return allowed.includes(email);
}

// POST /api/auth/request-otp
router.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const clean = email.trim().toLowerCase();

  if (isRateLimited(clean)) {
    return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes.' });
  }

  const settings = readSettings();

  // SMTP must be configured before anything else (env vars take priority over settings)
  const smtpHost = process.env.SMTP_HOST || (settings.email && settings.email.smtp && settings.email.smtp.host);
  if (!settings.email || !settings.email.enabled || !smtpHost) {
    return res.status(503).json({ error: 'Email is not configured on this server. Contact your administrator.' });
  }

  // Silent success for unrecognised emails — prevents enumeration
  if (!isEmailAllowed(clean, settings)) {
    return res.json({ sent: true });
  }

  const code = generateOTP();
  storeOTP(clean, code);

  try {
    await emailAlert.sendOTP(settings.email, clean, code);
    res.json({ sent: true });
  } catch (err) {
    console.error('OTP send error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Check SMTP settings.' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  const result = verifyOTP(email.trim(), code.trim());
  if (!result.valid) {
    const messages = {
      expired:           'Code has expired. Please request a new one.',
      too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
      invalid:           'Incorrect code. Please try again.',
      no_code:           'No code found. Please request a new one.',
    };
    return res.status(401).json({ error: messages[result.reason] || 'Invalid code' });
  }

  const token = createSession(email.trim());
  res.cookie(COOKIE_NAME, token, cookieOpts);
  res.json({ success: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) deleteSession(token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

// GET /api/auth/check
router.get('/check', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  const session = validateSession(token);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, email: session.email });
});

module.exports = router;
