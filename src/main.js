// Entry point. ?sandbox → free camera world viewer, otherwise the game.
import { Game } from './game.js';
const game = new Game();
game.boot().catch(e => { console.error(e); document.getElementById('stats').textContent = 'ERROR ' + e.message; });
