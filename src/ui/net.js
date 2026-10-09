// Network status, as the browser reports it: 'offline', 'online' or 'unknown'.
//
// - Phones often skip the `online`/`offline` events (the tab is suspended while airplane mode is
//   switched), so the status is also re-read when the page comes back into view and every two seconds.
// - On iPhone and iPad every browser uses WebKit, whose navigator.onLine can stay true with Wi-Fi and
//   data off, e.g. after reloading the page offline (WebKit bugs 171277, 225645). There it can't be
//   trusted, so the status is 'unknown' unless the browser says offline.
// - The page has no network access (CSP), so it can't test the connection itself, and it never tries.
const subs = new Set();
const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
let cur = read();

function read() {
  if (typeof navigator === 'undefined') return 'unknown';
  if (navigator.onLine === false) return 'offline';
  try {
    // Chrome on Android: connection.type is 'none' with no network at all.
    const c = navigator.connection;
    if (c && c.type === 'none') return 'offline';
  } catch (e) { /* not supported */ }
  return IOS ? 'unknown' : 'online';
}

function check() {
  const v = read();
  if (v === cur) return;
  cur = v;
  for (const f of subs) f(v);
}

if (typeof window !== 'undefined') {
  for (const ev of ['online', 'offline', 'focus', 'pageshow']) window.addEventListener(ev, check);
  document.addEventListener('visibilitychange', check);
  try { if (navigator.connection) navigator.connection.addEventListener('change', check); } catch (e) { /* not supported */ }
  setInterval(check, 2000);
}

/** 'offline', 'online' or 'unknown' (the browser can't be trusted to say). */
export function netStatus() { check(); return cur; }

/** Calls `f(status)` whenever the status changes; returns an unsubscribe function. */
export function onNetChange(f) { subs.add(f); return () => subs.delete(f); }
