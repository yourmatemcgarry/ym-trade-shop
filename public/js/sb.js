// Tiny Supabase client: just the login and data calls this site needs (no library download).
(function () {
  const cfg = window.YMT_CONFIG || {};
  const KEY = 'ymt-session';
  const listeners = new Set();
  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { session = null; }

  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const base = (cfg.supabaseUrl || '').replace(/\/$/, '');

  function save(s) {
    session = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) {}
    listeners.forEach((fn) => fn(session));
  }
  function withExpiry(s) {
    if (s && s.expires_in && !s.expires_at) s.expires_at = Math.floor(Date.now() / 1000) + Number(s.expires_in);
    return s;
  }
  async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        apikey: cfg.supabaseAnonKey,
        ...((token || /^eyJ/.test(cfg.supabaseAnonKey)) ? { Authorization: `Bearer ${token || cfg.supabaseAnonKey}` } : {}),
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `Request failed (${res.status})`;
      const err = new Error(friendly(msg)); err.status = res.status; err.raw = data; throw err;
    }
    return data;
  }
  function friendly(msg) {
    const m = String(msg);
    if (/invalid login credentials/i.test(m)) return 'That email and password don\'t match. Check them, or reset your password.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link we sent.';
    if (/already registered|already exists/i.test(m)) return 'There\'s already an account with that email. Log in instead.';
    if (/password should be at least/i.test(m)) return 'Use a password of at least 8 characters.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    return m;
  }

  let refreshing = null;
  async function token() {
    if (!session) return null;
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at - now < 60) {
      refreshing = refreshing || call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
        .then((s) => save(withExpiry(s)))
        .catch(() => save(null))
        .finally(() => { refreshing = null; });
      await refreshing;
    }
    return session && session.access_token;
  }

  // Links from emails (confirm sign-up, reset password) land with the session in the URL hash
  function readHash() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('error_description')) {
      const e = h.get('error_description');
      history.replaceState(null, '', location.pathname + location.search);
      return { error: /expired|invalid/i.test(e) ? 'That link has expired. Ask for a new one below.' : e };
    }
    if (h.get('access_token')) {
      const s = withExpiry({
        access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
        expires_in: Number(h.get('expires_in') || 3600), token_type: 'bearer',
      });
      history.replaceState(null, '', location.pathname + location.search);
      save(s);
      return { type: h.get('type') || 'login' };
    }
    return null;
  }

  const redirectTo = location.origin + location.pathname;

  window.SB = {
    configured,
    get session() { return session; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    readHash,
    token,
    async signUp({ email, password, data }) {
      const r = await call(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, password, data } });
      if (r && r.access_token) save(withExpiry(r)); // email confirmation turned off
      return r;
    },
    async signIn({ email, password }) {
      save(withExpiry(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })));
    },
    async resetPassword(email) {
      await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email } });
    },
    async updatePassword(password) {
      await call('/auth/v1/user', { method: 'PUT', body: { password }, token: await token() });
    },
    async user() { return call('/auth/v1/user', { token: await token() }); },
    async signOut() {
      const t = await token();
      save(null);
      if (t) call('/auth/v1/logout', { method: 'POST', token: t }).catch(() => {});
    },
    // PostgREST: SB.rest('orders?select=*'), SB.rest('orders?id=eq.1', {method:'PATCH', body})
    async rest(path, { method = 'GET', body, prefer } = {}) {
      return call(`/rest/v1/${path}`, { method, body, token: await token(), headers: prefer ? { Prefer: prefer } : {} });
    },
    async rpc(fn, args = {}) { return call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, token: await token() }); },
    // Our own Netlify functions
    async api(path, body) {
      const res = await fetch(`/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
      return data;
    },
  };
})();
