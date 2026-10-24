// node tests/profspikes.mjs file.cpuprofile [minMs] — finds contiguous busy spans in a CPU profile and prints the
// heaviest inclusive call paths inside each, to attribute long frames.
import fs from 'node:fs';
const [file, minMs = '80'] = process.argv.slice(2);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map(n => [n.id, n]));
const parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const name = n => `${n.callFrame.functionName || '(anon)'}@${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
let t = prof.startTime; const samples = prof.samples.map((id, i) => { t += prof.timeDeltas[i]; return [t, id]; });
const idle = id => { const f = byId.get(id).callFrame.functionName; return f === '(idle)' || f === '(program)' && false; };
let runs = [], cur = null;
for (const [ts, id] of samples) {
  if (byId.get(id).callFrame.functionName === '(idle)') { if (cur) { runs.push(cur); cur = null; } continue; }
  if (!cur) cur = { t0: ts, t1: ts, ids: [] };
  if (ts - cur.t1 > 8000) { runs.push(cur); cur = { t0: ts, t1: ts, ids: [] }; }
  cur.t1 = ts; cur.ids.push(id);
}
if (cur) runs.push(cur);
runs = runs.filter(r => (r.t1 - r.t0) / 1000 >= +minMs);
for (const r of runs) {
  const incl = new Map(); const per = (r.t1 - r.t0) / r.ids.length;
  for (const id of r.ids) { const seen = new Set(); let x = id; while (x != null) { const n = byId.get(x); const k = name(n); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + per); } x = parent.get(x); } }
  const top = [...incl].filter(([k]) => !/^\(root\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log(`\n### span at ${((r.t0 - prof.startTime) / 1000).toFixed(0)} ms, ${((r.t1 - r.t0) / 1000).toFixed(0)} ms`);
  for (const [k, v] of top) console.log((v / 1000).toFixed(0).padStart(6), k);
}
