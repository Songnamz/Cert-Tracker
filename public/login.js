/* ===== CERT TRACKER — LOGIN ===== */

document.getElementById('login-year').textContent = new Date().getFullYear();

const stepEmail  = document.getElementById('step-email');
const stepOTP    = document.getElementById('step-otp');
const formEmail  = document.getElementById('form-email');
const formOTP    = document.getElementById('form-otp');
const inputEmail = document.getElementById('input-email');
const sentTo     = document.getElementById('sent-to-email');
const msgEl      = document.getElementById('login-msg');
const otpInputs  = Array.from(document.querySelectorAll('.otp-input'));
const timerEl    = document.getElementById('otp-timer');

let currentEmail = '';
let timerInterval = null;

// ── OTP box behaviour ────────────────────────────────────────────────────────

otpInputs.forEach((box, i) => {
  box.addEventListener('input', e => {
    const val = e.target.value.replace(/\D/g, '');
    box.value = val ? val[val.length - 1] : '';
    box.classList.toggle('filled', !!box.value);
    if (box.value && i < otpInputs.length - 1) otpInputs[i + 1].focus();
  });

  box.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !box.value && i > 0) {
      otpInputs[i - 1].value = '';
      otpInputs[i - 1].classList.remove('filled');
      otpInputs[i - 1].focus();
    }
    // Allow paste on any box
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') return;
  });

  box.addEventListener('paste', e => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData)
      .getData('text').replace(/\D/g, '').slice(0, 6);
    pasted.split('').forEach((ch, idx) => {
      if (otpInputs[idx]) {
        otpInputs[idx].value = ch;
        otpInputs[idx].classList.add('filled');
      }
    });
    const next = otpInputs[Math.min(pasted.length, otpInputs.length - 1)];
    if (next) next.focus();
  });
});

// ── Timer ────────────────────────────────────────────────────────────────────

function startTimer(seconds) {
  clearInterval(timerInterval);
  let remaining = seconds;

  function tick() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    timerEl.classList.toggle('urgent', remaining <= 60);
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerEl.textContent = 'Expired';
    }
    remaining--;
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

// ── Messages ─────────────────────────────────────────────────────────────────

function showMsg(text, type = 'error') {
  msgEl.textContent = text;
  msgEl.className = `login-msg ${type}`;
}

function clearMsg() {
  msgEl.className = 'login-msg hidden';
}

// ── Loading state ─────────────────────────────────────────────────────────────

function setLoading(btnId, spinnerId, loading) {
  const btn = document.getElementById(btnId);
  const sp  = document.getElementById(spinnerId);
  btn.disabled = loading;
  sp.classList.toggle('active', loading);
}

// ── Step 1: Request OTP ───────────────────────────────────────────────────────

formEmail.addEventListener('submit', async e => {
  e.preventDefault();
  clearMsg();

  const email = inputEmail.value.trim();
  if (!email) return;

  setLoading('btn-send', 'btn-send-spinner', true);

  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Failed to send code.');
      return;
    }

    // Move to OTP step
    currentEmail = email;
    sentTo.textContent = email;
    stepEmail.classList.add('hidden');
    stepOTP.classList.remove('hidden');
    clearMsg();
    otpInputs.forEach(b => { b.value = ''; b.classList.remove('filled'); });
    otpInputs[0].focus();
    startTimer(300);

  } catch {
    showMsg('Network error. Please try again.');
  } finally {
    setLoading('btn-send', 'btn-send-spinner', false);
  }
});

// ── Step 2: Verify OTP ────────────────────────────────────────────────────────

formOTP.addEventListener('submit', async e => {
  e.preventDefault();
  clearMsg();

  const code = otpInputs.map(b => b.value).join('');
  if (code.length !== 6) {
    showMsg('Please enter the full 6-digit code.');
    return;
  }

  setLoading('btn-verify', 'btn-verify-spinner', true);

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, code }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Invalid code.');
      otpInputs.forEach(b => { b.value = ''; b.classList.remove('filled'); });
      otpInputs[0].focus();
      return;
    }

    clearInterval(timerInterval);
    showMsg('Signed in! Redirecting...', 'success');
    setTimeout(() => { window.location.href = '/'; }, 600);

  } catch {
    showMsg('Network error. Please try again.');
  } finally {
    setLoading('btn-verify', 'btn-verify-spinner', false);
  }
});

// ── Resend ────────────────────────────────────────────────────────────────────

document.getElementById('btn-resend').addEventListener('click', async () => {
  clearMsg();
  otpInputs.forEach(b => { b.value = ''; b.classList.remove('filled'); });

  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail }),
    });
    if (res.ok) {
      showMsg('New code sent.', 'success');
      startTimer(300);
      otpInputs[0].focus();
    } else {
      const d = await res.json();
      showMsg(d.error || 'Failed to resend.');
    }
  } catch {
    showMsg('Network error.');
  }
});

// ── Back ──────────────────────────────────────────────────────────────────────

document.getElementById('btn-back').addEventListener('click', () => {
  clearInterval(timerInterval);
  clearMsg();
  stepOTP.classList.add('hidden');
  stepEmail.classList.remove('hidden');
  inputEmail.focus();
});
