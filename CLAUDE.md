Perch — project rules
Perch is a web guitar tuner. Six soft, round birds sit on a wire; each bird is one string (low E on the left, high E on the right). When a string is played, its bird reacts: droops when flat, puffs up when sharp, sits still and chirps when in tune. The other birds stay quiet.

Stack
Vite + TypeScript (strict), no UI framework
Web Audio API for microphone input
Pitch detection: McLeod Pitch Method, our own code in src/audio/
Canvas 2D for rendering. Birds are drawn in code by src/scene/birds.ts (a port of the Perch Birds design canvas). No image assets.
Don't change bird shapes or colours without asking.
Vitest for tests
Deployed to GitHub Pages via GitHub Actions
Standard tuning (A4 = 440 Hz)
E2 82.41 · A2 110.00 · D3 146.83 · G3 196.00 · B3 246.94 · E4 329.63

Product rules
The bird is the readout: flat / sharp / in tune must be readable from the bird alone at arm's length.
A small cents number is always available for precision.
In tune = within ±3 cents. ±3 to ±10 cents = "close".
Only one bird animates at a time. One focal point on screen.
Calm, minimal UI. No ads, accounts or tracking. Works offline once loaded.
Must work in phone browsers (iOS Safari, Android Chrome) and on Mac.
Code rules
Audio logic (src/audio/) stays independent of rendering (src/scene/) so it can be tested alone.
Every change to pitch detection must keep npm test passing.
Small, readable files. Comment non-obvious DSP choices.
Don't add dependencies without saying why.
When a task is done, summarise what changed and how I can check it.