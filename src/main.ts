import './style.css';
import { renderLanding, shouldRenderApp } from './app/landing';
import { renderShell } from './app/shell';
import { registerServiceWorker } from './app/pwa';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

if (shouldRenderApp()) {
  renderShell(app);
  registerServiceWorker();
} else {
  renderLanding(app);
}
