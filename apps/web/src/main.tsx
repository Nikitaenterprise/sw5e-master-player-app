import { createRoot } from 'react-dom/client';
import { Застосунок } from './Застосунок.js';
import './стиль.css';

const корінь = document.getElementById('корінь');
if (корінь === null) throw new Error('немає #корінь у index.html');
createRoot(корінь).render(<Застосунок />);
