// character.js — chunky cartoon golfer rig. MODELS agent.
// createCharacter(customization) -> CharacterRig (see DESIGN.md).

import * as THREE from 'three';
import { toonMaterial, palette } from './materials.js';
import { DEFAULT_CUSTOMIZATION } from '/shared/constants.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawNameLabel(canvas, name) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const text = String(name || 'Player').slice(0, 14);
  ctx.font = 'bold 60px "Trebuchet MS", "Comic Sans MS", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(text).width;
  const pillW = Math.min(W - 12, textW + 84);
  const pillH = 92;
  const x = (W - pillW) / 2;
  const y = (H - pillH) / 2;
  // dark rounded pill with a chunky light outline
  roundedRectPath(ctx, x, y, pillW, pillH, pillH / 2);
  ctx.fillStyle = 'rgba(26, 28, 40, 0.88)';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, W / 2, H / 2 + 2);
}

// ---------------------------------------------------------------------------
// eyes — built from tiny geometry on the face (character faces +Z)
// ---------------------------------------------------------------------------

function buildEyes(style, bodyColor) {
  const g = new THREE.Group();
  const whiteMat = toonMaterial(palette.white);
  const blackMat = toonMaterial(palette.nearBlack);
  const lidMat = toonMaterial(new THREE.Color(bodyColor).offsetHSL(0, 0, -0.06));

  const sides = [-1, 1];
  for (const s of sides) {
    const ex = s * 0.125;
    const ey = 0.06;
    const ez = 0.27;

    if (style === 'happy') {
      // closed happy arcs: little black ∩ shapes
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.016, 8, 14, Math.PI),
        blackMat
      );
      arc.position.set(ex, ey, ez + 0.05);
      g.add(arc);
      continue;
    }

    // eyeball: flattened white sphere + black pupil
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.072, 12, 10), whiteMat);
    ball.scale.set(1, 1, 0.55);
    ball.position.set(ex, ey, ez);
    g.add(ball);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), blackMat);
    pupil.position.set(ex, ey + (style === 'sleepy' ? -0.022 : 0.005), ez + 0.045);
    if (style === 'angry') pupil.scale.setScalar(0.85);
    g.add(pupil);

    if (style === 'angry') {
      // slanted brows, inner ends low
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.034, 0.035), blackMat);
      brow.position.set(ex, ey + 0.075, ez + 0.035);
      brow.rotation.z = s * 0.55;
      g.add(brow);
    }

    if (style === 'sleepy') {
      // body-colored eyelid drooping over the top half of the eye
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(0.078, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
        lidMat
      );
      lid.scale.set(1, 1, 0.62);
      lid.position.set(ex, ey + 0.008, ez);
      g.add(lid);
      const lidLine = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.03), blackMat);
      lidLine.position.set(ex, ey + 0.012, ez + 0.052);
      g.add(lidLine);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// hats — sit on top of the head (head local space, head radius ~0.34)
// ---------------------------------------------------------------------------

function buildHat(style) {
  const g = new THREE.Group();
  g.position.y = 0.24; // up from head center; pieces offset from here

  if (style === 'cap') {
    const capMat = toonMaterial(palette.red);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      capMat
    );
    dome.scale.set(1, 0.78, 1);
    g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.035, 14), capMat);
    brim.scale.set(1, 1, 1.35);
    brim.position.set(0, 0.012, 0.24);
    g.add(brim);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), toonMaterial(palette.white));
    button.position.y = 0.175;
    g.add(button);
  } else if (style === 'tophat') {
    const hatMat = toonMaterial(palette.nearBlack);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 18), hatMat);
    brim.position.y = 0.02;
    g.add(brim);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.36, 18), hatMat);
    tube.position.y = 0.21;
    g.add(tube);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.178, 0.07, 18), toonMaterial(palette.red));
    band.position.y = 0.08;
    g.add(band);
  } else if (style === 'beanie') {
    const beanieMat = toonMaterial(palette.teal);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.235, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      beanieMat
    );
    dome.scale.set(1, 0.85, 1);
    g.add(dome);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.045, 8, 18), beanieMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.015;
    g.add(rim);
    const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), toonMaterial(palette.sunYellow));
    pompom.position.y = 0.235;
    g.add(pompom);
  } else if (style === 'crown') {
    const goldMat = toonMaterial(palette.gold);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.185, 0.11, 16), goldMat);
    band.position.y = 0.04;
    g.add(band);
    // zigzag: ring of spikes around the top edge
    const SPIKES = 6;
    for (let i = 0; i < SPIKES; i++) {
      const a = (i / SPIKES) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.11, 6), goldMat);
      spike.position.set(Math.sin(a) * 0.155, 0.14, Math.cos(a) * 0.155);
      g.add(spike);
    }
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), toonMaterial(palette.red));
    jewel.position.set(0, 0.045, 0.185);
    g.add(jewel);
  }
  // 'none' -> empty group
  return g;
}

// ---------------------------------------------------------------------------
// createCharacter
// ---------------------------------------------------------------------------

export function createCharacter(customization = {}) {
  const custom = { ...DEFAULT_CUSTOMIZATION, ...customization };

  const group = new THREE.Group(); // root: integration owns its transform
  const body = new THREE.Group();  // animated container (bob / lean / squash)
  group.add(body);

  // --- shared mats (recolored live on applyCustomization)
  const bodyMat = toonMaterial(custom.bodyColor);
  const shoeMat = toonMaterial(new THREE.Color(custom.bodyColor).offsetHSL(0, -0.05, -0.22));

  // --- torso: rounded chunky capsule, feet at y=0
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.36, 6, 16), bodyMat);
  torso.position.y = 0.62;
  torso.scale.set(1, 1, 0.92);
  body.add(torso);

  // round little belly highlight (cream front patch)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), toonMaterial(palette.cream));
  belly.scale.set(1, 1.15, 0.5);
  belly.position.set(0, 0.56, 0.16);
  body.add(belly);

  // --- oversized head
  const head = new THREE.Group();
  head.position.y = 1.32;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), bodyMat);
  head.add(skull);

  let eyes = buildEyes(custom.eyes, custom.bodyColor);
  head.add(eyes);
  let hat = buildHat(custom.hat);
  head.add(hat);

  // --- stubby arms (separate pivot groups at the shoulders so they swing)
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.37, 1.0, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.22, 4, 10), bodyMat);
    arm.position.y = -0.17;
    pivot.add(arm);
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), bodyMat);
    mitt.position.y = -0.32;
    pivot.add(mitt);
    pivot.rotation.z = side * 0.22; // held slightly out — chunky!
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  body.add(armL, armR);

  // --- big simple feet
  function makeFoot(side) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), shoeMat);
    foot.scale.set(1, 0.55, 1.35);
    foot.position.set(side * 0.17, 0.085, 0.05);
    return foot;
  }
  const footL = makeFoot(-1);
  const footR = makeFoot(1);
  body.add(footL, footR);
  const footBase = { y: 0.085, z: 0.05 };

  // --- floating name label sprite
  const labelCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  let nameLabel;
  if (labelCanvas) {
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    drawNameLabel(labelCanvas, custom.name);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    labelTex.anisotropy = 4;
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false });
    nameLabel = new THREE.Sprite(labelMat);
    nameLabel.scale.set(1.4, 0.35, 1);
  } else {
    nameLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  }
  nameLabel.position.y = 2.1;
  group.add(nameLabel);

  // -------------------------------------------------------------------------
  // animation state
  // -------------------------------------------------------------------------
  let t = Math.random() * 10; // desync crowds of characters
  let moving = false;
  let throwT = -1;            // 0..THROW_DUR while throwing, -1 idle
  const THROW_DUR = 0.4;

  // poof / unpoof
  let mode = 'alive';         // 'alive' | 'poofing' | 'hidden' | 'unpoofing'
  let modeT = 0;
  let poofResolve = null;

  // smoothed anim values
  const cur = { lean: 0, bob: 0, armL: 0, armR: 0, twist: 0, fLy: 0, fLz: 0, fRy: 0, fRz: 0 };

  function throwPose(p) {
    // returns { swing, twist } for the throwing arm + body
    if (p < 0.45) {
      const k = 1 - Math.pow(1 - p / 0.45, 2);          // ease-out wind-up
      return { swing: -2.1 * k, twist: 0.55 * k };
    }
    if (p < 0.7) {
      const k = Math.pow((p - 0.45) / 0.25, 2);          // ease-in whip
      return { swing: -2.1 + 3.8 * k, twist: 0.55 - 1.05 * k };
    }
    const k = (p - 0.7) / 0.3;                           // settle back
    return { swing: 1.7 * (1 - k), twist: -0.5 * (1 - k) };
  }

  function update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    t += dt;

    // ----- poof / unpoof override everything
    if (mode === 'poofing') {
      modeT += dt;
      const p = Math.min(modeT / 0.18, 1);
      body.scale.set(1 + p * 0.8, Math.max(0.03, 1 - p * 1.05), 1 + p * 0.8);
      if (p >= 1 && group.visible) group.visible = false;
      if (modeT >= 0.5) {
        mode = 'hidden';
        if (poofResolve) { const r = poofResolve; poofResolve = null; r(); }
      }
      return;
    }
    if (mode === 'hidden') return;
    if (mode === 'unpoofing') {
      modeT += dt;
      const p = Math.min(modeT / 0.35, 1);
      const s = 0.25 + 0.75 * easeOutBack(p);
      body.scale.set(s, s, s);
      if (p >= 1) { mode = 'alive'; body.scale.set(1, 1, 1); }
      return;
    }

    // ----- compute pose targets
    let tg;
    if (moving) {
      const f = t * 9; // run frequency
      const s = Math.sin(f);
      tg = {
        lean: 0.18,
        bob: Math.abs(s) * 0.06,
        armL: s * 1.05,
        armR: -s * 1.05,
        twist: 0,
        fLy: Math.max(0, s) * 0.11, fLz: footBase.z + s * 0.16,
        fRy: Math.max(0, -s) * 0.11, fRz: footBase.z - s * 0.16,
      };
    } else {
      // idle: gentle breathing bob + slight arm sway
      tg = {
        lean: 0,
        bob: Math.sin(t * 2.1) * 0.025,
        armL: Math.sin(t * 1.8) * 0.08,
        armR: Math.sin(t * 1.8 + 0.9) * 0.08,
        twist: 0,
        fLy: footBase.y * 0, fLz: footBase.z,
        fRy: 0, fRz: footBase.z,
      };
    }

    const k = 1 - Math.exp(-14 * dt);
    cur.lean += (tg.lean - cur.lean) * k;
    cur.bob += (tg.bob - cur.bob) * k;
    cur.armL += (tg.armL - cur.armL) * k;
    cur.armR += (tg.armR - cur.armR) * k;
    cur.twist += (tg.twist - cur.twist) * k;
    cur.fLy += (tg.fLy - cur.fLy) * k;
    cur.fLz += (tg.fLz - cur.fLz) * k;
    cur.fRy += (tg.fRy - cur.fRy) * k;
    cur.fRz += (tg.fRz - cur.fRz) * k;

    // ----- throw overrides the right arm + body twist
    let armRX = cur.armR;
    let twist = cur.twist;
    if (throwT >= 0) {
      throwT += dt;
      const p = Math.min(throwT / THROW_DUR, 1);
      const pose = throwPose(p);
      armRX = pose.swing;
      twist = pose.twist;
      if (p >= 1) throwT = -1;
    }

    body.position.y = cur.bob;
    body.rotation.x = cur.lean;
    body.rotation.y = twist;
    armL.rotation.x = cur.armL;
    armR.rotation.x = armRX;
    footL.position.y = footBase.y + cur.fLy;
    footL.position.z = cur.fLz;
    footR.position.y = footBase.y + cur.fRy;
    footR.position.z = cur.fRz;
  }

  // -------------------------------------------------------------------------
  // public rig API
  // -------------------------------------------------------------------------

  function setMoving(on) {
    moving = !!on;
  }

  function setThrowing() {
    throwT = 0;
  }

  function poof() {
    if (mode === 'poofing' || mode === 'hidden') {
      return Promise.resolve();
    }
    mode = 'poofing';
    modeT = 0;
    return new Promise((resolve) => { poofResolve = resolve; });
  }

  function unpoof() {
    mode = 'unpoofing';
    modeT = 0;
    group.visible = true;
    body.scale.set(0.25, 0.25, 0.25);
  }

  function applyCustomization(c = {}) {
    Object.assign(custom, c);
    // colors
    bodyMat.color.set(custom.bodyColor);
    shoeMat.color.set(new THREE.Color(custom.bodyColor).offsetHSL(0, -0.05, -0.22));
    // eyes
    head.remove(eyes);
    disposeObject(eyes);
    eyes = buildEyes(custom.eyes, custom.bodyColor);
    head.add(eyes);
    // hat
    head.remove(hat);
    disposeObject(hat);
    hat = buildHat(custom.hat);
    head.add(hat);
    // label
    if (labelCanvas && nameLabel.material.map) {
      drawNameLabel(labelCanvas, custom.name);
      nameLabel.material.map.needsUpdate = true;
    }
  }

  return {
    group,
    setMoving,
    setThrowing,
    update,
    poof,
    unpoof,
    applyCustomization,
    nameLabel,
  };
}
