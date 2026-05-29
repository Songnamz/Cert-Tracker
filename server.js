const express = require('express');
const cors = require('cors');
const path = require('path');
const { router: apiRouter, readDomains, readSettings } = require('./src/routes/api');
const scheduler = require('./src/services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRouter);

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n  🔒 Cert Tracker running at http://localhost:${PORT}\n`);

  // Start cron scheduler
  scheduler.startCron(readDomains, readSettings);

  // Run initial check on startup
  const domains = readDomains();
  const settings = readSettings();
  if (domains.length > 0) {
    console.log(`  📡 Running initial check on ${domains.length} domains...\n`);
    scheduler.runCheck(domains, settings);
  }
});
