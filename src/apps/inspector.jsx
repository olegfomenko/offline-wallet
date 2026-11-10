// PSBT Inspector: review a PSBT with no private keys (optionally a watch-only key), show each
// input's hash to sign with the Addresses app, check the signatures and put them into the PSBT.
import { boot } from '../ui/boot.jsx';
import * as I from '../ui/icons.jsx';
import * as S from '../ui/screens/signing.jsx';

boot({
  id: 'inspector', name: 'PSBT Inspector', sub: 'PSBT Inspector', start: 'inspector', home: 'inspector',
  features: ['inspector'],
  dropHint: 'Open an import button first, or drop a transaction on Load transaction.',
  nav: [
    ['inspector', 'Home', I.IHome, ['inspector']],
    ['load', 'Load transaction', I.IScan, ['load', 'notpsbt', 'review', 'psbt-details']],
    ['sign-inputs', 'Sign inputs', I.IPen, ['sign-inputs', 'signed-export']],
  ],
  open: {
    inspector: S.InspectorHome, load: S.LoadTransaction, notpsbt: S.NotAPsbt, review: S.Review,
    'sign-inputs': S.SignInputs, 'signed-export': S.SignedExport, 'psbt-details': S.PsbtDetails,
  },
});
