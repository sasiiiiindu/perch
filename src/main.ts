import './style.css';
import { mountDebugScreen } from './ui/debug';
import { mountTuner } from './ui/tuner';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

// The birds by default; the plain diagnostic screen with ?debug.
if (new URLSearchParams(location.search).has('debug')) mountDebugScreen(app);
else mountTuner(app);

// Offline support (build/pwa.ts writes sw.js). Production only, so it never caches a dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // Perch still works online without it.
  });
}
