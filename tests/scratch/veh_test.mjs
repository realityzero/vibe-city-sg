import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({x:0,y:-9.81,z:0});
w.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.2, 0).setCanSleep(false));
w.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.4, 2.2).setMass(1300), body);
const vc = w.createVehicleController(body);
console.log('default up/fwd', vc.indexUpAxis, vc.indexForwardAxis);
vc.setIndexForwardAxis = 2;
console.log('after', vc.indexUpAxis, vc.indexForwardAxis);
const pos = [[-0.8, -0.1, -1.4], [0.8, -0.1, -1.4], [-0.8, -0.1, 1.4], [0.8, -0.1, 1.4]];
for (const p of pos) vc.addWheel({x:p[0],y:p[1],z:p[2]}, {x:0,y:-1,z:0}, {x:-1,y:0,z:0}, 0.35, 0.34);
for (let i=0;i<4;i++){ vc.setWheelSuspensionStiffness(i, 30); vc.setWheelFrictionSlip(i, 2); }
for (let s=0;s<120;s++){ for(let i=2;i<4;i++) vc.setWheelEngineForce(i, 3000); vc.setWheelSteering(0, 0.3); vc.setWheelSteering(1, 0.3); vc.updateVehicle(1/60); w.step(); }
const v = body.linvel(), t = body.translation();
console.log('vel', v.x.toFixed(2), v.y.toFixed(2), v.z.toFixed(2), 'pos', t.x.toFixed(2), t.y.toFixed(2), t.z.toFixed(2), 'speed', vc.currentVehicleSpeed().toFixed(2), 'angvel y', body.angvel().y.toFixed(3));
