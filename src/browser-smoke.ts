import './style.css';
import { renderIsolatedBrowserSmoke } from './app/isolated-browser-smoke';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing smoke app root');

const shell = renderIsolatedBrowserSmoke(app);
void shell.ready.then(
  () => { document.documentElement.dataset.smokeIsolation = 'ready'; },
  (error) => {
    document.documentElement.dataset.smokeIsolation = 'failed';
    throw error;
  }
);