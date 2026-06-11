// client/src/engine/physics.js — disc flight simulation. ENGINE module.
// Pure math on plain {x,y,z} objects (no three.js) so it runs in both the
// browser and Node (multiplayer remote-disc sims reuse it too).

import {
  DISC_TYPES,
  GRAVITY,
  BASKET_CATCH_RADIUS,
  BASKET_HEIGHT,
  PLAYER_HIT_RADIUS,
} from '../../../shared/constants.js';

// ---- tuning constants (exported per DESIGN.md) ----
export const TUNING = {
  DRAG: 0.0062,          // quadratic air drag coefficient
  LIFT: 0.5,             // lift accel = LIFT * glide * speed (capped vs gravity)
  LIFT_CAP: 0.88,        // lift never exceeds this fraction of gravity
  CURVE_AUTH: 0.34,      // rad/s of yaw authority from the flick's curve input
  TURN_RATE: 0.25,       // scales disc.turn at high speed
  FADE_RATE: 0.7,        // scales disc.fade at low speed
  LAUNCH_PITCH: 0.42,    // rad at loft=1
  BOUNCE_RESTITUTION: 0.28,
  BOUNCE_FRICTION: 0.5,  // horizontal kept on bounce
  SLIDE_DECEL: 9,        // m/s^2 ground skid friction
  STOP_SPEED: 0.6,
  MIN_LAUNCH: 4,         // m/s at power 0
  SUBSTEP: 1 / 120,
};

const V0 = { x: 0, y: 0, z: 0 };

export function createThrow(discTypeKey, origin, throwParams) {
  const def = DISC_TYPES[discTypeKey] || DISC_TYPES.driver;
  const power = Math.min(1, Math.max(0, throwParams.power ?? 0.5));
  const loft = throwParams.loft ?? 0.35;
  const dirAngle = throwParams.dirAngle ?? 0;
  const curve = Math.min(1, Math.max(-1, throwParams.curve ?? 0));

  const speed = TUNING.MIN_LAUNCH + (def.maxSpeed - TUNING.MIN_LAUNCH) * power;
  // blade flies laser-flat so it can actually hit opponents at body height
  const pitch = TUNING.LAUNCH_PITCH * loft * (discTypeKey === 'blade' ? 0.22 : 1);
  const hs = speed * Math.cos(pitch);

  return {
    type: discTypeKey,
    def,
    pos: { x: origin.x, y: origin.y, z: origin.z },
    vel: {
      x: Math.sin(dirAngle) * hs,
      y: speed * Math.sin(pitch),
      z: Math.cos(dirAngle) * hs,
    },
    curve,
    power,
    spin: 1,
    age: 0,
    state: 'flying',       // 'flying' | 'sliding' | 'stopped' | 'inBasket' | 'water'
    bounces: 0,
    _hitPlayers: new Set(), // each player hit at most once per flight
    _treeCooldown: 0,
  };
}

function horizSpeed(v) {
  return Math.hypot(v.x, v.z);
}

function yawOf(v) {
  return Math.atan2(v.x, v.z);
}

function setYaw(v, yaw) {
  const hs = horizSpeed(v);
  v.x = Math.sin(yaw) * hs;
  v.z = Math.cos(yaw) * hs;
}

// Single physics substep. Pushes events into `out`.
function substep(disc, dt, world, out) {
  const { pos, vel, def } = disc;
  disc.age += dt;
  if (disc._treeCooldown > 0) disc._treeCooldown -= dt;

  if (disc.state === 'flying') {
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const frac = speed / def.maxSpeed;

    // gravity + lift (glidey discs float; lift capped so they always come down)
    const lift = Math.min(
      TUNING.LIFT_CAP * GRAVITY,
      TUNING.LIFT * def.glide * speed
    );
    vel.y += (lift - GRAVITY) * dt;

    // quadratic drag
    const drag = TUNING.DRAG * speed;
    vel.x -= vel.x * drag * dt;
    vel.y -= vel.y * drag * dt;
    vel.z -= vel.z * drag * dt;

    // S-curve steering: positive yaw delta = turns right.
    // High speed: disc.turn (negative stats turn right) + thrower's curve.
    // Low speed: fade drifts left.
    const hsFactor = Math.min(1, Math.max(0, (frac - 0.62) / 0.33));
    const lsFactor = Math.min(1, Math.max(0, (0.55 - frac) / 0.55));
    let yawRate =
      -def.turn * TUNING.TURN_RATE * hsFactor +
      disc.curve * TUNING.CURVE_AUTH * Math.min(1, frac * 1.15) -
      def.fade * TUNING.FADE_RATE * lsFactor;
    if (horizSpeed(vel) > 0.5) setYaw(vel, yawOf(vel) + yawRate * dt);

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    // ---- basket ----
    if (world.basket) {
      const b = world.basket;
      const hd = Math.hypot(pos.x - b.x, pos.z - b.z);
      if (hd < BASKET_CATCH_RADIUS && pos.y > b.y + 0.12 && pos.y < b.y + BASKET_HEIGHT + 0.35) {
        disc.state = 'inBasket';
        pos.x = b.x;
        pos.y = b.y + 0.75;
        pos.z = b.z;
        vel.x = vel.y = vel.z = 0;
        out.push({ kind: 'chains' });
        out.push({ kind: 'basket' });
        return;
      }
    }

    // ---- players (blade kills etc.) ----
    if (world.players && speed > 6) {
      for (const p of world.players) {
        if (disc._hitPlayers.has(p.id)) continue;
        const cy = p.pos.y + 0.9;
        const d = Math.hypot(pos.x - p.pos.x, pos.y - cy, pos.z - p.pos.z);
        if (d < (p.radius || PLAYER_HIT_RADIUS)) {
          disc._hitPlayers.add(p.id);
          out.push({ kind: 'playerHit', playerId: p.id });
        }
      }
    }

    // ---- tree trunks + canopies ----
    if (world.trees && disc._treeCooldown <= 0) {
      for (const t of world.trees) {
        if (world.flattenedTreeIds && world.flattenedTreeIds.has(t.id)) continue;
        const dx = pos.x - t.x;
        const dz = pos.z - t.z;
        const hd2 = dx * dx + dz * dz;
        const baseY = world.heightAt(t.x, t.z);
        const relY = pos.y - baseY;
        if (relY < 0 || relY > t.height) continue;

        const trunkR = t.trunkRadius + 0.22;
        if (hd2 < trunkR * trunkR) {
          // BONK — bounce off the trunk and drop
          const hd = Math.sqrt(hd2) || 0.001;
          const nx = dx / hd;
          const nz = dz / hd;
          const dot = vel.x * nx + vel.z * nz;
          vel.x = (vel.x - 2 * dot * nx) * 0.18;
          vel.z = (vel.z - 2 * dot * nz) * 0.18;
          vel.y = Math.min(vel.y, 0.5);
          disc._treeCooldown = 0.25;
          out.push({ kind: 'treeHit' });
          break;
        }
        // soft canopy hit (upper half of the tree only)
        const canR = t.canopyRadius * 0.62;
        if (relY > t.height * 0.42 && hd2 < canR * canR && horizSpeed(vel) > 7) {
          vel.x *= 0.42;
          vel.y *= 0.42;
          vel.z *= 0.42;
          disc._treeCooldown = 0.4;
          out.push({ kind: 'treeHit' });
          break;
        }
      }
    }

    // ---- ground contact ----
    const gy = world.heightAt(pos.x, pos.z);
    if (pos.y <= gy + 0.06 && vel.y < 0) {
      pos.y = gy + 0.06;
      if (inWater(pos, world)) {
        disc.state = 'water';
        vel.x = vel.y = vel.z = 0;
        out.push({ kind: 'water' });
        return;
      }
      const impact = Math.hypot(vel.x, vel.y, vel.z);
      if (impact > 7 && disc.bounces < 2) {
        disc.bounces += 1;
        vel.y = -vel.y * TUNING.BOUNCE_RESTITUTION;
        vel.x *= TUNING.BOUNCE_FRICTION;
        vel.z *= TUNING.BOUNCE_FRICTION;
      } else {
        disc.state = 'sliding';
        vel.y = 0;
      }
    }
    return;
  }

  if (disc.state === 'sliding') {
    const hs = horizSpeed(vel);
    if (hs <= TUNING.STOP_SPEED) {
      disc.state = 'stopped';
      vel.x = vel.z = 0;
      out.push({ kind: 'landed' });
      return;
    }
    const dec = Math.max(0, hs - TUNING.SLIDE_DECEL * dt) / hs;
    vel.x *= dec;
    vel.z *= dec;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    pos.y = world.heightAt(pos.x, pos.z) + 0.06;
    if (inWater(pos, world)) {
      disc.state = 'water';
      vel.x = vel.y = vel.z = 0;
      out.push({ kind: 'water' });
    }
  }
}

function inWater(pos, world) {
  if (!world.waters) return false;
  for (const w of world.waters) {
    const dx = pos.x - w.x;
    const dz = pos.z - w.z;
    if (dx * dx + dz * dz < w.radius * w.radius * 0.92) return true;
  }
  return false;
}

// Steps the disc by dt (substepped internally for stability). Mutates disc,
// returns an array of events: landed | water | treeHit | chains | basket | playerHit.
export function stepDisc(disc, dt, world) {
  const out = [];
  if (disc.state === 'stopped' || disc.state === 'inBasket' || disc.state === 'water') {
    return out;
  }
  let remaining = Math.min(dt, 0.25);
  while (remaining > 0 && disc.state !== 'stopped' && disc.state !== 'inBasket' && disc.state !== 'water') {
    const h = Math.min(TUNING.SUBSTEP, remaining);
    substep(disc, h, world, out);
    remaining -= h;
  }
  return out;
}
