import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { PrintPage } from './Print.js';
import { ReferencePage } from './Reference.js';
import { ShipSheetPage } from './ShipSheet.js';
import { StyleguidePage, applySavedLook } from './Look.js';
import { ChooseCharacter } from './Choose.js';
import './style.css';

const root = document.getElementById('root');
if (root === null) throw new Error('немає #корінь у index.html');
// The printed sheets are a page of their own: no socket, no place at the table (F-030).
// So is the reference (F-049) and the ship's sheet (F-031).
const params = new URLSearchParams(location.search);
const page = params.get('as');
// A phone without a character — the bare address the QR leads to — picks one (F-094).
const choosing = page !== 'gm' && (params.get('character') ?? '') === '' && [null, 'player'].includes(page);
// The viewer's own glass and motion switches, before the first paint (F-114).
applySavedLook();
createRoot(root).render(
  page === 'print' ? <PrintPage />
    : page === 'ref' ? <ReferencePage />
      : page === 'ship' ? <ShipSheetPage />
        : page === 'styleguide' ? <StyleguidePage />
          : choosing ? <ChooseCharacter />
            : <App />,
);
