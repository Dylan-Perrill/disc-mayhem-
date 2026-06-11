// client/src/course/generator.js — COURSE agent.
// Procedural 18-hole course generation. PURE data/math module: no three.js
// imports, 100% deterministic from a uint32 seed (multiplayer clients and the
// server must be able to generate identical courses). Only shared/rng.js is
// used for randomness — never Math.random.

import { mulberry32, randRange, pick } from '/shared/rng.js';
import { HOLE_COUNT } from '/shared/constants.js';

const WORLD_W = 900;
const WORLD_D = 900;
const HOLE_MARGIN = 45;       // holes keep this far from the world edge
const LOOP_EDGE_MARGIN = 85;  // the guiding loop stays this far from the edge
const CORRIDOR_HALF = 7;      // fairway corridor half-width (14 m wide total)
const WATER_DIP = 1.5;        // terrain dip inside ponds (m)

// ---------------------------------------------------------------------------
// Deterministic value noise: integer-lattice hash mixed with the seed,
// smoothstep-interpolated. Pure + fast (heightAt runs every physics frame).
// ---------------------------------------------------------------------------

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0, 1)
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const v00 = hash2(ix, iz, seed);
  const v10 = hash2(ix + 1, iz, seed);
  const v01 = hash2(ix, iz + 1, seed);
  const v11 = hash2(ix + 1, iz + 1, seed);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sz;
}

// 3 octaves of value noise -> rolling hills roughly -3..+8 m, plus a smooth
// ~1.5 m dip inside each water circle. Continuous everywhere.
function makeHeightAt(seed, waters) {
  const s1 = (seed ^ 0x9e3779b9) | 0;
  const s2 = (seed ^ 0x85ebca6b) | 0;
  const s3 = (seed ^ 0xc2b2ae35) | 0;
  // Flatten water list into plain numbers for the hot path.
  const ws = waters.map((w) => ({ x: w.x, z: w.z, r: w.radius }));
  return function heightAt(x, z) {
    let n =
      0.58 * valueNoise(x * 0.0062, z * 0.0062, s1) +
      0.30 * valueNoise(x * 0.016, z * 0.016, s2) +
      0.12 * valueNoise(x * 0.043, z * 0.043, s3);
    n = (n - 0.5) * 1.75 + 0.5; // stretch toward the full -3..+8 band
    let y = -3 + 11 * n;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const dx = x - w.x;
      const dz = z - w.z;
      const outer = w.r + 7;
      const d2 = dx * dx + dz * dz;
      if (d2 < outer * outer) {
        const d = Math.sqrt(d2);
        const inner = w.r * 0.55;
        let u = (d - inner) / (outer - inner);
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
        const sm = u * u * (3 - 2 * u);
        y -= WATER_DIP * (1 - sm);
      }
    }
    return y;
  };
}

// ---------------------------------------------------------------------------
// Small 2D helpers
// ---------------------------------------------------------------------------

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function clampPt(p) {
  return {
    x: Math.min(WORLD_W - HOLE_MARGIN, Math.max(HOLE_MARGIN, p.x)),
    z: Math.min(WORLD_D - HOLE_MARGIN, Math.max(HOLE_MARGIN, p.z)),
  };
}

function polylineLength(wps) {
  let len = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    len += Math.hypot(wps[i + 1].x - wps[i].x, wps[i + 1].z - wps[i].z);
  }
  return len;
}

// Point at `dist` metres along a waypoint polyline (clamped to the end).
// Also returns the local segment direction.
function pointAlongPolyline(wps, dist) {
  let remaining = Math.max(0, dist);
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= segLen || i === wps.length - 2) {
      const t = segLen > 0 ? Math.min(remaining / segLen, 1) : 0;
      const dx = segLen > 0 ? (b.x - a.x) / segLen : 1;
      const dz = segLen > 0 ? (b.z - a.z) / segLen : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dirX: dx, dirZ: dz };
    }
    remaining -= segLen;
  }
  const last = wps[wps.length - 1];
  return { x: last.x, z: last.z, dirX: 1, dirZ: 0 };
}

function pointSegDist2(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return dist2(px, pz, ax + abx * t, az + abz * t);
}

// ---------------------------------------------------------------------------
// Layout: a closed guiding loop (wobbly rounded square around the map centre)
// parameterised by arc length. Holes walk it head-to-tail.
// ---------------------------------------------------------------------------

function buildLoopCurve(rand, targetLen) {
  const cx = WORLD_W / 2;
  const cz = WORLD_D / 2;
  const k1 = 2 + Math.floor(rand() * 2); // integer harmonics keep the loop closed
  const k2 = 4 + Math.floor(rand() * 2);
  const a1 = randRange(rand, 0.025, 0.055);
  const a2 = randRange(rand, 0.02, 0.04);
  const ph1 = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const theta0 = rand() * Math.PI * 2; // random start point on the loop
  const ccw = rand() < 0.5 ? 1 : -1;   // travel direction around the course

  const N = 720;
  const unit = [];
  let maxR = 0;
  for (let i = 0; i <= N; i++) {
    const t = theta0 + ccw * (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    // superellipse (rounded square) so the loop uses the corners of the map
    const sq = Math.pow(c * c * c * c + s * s * s * s, 0.25);
    const wob = 1 + a1 * Math.sin(k1 * t + ph1) + a2 * Math.sin(k2 * t + ph2);
    const r = (1 / sq) * wob;
    if (r > maxR) maxR = r;
    unit.push({ x: c * r, z: s * r });
  }
  const cum = [0];
  let per = 0;
  for (let i = 1; i <= N; i++) {
    per += Math.hypot(unit[i].x - unit[i - 1].x, unit[i].z - unit[i - 1].z);
    cum.push(per);
  }
  let scale = targetLen / per;
  const maxAllowed = Math.min(WORLD_W, WORLD_D) / 2 - LOOP_EDGE_MARGIN;
  if (scale * maxR > maxAllowed) scale = maxAllowed / maxR;

  return {
    // frac in [0..1) of total arc length -> world-space point
    pointAt(frac) {
      let f = frac % 1;
      if (f < 0) f += 1;
      const target = f * per;
      let lo = 0;
      let hi = N;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cum[mid] <= target) lo = mid;
        else hi = mid - 1;
      }
      const i = Math.min(lo, N - 1);
      const span = cum[i + 1] - cum[i] || 1;
      const u = (target - cum[i]) / span;
      const a = unit[i];
      const b = unit[i + 1];
      return {
        x: cx + (a.x + (b.x - a.x) * u) * scale,
        z: cz + (a.z + (b.z - a.z) * u) * scale,
      };
    },
  };
}

// Par mix: 9-10 par 3s, 5-6 par 4s, 2-3 par 5s summing to 18. Shuffled, with
// the closing hole forced to a straight par 3 so the loop closes tidily.
function makeParSequence(rand) {
  const combo = pick(rand, [
    [10, 5, 3],
    [9, 6, 3],
    [10, 6, 2],
  ]);
  const pars = [];
  for (let i = 0; i < combo[0]; i++) pars.push(3);
  for (let i = 0; i < combo[1]; i++) pars.push(4);
  for (let i = 0; i < combo[2]; i++) pars.push(5);
  for (let i = pars.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pars[i];
    pars[i] = pars[j];
    pars[j] = tmp;
  }
  if (pars[HOLE_COUNT - 1] !== 3) {
    const j = pars.indexOf(3);
    pars[j] = pars[HOLE_COUNT - 1];
    pars[HOLE_COUNT - 1] = 3;
  }
  return pars;
}

// Dogleg path: par 3 straight, par 4 one bend, par 5 one or two bends of
// 20-45 degrees. Bend side flips if the basket would leave the safe area.
function doglegWaypoints(rand, tee, dir, length, par) {
  const bendCount = par === 3 ? 0 : par === 4 ? 1 : rand() < 0.55 ? 2 : 1;
  if (bendCount === 0) {
    return [
      { x: tee.x, z: tee.z },
      { x: tee.x + dir.x * length, z: tee.z + dir.z * length },
    ];
  }
  const fracs =
    bendCount === 1
      ? [randRange(rand, 0.38, 0.62)]
      : [randRange(rand, 0.28, 0.42), randRange(rand, 0.6, 0.75)];
  const bendRad = [];
  for (let i = 0; i < bendCount; i++) {
    bendRad.push((randRange(rand, 20, 45) * Math.PI) / 180);
  }
  const sameSign = bendCount === 2 ? rand() < 0.5 : true;
  const baseSign = rand() < 0.5 ? 1 : -1;

  const build = (sign) => {
    const wps = [{ x: tee.x, z: tee.z }];
    let ang = Math.atan2(dir.z, dir.x);
    let px = tee.x;
    let pz = tee.z;
    let prevFrac = 0;
    for (let b = 0; b <= bendCount; b++) {
      const frac = b < bendCount ? fracs[b] : 1;
      const segLen = (frac - prevFrac) * length;
      px += Math.cos(ang) * segLen;
      pz += Math.sin(ang) * segLen;
      wps.push({ x: px, z: pz });
      if (b < bendCount) {
        const s = b === 0 ? sign : sameSign ? sign : -sign;
        ang += s * bendRad[b];
      }
      prevFrac = frac;
    }
    return wps;
  };

  let wps = build(baseSign);
  const end = wps[wps.length - 1];
  const safe = HOLE_MARGIN + 10;
  if (
    end.x < safe ||
    end.x > WORLD_W - safe ||
    end.z < safe ||
    end.z > WORLD_D - safe
  ) {
    wps = build(-baseSign);
  }
  return wps;
}

function layoutHoles(rand) {
  const pars = makeParSequence(rand);
  const lengths = pars.map((p) =>
    p === 3
      ? randRange(rand, 60, 110)
      : p === 4
        ? randRange(rand, 120, 180)
        : randRange(rand, 190, 260)
  );
  const gaps = [];
  for (let i = 0; i < HOLE_COUNT; i++) gaps.push(randRange(rand, 14, 30));
  let total = 0;
  for (let i = 0; i < HOLE_COUNT; i++) total += lengths[i] + gaps[i];

  const loop = buildLoopCurve(rand, total);

  const holes = [];
  let s = 0;
  let tee = clampPt(loop.pointAt(0));
  for (let i = 0; i < HOLE_COUNT; i++) {
    const L = lengths[i];
    // Aim at the loop point one hole-length further along the arc. This
    // continually re-anchors the walk to the loop so drift never accumulates.
    const target = loop.pointAt((s + L) / total);
    let dx = target.x - tee.x;
    let dz = target.z - tee.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-6) {
      dx = 1;
      dz = 0;
    } else {
      dx /= dl;
      dz /= dl;
    }
    let wps = doglegWaypoints(rand, tee, { x: dx, z: dz }, L, pars[i]);
    wps = wps.map(clampPt);
    const basket = wps[wps.length - 1];
    holes.push({
      index: i,
      par: pars[i],
      tee: { x: tee.x, y: 0, z: tee.z },
      basket: { x: basket.x, y: 0, z: basket.z },
      length: polylineLength(wps),
      waypoints: wps,
    });
    s += L;
    const anchor = loop.pointAt((s + gaps[i]) / total);
    s += gaps[i];
    if (i < HOLE_COUNT - 1) {
      // Next tee: a short hop (<= 32 m, so always within the ~40 m contract)
      // from this basket toward the next loop anchor.
      let gx = anchor.x - basket.x;
      let gz = anchor.z - basket.z;
      const gd = Math.hypot(gx, gz);
      if (gd < 1e-6) {
        gx = dx;
        gz = dz;
      } else {
        gx /= gd;
        gz /= gd;
      }
      const hop = Math.min(Math.max(gd, 12), 32);
      tee = clampPt({ x: basket.x + gx * hop, z: basket.z + gz * hop });
    }
  }
  return holes;
}

// ---------------------------------------------------------------------------
// Water: 4-6 circular ponds threatening specific holes — beside or crossing
// the corridor mid-hole. Never on tees/baskets; pond edge >= 12 m from every
// basket so putting is never suicide.
// ---------------------------------------------------------------------------

function waterPlacementOk(x, z, r, holes, waters) {
  if (
    x < r + 25 ||
    x > WORLD_W - r - 25 ||
    z < r + 25 ||
    z > WORLD_D - r - 25
  ) {
    return false;
  }
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    if (dist2(x, z, h.tee.x, h.tee.z) < (r + 8) * (r + 8)) return false;
    if (dist2(x, z, h.basket.x, h.basket.z) < (r + 12) * (r + 12)) return false;
  }
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    const min = r + w.radius + 10;
    if (dist2(x, z, w.x, w.z) < min * min) return false;
  }
  return true;
}

function placeWaters(rand, holes) {
  const count = 4 + Math.floor(rand() * 3); // 4..6
  const waters = [];

  // Shuffle hole order, then stable-sort longer holes to the front so ponds
  // favour holes with room for a real hazard (order stays seed-deterministic).
  const order = [];
  for (let i = 0; i < HOLE_COUNT; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  order.sort((a, b) => (holes[a].length > 115 ? 0 : 1) - (holes[b].length > 115 ? 0 : 1));

  const tryHole = (hole, attempts, t0, t1) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const radius = randRange(rand, 8, 20);
      const along = randRange(rand, t0, t1) * hole.length;
      const p = pointAlongPolyline(hole.waypoints, along);
      const side = rand() < 0.5 ? 1 : -1;
      const crossing = rand() < 0.4;
      const off = crossing
        ? randRange(rand, 0, radius * 0.3) // pond swallows the corridor
        : randRange(rand, radius * 0.55 + 3, radius + 9); // guards one side
      const wx = p.x - p.dirZ * side * off;
      const wz = p.z + p.dirX * side * off;
      if (waterPlacementOk(wx, wz, radius, holes, waters)) {
        waters.push({ x: wx, z: wz, radius });
        return true;
      }
    }
    return false;
  };

  for (let oi = 0; oi < order.length && waters.length < count; oi++) {
    tryHole(holes[order[oi]], 16, 0.32, 0.68);
  }
  // Fallback (rare): loosen the along-fraction until we have at least 4.
  for (let oi = 0; oi < order.length && waters.length < 4; oi++) {
    tryHole(holes[order[oi]], 30, 0.22, 0.78);
  }
  return waters;
}

// ---------------------------------------------------------------------------
// Trees: walls lining each fairway, rough scatter near corridors, and a
// uniform fill across the rest of the map. The ~14 m corridor along each
// hole's waypoints stays clear apart from the occasional guardian tree.
// ---------------------------------------------------------------------------

function placeTrees(rand, holes, waters) {
  const trees = [];
  const cell = 5;
  const grid = new Map(); // coarse hash for minimum tree spacing

  const gridKey = (gx, gz) => gx * 1024 + gz;
  const addToGrid = (t) => {
    const k = gridKey(Math.floor(t.x / cell), Math.floor(t.z / cell));
    let arr = grid.get(k);
    if (!arr) {
      arr = [];
      grid.set(k, arr);
    }
    arr.push(t);
  };
  const spacedOk = (x, z, minD) => {
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    const min2 = minD * minD;
    for (let dgx = -1; dgx <= 1; dgx++) {
      for (let dgz = -1; dgz <= 1; dgz++) {
        const arr = grid.get(gridKey(gx + dgx, gz + dgz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          if (dist2(x, z, arr[i].x, arr[i].z) < min2) return false;
        }
      }
    }
    return true;
  };

  // All fairway segments, for corridor-distance tests against EVERY hole.
  const segs = [];
  for (let i = 0; i < holes.length; i++) {
    const wps = holes[i].waypoints;
    for (let j = 0; j < wps.length - 1; j++) {
      segs.push([wps[j].x, wps[j].z, wps[j + 1].x, wps[j + 1].z]);
    }
  }
  const corridorDist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const d2 = pointSegDist2(x, z, s[0], s[1], s[2], s[3]);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };

  const nearTeeOrBasket = (x, z) => {
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      if (dist2(x, z, h.tee.x, h.tee.z) < 64) return true; // 8 m
      if (dist2(x, z, h.basket.x, h.basket.z) < 64) return true;
    }
    return false;
  };
  const inWater = (x, z) => {
    for (let i = 0; i < waters.length; i++) {
      const w = waters[i];
      const min = w.radius + 1.5;
      if (dist2(x, z, w.x, w.z) < min * min) return true;
    }
    return false;
  };

  const tryAdd = (x, z, allowGuardian) => {
    if (x < 8 || x > WORLD_W - 8 || z < 8 || z > WORLD_D - 8) return false;
    const cd = corridorDist(x, z);
    if (cd < CORRIDOR_HALF) {
      // Rare guardian tree allowed only at the very edge of the corridor.
      const guardian =
        allowGuardian && cd >= CORRIDOR_HALF - 1.5 && rand() < 0.06;
      if (!guardian) return false;
    }
    if (nearTeeOrBasket(x, z)) return false;
    if (inWater(x, z)) return false;
    if (!spacedOk(x, z, 2.4)) return false;
    const roll = rand();
    const kind = roll < 0.45 ? 'pine' : roll < 0.8 ? 'round' : 'tall';
    const tree = {
      id: trees.length + 1,
      x,
      z,
      height:
        kind === 'tall'
          ? randRange(rand, 8, 12)
          : kind === 'pine'
            ? randRange(rand, 5, 12)
            : randRange(rand, 4, 9),
      trunkRadius: randRange(rand, 0.25, 0.5),
      canopyRadius:
        kind === 'round' ? randRange(rand, 2.2, 4) : randRange(rand, 1.5, 3.2),
      kind,
    };
    trees.push(tree);
    addToGrid(tree);
    return true;
  };

  // 1) Walls of trees lining each fairway (just outside the corridor).
  for (let hi = 0; hi < holes.length; hi++) {
    const wps = holes[hi].waypoints;
    for (let si = 0; si < wps.length - 1; si++) {
      const a = wps[si];
      const b = wps[si + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 2) continue;
      const dx = (b.x - a.x) / segLen;
      const dz = (b.z - a.z) / segLen;
      const slots = Math.floor(segLen / 10);
      for (let k = 0; k < slots; k++) {
        for (let side = -1; side <= 1; side += 2) {
          if (rand() > 0.78) continue;
          const along = ((k + randRange(rand, 0.15, 0.85)) / slots) * segLen;
          const lat = randRange(rand, 8.5, 15) * side;
          tryAdd(a.x + dx * along - dz * lat, a.z + dz * along + dx * lat, false);
        }
      }
    }
  }

  // 2) Rough scatter clustered near fairways (the punishing miss zone).
  for (let i = 0; i < 240; i++) {
    const h = holes[Math.floor(rand() * HOLE_COUNT)];
    const p = pointAlongPolyline(h.waypoints, rand() * h.length);
    const side = rand() < 0.5 ? -1 : 1;
    const lat = randRange(rand, 12, 48) * side;
    tryAdd(p.x - p.dirZ * lat, p.z + p.dirX * lat, true);
  }

  // 3) Uniform fill across the whole map (centre + outskirts).
  for (let i = 0; i < 320; i++) {
    tryAdd(
      randRange(rand, 10, WORLD_W - 10),
      randRange(rand, 10, WORLD_D - 10),
      true
    );
  }

  return trees;
}

// ---------------------------------------------------------------------------
// Decor: purely visual bushes / rocks / flowers, anywhere outside water.
// ---------------------------------------------------------------------------

function placeDecor(rand, holes, waters) {
  const decor = [];
  const kinds = ['bush', 'rock', 'flower'];
  for (let i = 0; i < 340; i++) {
    const x = randRange(rand, 6, WORLD_W - 6);
    const z = randRange(rand, 6, WORLD_D - 6);
    let bad = false;
    for (let wi = 0; wi < waters.length && !bad; wi++) {
      const w = waters[wi];
      const min = w.radius + 1;
      if (dist2(x, z, w.x, w.z) < min * min) bad = true;
    }
    for (let hi = 0; hi < holes.length && !bad; hi++) {
      const h = holes[hi];
      if (dist2(x, z, h.tee.x, h.tee.z) < 16) bad = true; // keep pads clean
      else if (dist2(x, z, h.basket.x, h.basket.z) < 16) bad = true;
    }
    if (bad) continue;
    decor.push({ x, z, kind: pick(rand, kinds), scale: randRange(rand, 0.5, 1.5) });
  }
  return decor;
}

// ---------------------------------------------------------------------------
// Validation: catch NaNs / out-of-bounds holes before anything ships them.
// ---------------------------------------------------------------------------

function validateCourse(course) {
  const { holes, heightAt, worldSize } = course;
  if (holes.length !== HOLE_COUNT) {
    throw new Error(`generateCourse: expected ${HOLE_COUNT} holes, got ${holes.length}`);
  }
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const pts = [h.tee, h.basket];
    for (let p = 0; p < pts.length; p++) {
      const pt = pts[p];
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) {
        throw new Error(`generateCourse: hole ${i} has a non-finite tee/basket`);
      }
      if (pt.x < 0 || pt.x > worldSize.w || pt.z < 0 || pt.z > worldSize.d) {
        throw new Error(`generateCourse: hole ${i} is out of bounds`);
      }
    }
    if (!(h.length > 0) || h.waypoints.length < 2) {
      throw new Error(`generateCourse: hole ${i} has a degenerate path`);
    }
    for (let d = 0; d <= h.length; d += 5) {
      const p = pointAlongPolyline(h.waypoints, d);
      if (!Number.isFinite(heightAt(p.x, p.z))) {
        throw new Error(`generateCourse: NaN terrain height on hole ${i}`);
      }
    }
  }
  if (course.waters.length < 4 || course.waters.length > 6) {
    throw new Error(`generateCourse: expected 4-6 waters, got ${course.waters.length}`);
  }
  for (let i = 0; i < course.trees.length; i++) {
    const t = course.trees[i];
    if (!Number.isFinite(t.x + t.z + t.height + t.trunkRadius + t.canopyRadius)) {
      throw new Error(`generateCourse: tree ${t.id} has non-finite fields`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateCourse(seed) {
  seed = seed >>> 0;
  const rand = mulberry32(seed);

  const holes = layoutHoles(rand);
  const waters = placeWaters(rand, holes);
  const heightAt = makeHeightAt(seed, waters); // waters finalised BEFORE heightAt
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    h.tee.y = heightAt(h.tee.x, h.tee.z);
    h.basket.y = heightAt(h.basket.x, h.basket.z);
  }
  const trees = placeTrees(rand, holes, waters);
  const decor = placeDecor(rand, holes, waters);

  const course = {
    seed,
    worldSize: { w: WORLD_W, d: WORLD_D },
    heightAt,
    holes,
    trees,
    waters,
    decor,
  };
  validateCourse(course);
  return course;
}
