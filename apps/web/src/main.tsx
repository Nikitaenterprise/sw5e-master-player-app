import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { PrintPage } from './Print.js';
import { ReferencePage } from './Reference.js';
import { ShipSheetPage } from './ShipSheet.js';
import './style.css';

const root = document.getElementById('root');
if (root === null) throw new Error('немає #корінь у index.html');
// The printed sheets are a page of their own: no socket, no place at the table (F-030).
// So is the reference (F-049) and the ship's sheet (F-031).
const page = new URLSearchParams(location.search).get('as');
createRoot(root).render(
  page === 'print' ? <PrintPage />
    : page === 'ref' ? <ReferencePage />
      : page === 'ship' ? <ShipSheetPage />
        : <App />,
);
