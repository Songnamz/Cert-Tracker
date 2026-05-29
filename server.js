require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { router: apiRouter, readDomains, readSettings } = require('./src/routes/api');
const authRouter = require('./src/routes/auth');
const { validateSession, isIPBlocked } = require('./src/services/otpStore');
const scheduler = require('./src/services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],   // inline JS in HTML files
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1); // trust first proxy (nginx)
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ── IP block gate ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
  if (isIPBlocked(ip)) {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Access denied. Too many failed attempts.' });
    }
    return res.status(403).send('Access denied. Too many failed login attempts. Try again in 24 hours.');
  }
  next();
});

// ── Public routes (no auth required) ─────────────────────────────────────────
app.use('/api/auth', authLimiter, authRouter);

app.get('/login',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.css')));
app.get('/login.js',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.js')));

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.ct_session;
  const session = validateSession(token);
  if (!session) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }
  req.user = session;
  next();
}

app.use(requireAuth);

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api', apiLimiter, apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🔒 Cert Tracker running at http://localhost:${PORT}\n`);
  scheduler.startCron(readDomains, readSettings);
  const domains = readDomains();
  const settings = readSettings();
  if (domains.length > 0) {
    console.log(`  📡 Running initial check on ${domains.length} domains...\n`);
    scheduler.runCheck(domains, settings);
  }
});
