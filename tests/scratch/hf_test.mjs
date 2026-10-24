import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({x:0,y:-9.81,z:0});
// try nrows=2 ncols=3 with (nrows+1)*(ncols+1) heights, height = column index*10 + row index
const nr = 2, nc = 3;
let heights;
try {
  heights = new Float32Array((nr+1)*(nc+1));
  // column-major: index = col*(nr+1) + row
  for (let c=0;c<=nc;c++) for (let r=0;r<=nr;r++) heights[c*(nr+1)+r] = c*10 + r;
  w.createCollider(RAPIER.ColliderDesc.heightfield(nr, nc, heights, {x: 30, y: 1, z: 20}));
  console.log('created with (nr+1)*(nc+1)');
} catch(e) { console.log('fail', e.message); }
w.step();
for (const [x,z] of [[-15,-10],[15,-10],[-15,10],[15,10],[0,0]]) {
  const ray = new RAPIER.Ray({x, y: 100, z}, {x:0,y:-1,z:0});
  const hit = w.castRay(ray, 200, true);
  console.log(x, z, hit ? (100 - hit.timeOfImpact).toFixed(2) : 'miss');
}
