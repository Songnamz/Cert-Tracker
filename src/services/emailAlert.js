const nodemailer = require('nodemailer');

/**
 * Send email alert for certificate issues.
 */
async function sendAlert(emailConfig, alerts) {
  if (!emailConfig.enabled) {
    return { sent: false, reason: 'Email alerts not enabled' };
  }

  if (!emailConfig.smtp.host || !emailConfig.from || !emailConfig.to) {
    return { sent: false, reason: 'Email configuration incomplete' };
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port || 587,
    secure: emailConfig.smtp.secure || false,
    auth: emailConfig.smtp.user ? {
      user: emailConfig.smtp.user,
      pass: emailConfig.smtp.pass,
    } : undefined,
  });

  // Build HTML email
  const rows = alerts.map(a => {
    const color = a.status === 'expired' ? '#ef4444'
      : a.status === 'critical' ? '#f97316'
      : a.status === 'warning' ? '#eab308'
      : a.status === 'error' ? '#94a3b8'
      : '#22c55e';

    const days = a.daysRemaining !== null ? `${a.daysRemaining} days` : 'N/A';
    const expiry = a.certificate ? new Date(a.certificate.validTo).toLocaleDateString() : 'N/A';

    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">
          <strong>${a.domain}</strong>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">
          <span style="background: ${color}; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
            ${a.status.toUpperCase()}
          </span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">${days}</td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">${expiry}</td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">${a.error || '—'}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #7c3aed, #06b6d4); padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 22px; color: #fff;">🔒 SSL Certificate Alert</h1>
        <p style="margin: 6px 0 0; opacity: 0.9; font-size: 14px; color: #fff;">${alerts.length} certificate(s) require attention</p>
      </div>
      <div style="padding: 24px 32px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #cbd5e1;">
          <thead>
            <tr style="text-align: left; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
              <th style="padding: 12px; border-bottom: 2px solid #1e293b;">Domain</th>
              <th style="padding: 12px; border-bottom: 2px solid #1e293b;">Status</th>
              <th style="padding: 12px; border-bottom: 2px solid #1e293b;">Days Left</th>
              <th style="padding: 12px; border-bottom: 2px solid #1e293b;">Expiry</th>
              <th style="padding: 12px; border-bottom: 2px solid #1e293b;">Error</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <p style="margin-top: 24px; font-size: 12px; color: #64748b;">
          Sent by Cert Tracker at ${new Date().toISOString()}
        </p>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject: `🔒 SSL Alert: ${alerts.length} certificate(s) need attention`,
      html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

/**
 * Filter results that need alerting based on email config preferences.
 */
function filterAlertable(results, emailConfig) {
  return results.filter(r => {
    if (r.status === 'expired' && emailConfig.alertOnExpired) return true;
    if (r.status === 'critical' && emailConfig.alertOnCritical) return true;
    if (r.status === 'warning' && emailConfig.alertOnWarning) return true;
    return false;
  });
}

/**
 * Send a test email to verify SMTP configuration.
 */
async function sendTestEmail(emailConfig) {
  if (!emailConfig.smtp.host || !emailConfig.from || !emailConfig.to) {
    return { sent: false, reason: 'Email configuration incomplete' };
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port || 587,
    secure: emailConfig.smtp.secure || false,
    auth: emailConfig.smtp.user ? {
      user: emailConfig.smtp.user,
      pass: emailConfig.smtp.pass,
    } : undefined,
  });

  try {
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject: '🔒 Cert Tracker — Test Email',
      html: `
        <div style="font-family: sans-serif; padding: 32px; background: #0f172a; color: #e2e8f0; border-radius: 12px;">
          <h2 style="color: #22d3ee;">✅ Email Configuration Working</h2>
          <p>Your Cert Tracker email alerts are configured correctly.</p>
          <p style="color: #64748b; font-size: 12px;">Sent at ${new Date().toISOString()}</p>
        </div>
      `,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendAlert, filterAlertable, sendTestEmail };
