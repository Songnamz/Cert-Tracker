const tls = require('tls');

/**
 * Probes a domain's SSL certificate via TLS connection.
 * @param {string} domain - The domain name (used for SNI)
 * @param {object} opts - Options
 * @param {number} opts.port - Port to connect to (default 443)
 * @param {string} opts.resolveHost - IP/hostname to connect to instead of DNS resolution (for split-brain DNS / origin servers behind CDN)
 * @param {number} opts.timeoutMs - Connection timeout in ms (default 10000)
 * Returns certificate details including issuer, validity, days remaining, and status.
 */
function checkCertificate(domain, opts = {}) {
  const port = opts.port || 443;
  const resolveHost = opts.resolveHost || null;
  const timeoutMs = opts.timeoutMs || 10000;

  return new Promise((resolve) => {
    const result = {
      domain,
      port,
      resolveHost: resolveHost || null,
      status: 'unknown',
      error: null,
      certificate: null,
      daysRemaining: null,
      checkedAt: new Date().toISOString(),
    };

    const options = {
      host: resolveHost || domain,  // Connect to specific IP or resolve via DNS
      port,
      servername: domain, // SNI — always use the domain name for cert selection
      rejectUnauthorized: false, // We still want to see expired certs
      timeout: timeoutMs,
    };

    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        result.status = 'error';
        result.error = `Connection timed out after ${timeoutMs}ms`;
        try { socket.destroy(); } catch (_) {}
        resolve(result);
      }
    }, timeoutMs + 500);

    const socket = tls.connect(options, () => {
      if (settled) return;

      const cert = socket.getPeerCertificate(true);

      if (!cert || !cert.valid_to) {
        settled = true;
        clearTimeout(timer);
        result.status = 'error';
        result.error = 'No certificate returned';
        socket.end();
        resolve(result);
        return;
      }

      const now = new Date();
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);
      const msRemaining = validTo.getTime() - now.getTime();
      const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

      // Extract Subject Alternative Names
      const sans = cert.subjectaltname
        ? cert.subjectaltname.split(', ').map(s => s.replace('DNS:', ''))
        : [];

      // Build issuer string
      const issuerParts = [];
      if (cert.issuer) {
        if (cert.issuer.O) issuerParts.push(cert.issuer.O);
        if (cert.issuer.CN) issuerParts.push(cert.issuer.CN);
      }
      const issuerStr = issuerParts.join(' — ') || 'Unknown';

      // Build subject string
      const subjectStr = cert.subject ? (cert.subject.CN || 'Unknown') : 'Unknown';

      result.certificate = {
        subject: subjectStr,
        issuer: issuerStr,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        serialNumber: cert.serialNumber || '',
        fingerprint: cert.fingerprint || '',
        fingerprint256: cert.fingerprint256 || '',
        sans,
        protocol: socket.getProtocol ? socket.getProtocol() : 'unknown',
      };

      result.daysRemaining = daysRemaining;
      result.authorized = socket.authorized;

      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(result);
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result.status = 'error';
      result.error = err.message || String(err);
      resolve(result);
    });

    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result.status = 'error';
      result.error = 'Socket timed out';
      socket.destroy();
      resolve(result);
    });
  });
}

/**
 * Classify status based on days remaining and thresholds.
 */
function classifyStatus(result, thresholds = { critical: 7, warning: 30 }) {
  if (result.error) {
    result.status = 'error';
  } else if (result.daysRemaining !== null && result.daysRemaining < 0) {
    result.status = 'expired';
  } else if (result.daysRemaining !== null && result.daysRemaining <= thresholds.critical) {
    result.status = 'critical';
  } else if (result.daysRemaining !== null && result.daysRemaining <= thresholds.warning) {
    result.status = 'warning';
  } else if (result.daysRemaining !== null) {
    result.status = 'healthy';
  }
  return result;
}

/**
 * Check multiple domains concurrently with a concurrency limit.
 */
async function checkMultiple(domains, thresholds, concurrency = 5) {
  const results = [];
  const queue = [...domains];

  async function worker() {
    while (queue.length > 0) {
      const domainEntry = queue.shift();
      const domain = typeof domainEntry === 'string' ? domainEntry : domainEntry.domain;
      const id = typeof domainEntry === 'string' ? null : domainEntry.id;
      const resolveHost = typeof domainEntry === 'object' ? domainEntry.resolveHost : null;
      const port = typeof domainEntry === 'object' ? (domainEntry.port || 443) : 443;
      let res = await checkCertificate(domain, { port, resolveHost });
      res = classifyStatus(res, thresholds);
      if (id) res.id = id;
      if (domainEntry.label) res.label = domainEntry.label;
      if (resolveHost) res.resolveHost = resolveHost;
      results.push(res);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, domains.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

module.exports = { checkCertificate, classifyStatus, checkMultiple };
