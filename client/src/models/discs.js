// discs.js — disc visuals + self-managed ribbon trails. MODELS agent.
// createDiscVisual(typeKey, trailColor) -> DiscVisual (see DESIGN.md).

import * as THREE from 'three';
import { toonMaterial, palette } from './materials.js';
import { DISC_TYPES } from '/shared/constants.js';

const TRAIL_SEGMENTS = 26;
const TRAIL_LIFE = 0.45;     // seconds a segment lives
const TRAIL_EMIT_EVERY = 0.022;

export function createDiscVisual(typeKey, trailColor = 0xffffff) {
  const def = DISC_TYPES[typeKey] || DISC_TYPES.driver;

  const group = new THREE.Group();   // world transform (position + flight tilt)
  const spinner = new THREE.Group(); // spins fast around local Y
  group.add(spinner);

  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };
  const mesh = (geo, mat) => new THREE.Mesh(track(geo), track(mat));

  // -------------------------------------------------------------------------
  // build per-type body
  // -------------------------------------------------------------------------
  let sparkMat = null; // bomb fuse spark, flickers in update
  let spinTarget = 28; // rad/s while flying

  if (typeKey === 'blade') {
    spinTarget = 36;
    // aggressive dark-red disc
    const plate = mesh(new THREE.CylinderGeometry(0.2, 0.225, 0.05, 20), toonMaterial(0x991414));
    spinner.add(plate);
    const rim = mesh(new THREE.TorusGeometry(0.215, 0.026, 8, 24), toonMaterial(0x550d0d));
    rim.rotation.x = Math.PI / 2;
    spinner.add(rim);
    const hub = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), toonMaterial(palette.nearBlack));
    spinner.add(hub);
    // 4 protruding metallic blade fins
    const finGeo = track(new THREE.ConeGeometry(0.05, 0.17, 6));
    const finMat = track(toonMaterial(0xcfd4da, { emissive: 0x222226 }));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.rotation.x = Math.PI / 2;       // point along +Z…
      fin.scale.set(1, 1, 0.35);          // …flattened like a blade
      const pivot = new THREE.Group();
      pivot.rotation.y = a;               // …then swung around the rim
      fin.position.z = 0.295;
      pivot.add(fin);
      spinner.add(pivot);
    }
  } else if (typeKey === 'bomb') {
    spinTarget = 7;
    const ball = mesh(new THREE.SphereGeometry(0.21, 16, 12), toonMaterial(def.color));
    spinner.add(ball);
    const cap = mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.05, 10), toonMaterial(palette.charcoal));
    cap.position.y = 0.2;
    spinner.add(cap);
    const fuse = mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.11, 8), toonMaterial(palette.cream));
    fuse.position.set(0.015, 0.27, 0);
    fuse.rotation.z = -0.25;
    spinner.add(fuse);
    sparkMat = track(new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
    const spark = new THREE.Mesh(track(new THREE.SphereGeometry(0.035, 8, 6)), sparkMat);
    spark.position.set(0.03, 0.325, 0);
    spark.name = 'spark';
    spinner.add(spark);
  } else {
    // standard discs: chunky flat cylinder + white rim torus in DISC_TYPES color
    const plate = mesh(new THREE.CylinderGeometry(0.21, 0.235, 0.05, 20), toonMaterial(def.color));
    spinner.add(plate);
    const rim = mesh(new THREE.TorusGeometry(0.218, 0.03, 8, 24), toonMaterial(palette.white));
    rim.rotation.x = Math.PI / 2;
    spinner.add(rim);
    const dot = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.014, 12), toonMaterial(palette.white));
    dot.position.y = 0.028;
    spinner.add(dot);
  }

  // -------------------------------------------------------------------------
  // ribbon trail: fixed pool of small fading quads chained along the path.
  // Lives in world space (added to group's parent lazily), fully self-managed.
  // -------------------------------------------------------------------------
  const trailRoot = new THREE.Group();
  const trailGeo = track(new THREE.PlaneGeometry(0.17, 0.17));
  const segs = [];
  for (let i = 0; i < TRAIL_SEGMENTS; i++) {
    const mat = track(new THREE.MeshBasicMaterial({
      color: trailColor,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    const m = new THREE.Mesh(trailGeo, mat);
    m.visible = false;
    trailRoot.add(m);
    segs.push({ mesh: m, life: 0 });
  }
  let segIdx = 0;
  let emitAcc = 0;
  const prevEmit = new THREE.Vector3();
  let hasPrevEmit = false;

  function emitSegment() {
    const seg = segs[segIdx];
    segIdx = (segIdx + 1) % TRAIL_SEGMENTS;
    seg.life = TRAIL_LIFE;
    seg.mesh.visible = true;
    seg.mesh.position.copy(group.position);
    if (hasPrevEmit && prevEmit.distanceToSquared(group.position) > 1e-6) {
      seg.mesh.lookAt(prevEmit); // quad faces along the flight path -> ribbon slice
      seg.mesh.rotateZ(Math.random() * Math.PI);
    }
    seg.mesh.scale.setScalar(1);
    prevEmit.copy(group.position);
    hasPrevEmit = true;
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  let spinSpeed = 0;
  let sparkT = 0;
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmpQuat = new THREE.Quaternion();

  function update(dt, discState) {
    dt = Math.min(Math.max(dt, 0), 0.1);

    // bomb spark flicker (always animated while visible)
    if (sparkMat) {
      sparkT += dt;
      sparkMat.color.setHex(Math.sin(sparkT * 41) > 0 ? 0xffaa33 : 0xffe066);
      const spark = spinner.getObjectByName('spark');
      if (spark) spark.scale.setScalar(0.75 + Math.abs(Math.sin(sparkT * 27)) * 0.55);
    }

    const flying = !!discState && discState.state === 'flying';

    if (discState && discState.pos) {
      group.position.set(discState.pos.x, discState.pos.y, discState.pos.z);
    }

    if (flying) {
      // spin up fast
      spinSpeed += (spinTarget - spinSpeed) * Math.min(1, dt * 8);

      // tilt slightly along velocity
      const v = discState.vel || { x: 0, y: 0, z: 0 };
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0.3) {
        const yaw = Math.atan2(v.x, v.z);
        const age = discState.age || 0;
        const pitch = Math.atan2(-v.y, hs) * 0.35 + Math.sin(age * 17) * 0.045;
        const roll = Math.sin(age * 11) * 0.05;
        tmpEuler.set(pitch, yaw, roll);
        group.quaternion.slerp(tmpQuat.setFromEuler(tmpEuler), 1 - Math.exp(-10 * dt));
      }

      // emit ribbon trail (world space)
      if (group.parent && trailRoot.parent !== group.parent) group.parent.add(trailRoot);
      emitAcc += dt;
      while (emitAcc >= TRAIL_EMIT_EVERY) {
        emitAcc -= TRAIL_EMIT_EVERY;
        emitSegment();
      }
    } else {
      // slow the spin to rest, level the disc, stop emitting
      spinSpeed += (0 - spinSpeed) * Math.min(1, dt * 4);
      emitAcc = 0;
      hasPrevEmit = false;
      tmpEuler.set(0, tmpEuler.y, 0);
      group.quaternion.slerp(tmpQuat.setFromEuler(tmpEuler), 1 - Math.exp(-5 * dt));
    }

    spinner.rotation.y += spinSpeed * dt;

    // fade trail segments (also drains them after landing)
    for (const seg of segs) {
      if (seg.life <= 0) continue;
      seg.life -= dt;
      const a = Math.max(0, seg.life / TRAIL_LIFE);
      seg.mesh.material.opacity = a * 0.75;
      seg.mesh.scale.setScalar(0.35 + 0.65 * a);
      if (seg.life <= 0) seg.mesh.visible = false;
    }
  }

  function dispose() {
    if (trailRoot.parent) trailRoot.parent.remove(trailRoot);
    if (group.parent) group.parent.remove(group);
    for (const d of disposables) d.dispose();
  }

  return { group, update, dispose };
}
