// Which app this file is. One source builds four single-file apps (see src/apps/): Full, Addresses,
// PSBT Inspector and Tools. The entry file calls setApp() once, before the first render; screens
// ask has() before linking to a screen that only some apps contain.
//
//   features: 'wallet'    create/restore and a wallet in this tab
//             'psbt'      sign a PSBT with that wallet (Full)
//             'inspector' review a PSBT with no private keys (Inspector)
//             'settings'  the Settings screen (Full); the other apps link their tools from the menu
let APP = { id: 'full', name: 'Offline Signer', sub: 'Bitcoin · single-sig', start: 'welcome', home: 'main', features: ['wallet', 'psbt', 'settings'], nav: [] };

export function setApp(cfg) { APP = cfg; }
export const app = () => APP;
export const has = (feature) => APP.features.includes(feature);
/** Where a tool's back button goes: Settings in Full, the app's home elsewhere. */
export const toolsBack = () => (has('settings') ? 'settings' : APP.home);
