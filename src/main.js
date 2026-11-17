// Entry point. ?sandbox → free camera world viewer, otherwise the game.
import { Game } from './game.js';
// iOS Safari ignores user-scalable=no: stop pinch-zoom of the page itself (in-game pinch is handled by the touch
// controls on elements with touch-action: none, which never zoom the page)
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
const game = new Game();
game.boot().catch(e => { console.error(e); document.getElementById('stats').textContent = 'ERROR ' + e.message; });
