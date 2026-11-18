// Inside a hawker centre: islands of stalls standing back to back in the hall, fixed tables in rows round them, ceiling
// fans over the seating and tray-return stations at the islands' ends. Pure layout in the hall's own frame (the long
// axis of its oriented box); the city builder writes the geometry. Everything is kept a walkway's width inside the
// outline, where the columns stand.

export const STALL_W = 3.0, STALL_D = 2.6;   // one stall: frontage x depth
const AISLE = 1.8;                            // in front of a row of stalls: the queue and the way past it
const EDGE = 2.2;                             // clear of the outline: the columns and a walkway round the hall
const TABLE = 2.7;                            // table pitch (a 0.9 m table and its stools, a gap to squeeze through)

/**
 * ring: the hall's outline (CCW [x, z]); o: its oriented box (cx, cz, ux, uz, L, Wd); h(k): a hash 0..1 per integer k.
 * Returns world-space records: stalls [x, z, yaw, k] (front-centre on the floor, yaw turns local +z to the aisle, k the
 * stall's number in the hall), islands [x0, z0, x1, z1, x2, z2, x3, z3] (footprints), tables [x, z, yaw],
 * fans [x, z], trays [x, z, yaw].
 */
export function hallLayout(ring, o, h, pip) {
  const vx = -o.uz, vz = o.ux;
  const W = (a, b) => [o.cx + o.ux * a + vx * b, o.cz + o.uz * a + vz * b];
  const yawOf = (da, db) => Math.atan2(o.ux * da + vx * db, o.uz * da + vz * db);
  // (a, b) and a margin round it all inside the outline
  const inside = (a, b, m) => {
    for (let k = 0; k < 9; k++) {
      const da = k < 8 ? Math.cos(k * Math.PI / 4) * m : 0, db = k < 8 ? Math.sin(k * Math.PI / 4) * m : 0;
      const [x, z] = W(a + da, b + db); if (!pip(x, z, ring)) return false;
    }
    return true;
  };
  const out = { stalls: [], islands: [], tables: [], fans: [], trays: [] };
  const L = o.L, Wd = o.Wd;
  // islands: two rows back to back (one row along a narrow hall); each needs its aisles and a band of tables
  const single = Wd < 2 * EDGE + 2 * STALL_D + 2 * AISLE + 2;
  const nI = single ? 1 : Math.max(1, Math.round((Wd - 2 * EDGE) / 15));
  const rows = [];   // [b of the backs, side (+1 front faces +b, -1 faces -b)]
  const isl = [];    // [b0, b1] across each island, for the tables to keep clear of
  for (let k = 0; k < nI; k++) {
    if (single) { const b0 = -Wd / 2 + EDGE; rows.push([b0, 1]); isl.push([b0, b0 + STALL_D]); continue; }
    const bc = -Wd / 2 + Wd * (k + 0.5) / nI;
    rows.push([bc, 1], [bc, -1]); isl.push([bc - STALL_D, bc + STALL_D]);
  }
  // along the hall: tables at both ends, the stalls in runs of up to 8 with a cross aisle between runs
  let span = L - 2 * (EDGE + 2 * TABLE);
  if (span < 4 * STALL_W) span = L - 2 * (EDGE + TABLE);
  const nS = Math.max(0, Math.floor(span / STALL_W)), runs = Math.ceil(nS / 8), GAP = 3.6;
  const per = runs ? Math.ceil(nS / runs) : 0, len = nS * STALL_W + (runs - 1) * GAP;
  const slotA = [];
  for (let s = 0; s < nS; s++) { const r = Math.floor(s / per); slotA.push(-len / 2 + (s + 0.5) * STALL_W + r * GAP); }
  let k = 0;
  for (const [b0, side] of rows) {
    let lo = Infinity, hi = -Infinity;
    for (const a of slotA) {
      const bf = b0 + side * STALL_D;   // the counter's front line
      // the stall's footprint and its aisle (half a frontage each way), all inside
      if (!inside(a, b0 + side * STALL_D / 2, STALL_W / 2) || !inside(a, bf + side * AISLE / 2, STALL_W / 2)) continue;
      const [x, z] = W(a, bf);
      out.stalls.push(x, z, yawOf(0, side), k++);
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    if (lo > hi) continue;
    // the row's footprint, for its collider (back to back rows each add their own)
    const P = [W(lo - STALL_W / 2, b0), W(hi + STALL_W / 2, b0), W(hi + STALL_W / 2, b0 + side * STALL_D), W(lo - STALL_W / 2, b0 + side * STALL_D)];
    out.islands.push(...P.flat());
    // a tray-return station at each end of the island (once per island: the +b row places them)
    if (side > 0 || single) for (const e of [-1, 1]) {
      const a = e > 0 ? hi + STALL_W / 2 + 0.9 : lo - STALL_W / 2 - 0.9, b = single ? b0 + STALL_D / 2 : b0;
      if (inside(a, b, 1.2)) { const [x, z] = W(a, b); out.trays.push(x, z, yawOf(e, 0)); }
    }
  }
  // tables in rows over the rest of the floor, leaving the aisles in front of the stalls and round the hall
  const nA = Math.floor((L - 2 * EDGE) / TABLE), nB = Math.floor((Wd - 2 * EDGE) / TABLE);
  const yaw = yawOf(0, 1);
  for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
    if (i % 6 === 5) continue; // a cross aisle every few tables
    const a = -L / 2 + EDGE + (i + 0.5) * (L - 2 * EDGE) / nA, b = -Wd / 2 + EDGE + (j + 0.5) * (Wd - 2 * EDGE) / nB;
    let clear = true;
    for (const [b0, b1] of isl) if (b > b0 - AISLE - 1.0 && b < b1 + AISLE + 1.0 && a > -len / 2 - 2.4 && a < len / 2 + 2.4) clear = false;
    if (!clear || !inside(a, b, 1.3)) continue;
    const [x, z] = W(a, b);
    out.tables.push(x, z, yaw + (h(i * 31 + j) - 0.5) * 0.08);
  }
  // ceiling fans over the seating, in a looser grid
  const nFa = Math.floor((L - 2 * EDGE) / 5.4), nFb = Math.floor((Wd - 2 * EDGE) / 5.4);
  for (let i = 0; i < nFa; i++) for (let j = 0; j < nFb; j++) {
    const a = -L / 2 + EDGE + (i + 0.5) * (L - 2 * EDGE) / nFa, b = -Wd / 2 + EDGE + (j + 0.5) * (Wd - 2 * EDGE) / nFb;
    let over = false;
    for (const [b0, b1] of isl) if (b > b0 - 0.6 && b < b1 + 0.6 && a > -len / 2 - 0.6 && a < len / 2 + 0.6) over = true;
    if (!over && inside(a, b, 1.0)) out.fans.push(...W(a, b));
  }
  return out;
}
