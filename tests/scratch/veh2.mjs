import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const G = { STATIC: 1, CHAR: 2, VEHICLE: 4, TRAFFIC: 8 };
const groups = (m, f) => (m << 16) | f;
const w = new RAPIER.World({x:0,y:-9.81,z:0});
const nr = 10, nc = 10; const h = new Float32Array((nr+1)*(nc+1));
w.createCollider(RAPIER.ColliderDesc.heightfield(nr, nc, h, {x: 400, y: 1, z: 400}).setCollisionGroups(groups(G.STATIC, 0xffff)));
const mass = 1450, wr = 0.33, rest = 0.3, height = 1.12, length = 4.25, width = 1.98;
const clearance = wr * 0.55, hh = Math.max(0.25, (height - clearance) / 2 * 0.86), hx = width/2*0.94, hz = length/2*0.95;
const mode = process.argv[2] || 'mine';
const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.15, 0).setCanSleep(false));
let cd = RAPIER.ColliderDesc.cuboid(hx, hh, hz).setTranslation(0, clearance + hh, 0).setCollisionGroups(groups(G.VEHICLE, G.STATIC|G.VEHICLE|G.TRAFFIC|G.CHAR));
if (mode === 'mine') cd = cd.setMassProperties(mass, { x: 0, y: clearance + hh * 0.35, z: 0 }, { x: mass * (hh*hh + hz*hz)/3, y: mass*(hx*hx+hz*hz)/3, z: mass*(hx*hx+hh*hh)/3 }, { x: 0, y: 0, z: 0, w: 1 });
else cd = cd.setMass(mass);
w.createCollider(cd, body);
const vc = w.createVehicleController(body); vc.setIndexForwardAxis = 2;
const connY = wr + rest * 0.75;
for (const [x, z] of [[0.81,-1.25],[-0.81,-1.25],[0.81,1.25],[-0.81,1.25]]) vc.addWheel({x, y: connY, z}, {x:0,y:-1,z:0}, {x:-1,y:0,z:0}, rest, wr);
for (let i=0;i<4;i++){ vc.setWheelSuspensionStiffness(i, 40); vc.setWheelSuspensionCompression(i, 3.2); vc.setWheelSuspensionRelaxation(i, 3.6); vc.setWheelMaxSuspensionForce(i, mass*40); vc.setWheelMaxSuspensionTravel(i, rest*1.2); vc.setWheelFrictionSlip(i, 2.2*1.45); }
const wheelsFilter = groups(G.VEHICLE, G.STATIC);
for (let s=0;s<180;s++){
  for (let i=0;i<4;i++) { vc.setWheelEngineForce(i, s > 60 ? -11000/4 : 0); vc.setWheelBrake(i, 0); }
  vc.updateVehicle(1/60, undefined, mode === 'nofilter' ? undefined : wheelsFilter); w.step();
  if (s % 30 === 0) console.log(s, 'y', body.translation().y.toFixed(3), 'contact', [0,1,2,3].map(i=>vc.wheelIsInContact(i)?1:0).join(''), 'susp', vc.wheelSuspensionLength(0)?.toFixed(3), 'speed', vc.currentVehicleSpeed().toFixed(2));
}
