import './style.css';
import { renderShell } from './app/shell';
import { installImageFallbacks } from './app/image-fallback';

installImageFallbacks();
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

renderShell(app);
