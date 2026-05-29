/* ===== CERT TRACKER — FRONTEND APP ===== */

const API = '';
let domainData = [];
let activeFilter = 'all';
let searchQuery = '';
let settings = {};
let refreshInterval = null;
let collapsedGroups = {}; // Track which groups are collapsed
let activeGroup = 'all';  // Track which sidebar menu item is selected

// ===== INIT =====

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  // Verify session before rendering the app
  try {
    const res = await fetch('/api/auth/check');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = data.email || '';
  } catch {
    window.location.href = '/login';
    return;
  }

  loadSettings();
  loadDomains();
  setupEventListeners();
  startAutoRefresh();
  requestNotificationPermission();
});

// ===== DATA FETCHING =====

async function loadDomains() {
  try {
    const res = await fetch(`${API}/api/domains`);
    const data = await res.json();
    domainData = data.domains || [];
    updateStats(domainData);
    updateLastCheck(data.lastCheckTime, data.checking);
    renderSidebar(groupDomains(domainData));
    renderDomainGroups(domainData);
    checkForAlerts(domainData);
  } catch (err) {
    console.error('Failed to load domains:', err);
    showToast('Failed to load domain data', 'error');
  }
}

async function loadSettings() {
  try {
    const res = await fetch(`${API}/api/settings`);
    settings = await res.json();
    populateSettingsForm(settings);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// ===== STATS =====

function updateStats(domains) {
  const counts = { total: domains.length, healthy: 0, warning: 0, critical: 0, expired: 0, error: 0 };
  for (const d of domains) {
    const status = d.result ? d.result.status : 'unknown';
    if (counts.hasOwnProperty(status)) counts[status]++;
  }

  document.getElementById('stat-total').textContent = counts.total;
  document.getElementById('stat-healthy').textContent = counts.healthy;
  document.getElementById('stat-warning').textContent = counts.warning;
  document.getElementById('stat-critical').textContent = counts.critical;
  document.getElementById('stat-expired').textContent = counts.expired;
  document.getElementById('stat-error').textContent = counts.error;

  // Update filter pill counts
  document.querySelectorAll('.filter-pill').forEach(pill => {
    const filter = pill.dataset.filter;
    const existing = pill.querySelector('.pill-count');
    if (existing) existing.remove();

    let count;
    if (filter === 'all') count = counts.total;
    else count = counts[filter] || 0;

    if (count > 0 && filter !== 'all') {
      const span = document.createElement('span');
      span.className = 'pill-count';
      span.textContent = `(${count})`;
      pill.appendChild(span);
    }
  });
}

function updateLastCheck(time, checking) {
  const el = document.getElementById('last-check-text');
  const bar = document.getElementById('last-check-bar');

  if (checking) {
    el.textContent = 'Checking certificates...';
    bar.classList.add('checking');
  } else if (time) {
    const d = new Date(time);
    const ago = timeAgo(d);
    el.textContent = `Last checked ${ago}`;
    bar.classList.remove('checking');
  } else {
    el.textContent = 'Never checked';
    bar.classList.remove('checking');
  }
}

// ===== DOMAIN GROUPING =====

/**
 * Extract the base/parent domain from a full domain name.
 * e.g., "adbulk.songnam.xyz" → "songnam.xyz"
 *       "apiu.edu" → "apiu.edu"
 *       "fit.apiu.edu" → "apiu.edu"
 */
function getBaseDomain(domain) {
  const parts = domain.split('.');
  if (parts.length <= 2) return domain; // already a base domain

  // Known two-part TLDs could be expanded, but for simplicity
  // take the last 2 parts as the base domain
  return parts.slice(-2).join('.');
}

/**
 * Check if a domain is a subdomain (not the base domain itself).
 */
function isSubdomain(domain) {
  const parts = domain.split('.');
  return parts.length > 2;
}

/**
 * Group domains by their parent/base domain.
 * Returns an ordered array of { baseDomain, domains: [...] }
 */
function groupDomains(domains) {
  const groups = {};

  for (const d of domains) {
    const base = getBaseDomain(d.domain);
    if (!groups[base]) {
      groups[base] = [];
    }
    groups[base].push(d);
  }

  // Sort: put the base domain first in each group, then subdomains alphabetically
  const result = [];
  for (const [baseDomain, entries] of Object.entries(groups)) {
    entries.sort((a, b) => {
      // Base domain comes first
      if (a.domain === baseDomain) return -1;
      if (b.domain === baseDomain) return 1;
      return a.domain.localeCompare(b.domain);
    });
    result.push({ baseDomain, domains: entries });
  }

  // Sort groups alphabetically by base domain
  result.sort((a, b) => a.baseDomain.localeCompare(b.baseDomain));

  return result;
}

/**
 * Get status summary for a group of domains.
 */
function getGroupStatusSummary(domains) {
  const counts = { healthy: 0, warning: 0, critical: 0, expired: 0, error: 0, unknown: 0 };
  for (const d of domains) {
    const status = d.result ? d.result.status : 'unknown';
    if (counts.hasOwnProperty(status)) counts[status]++;
    else counts.unknown++;
  }
  return counts;
}

function getWorstStatusFromSummary(summary) {
  if (summary.expired > 0) return 'expired';
  if (summary.critical > 0) return 'critical';
  if (summary.warning > 0) return 'warning';
  if (summary.error > 0) return 'error';
  if (summary.healthy > 0) return 'healthy';
  return 'unknown';
}

// ===== SIDEBAR =====

function renderSidebar(groups) {
  const sidebar = document.getElementById('sidebar');

  const allWorst = getWorstStatusFromSummary(getGroupStatusSummary(domainData));

  let html = `<div class="sidebar-title">Groups</div>`;
  html += `
    <div class="sidebar-item ${activeGroup === 'all' ? 'active' : ''}" onclick="selectGroup('all')">
      <span class="sidebar-item-dot" style="background:${getStrokeColor(allWorst)};"></span>
      <span class="sidebar-item-name">All Domains</span>
      <span class="sidebar-item-count">${domainData.length}</span>
    </div>
    <div class="sidebar-divider"></div>
  `;

  for (const group of groups) {
    const worst = getWorstStatusFromSummary(getGroupStatusSummary(group.domains));
    const isActive = activeGroup === group.baseDomain;
    html += `
      <div class="sidebar-item ${isActive ? 'active' : ''}" onclick="selectGroup('${group.baseDomain}')">
        <span class="sidebar-item-dot" style="background:${getStrokeColor(worst)};"></span>
        <span class="sidebar-item-name" title="${escapeHtml(group.baseDomain)}">${escapeHtml(group.baseDomain)}</span>
        <span class="sidebar-item-count">${group.domains.length}</span>
      </div>
    `;
  }

  sidebar.innerHTML = html;
}

function selectGroup(groupName) {
  activeGroup = groupName;
  renderSidebar(groupDomains(domainData));
  renderDomainGroups(domainData);
}

// ===== DOMAIN GRID (GROUPED) =====

function renderDomainGroups(domains) {
  const container = document.getElementById('domain-groups');
  let filtered = domains;

  // Filter by active sidebar group
  if (activeGroup !== 'all') {
    filtered = filtered.filter(d => getBaseDomain(d.domain) === activeGroup);
  }

  // Apply status filter
  if (activeFilter !== 'all') {
    filtered = filtered.filter(d => {
      const status = d.result ? d.result.status : 'unknown';
      return status === activeFilter;
    });
  }

  // Apply search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(d => d.domain.toLowerCase().includes(q));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>No domains found</h3>
        <p>${searchQuery ? 'Try adjusting your search.' : activeFilter !== 'all' ? 'No domains match this filter.' : 'Add your first domain to get started.'}</p>
        ${!searchQuery && activeFilter === 'all' && activeGroup === 'all' ? '<button class="btn btn-primary" onclick="openModal(\'add-domain-modal\')"><span>+</span> Add Domain</button>' : ''}
      </div>`;
    return;
  }

  // Single group selected — flat card grid, no collapsible headers
  if (activeGroup !== 'all') {
    let cardIndex = 0;
    const cardsHtml = filtered.map(d => renderDomainCard(d, cardIndex++)).join('');
    container.innerHTML = `<div class="domain-grid">${cardsHtml}</div>`;
    return;
  }

  // All groups view — grouped with collapsible headers
  const groups = groupDomains(filtered);
  let cardIndex = 0;

  container.innerHTML = groups.map(group => {
    const statusSummary = getGroupStatusSummary(group.domains);
    const isCollapsed = collapsedGroups[group.baseDomain] === true;

    const statusDots = [];
    if (statusSummary.healthy > 0) statusDots.push(`<span class="group-status-dot healthy">${statusSummary.healthy} ✓</span>`);
    if (statusSummary.warning > 0) statusDots.push(`<span class="group-status-dot warning">${statusSummary.warning} ⚠</span>`);
    if (statusSummary.critical > 0) statusDots.push(`<span class="group-status-dot critical">${statusSummary.critical} 🔴</span>`);
    if (statusSummary.expired > 0) statusDots.push(`<span class="group-status-dot expired">${statusSummary.expired} ✕</span>`);
    if (statusSummary.error > 0) statusDots.push(`<span class="group-status-dot error">${statusSummary.error} ⚡</span>`);

    let groupEmoji = '🟢';
    if (statusSummary.error > 0) groupEmoji = '⚡';
    if (statusSummary.warning > 0) groupEmoji = '🟡';
    if (statusSummary.critical > 0) groupEmoji = '🔴';
    if (statusSummary.expired > 0) groupEmoji = '🔴';

    const subdomainCount = group.domains.filter(d => isSubdomain(d.domain)).length;
    const countText = subdomainCount > 0
      ? `${group.domains.length} domain${group.domains.length > 1 ? 's' : ''} · ${subdomainCount} subdomain${subdomainCount !== 1 ? 's' : ''}`
      : `${group.domains.length} domain${group.domains.length > 1 ? 's' : ''}`;

    const cardsHtml = group.domains.map(d => renderDomainCard(d, cardIndex++)).join('');

    return `
      <div class="domain-group ${isCollapsed ? 'collapsed' : ''}" data-group="${group.baseDomain}">
        <div class="group-header" onclick="toggleGroup('${group.baseDomain}')">
          <span class="group-chevron">▼</span>
          <div class="group-icon">${groupEmoji}</div>
          <div class="group-info">
            <div class="group-name">${escapeHtml(group.baseDomain)}</div>
            <div class="group-meta">
              <span class="group-count">${countText}</span>
              <div class="group-status-dots">${statusDots.join('')}</div>
            </div>
          </div>
        </div>
        <div class="group-body">
          <div class="domain-grid">${cardsHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleGroup(baseDomain) {
  collapsedGroups[baseDomain] = !collapsedGroups[baseDomain];
  const groupEl = document.querySelector(`.domain-group[data-group="${baseDomain}"]`);
  if (groupEl) {
    groupEl.classList.toggle('collapsed');
  }
}

function renderDomainCard(domainEntry, index) {
  const { domain, id, result, resolveHost, label } = domainEntry;
  const status = result ? result.status : 'unknown';
  const days = result && result.daysRemaining !== null ? result.daysRemaining : null;
  const cert = result ? result.certificate : null;

  const issuer = cert ? cert.issuer : '—';
  const validTo = cert ? formatDate(cert.validTo) : '—';
  const validFrom = cert ? formatDate(cert.validFrom) : '—';
  const error = result ? result.error : null;

  const baseDomain = getBaseDomain(domain);
  const displayDomain = domain === baseDomain ? domain : domain;

  // Countdown ring
  const maxDays = 90;
  const progress = days !== null ? Math.max(0, Math.min(1, days / maxDays)) : 0;
  const circumference = 2 * Math.PI * 34;
  const dashOffset = circumference * (1 - progress);
  const strokeColor = getStrokeColor(status);

  const daysDisplay = days !== null ? (days < 0 ? Math.abs(days) : days) : '?';
  const daysLabel = days !== null ? (days < 0 ? 'EXPIRED' : 'DAYS') : '';

  return `
    <div class="domain-card status-${status} fade-in" 
         style="animation-delay: ${index * 40}ms"
         onclick="openDetail('${id}')" 
         data-id="${id}">
      <div class="card-header">
        <div>
          <div class="card-domain">${escapeHtml(label || displayDomain)}</div>
          ${label ? `<div class="card-subdomain">${escapeHtml(displayDomain)}</div>` : ''}
          ${resolveHost ? `<div class="card-origin-host">→ ${escapeHtml(resolveHost)}</div>` : ''}
          <div class="card-issuer">${escapeHtml(issuer)}</div>
        </div>
        <span class="status-badge ${status}">
          <span class="badge-dot"></span>
          ${status === 'unknown' ? 'Checking...' : status}
        </span>
      </div>

      ${error ? `
        <div class="card-error-msg">
          <span class="error-icon">⚠️</span>
          <span>${escapeHtml(error.substring(0, 120))}</span>
        </div>
      ` : `
        <div class="card-countdown">
          <div class="countdown-ring">
            <svg viewBox="0 0 76 76">
              <circle class="ring-bg" cx="38" cy="38" r="34"></circle>
              <circle class="ring-progress" cx="38" cy="38" r="34"
                stroke="${strokeColor}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${dashOffset}">
              </circle>
            </svg>
            <div class="ring-center">
              <div class="ring-days">${daysDisplay}</div>
              <div class="ring-label">${daysLabel}</div>
            </div>
          </div>
          <div class="countdown-details">
            <div class="countdown-detail-row">
              <span class="label">Expires</span>
              <span class="value">${validTo}</span>
            </div>
            <div class="countdown-detail-row">
              <span class="label">Issued</span>
              <span class="value">${validFrom}</span>
            </div>
            <div class="countdown-detail-row">
              <span class="label">Protocol</span>
              <span class="value">${cert && cert.protocol ? cert.protocol : '—'}</span>
            </div>
          </div>
        </div>
      `}

      <div class="card-actions">
        <button class="btn btn-sm" onclick="event.stopPropagation(); recheckDomain('${id}', this)">
          ⟳ Check Now
        </button>
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteDomain('${id}', '${escapeHtml(domain)}')">
          ✕ Remove
        </button>
      </div>
    </div>
  `;
}

function getStrokeColor(status) {
  switch (status) {
    case 'healthy': return '#10b981';
    case 'warning': return '#f59e0b';
    case 'critical': return '#ef4444';
    case 'expired': return '#dc2626';
    case 'error': return '#6b7280';
    default: return '#475569';
  }
}

// ===== DOMAIN ACTIONS =====

async function recheckDomain(id, btn) {
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Checking';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/domains/${id}/check`, { method: 'POST' });
    if (!res.ok) throw new Error('Check failed');
    showToast('Certificate check complete', 'success');
    await loadDomains();
  } catch (err) {
    showToast('Failed to check certificate', 'error');
  } finally {
    btn.innerHTML = origHTML;
    btn.disabled = false;
  }
}

async function deleteDomain(id, name) {
  if (!confirm(`Remove "${name}" from tracking?`)) return;

  try {
    const res = await fetch(`${API}/api/domains/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast(`Removed ${name}`, 'info');
    await loadDomains();
  } catch (err) {
    showToast('Failed to remove domain', 'error');
  }
}

async function addDomain(domain, resolveHost = null, label = null) {
  try {
    const body = { domain };
    if (resolveHost) body.resolveHost = resolveHost;
    if (label) body.label = label;

    const res = await fetch(`${API}/api/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      showToast('Domain already exists', 'error');
      return;
    }
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Failed to add domain', 'error');
      return;
    }

    showToast(`Added ${label || domain}`, 'success');
    closeModal('add-domain-modal');
    document.getElementById('new-domain').value = '';
    document.getElementById('new-resolve-host').value = '';
    document.getElementById('new-label').value = '';

    // Wait a moment for initial check
    setTimeout(() => loadDomains(), 2000);
    loadDomains();
  } catch (err) {
    showToast('Failed to add domain', 'error');
  }
}

async function refreshAll() {
  const btn = document.getElementById('btn-refresh-all');
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Checking...';
  btn.disabled = true;

  try {
    await fetch(`${API}/api/check-all`, { method: 'POST' });
    showToast('Certificate check started for all domains', 'info');

    // Poll for completion
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      await loadDomains();
      const bar = document.getElementById('last-check-bar');
      if (!bar.classList.contains('checking') || attempts > 60) {
        clearInterval(poll);
        btn.innerHTML = origHTML;
        btn.disabled = false;
        if (attempts <= 60) showToast('All certificates checked', 'success');
      }
    }, 3000);
  } catch (err) {
    showToast('Failed to start check', 'error');
    btn.innerHTML = origHTML;
    btn.disabled = false;
  }
}

// ===== DETAIL MODAL =====

function openDetail(id) {
  const entry = domainData.find(d => d.id === id);
  if (!entry) return;

  const { domain, result, resolveHost, label } = entry;
  const cert = result ? result.certificate : null;
  const status = result ? result.status : 'unknown';

  document.getElementById('detail-modal-title').textContent = label || domain;

  const body = document.getElementById('detail-modal-body');

  if (!result || result.error) {
    body.innerHTML = `
      <div class="card-error-msg" style="margin:0;">
        <span class="error-icon">⚠️</span>
        <span>${escapeHtml(result ? result.error : 'No data available yet')}</span>
      </div>
    `;
    openModal('detail-modal');
    return;
  }

  const days = result.daysRemaining;

  body.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">Status</div>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
        <span class="status-badge ${status}">
          <span class="badge-dot"></span>
          ${status}
        </span>
        <span style="font-size:1.5rem; font-weight:700; color:${getStrokeColor(status)};">
          ${days !== null ? (days < 0 ? `${Math.abs(days)} days ago` : `${days} days left`) : 'N/A'}
        </span>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Certificate Info</div>
      <div class="detail-grid">
        ${label ? `
        <div class="detail-item full-width">
          <div class="label">Domain</div>
          <div class="value">${escapeHtml(domain)}</div>
        </div>` : ''}
        ${resolveHost ? `
        <div class="detail-item full-width">
          <div class="label">Origin Host (bypasses public DNS)</div>
          <div class="value" style="font-family:monospace;">${escapeHtml(resolveHost)}</div>
        </div>` : ''}
        <div class="detail-item">
          <div class="label">Subject</div>
          <div class="value">${escapeHtml(cert.subject || '—')}</div>
        </div>
        <div class="detail-item">
          <div class="label">Issuer</div>
          <div class="value">${escapeHtml(cert.issuer || '—')}</div>
        </div>
        <div class="detail-item">
          <div class="label">Valid From</div>
          <div class="value">${cert.validFrom ? formatDate(cert.validFrom) : '—'}</div>
        </div>
        <div class="detail-item">
          <div class="label">Valid To</div>
          <div class="value">${cert.validTo ? formatDate(cert.validTo) : '—'}</div>
        </div>
        <div class="detail-item">
          <div class="label">Protocol</div>
          <div class="value">${cert.protocol || '—'}</div>
        </div>
        <div class="detail-item">
          <div class="label">Authorized</div>
          <div class="value">${result.authorized ? '✅ Yes' : '❌ No'}</div>
        </div>
        <div class="detail-item full-width">
          <div class="label">Serial Number</div>
          <div class="value" style="font-family:monospace; font-size:0.75rem;">${cert.serialNumber || '—'}</div>
        </div>
        <div class="detail-item full-width">
          <div class="label">Fingerprint (SHA-256)</div>
          <div class="value" style="font-family:monospace; font-size:0.7rem;">${cert.fingerprint256 || '—'}</div>
        </div>
      </div>
    </div>

    ${cert.sans && cert.sans.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">Subject Alternative Names (${cert.sans.length})</div>
        <div class="sans-list">
          ${cert.sans.map(s => `<span class="san-tag">${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>
    ` : ''}

    <div style="margin-top:16px; font-size:0.72rem; color:var(--text-dim);">
      Last checked: ${result.checkedAt ? formatDateTime(result.checkedAt) : '—'}
    </div>
  `;

  openModal('detail-modal');
}

// ===== SETTINGS =====

function populateSettingsForm(s) {
  document.getElementById('threshold-critical').value = s.thresholds?.critical || 7;
  document.getElementById('threshold-warning').value = s.thresholds?.warning || 30;
  document.getElementById('email-enabled').checked = s.email?.enabled || false;
  document.getElementById('smtp-host').value = s.email?.smtp?.host || '';
  document.getElementById('smtp-port').value = s.email?.smtp?.port || 587;
  document.getElementById('smtp-secure').checked = s.email?.smtp?.secure || false;
  document.getElementById('smtp-user').value = s.email?.smtp?.user || '';
  document.getElementById('smtp-pass').value = '';
  const passHint = document.getElementById('smtp-pass-env-hint');
  if (s.email?.smtp?.passFromEnv) {
    passHint.style.display = '';
    document.getElementById('smtp-pass').placeholder = 'Leave blank to keep .env password';
  } else {
    passHint.style.display = 'none';
    document.getElementById('smtp-pass').placeholder = '••••••••';
  }
  document.getElementById('email-from').value = s.email?.from || '';
  document.getElementById('email-to').value = s.email?.to || '';
  document.getElementById('alert-on-expired').checked = s.email?.alertOnExpired !== false;
  document.getElementById('alert-on-critical').checked = s.email?.alertOnCritical !== false;
  document.getElementById('alert-on-warning').checked = s.email?.alertOnWarning || false;
  renderAllowedEmails(s.allowedEmails || []);
  toggleEmailFields();
}

let allowedEmails = [];

function renderAllowedEmails(list) {
  allowedEmails = [...list];
  const container = document.getElementById('allowed-emails-list');
  if (allowedEmails.length === 0) {
    container.innerHTML = '<p style="font-size:0.75rem;color:var(--text-dim);margin-bottom:8px;">No emails added yet.</p>';
    return;
  }
  container.innerHTML = allowedEmails.map((em, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:var(--bg-glass);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin-bottom:6px;">
      <span style="font-size:0.82rem;color:var(--text-secondary);">${escapeHtml(em)}</span>
      <button type="button" onclick="removeAllowedEmail(${i})" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:14px;padding:2px 6px;" title="Remove">✕</button>
    </div>
  `).join('');
}

function removeAllowedEmail(index) {
  allowedEmails.splice(index, 1);
  renderAllowedEmails(allowedEmails);
}

function toggleEmailFields() {
  const enabled = document.getElementById('email-enabled').checked;
  document.getElementById('email-fields').style.display = enabled ? '' : 'none';
}

async function saveSettings(e) {
  e.preventDefault();

  const updated = {
    allowedEmails,
    thresholds: {
      critical: parseInt(document.getElementById('threshold-critical').value) || 7,
      warning: parseInt(document.getElementById('threshold-warning').value) || 30,
    },
    email: {
      enabled: document.getElementById('email-enabled').checked,
      smtp: {
        host: document.getElementById('smtp-host').value,
        port: parseInt(document.getElementById('smtp-port').value) || 587,
        secure: document.getElementById('smtp-secure').checked,
        user: document.getElementById('smtp-user').value,
        pass: document.getElementById('smtp-pass').value,
      },
      from: document.getElementById('email-from').value,
      to: document.getElementById('email-to').value,
      alertOnExpired: document.getElementById('alert-on-expired').checked,
      alertOnCritical: document.getElementById('alert-on-critical').checked,
      alertOnWarning: document.getElementById('alert-on-warning').checked,
    },
  };

  try {
    const res = await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });

    if (!res.ok) throw new Error('Save failed');
    settings = await res.json();
    showToast('Settings saved', 'success');
    closeModal('settings-modal');

    // Re-check with new thresholds
    await loadDomains();
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
}

async function sendTestEmail() {
  const btn = document.getElementById('btn-test-email');
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Sending...';
  btn.disabled = true;

  // Save settings first
  await saveSettings(new Event('submit'));

  try {
    const res = await fetch(`${API}/api/email/test`, { method: 'POST' });
    const data = await res.json();
    if (data.sent) {
      showToast('Test email sent successfully!', 'success');
    } else {
      showToast(`Email failed: ${data.reason}`, 'error');
    }
  } catch (err) {
    showToast('Failed to send test email', 'error');
  } finally {
    btn.innerHTML = origHTML;
    btn.disabled = false;
  }
}

// ===== MODALS =====

function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

// ===== NOTIFICATIONS =====

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function checkForAlerts(domains) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const criticals = domains.filter(d => d.result && (d.result.status === 'critical' || d.result.status === 'expired'));

  if (criticals.length > 0) {
    new Notification('🔒 SSL Certificate Alert', {
      body: `${criticals.length} certificate(s) need urgent attention!`,
      icon: '🔒',
      tag: 'cert-alert',
    });
  }
}

// ===== TOAST =====

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ===== EVENT LISTENERS =====

function setupEventListeners() {
  // Add domain
  document.getElementById('btn-add-domain').addEventListener('click', () => openModal('add-domain-modal'));
  document.getElementById('add-domain-close').addEventListener('click', () => closeModal('add-domain-modal'));
  document.getElementById('add-domain-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const domain = document.getElementById('new-domain').value.trim();
    const resolveHost = document.getElementById('new-resolve-host').value.trim() || null;
    const label = document.getElementById('new-label').value.trim() || null;
    if (domain) addDomain(domain, resolveHost, label);
  });

  // Refresh all
  document.getElementById('btn-refresh-all').addEventListener('click', refreshAll);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    loadSettings().then(() => openModal('settings-modal'));
  });
  document.getElementById('settings-modal-close').addEventListener('click', () => closeModal('settings-modal'));
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('email-enabled').addEventListener('change', toggleEmailFields);
  document.getElementById('btn-test-email').addEventListener('click', sendTestEmail);

  // Detail modal
  document.getElementById('detail-modal-close').addEventListener('click', () => closeModal('detail-modal'));

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Add allowed email
  document.getElementById('btn-add-allowed-email').addEventListener('click', () => {
    const input = document.getElementById('new-allowed-email');
    const val = input.value.trim().toLowerCase();
    if (!val || !val.includes('@')) return;
    if (!allowedEmails.includes(val)) {
      allowedEmails.push(val);
      renderAllowedEmails(allowedEmails);
    }
    input.value = '';
  });

  document.getElementById('new-allowed-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-allowed-email').click(); }
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
    }
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderDomainGroups(domainData);
  });

  // Filters
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      renderDomainGroups(domainData);
    });
  });
}

// ===== AUTO REFRESH =====

function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    loadDomains();
  }, 60000); // Every 60 seconds
}

// ===== UTILITIES =====

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) {
    return iso;
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {
    return iso;
  }
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
