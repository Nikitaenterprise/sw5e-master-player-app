import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';

const root = document.getElementById('root');
if (root === null) throw new Error('немає #корінь у index.html');
createRoot(root).render(<App />);
