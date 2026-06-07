/* ===== CERT TRACKER — LOGIN ===== */

document.getElementById('login-year').textContent = new Date().getFullYear();

const msgEl = document.getElementById('login-msg');

function showMsg(text, type = 'error') {
  msgEl.textContent = text;
  msgEl.className = `login-msg ${type}`;
}

function clearMsg() {
  msgEl.className = 'login-msg hidden';
}

// Global callback function for Google Sign-In
window.handleGoogleSignIn = async function(response) {
  clearMsg();
  
  if (!response.credential) {
    showMsg('Google sign-in failed. No credential received.');
    return;
  }

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Failed to sign in.');
      return;
    }

    showMsg('Signed in! Redirecting...', 'success');
    setTimeout(() => { window.location.href = '/'; }, 600);

  } catch (err) {
    showMsg('Network error. Please try again.');
  }
};

// Fetch the Google Client ID and initialize the Google Identity Services
async function initGoogleSignIn() {
  try {
    const res = await fetch('/api/auth/client-id');
    const data = await res.json();
    
    if (data.clientId) {
      if (window.google) {
        google.accounts.id.initialize({
          client_id: data.clientId,
          callback: handleGoogleSignIn
        });
        google.accounts.id.renderButton(
          document.getElementById("google-btn-container"),
          { theme: "filled_black", size: "large", text: "continue_with", shape: "rectangular" }
        );
      } else {
        // Retry if script isn't loaded yet
        setTimeout(initGoogleSignIn, 100);
      }
    } else {
      showMsg('Google Client ID is not configured. Add GOOGLE_CLIENT_ID to .env on the server.');
    }
  } catch (err) {
    showMsg('Failed to load login configuration.');
  }
}

// Initialize
initGoogleSignIn();
