const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Auto-discover certbot and win-acme log/config directories.
 */
function discoverSources() {
  const sources = [];
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    // Win-ACME default locations
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    const winAcmeBase = path.join(programData, 'win-acme');
    if (fs.existsSync(winAcmeBase)) {
      try {
        const subdirs = fs.readdirSync(winAcmeBase);
        for (const sub of subdirs) {
          const logDir = path.join(winAcmeBase, sub, 'Log');
          if (fs.existsSync(logDir)) {
            sources.push({ type: 'win-acme', path: logDir });
          }
        }
      } catch (_) { }
    }

    // Certbot on Windows
    const certbotLog = 'C:\\Certbot\\log\\letsencrypt.log';
    if (fs.existsSync(certbotLog)) {
      sources.push({ type: 'certbot', path: certbotLog });
    }
  } else {
    // Linux certbot
    const certbotPaths = [
      '/var/log/letsencrypt/letsencrypt.log',
      '/var/log/letsencrypt',
    ];
    for (const p of certbotPaths) {
      if (fs.existsSync(p)) {
        sources.push({ type: 'certbot', path: p });
        break;
      }
    }
  }

  return sources;
}

/**
 * Parse certbot log for renewal events.
 */
function parseCertbotLog(logPath, maxEntries = 100) {
  const entries = [];
  try {
    let content;
    if (fs.statSync(logPath).isDirectory()) {
      // Read most recent log file
      const files = fs.readdirSync(logPath)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();
      if (files.length === 0) return entries;
      content = fs.readFileSync(path.join(logPath, files[0]), 'utf-8');
    } else {
      content = fs.readFileSync(logPath, 'utf-8');
    }

    const lines = content.split('\n');
    const renewPattern = /(\d{4}-\d{2}-\d{2}\s[\d:,]+)\s.*?(Renewing|Renewal|renew|certificate|cert)/i;
    const successPattern = /success|congratulations|renewed|saved/i;
    const failPattern = /fail|error|exception|problem|timeout/i;

    for (const line of lines) {
      const match = line.match(renewPattern);
      if (match) {
        let status = 'info';
        if (successPattern.test(line)) status = 'success';
        else if (failPattern.test(line)) status = 'failure';

        // Try to extract domain
        const domainMatch = line.match(/(?:for|domain[s]?:?)\s+([\w.-]+\.\w+)/i);
        const domain = domainMatch ? domainMatch[1] : null;

        entries.push({
          timestamp: match[1],
          source: 'certbot',
          status,
          domain,
          message: line.trim().substring(0, 300),
        });
      }
    }
  } catch (err) {
    entries.push({
      timestamp: new Date().toISOString(),
      source: 'certbot',
      status: 'error',
      domain: null,
      message: `Failed to read log: ${err.message}`,
    });
  }

  return entries.slice(-maxEntries);
}

/**
 * Parse win-acme log directory for renewal events.
 */
function parseWinAcmeLog(logDir, maxEntries = 100) {
  const entries = [];
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log') || f.endsWith('.txt'))
      .sort()
      .reverse()
      .slice(0, 5); // Last 5 log files

    for (const file of files) {
      const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        // Win-acme serilog format: {Timestamp} [{Level}] {Message}
        const match = line.match(/^(\d{4}-\d{2}-\d{2}\s[\d:.]+)\s+\[(\w+)\]\s+(.*)/);
        if (match) {
          const [, timestamp, level, message] = match;
          const isRenewalRelated = /renew|certificate|order|validation|store|install/i.test(message);
          if (!isRenewalRelated) continue;

          let status = 'info';
          if (/succeeded|success|complete/i.test(message)) status = 'success';
          else if (/error|fail|fatal/i.test(message)) status = 'failure';
          else if (level === 'Warning') status = 'warning';

          const domainMatch = message.match(/([\w.-]+\.\w{2,})/);
          entries.push({
            timestamp,
            source: 'win-acme',
            status,
            domain: domainMatch ? domainMatch[1] : null,
            message: message.substring(0, 300),
          });
        }
      }
    }
  } catch (err) {
    entries.push({
      timestamp: new Date().toISOString(),
      source: 'win-acme',
      status: 'error',
      domain: null,
      message: `Failed to read log: ${err.message}`,
    });
  }

  return entries.slice(-maxEntries).reverse();
}

/**
 * Get all logs from all discovered sources.
 */
function getAllLogs(maxEntries = 100) {
  const sources = discoverSources();
  let allEntries = [];

  for (const source of sources) {
    if (source.type === 'certbot') {
      allEntries = allEntries.concat(parseCertbotLog(source.path, maxEntries));
    } else if (source.type === 'win-acme') {
      allEntries = allEntries.concat(parseWinAcmeLog(source.path, maxEntries));
    }
  }

  // Sort by timestamp descending
  allEntries.sort((a, b) => {
    try {
      return new Date(b.timestamp) - new Date(a.timestamp);
    } catch (_) {
      return 0;
    }
  });

  return {
    sources: sources.map(s => ({ type: s.type, path: s.path })),
    entries: allEntries.slice(0, maxEntries),
  };
}

module.exports = { discoverSources, parseCertbotLog, parseWinAcmeLog, getAllLogs };
