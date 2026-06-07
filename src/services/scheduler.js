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
async function runCheck(allDomainsMap, allSettingsMap, isPartial = false) {
  if (checkInProgress) {
    return { status: 'already-running' };
  }

  checkInProgress = true;

  try {
    let allResults = [];
    let totalDomains = 0;

    // Handle legacy flat array
    if (Array.isArray(allDomainsMap)) {
      const thresholds = allSettingsMap.thresholds || { critical: 7, warning: 30 };
      allResults = await checkMultiple(allDomainsMap, thresholds, 5);
      
      if (allSettingsMap.email && allSettingsMap.email.enabled) {
        const alertable = filterAlertable(allResults, allSettingsMap.email);
        if (alertable.length > 0) await sendAlert(allSettingsMap.email, alertable);
      }
    } else {
      // Multi-tenant logic
      for (const [email, userDomains] of Object.entries(allDomainsMap)) {
        if (!Array.isArray(userDomains) || userDomains.length === 0) continue;
        const userSettings = allSettingsMap[email] || { thresholds: { critical: 7, warning: 30 } };
        const thresholds = userSettings.thresholds || { critical: 7, warning: 30 };
        
        const results = await checkMultiple(userDomains, thresholds, 5);
        allResults = allResults.concat(results);
        totalDomains += userDomains.length;

        // Send email alerts for this user if configured
        if (userSettings.email && userSettings.email.enabled) {
          const alertable = filterAlertable(results, userSettings.email);
          if (alertable.length > 0) {
            await sendAlert(userSettings.email, alertable);
          }
        }
      }
    }

    if (isPartial) {
      for (const r of allResults) {
        const idx = cachedResults.findIndex(c => c.id === r.id);
        if (idx >= 0) cachedResults[idx] = r;
        else cachedResults.push(r);
      }
    } else {
      cachedResults = allResults;
    }

    lastCheckTime = new Date().toISOString();
    saveResults();

    return { status: 'completed', count: allResults.length };
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
