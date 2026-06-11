// effects.js — pooled procedural particle effects. MODELS agent.
// createEffects(scene) -> Effects (see DESIGN.md). All effects are timed,
// self-removing inside update(dt), and recycle meshes through pools.

import * as THREE from 'three';
import { toonMaterial, palette } from './materials.js';

const CONFETTI_COLORS = [
  0xff5533, 0xffd93d, 0x69db7c, 0x4dabf7,
  0xb197fc, 0xf783ac, 0x63e6e2, 0xffffff,
];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function createEffects(scene) {
  // shared geometries
  const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
  const quadGeo = new THREE.PlaneGeometry(1, 1);
  const ringGeo = new THREE.RingGeometry(0.72, 1, 28);

  // mesh pools by kind (each pooled mesh owns its material -> per-particle fade)
  const pools = { toonSphere: [], basicSphere: [], quad: [], ring: [] };

  function makeMesh(kind) {
    if (kind === 'toonSphere') {
      return new THREE.Mesh(sphereGeo, toonMaterial(0xffffff, { transparent: true, depthWrite: false }));
    }
    if (kind === 'basicSphere') {
      return new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    }
    if (kind === 'ring') {
      return new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
    }
    return new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
  }

  const particles = [];

  // spawn(kind, opts) — generic timed particle.
  // opts: pos, vel, color, life, gravity, drag, spin (Euler rates Vector3),
  //       s0/s1 (start/end scale, number or Vector3), peak (sin-curve scale),
  //       o0/o1 (start/end opacity), flat (lay flat, e.g. water ring)
  function spawn(kind, opts) {
    const m = pools[kind].pop() || makeMesh(kind);
    m.material.color.set(opts.color !== undefined ? opts.color : 0xffffff);
    m.material.opacity = opts.o0 !== undefined ? opts.o0 : 1;
    m.position.copy(opts.pos);
    m.rotation.set(0, 0, 0);
    if (opts.flat) m.rotation.x = -Math.PI / 2;
    if (opts.spin) m.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
    const toV3 = (s, dflt) => {
      if (s === undefined) s = dflt;
      return (typeof s === 'number') ? new THREE.Vector3(s, s, s) : s.clone();
    };
    const p = {
      kind,
      mesh: m,
      vel: opts.vel ? opts.vel.clone() : new THREE.Vector3(),
      gravity: opts.gravity || 0,
      drag: opts.drag || 0,
      spin: opts.spin ? opts.spin.clone() : null,
      life: 0,
      maxLife: opts.life || 1,
      s0: toV3(opts.s0, 1),
      s1: toV3(opts.s1, 1),
      peak: !!opts.peak,
      o0: opts.o0 !== undefined ? opts.o0 : 1,
      o1: opts.o1 !== undefined ? opts.o1 : 0,
    };
    m.scale.copy(p.s0);
    scene.add(m);
    particles.push(p);
    return p;
  }

  function release(p) {
    scene.remove(p.mesh);
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.scale.set(1, 1, 1);
    pools[p.kind].push(p.mesh);
  }

  // ---------------------------------------------------------------------
  // effects
  // ---------------------------------------------------------------------

  function explosion(pos, radius = 5) {
    const at = new THREE.Vector3(pos.x, pos.y, pos.z);
    const r = Math.max(2, radius);

    // expanding orange flash sphere + hot white core
    spawn('basicSphere', {
      pos: at, color: 0xff8a22, life: 0.35,
      s0: r * 0.18, s1: r * 0.95, o0: 0.95, o1: 0,
    });
    spawn('basicSphere', {
      pos: at, color: 0xffe28a, life: 0.22,
      s0: r * 0.1, s1: r * 0.5, o0: 1, o1: 0,
    });

    // 8-12 grey smoke puffs that rise and fade
    const puffs = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + rand(-0.4, 0.4);
      spawn('toonSphere', {
        pos: new THREE.Vector3(
          at.x + Math.sin(a) * r * rand(0.1, 0.35),
          at.y + rand(0, r * 0.2),
          at.z + Math.cos(a) * r * rand(0.1, 0.35)
        ),
        vel: new THREE.Vector3(Math.sin(a) * rand(1, 2.5), rand(2, 4.5), Math.cos(a) * rand(1, 2.5)),
        color: new THREE.Color().setHSL(0, 0, rand(0.45, 0.65)),
        gravity: -1.2, // smoke rises
        drag: 1.6,
        life: rand(0.9, 1.5),
        s0: r * 0.14, s1: r * 0.34,
        o0: 0.9, o1: 0,
      });
    }

    // dirt flecks
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      spawn('toonSphere', {
        pos: at,
        vel: new THREE.Vector3(Math.sin(a) * rand(2, 5.5), rand(4, 9), Math.cos(a) * rand(2, 5.5)),
        color: Math.random() < 0.5 ? palette.dirt : palette.darkBrown,
        gravity: 12,
        life: rand(0.6, 1),
        s0: rand(0.07, 0.16), s1: 0.02,
        o0: 1, o1: 0.4,
      });
    }
  }

  function poof(pos) {
    const at = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z);
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
      const up = rand(-0.2, 0.9);
      spawn('toonSphere', {
        pos: at,
        vel: new THREE.Vector3(Math.sin(a) * rand(1.4, 2.6), up, Math.cos(a) * rand(1.4, 2.6)),
        color: palette.white,
        drag: 2.4,
        life: rand(0.45, 0.65),
        s0: 0.12, s1: 0.5, peak: true, // expand outward then shrink
        o0: 0.95, o1: 0,
      });
    }
  }

  function confetti(pos) {
    const at = new THREE.Vector3(pos.x, pos.y, pos.z);
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2);
      spawn('quad', {
        pos: at,
        vel: new THREE.Vector3(Math.sin(a) * rand(0.5, 2.8), rand(3.5, 7.5), Math.cos(a) * rand(0.5, 2.8)),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        gravity: 5.5,
        drag: 0.9, // flutter
        spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        life: rand(1.4, 2.3),
        s0: new THREE.Vector3(rand(0.06, 0.1), rand(0.1, 0.16), 1),
        s1: new THREE.Vector3(rand(0.06, 0.1), rand(0.1, 0.16), 1),
        o0: 1, o1: 0,
      });
    }
  }

  function splash(pos) {
    const at = new THREE.Vector3(pos.x, pos.y, pos.z);

    // expanding flat rings on the water
    spawn('ring', {
      pos: new THREE.Vector3(at.x, at.y + 0.03, at.z),
      color: 0xbfe9ff, flat: true, life: 0.7,
      s0: 0.35, s1: 2.6, o0: 0.85, o1: 0,
    });
    spawn('ring', {
      pos: new THREE.Vector3(at.x, at.y + 0.03, at.z),
      color: palette.water, flat: true, life: 0.95,
      s0: 0.2, s1: 1.7, o0: 0.6, o1: 0,
    });

    // blue droplets up
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2);
      spawn('basicSphere', {
        pos: at,
        vel: new THREE.Vector3(Math.sin(a) * rand(0.6, 2), rand(2.8, 5.5), Math.cos(a) * rand(0.6, 2)),
        color: Math.random() < 0.7 ? 0x55aaff : 0xcfeeff,
        gravity: 11,
        life: rand(0.55, 0.85),
        s0: rand(0.05, 0.11), s1: 0.02,
        o0: 0.95, o1: 0.2,
      });
    }
  }

  function chainsHit(pos) {
    const at = new THREE.Vector3(pos.x, pos.y, pos.z);
    for (let i = 0; i < 9; i++) {
      const a = rand(0, Math.PI * 2);
      const tilt = rand(-0.8, 0.8);
      spawn('quad', {
        pos: at,
        vel: new THREE.Vector3(Math.sin(a) * rand(0.8, 2.4), tilt + rand(0.5, 1.6), Math.cos(a) * rand(0.8, 2.4)),
        color: Math.random() < 0.5 ? 0xeef2ff : 0xc8ccd8, // silver sparkle
        gravity: 2.5,
        spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)),
        life: rand(0.25, 0.4),
        s0: rand(0.05, 0.1), s1: 0.015,
        o0: 1, o1: 0,
      });
    }
  }

  // ---------------------------------------------------------------------
  // update — drives + retires every live particle
  // ---------------------------------------------------------------------
  const tmpScale = new THREE.Vector3();

  function update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        release(p);
        particles.splice(i, 1);
        continue;
      }
      // motion
      p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.spin) {
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.rotation.z += p.spin.z * dt;
      }
      // scale: linear, or sin-peak (grow then shrink)
      const k = p.peak ? Math.sin(t * Math.PI) : t;
      p.mesh.scale.copy(tmpScale.lerpVectors(p.s0, p.s1, k));
      // fade
      p.mesh.material.opacity = p.o0 + (p.o1 - p.o0) * t;
    }
  }

  return { explosion, poof, confetti, splash, chainsHit, update };
}
