import './style.css';
import { mountDebugScreen } from './ui/debug';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

// Phase 2: the debug screen is the whole app. Later it moves behind ?debug.
mountDebugScreen(app);
