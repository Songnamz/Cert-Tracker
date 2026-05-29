# 🔒 Cert Tracker

A self-hosted SSL certificate expiry dashboard. Monitor all your domains and internal servers, get email alerts before certificates expire, and control access with email OTP authentication — no passwords stored.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Certificate monitoring** — checks SSL/TLS certs and shows days remaining with a visual countdown ring
- **Sidebar navigation** — domains grouped by base domain, navigate between groups without scrolling
- **Status indicators** — Healthy / Warning / Critical / Expired / Error with color-coded badges
- **Origin/internal host support** — bypass public DNS to check certs on servers behind a CDN, load balancer, or reverse proxy (e.g. check the backend server cert separately from nginx)
- **Email OTP login** — enter your email, receive a 6-digit code, no passwords required
- **Allowed emails list** — only pre-approved addresses can request a login code
- **Email alerts** — automated notifications when certs are expiring (configurable thresholds)
- **Scheduled checks** — automatic re-checks on a configurable interval (default every 6 hours)
- **Responsive UI** — works on desktop, tablet, and mobile
- **Security hardened** — HTTP security headers (helmet), rate limiting, credentials in `.env`, session cookies

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or higher
- npm
- An SMTP email account for sending OTP codes and alerts:
  - **Microsoft 365** — requires SMTP AUTH enabled on the mailbox + App Password if MFA is on
  - **Gmail** — requires an [App Password](https://myaccount.google.com/apppasswords) (not your regular password)
  - Any other SMTP-compatible provider

---

## Installation

```bash
git clone https://github.com/Songnamz/Cert-Tracker.git
cd Cert-Tracker
npm install
```

---

## Configuration

### 1. Create the `.env` file

Copy the example below and fill in your SMTP credentials. This file is **never committed to git**.

```env
# Server
PORT=3000

# SMTP credentials — keep this file private
SMTP_HOST=smtp.office365.com       # or smtp.gmail.com for Gmail
SMTP_PORT=587
SMTP_USER=you@yourdomain.com
SMTP_PASS=your-app-password
SMTP_FROM=you@yourdomain.com
```

**Microsoft 365 — enable SMTP AUTH first:**
1. Microsoft 365 Admin Center → Users → select the user → Mail → Manage email apps
2. Enable **Authenticated SMTP** → Save
3. If MFA is enabled: [create an App Password](https://mysignins.microsoft.com/security-info)

**Gmail:**
1. Google Account → Security → 2-Step Verification (must be on)
2. App passwords → create one for "Mail"
3. Use the 16-character code as `SMTP_PASS`

### 2. Create the `data` directory

```bash
mkdir data
```

The app creates `data/settings.json`, `data/domains.json`, and `data/results.json` automatically on first run. The `data/` folder is gitignored.

### 3. Add your email to the allowed login list

On first run the app creates `data/settings.json`. Edit it to add your email:

```json
{
  "email": {
    "enabled": true,
    "to": "alerts@yourdomain.com"
  },
  "allowedEmails": ["you@yourdomain.com"]
}
```

Or configure it through the Settings page after first login (if you add your email to `allowedEmails` before starting, you can log straight in).

---

## Running

```bash
# Production
node server.js

# Development (auto-restart on file changes)
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

---

## First Login

1. Go to `http://localhost:3000` — you'll be redirected to the login page
2. Enter your email address
3. Check your inbox for a 6-digit code (expires in 5 minutes)
4. Enter the code → you're in
5. Sessions last **8 hours** before requiring a new code

---

## Using the Dashboard

### Adding a domain

Click **+ Add Domain** and fill in:

| Field | Description |
|---|---|
| **Domain Name** | e.g. `example.com` or `sub.example.com` |
| **Origin / Internal Host** | Optional. IP or hostname to connect to directly — use this for servers behind Cloudflare, nginx, or any reverse proxy to check the origin cert separately |
| **Label** | Optional friendly name shown on the card |

### Sidebar navigation

Domains are grouped by their base domain (e.g. `apiu.edu`). Click a group in the left sidebar to view only that group's certificates. Click **All Domains** to see everything.

### Status filters

Use the filter pills (All / Healthy / Warning / Critical / Expired / Error) to focus on certs that need attention.

### Re-checking a certificate

Click **Check Now** on any card to force an immediate re-check, or click **Check All** in the header to re-check everything.

---

## Settings

Access via the **⚙** button in the header.

| Setting | Description |
|---|---|
| **Critical threshold** | Days remaining before status turns red (default: 7) |
| **Warning threshold** | Days remaining before status turns yellow (default: 30) |
| **Email alerts** | Enable/disable automated expiry alerts |
| **SMTP** | Mail server configuration (host, port, credentials) |
| **From / To** | Sender and recipient for cert alert emails |
| **Allowed Login Emails** | Emails permitted to request an OTP login code |

> **Note:** If SMTP credentials are set in `.env`, the password field in Settings will show *"Managed by .env file"*. Leave it blank when saving to keep using the `.env` password.

---

## Security

| Feature | Details |
|---|---|
| **Email OTP** | No passwords — login codes expire after 5 minutes |
| **Rate limiting** | 3 OTP requests per 15 min per email; 100 API requests per 15 min per IP |
| **Brute force protection** | Code invalidated after 5 wrong attempts |
| **Credential isolation** | SMTP password lives in `.env`, never in `settings.json` or git |
| **HttpOnly session cookie** | Session token not accessible to JavaScript |
| **Security headers** | `helmet` sets CSP, X-Frame-Options, HSTS, and more |
| **Gitignore** | `data/` and `.env` are excluded from version control |

---

## Deployment (behind nginx)

The app runs on HTTP — terminate SSL at nginx and proxy to it:

```nginx
server {
    listen 443 ssl;
    server_name certtracker.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Project Structure

```
Cert-Tracker/
├── server.js               # Express app entry point
├── .env                    # Credentials (create this, never commit)
├── data/                   # Runtime data (gitignored)
│   ├── settings.json       # App configuration
│   ├── domains.json        # Tracked domains
│   └── results.json        # Latest cert check results
├── public/                 # Frontend
│   ├── index.html
│   ├── index.css
│   ├── app.js
│   ├── login.html
│   ├── login.css
│   └── login.js
└── src/
    ├── routes/
    │   ├── api.js          # REST API
    │   └── auth.js         # OTP login routes
    └── services/
        ├── certChecker.js  # TLS certificate inspection
        ├── emailAlert.js   # Nodemailer email sending
        ├── otpStore.js     # OTP & session management
        ├── scheduler.js    # Cron-based auto-checks
        └── logParser.js    # Check history logs
```

---

## Built With

- [Express](https://expressjs.com/) — web server
- [Nodemailer](https://nodemailer.com/) — email sending
- [node-cron](https://github.com/node-cron/node-cron) — scheduled checks
- [helmet](https://helmetjs.github.io/) — security headers
- [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) — rate limiting
- [uuid](https://github.com/uuidjs/uuid) — session tokens

---

## Author

**Songnam Saraphai**

- Website: [songnam.xyz](https://songnam.xyz)
- LinkedIn: [linkedin.com/in/songnam-saraphai-b1a1a7329](https://www.linkedin.com/in/songnam-saraphai-b1a1a7329/)
- GitHub: [@Songnamz](https://github.com/Songnamz)

---

## License

MIT
