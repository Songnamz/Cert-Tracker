const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { checkMultiple, classifyStatus } = require('./certChecker');
const { filterAlertable, sendAlert } = require('./emailAlert');

const RESULTS_PATH = path.join(__dirname, '..', '..', 'data', 'results.json');

let cachedResults = [];
let lastCheckTime = null;
let checkInProgress = false;
let cronJob = null;

/**
 * Load cached results from disk.
 */
function loadResults() {
  try {
    if (fs.existsSync(RESULTS_PATH)) {
      const data = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
      cachedResults = data.results || [];
      lastCheckTime = data.lastCheckTime || null;
    }
  } catch (_) {
    cachedResults = [];
  }
}

/**
 * Save results to disk.
 */
function saveResults() {
  try {
    const dir = path.dirname(RESULTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RESULTS_PATH, JSON.stringify({
      lastCheckTime,
      results: cachedResults,
    }, null, 2));
  } catch (err) {
    console.error('Failed to save results:', err.message);
  }
}

/**
 * Run a full check on all domains.
 */
async function runCheck(domains, settings) {
  if (checkInProgress) {
    return { status: 'already-running' };
  }

  checkInProgress = true;
  console.log(`[Scheduler] Starting check of ${domains.length} domains...`);

  try {
    const thresholds = settings.thresholds || { critical: 7, warning: 30 };
    const results = await checkMultiple(domains, thresholds, 5);
    cachedResults = results;
    lastCheckTime = new Date().toISOString();
    saveResults();

    console.log(`[Scheduler] Check complete. ${results.length} domains checked.`);

    // Send email alerts if configured
    if (settings.email && settings.email.enabled) {
      const alertable = filterAlertable(results, settings.email);
      if (alertable.length > 0) {
        console.log(`[Scheduler] Sending email alert for ${alertable.length} domains...`);
        const emailResult = await sendAlert(settings.email, alertable);
        console.log(`[Scheduler] Email: ${emailResult.sent ? 'sent' : emailResult.reason}`);
      }
    }

    return { status: 'completed', count: results.length };
  } catch (err) {
    console.error('[Scheduler] Check failed:', err.message);
    return { status: 'error', error: err.message };
  } finally {
    checkInProgress = false;
  }
}

/**
 * Check a single domain and update cache.
 */
async function runSingleCheck(domainEntry, settings) {
  const { checkCertificate } = require('./certChecker');
  const thresholds = settings.thresholds || { critical: 7, warning: 30 };

  let result = await checkCertificate(domainEntry.domain, {
    resolveHost: domainEntry.resolveHost || null,
    port: domainEntry.port || 443,
  });
  result = classifyStatus(result, thresholds);
  result.id = domainEntry.id;
  if (domainEntry.label) result.label = domainEntry.label;
  if (domainEntry.resolveHost) result.resolveHost = domainEntry.resolveHost;

  // Update or add to cache
  const idx = cachedResults.findIndex(r => r.id === domainEntry.id);
  if (idx >= 0) {
    cachedResults[idx] = result;
  } else {
    cachedResults.push(result);
  }
  saveResults();

  return result;
}

/**
 * Start the cron schedule.
 */
function startCron(getDomains, getSettings) {
  loadResults();

  const intervalHours = 6;
  // Run every N hours
  const cronExpr = `0 */${intervalHours} * * *`;

  if (cronJob) cronJob.stop();

  cronJob = cron.schedule(cronExpr, async () => {
    const domains = getDomains();
    const settings = getSettings();
    await runCheck(domains, settings);
  });

  console.log(`[Scheduler] Cron started: checking every ${intervalHours} hours`);
}

function getResults() {
  return cachedResults;
}

function getLastCheckTime() {
  return lastCheckTime;
}

function isChecking() {
  return checkInProgress;
}

/**
 * Remove domain result from cache by ID.
 */
function removeCachedResult(id) {
  cachedResults = cachedResults.filter(r => r.id !== id);
  saveResults();
}

module.exports = {
  loadResults,
  runCheck,
  runSingleCheck,
  startCron,
  getResults,
  getLastCheckTime,
  isChecking,
  removeCachedResult,
};
