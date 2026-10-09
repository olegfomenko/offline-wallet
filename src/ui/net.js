// Network status, as the browser reports it. Phones often skip the `online`/`offline` events (the tab
// is suspended while the user switches airplane mode in Control Center or the notification shade),
// so the status is also re-read when the page comes back into view and every two seconds.
// This only reads what the browser says; it can't prove there is no network.
const subs = new Set();
let cur = read();

function read() {
  if (typeof navigator === 'undefined') return false;
  let on = navigator.onLine !== false;
  try {
    // Chrome on Android: connection.type is 'none' with no network at all.
    const c = navigator.connection;
    if (c && c.type === 'none') on = false;
  } catch (e) { /* not supported */ }
  return on;
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

/** Whether the browser currently reports a network connection. */
export function isOnline() { check(); return cur; }

/** Calls `f(online)` whenever the status changes; returns an unsubscribe function. */
export function onNetChange(f) { subs.add(f); return () => subs.delete(f); }
