export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  } catch (error) {
    console.warn('service worker registration failed', error);
  }
}
