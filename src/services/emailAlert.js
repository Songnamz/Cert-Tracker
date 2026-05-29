const nodemailer = require('nodemailer');

function resolveSmtp(emailConfig) {
  return {
    host:   process.env.SMTP_HOST || emailConfig.smtp.host,
    port:   parseInt(process.env.SMTP_PORT) || emailConfig.smtp.port || 587,
    secure: emailConfig.smtp.secure || false,
    user:   process.env.SMTP_USER || emailConfig.smtp.user,
    pass:   process.env.SMTP_PASS || emailConfig.smtp.pass,
    from:   process.env.SMTP_FROM || emailConfig.from,
  };
}

function makeTransporter(smtp) {
  return nodemailer.createTransport({
    host:   smtp.host,
    port:   smtp.port,
    secure: smtp.secure,
    auth:   smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

function thaiTime() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }) + ' (ICT)';
}

async function sendAlert(emailConfig, alerts) {
  if (!emailConfig.enabled) {
    return { sent: false, reason: 'Email alerts not enabled' };
  }

  const smtp = resolveSmtp(emailConfig);
  if (!smtp.host || !smtp.from || !emailConfig.to) {
    return { sent: false, reason: 'Email configuration incomplete' };
  }

  const rows = alerts.map(a => {
    const color = a.status === 'expired' ? '#ef4444'
      : a.status === 'critical' ? '#f97316'
      : a.status === 'warning'  ? '#eab308'
      : a.status === 'error'    ? '#94a3b8'
      : '#22c55e';
    const days   = a.daysRemaining !== null ? `${a.daysRemaining} days` : 'N/A';
    const expiry = a.certificate ? new Date(a.certificate.validTo).toLocaleDateString() : 'N/A';
    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #1e293b;"><strong>${a.domain}</strong></td>
        <td style="padding:12px;border-bottom:1px solid #1e293b;">
          <span style="background:${color};color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;">${a.status.toUpperCase()}</span>
        </td>
        <td style="padding:12px;border-bottom:1px solid #1e293b;">${days}</td>
        <td style="padding:12px;border-bottom:1px solid #1e293b;">${expiry}</td>
        <td style="padding:12px;border-bottom:1px solid #1e293b;">${a.error || '—'}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:700px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#7c3aed,#06b6d4);padding:24px 32px;">
        <h1 style="margin:0;font-size:22px;color:#fff;">🔒 SSL Certificate Alert</h1>
        <p style="margin:6px 0 0;opacity:0.9;font-size:14px;color:#fff;">${alerts.length} certificate(s) require attention</p>
      </div>
      <div style="padding:24px 32px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#cbd5e1;">
          <thead>
            <tr style="text-align:left;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">
              <th style="padding:12px;border-bottom:2px solid #1e293b;">Domain</th>
              <th style="padding:12px;border-bottom:2px solid #1e293b;">Status</th>
              <th style="padding:12px;border-bottom:2px solid #1e293b;">Days Left</th>
              <th style="padding:12px;border-bottom:2px solid #1e293b;">Expiry</th>
              <th style="padding:12px;border-bottom:2px solid #1e293b;">Error</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#64748b;">Sent by Cert Tracker at ${thaiTime()}</p>
      </div>
    </div>`;

  try {
    const info = await makeTransporter(smtp).sendMail({
      from: smtp.from, to: emailConfig.to,
      subject: `🔒 SSL Alert: ${alerts.length} certificate(s) need attention`,
      html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

function filterAlertable(results, emailConfig) {
  return results.filter(r => {
    if (r.status === 'expired'  && emailConfig.alertOnExpired)  return true;
    if (r.status === 'critical' && emailConfig.alertOnCritical) return true;
    if (r.status === 'warning'  && emailConfig.alertOnWarning)  return true;
    return false;
  });
}

async function sendTestEmail(emailConfig) {
  const smtp = resolveSmtp(emailConfig);
  if (!smtp.host || !smtp.from || !emailConfig.to) {
    return { sent: false, reason: 'Email configuration incomplete' };
  }
  try {
    const info = await makeTransporter(smtp).sendMail({
      from: smtp.from, to: emailConfig.to,
      subject: '🔒 Cert Tracker — Test Email',
      html: `
        <div style="font-family:sans-serif;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
          <h2 style="color:#22d3ee;">✅ Email Configuration Working</h2>
          <p>Your Cert Tracker email alerts are configured correctly.</p>
          <p style="color:#64748b;font-size:12px;">Sent at ${thaiTime()}</p>
        </div>`,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

async function sendOTP(emailConfig, toAddress, code) {
  const smtp = resolveSmtp(emailConfig);
  const html = `
    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:480px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#06b6d4,#8b5cf6);padding:28px 32px;">
        <h1 style="margin:0;font-size:22px;color:#fff;">🔒 Cert Tracker</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Your login verification code</p>
      </div>
      <div style="padding:32px;">
        <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;">Use the code below to sign in. It expires in <strong style="color:#e2e8f0;">5 minutes</strong>.</p>
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:#22d3ee;font-family:monospace;">${code}</span>
        </div>
        <p style="margin:0;font-size:12px;color:#475569;">If you did not request this code, you can safely ignore this email.</p>
        <p style="margin-top:16px;font-size:11px;color:#334155;">Sent at ${thaiTime()}</p>
      </div>
    </div>`;
  await makeTransporter(smtp).sendMail({
    from: smtp.from, to: toAddress,
    subject: '🔒 Your Cert Tracker login code',
    html,
  });
}

module.exports = { sendAlert, filterAlertable, sendTestEmail, sendOTP };
