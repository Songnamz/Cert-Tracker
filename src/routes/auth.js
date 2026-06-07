const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const {
  createSession, validateSession, deleteSession, isIPBlocked, recordFailedVerify
} = require('../services/otpStore');
const fs = require('fs');
const path = require('path');
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'settings.json');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const COOKIE_NAME  = 'ct_session';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
};

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0] : req.ip || req.socket.remoteAddress || '').trim();
}

// GET /api/auth/client-id
router.get('/client-id', (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  const ip = getClientIP(req);
  if (isIPBlocked(ip)) {
    return res.status(403).json({ error: 'Access denied. Too many failed attempts.' });
  }

  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google credential is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;

    if (!email) {
      return res.status(400).json({ error: 'No email found in Google token' });
    }

    const token = createSession(email);
    res.cookie(COOKIE_NAME, token, cookieOpts);

    // Track user
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        if (!settings.users) settings.users = [];
        const user = settings.users.find(u => u.email === email);
        if (!user) {
          const defaultRole = email === 'jeng.ss.it@gmail.com' ? 'admin' : 'user';
          settings.users.push({ email, role: defaultRole, lastLogin: new Date().toISOString() });
        } else {
          user.lastLogin = new Date().toISOString();
        }
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
      }
    } catch (err) {
      console.error('Failed to track user:', err);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    recordFailedVerify(ip);
    if (isIPBlocked(ip)) {
      return res.status(403).json({ error: 'Access denied. Too many failed attempts. Try again in 24 hours.' });
    }
    res.status(401).json({ error: 'Invalid Google token' });
  }
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

  let isAdmin = session.email === 'jeng.ss.it@gmail.com';
  if (!isAdmin) {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        const users = settings.users || [];
        const u = users.find(user => user.email === session.email);
        if (u && u.role === 'admin') isAdmin = true;
      }
    } catch (err) {}
  }

  res.json({ authenticated: true, email: session.email, isAdmin });
});

module.exports = router;
