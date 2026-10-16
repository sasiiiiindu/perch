import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

const title = document.createElement('h1');
title.textContent = 'Perch';
app.append(title);
