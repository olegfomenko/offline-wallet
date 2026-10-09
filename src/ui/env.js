// Offline check on the Welcome screen. It only reads what the browser reports and can't prove
// the computer is clean, so the screen says so.
const injected = [];
let observer = null;

/** Start watching for DOM nodes we didn't create (extensions often inject them). Call before render. */
export function watchInjections(rootId) {
  if (observer) return;
  const ours = (n) => n.nodeType !== 1 || n.id === rootId || n.closest && n.closest('#' + rootId) || n.tagName === 'SCRIPT' && n.id === 'app-script';
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.parentElement && (n.parentElement === document.body || n.parentElement === document.documentElement || n.parentElement === document.head) && !ours(n)) {
          // our own transient elements (download links, hidden inputs) are tagged
          if (n.dataset && n.dataset.own) continue;
          if (n.tagName === 'A' && n.download) continue;
          if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'CANVAS') continue;
          injected.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : ''));
        }
      }
      if (m.type === 'attributes' && (m.target === document.body || m.target === document.documentElement) && /^data-/.test(m.attributeName)) injected.push('attr:' + m.attributeName);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
}

export function environment() {
  const signs = new Set(injected);
  const g = window;
  for (const k of ['ethereum', 'solana', 'phantom', 'unisat', 'okxwallet', 'BinanceChain', 'xfi', '__REACT_DEVTOOLS_GLOBAL_HOOK__', '__VUE_DEVTOOLS_GLOBAL_HOOK__', 'grammarly']) {
    try { if (g[k]) signs.add('global:' + k); } catch (e) { /* ignore */ }
  }
  for (const el of document.querySelectorAll('[data-lastpass-root],[data-gr-ext-installed],com-1password-button,grammarly-desktop-integration,[data-bitwarden-watching]')) signs.add(el.tagName.toLowerCase());
  // Phones rarely open a local file as file://: Android Chrome uses content://, and file and
  // browser apps use their own schemes. Only http(s) from another host is a website.
  const proto = location.protocol;
  const web = proto === 'http:' || proto === 'https:';
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return {
    local: !web,
    origin: !web ? 'Local file' : loopback ? 'Local server' : 'A website',
    extensions: [...signs],
  };
}
