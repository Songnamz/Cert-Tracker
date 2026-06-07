const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const scheduler = require('../services/scheduler');
const logParser = require('../services/logParser');
const emailAlert = require('../services/emailAlert');

const router = express.Router();

const DOMAINS_PATH = path.join(__dirname, '..', '..', 'data', 'domains.json');
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'settings.json');

// --- Helpers ---

function isAdmin(email) {
  if (email === 'jeng.ss.it@gmail.com') return true;
  const settings = readSettings();
  const users = settings.users || [];
  const u = users.find(user => user.email === email);
  return u && u.role === 'admin';
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function readDomains() {
  try {
    const data = JSON.parse(fs.readFileSync(DOMAINS_PATH, 'utf-8'));
    return Array.isArray(data) ? { 'jeng.ss.it@gmail.com': data } : data;
  } catch (_) {
    return {};
  }
}

function writeDomains(domainsMap) {
  const dir = path.dirname(DOMAINS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DOMAINS_PATH, JSON.stringify(domainsMap, null, 2));
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (_) {
    return { users: [] };
  }
}

function writeSettings(settingsMap) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settingsMap, null, 2));
}

// --- Domains ---

// GET /api/domains — list all domains with cert results
router.get('/domains', (req, res) => {
  const email = req.user.email;
  const allDomains = readDomains();
  const domains = allDomains[email] || [];
  const results = scheduler.getResults();

  const merged = domains.map(d => {
    const result = results.find(r => r.id === d.id) || null;
    return { ...d, result };
  });

  res.json({
    domains: merged,
    lastCheckTime: scheduler.getLastCheckTime(),
    checking: scheduler.isChecking(),
  });
});

// POST /api/domains — add a new domain
router.post('/domains', (req, res) => {
  const { domain, resolveHost, label } = req.body;
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({ error: 'Domain is required' });
  }

  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(cleaned)) {
    return res.status(400).json({ error: 'Invalid domain format' });
  }

  // Validate resolveHost if provided (IP or hostname)
  const cleanResolveHost = resolveHost ? resolveHost.trim() : null;
  if (cleanResolveHost && !/^[a-zA-Z0-9.:_-]+$/.test(cleanResolveHost)) {
    return res.status(400).json({ error: 'Invalid resolve host format' });
  }

  const email = req.user.email;
  const allDomains = readDomains();
  if (!allDomains[email]) allDomains[email] = [];
  const domains = allDomains[email];

  // Check for duplicate: same domain + same resolveHost
  if (domains.some(d => d.domain === cleaned && (d.resolveHost || null) === (cleanResolveHost || null))) {
    return res.status(409).json({ error: 'Domain with this target already exists' });
  }

  const entry = {
    id: 'd' + uuidv4().replace(/-/g, '').substring(0, 6),
    domain: cleaned,
    addedAt: new Date().toISOString(),
  };

  // Add optional fields
  if (cleanResolveHost) entry.resolveHost = cleanResolveHost;
  if (label && typeof label === 'string') entry.label = label.trim();

  domains.push(entry);
  writeDomains(allDomains);

  // Immediately check the new domain
  const allSettings = readSettings();
  const userSettings = allSettings[email] || { thresholds: { critical: 7, warning: 30 } };
  scheduler.runSingleCheck(entry, userSettings).then(result => {
    // Result is cached by scheduler
  });

  res.status(201).json(entry);
});

// DELETE /api/domains/:id — remove a domain
router.delete('/domains/:id', (req, res) => {
  const email = req.user.email;
  const { id } = req.params;
  let allDomains = readDomains();
  let domains = allDomains[email] || [];
  const before = domains.length;
  allDomains[email] = domains.filter(d => d.id !== id);

  if (allDomains[email].length === before) {
    return res.status(404).json({ error: 'Domain not found' });
  }

  writeDomains(allDomains);
  scheduler.removeCachedResult(id);
  res.json({ success: true });
});

// POST /api/domains/:id/check — re-check a single domain
router.post('/domains/:id/check', async (req, res) => {
  const email = req.user.email;
  const { id } = req.params;
  const allDomains = readDomains();
  const domains = allDomains[email] || [];
  const domain = domains.find(d => d.id === id);

  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }

  const allSettings = readSettings();
  const userSettings = allSettings[email] || { thresholds: { critical: 7, warning: 30 } };
  const result = await scheduler.runSingleCheck(domain, userSettings);
  res.json(result);
});

// --- Check All ---

router.post('/check-all', async (req, res) => {
  const email = req.user.email;
  const allDomains = readDomains();
  const allSettings = readSettings();
  
  const userDomains = allDomains[email] || [];
  const userSettings = allSettings[email] || { thresholds: { critical: 7, warning: 30 } };

  if (scheduler.isChecking()) {
    return res.json({ status: 'already-running' });
  }

  // Run async just for this user
  scheduler.runCheck({ [email]: userDomains }, { [email]: userSettings }, true);
  res.json({ status: 'started', count: userDomains.length });
});

// --- Logs ---

router.get('/logs', (req, res) => {
  const logs = logParser.getAllLogs(100);
  res.json(logs);
});

// --- Settings ---

router.get('/settings', (req, res) => {
  const email = req.user.email;
  const allSettings = readSettings();
  let s = allSettings[email] || { thresholds: { critical: 7, warning: 30 }, email: { enabled: false } };
  
  // Clone to avoid modifying the read object before write
  s = JSON.parse(JSON.stringify(s));

  if (!s.email) s.email = { enabled: false, smtp: {}, alertOnExpired: true, alertOnCritical: true };
  if (!s.email.to && req.user && req.user.email) s.email.to = req.user.email;
  if (!s.email.smtp) s.email.smtp = {};
  if (!s.email.smtp.host) s.email.smtp.host = 'smtp.gmail.com';
  if (!s.email.smtp.port) s.email.smtp.port = 587;
  if (!s.email.smtp.user && req.user && req.user.email) s.email.smtp.user = req.user.email;
  if (!s.email.from && req.user && req.user.email) s.email.from = req.user.email;
  // Overlay env vars so the UI reflects the effective configuration
  if (process.env.SMTP_HOST) s.email.smtp.host = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) s.email.smtp.port = parseInt(process.env.SMTP_PORT);
  if (process.env.SMTP_USER) s.email.smtp.user = process.env.SMTP_USER;
  if (process.env.SMTP_FROM) s.email.from      = process.env.SMTP_FROM;
  // Signal to the frontend if password is saved or env-managed
  s.email.smtp.passFromEnv = !!process.env.SMTP_PASS;
  s.email.smtp.hasSavedPass = !!s.email.smtp.pass;
  
  // Never send the actual password back to the frontend!
  if (s.email && s.email.smtp) s.email.smtp.pass = '';
  res.json(s);
});

router.put('/settings', (req, res) => {
  const email = req.user.email;
  const allSettings = readSettings();
  const current = allSettings[email] || {};
  const updated = { ...current, ...req.body };

  // Preserve existing password if the new one is blank
  if (req.body.email?.smtp?.pass === '') {
    if (current.email?.smtp?.pass) {
      if (!updated.email) updated.email = {};
      if (!updated.email.smtp) updated.email.smtp = {};
      updated.email.smtp.pass = current.email.smtp.pass;
    }
  }

  // Default 'to' email and SMTP settings if not provided
  if (updated.email) {
    if (!updated.email.to || updated.email.to.trim() === '') {
      if (req.user && req.user.email) updated.email.to = req.user.email;
    }
    if (!updated.email.from || updated.email.from.trim() === '') {
      if (req.user && req.user.email) updated.email.from = req.user.email;
    }
    if (updated.email.smtp) {
      if (!updated.email.smtp.host || updated.email.smtp.host.trim() === '') {
        updated.email.smtp.host = 'smtp.gmail.com';
      }
      if (!updated.email.smtp.port) {
        updated.email.smtp.port = 587;
      }
      if (!updated.email.smtp.user || updated.email.smtp.user.trim() === '') {
        if (req.user && req.user.email) updated.email.smtp.user = req.user.email;
      }
    }
  }

  // Validate thresholds
  if (updated.thresholds) {
    updated.thresholds.critical = Math.max(1, parseInt(updated.thresholds.critical) || 7);
    updated.thresholds.warning = Math.max(updated.thresholds.critical + 1, parseInt(updated.thresholds.warning) || 30);
  }

  // Don't overwrite env-managed password with blank
  if (!updated.email?.smtp?.pass && process.env.SMTP_PASS) {
    if (updated.email && updated.email.smtp) updated.email.smtp.pass = '';
  }

  allSettings[email] = updated;
  writeSettings(allSettings);
  res.json(updated);
});

// --- Email ---

router.post('/email/test', async (req, res) => {
  const email = req.user.email;
  const allSettings = readSettings();
  const settings = allSettings[email] || {};
  
  if (!settings.email) {
    return res.status(400).json({ error: 'Email not configured' });
  }
  const result = await emailAlert.sendTestEmail(settings.email);
  res.json(result);
});

// --- Status ---

router.get('/status', (req, res) => {
  const email = req.user.email;
  const allDomains = readDomains();
  const domains = allDomains[email] || [];
  const results = scheduler.getResults();

  const counts = { total: domains.length, healthy: 0, warning: 0, critical: 0, expired: 0, error: 0, unknown: 0 };
  
  // Only count results for this user's domains
  const userDomainIds = new Set(domains.map(d => d.id));
  const userResults = results.filter(r => userDomainIds.has(r.id));

  for (const r of userResults) {
    if (counts.hasOwnProperty(r.status)) counts[r.status]++;
    else counts.unknown++;
  }

  res.json({
    counts,
    lastCheckTime: scheduler.getLastCheckTime(),
    checking: scheduler.isChecking(),
    logSources: logParser.discoverSources(),
  });
});

// --- Users ---

router.get('/users', requireAdmin, (req, res) => {
  const settings = readSettings();
  let users = settings.users || [];
  const master = users.find(u => u.email === 'jeng.ss.it@gmail.com');
  if (master) {
    master.role = 'admin';
  } else {
    users.unshift({ email: 'jeng.ss.it@gmail.com', role: 'admin', lastLogin: '' });
  }
  res.json(users);
});

router.post('/users', requireAdmin, (req, res) => {
  const settings = readSettings();
  const users = settings.users || [];
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Email and role required' });
  
  const existing = users.find(u => u.email === email);
  if (existing) {
    existing.role = role;
  } else {
    users.push({ email, role });
  }
  
  settings.users = users;
  writeSettings(settings);
  res.json(users);
});

router.delete('/users/:email', requireAdmin, (req, res) => {
  const settings = readSettings();
  const email = req.params.email;
  if (email === 'jeng.ss.it@gmail.com') return res.status(400).json({ error: 'Cannot delete primary admin' });
  
  const users = settings.users || [];
  settings.users = users.filter(u => u.email !== email);
  
  // Clean up user's private settings
  delete settings[email];
  writeSettings(settings);

  // Clean up user's private domains
  const allDomains = readDomains();
  if (allDomains[email]) {
    delete allDomains[email];
    writeDomains(allDomains);
  }

  res.json(settings.users);
});

module.exports = { router, readDomains, readSettings, writeSettings };
