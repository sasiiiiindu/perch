import './style.css';
import { mountDebugScreen } from './ui/debug';
import { mountTuner } from './ui/tuner';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

// The birds by default; the plain diagnostic screen with ?debug.
if (new URLSearchParams(location.search).has('debug')) mountDebugScreen(app);
else mountTuner(app);
