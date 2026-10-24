// "Claudia Autopilot (beta)": the AI pair-programmer drives Tommy's car to the map waypoint / mission target.
// Uses the lane graph for routing and the PathDriver for steering. Any steering input disengages it.
import { PathDriver } from './aiDriver.js';

export class Autopilot {
  constructor(game) {
    this.game = game;
    addEventListener('keydown', e => {
      if (e.__uiHandled || e.__cheatTyping || e.code !== 'KeyY' || game.state !== 'play' || game.paused) return;
      const p = game.player;
      if (p.autopilot) p.autopilot.disengage('Autopilot off. You have the wheel.');
      else this.engage();
    });
  }
  engage(target) {
    const g = this.game, p = g.player, v = p.vehicle;
    if (!v || v.isBoat || v.isAircraft) { g.ui.toast('Claudia Autopilot needs a car. She does not do boats. Yet.'); return; }
    const t = target || g.routeTarget || g.waypoint;
    if (!t) { g.ui.toast('Set a waypoint first (M, right-click) — Claudia needs a destination.'); return; }
    const route = g.roadnet.route(v.position.x, v.position.z, t.x, t.z);
    if (!route || route.length < 2) { g.ui.toast('Claudia could not find a route. She blames OpenStreetMap.'); return; }
    const drv = new PathDriver(g, v, route, { speed: 0.55, aggression: 0.6 });
    const step = h => { if (p.vehicle !== v) return this.disengage(); drv.update(h); if (drv.done) this.disengage('Arrived. Claudia would like a 5-star rating.'); };
    g.physics.onStep(step);
    this.state = { drv, step, v };
    p.autopilot = this;
    g.ui.toast('Claudia Autopilot (beta) engaged. Not responsible for pedestrians, ERP or vibes. Steer to take over.');
    g.audio?.sfx?.('ui_select');
  }
  disengage(msg) {
    const g = this.game, p = g.player;
    if (!this.state) { p.autopilot = null; return; }
    const i = g.physics.stepCallbacks.indexOf(this.state.step); if (i >= 0) g.physics.stepCallbacks.splice(i, 1);
    this.state = null; p.autopilot = null;
    if (msg) g.ui.toast(msg);
  }
}
