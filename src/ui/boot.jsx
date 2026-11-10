// Starts one of the apps: routes, the export/import sheet, file drops and toasts.
// One wallet per tab, nothing persisted, no network APIs used.
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRoute, go, setStart } from './router.js';
import { useStore, getState, toast } from './store.js';
import { Sheet } from './sheet.jsx';
import { watchInjections } from './env.js';
import { setApp } from './app.js';

/**
 * cfg: the app (see app.js) plus `open`, the screens that work without a wallet, and `wallet`,
 * the screens that need one (they go back to the start screen when no wallet is open).
 */
export function boot(cfg) {
  setApp(cfg);
  setStart(cfg.start);
  document.title = cfg.name;
  watchInjections('app');

  function App() {
    const route = useRoute();
    const st = useStore();
    const [drag, setDrag] = useState(false);
    useEffect(() => {
      const over = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } };
      const leave = (e) => { if (!e.relatedTarget) setDrag(false); };
      const drop = (e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        const s = getState();
        if (s.sheetDrop) s.sheetDrop(f);
        else if (s.pageDrop) s.pageDrop(f);
        else toast(cfg.dropHint || 'Open an import button first.');
      };
      window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
      return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
    }, []);
    let Screen = cfg.open[route];
    if (!Screen && cfg.wallet && cfg.wallet[route]) {
      if (!st.wallet) { setTimeout(() => go(cfg.start), 0); return null; }
      Screen = cfg.wallet[route];
    }
    if (!Screen) { setTimeout(() => go(st.wallet ? cfg.home : cfg.start), 0); return null; }
    return (
      <div class={drag ? 'dropzone-on' : ''}>
        <Screen key={route} />
        <Sheet />
        {st.toast && <div class="toast" role="status">{st.toast}</div>}
      </div>
    );
  }

  // A reload always starts empty, on the start screen.
  if (location.hash && location.hash !== '#/' + cfg.start) history.replaceState(null, '', location.pathname + location.search + '#/' + cfg.start);
  render(<App />, document.getElementById('app'));
}
