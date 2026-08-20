import './style.css';
import { renderShell } from './app/shell';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

renderShell(app);
