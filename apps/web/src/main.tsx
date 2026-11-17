import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { PrintPage } from './Print.js';
import './style.css';

const root = document.getElementById('root');
if (root === null) throw new Error('немає #корінь у index.html');
// The printed sheets are a page of their own: no socket, no place at the table (F-030).
const printing = new URLSearchParams(location.search).get('as') === 'print';
createRoot(root).render(printing ? <PrintPage /> : <App />);
