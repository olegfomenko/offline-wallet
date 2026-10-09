// Hash routing (#/addresses). The hash only ever names a screen; no data goes into the URL.
import { useEffect, useReducer } from 'preact/hooks';

const subs = new Set();
export function current() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return h || 'welcome';
}
export function go(name) {
  if (current() === name) { for (const f of subs) f(); return; }
  location.hash = '#/' + name;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); for (const f of subs) f(); });
export function useRoute() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { subs.add(force); return () => subs.delete(force); }, []);
  return current();
}
