import './style.css';
import { renderShell } from './app/shell';
import { registerServiceWorker } from './app/pwa';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

renderShell(app);
registerServiceWorker();
