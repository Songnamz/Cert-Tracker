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

function readDomains() {
  try {
    return JSON.parse(fs.readFileSync(DOMAINS_PATH, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function writeDomains(domains) {
  const dir = path.dirname(DOMAINS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DOMAINS_PATH, JSON.stringify(domains, null, 2));
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (_) {
    return {
      thresholds: { critical: 7, warning: 30 },
      checkIntervalHours: 6,
      email: { enabled: false, smtp: {}, from: '', to: '' },
    };
  }
}

function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// --- Domains ---

// GET /api/domains — list all domains with cert results
router.get('/domains', (req, res) => {
  const domains = readDomains();
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

  const domains = readDomains();
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
  writeDomains(domains);

  // Immediately check the new domain
  const settings = readSettings();
  scheduler.runSingleCheck(entry, settings).then(result => {
    // Result is cached by scheduler
  });

  res.status(201).json(entry);
});

// DELETE /api/domains/:id — remove a domain
router.delete('/domains/:id', (req, res) => {
  const { id } = req.params;
  let domains = readDomains();
  const before = domains.length;
  domains = domains.filter(d => d.id !== id);

  if (domains.length === before) {
    return res.status(404).json({ error: 'Domain not found' });
  }

  writeDomains(domains);
  scheduler.removeCachedResult(id);
  res.json({ success: true });
});

// POST /api/domains/:id/check — re-check a single domain
router.post('/domains/:id/check', async (req, res) => {
  const { id } = req.params;
  const domains = readDomains();
  const domain = domains.find(d => d.id === id);

  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }

  const settings = readSettings();
  const result = await scheduler.runSingleCheck(domain, settings);
  res.json(result);
});

// --- Check All ---

router.post('/check-all', async (req, res) => {
  const domains = readDomains();
  const settings = readSettings();

  if (scheduler.isChecking()) {
    return res.json({ status: 'already-running' });
  }

  // Run async — don't block
  scheduler.runCheck(domains, settings);
  res.json({ status: 'started', count: domains.length });
});

// --- Logs ---

router.get('/logs', (req, res) => {
  const logs = logParser.getAllLogs(100);
  res.json(logs);
});

// --- Settings ---

router.get('/settings', (req, res) => {
  res.json(readSettings());
});

router.put('/settings', (req, res) => {
  const current = readSettings();
  const updated = { ...current, ...req.body };

  // Validate thresholds
  if (updated.thresholds) {
    updated.thresholds.critical = Math.max(1, parseInt(updated.thresholds.critical) || 7);
    updated.thresholds.warning = Math.max(updated.thresholds.critical + 1, parseInt(updated.thresholds.warning) || 30);
  }

  writeSettings(updated);
  res.json(updated);
});

// --- Email ---

router.post('/email/test', async (req, res) => {
  const settings = readSettings();
  if (!settings.email) {
    return res.status(400).json({ error: 'Email not configured' });
  }
  const result = await emailAlert.sendTestEmail(settings.email);
  res.json(result);
});

// --- Status ---

router.get('/status', (req, res) => {
  const domains = readDomains();
  const results = scheduler.getResults();

  const counts = { total: domains.length, healthy: 0, warning: 0, critical: 0, expired: 0, error: 0, unknown: 0 };
  for (const r of results) {
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

module.exports = { router, readDomains, readSettings };
