// client/src/course/render.js — turns CourseData into cartoon Three.js meshes.
// buildCourseScene(course) -> { group, basketByHole, treeMeshes,
//   setHoleHighlight, setTreeFlattened, update }  (see DESIGN.md)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial, palette } from '../models/materials.js';

const TERRAIN_SEGMENTS = 128;

// deterministic-ish cheap hash noise for terrain color patches (visual only)
function hashNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// terrain
// ---------------------------------------------------------------------------

function buildTerrain(course) {
  const { w, d } = course.worldSize;
  const geo = new THREE.PlaneGeometry(w, d, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  geo.translate(w / 2, 0, d / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(palette.grassGreen);
  const grassDk = new THREE.Color(palette.grassDark);
  const sand = new THREE.Color(0xe8d28a);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = course.heightAt(x, z);
    pos.setY(i, y);

    // valley-to-hill shading + patchy jitter
    const shade = Math.min(1, Math.max(0, (y + 3) / 11));
    c.copy(grassDk).lerp(grass, 0.35 + shade * 0.65);
    const jitter = (hashNoise(Math.floor(x / 7), Math.floor(z / 7)) - 0.5) * 0.10;
    c.offsetHSL(0, 0, jitter);

    // sandy ring near water edges
    for (const wt of course.waters) {
      const dist = Math.hypot(x - wt.x, z - wt.z);
      const t = (dist - wt.radius) / 6; // 0 at edge .. 1 six metres out
      if (t < 1 && t > -0.4) c.lerp(sand, 0.55 * (1 - Math.max(0, t)));
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, toonMaterial(0xffffff, { vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// trees — instanced: 1 trunk mesh + 1 canopy mesh per kind. Per-tree squash
// for the bomb flatten effect is done by rewriting instance matrices.
// ---------------------------------------------------------------------------

function buildTrees(course, group) {
  const trees = course.trees;

  // unit geometries (base at y=0, height 1, radius 1 — scaled per instance)
  const trunkGeo = new THREE.CylinderGeometry(1, 1.2, 1, 7);
  trunkGeo.translate(0, 0.5, 0);

  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(1, 0.5, 8).translate(0, 0.25, 0),
    new THREE.ConeGeometry(0.78, 0.45, 8).translate(0, 0.52, 0),
    new THREE.ConeGeometry(0.55, 0.4, 8).translate(0, 0.8, 0),
  ]);
  const roundGeo = new THREE.SphereGeometry(1, 10, 8).translate(0, 0.5, 0).scale(1, 0.5, 1);
  const tallGeo = new THREE.SphereGeometry(1, 9, 8).translate(0, 0.5, 0).scale(1, 0.5, 1);

  const trunkMat = toonMaterial(palette.brown);
  const canopyMats = {
    pine: toonMaterial(0x2e8b46),
    round: toonMaterial(0x55c24e),
    tall: toonMaterial(0x3da95c),
  };
  const canopyGeos = { pine: pineGeo, round: roundGeo, tall: tallGeo };

  const byKind = { pine: [], round: [], tall: [] };
  for (const t of trees) byKind[t.kind].push(t);

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunkMesh.castShadow = true;
  group.add(trunkMesh);

  const canopyMeshes = {};
  for (const kind of Object.keys(byKind)) {
    const m = new THREE.InstancedMesh(canopyGeos[kind], canopyMats[kind], Math.max(1, byKind[kind].length));
    m.count = byKind[kind].length;
    m.castShadow = true;
    canopyMeshes[kind] = m;
    group.add(m);
  }

  // per-tree placement info for matrix (re)writes
  const info = new Map(); // id -> placement
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const vPos = new THREE.Vector3();
  const vScl = new THREE.Vector3();

  function writeTree(p, squash) {
    // trunk
    const trunkH = p.trunkH * squash;
    vPos.set(p.x, p.y, p.z);
    vScl.set(p.trunkR * (1 + (1 - squash) * 0.6), Math.max(0.04, trunkH), p.trunkR * (1 + (1 - squash) * 0.6));
    mat4.compose(vPos, quat, vScl);
    trunkMesh.setMatrixAt(p.trunkIdx, mat4);
    // canopy (sits at trunk top, widens slightly as it squashes)
    vPos.set(p.x, p.y + trunkH * 0.85, p.z);
    vScl.set(
      p.canopyR * (1 + (1 - squash) * 0.5),
      Math.max(0.05, p.canopyH * squash),
      p.canopyR * (1 + (1 - squash) * 0.5)
    );
    mat4.compose(vPos, quat, vScl);
    canopyMeshes[p.kind].setMatrixAt(p.canopyIdx, mat4);
  }

  const kindCounters = { pine: 0, round: 0, tall: 0 };
  trees.forEach((t, i) => {
    const trunkFrac = t.kind === 'pine' ? 0.32 : t.kind === 'tall' ? 0.6 : 0.42;
    const p = {
      x: t.x,
      z: t.z,
      y: course.heightAt(t.x, t.z) - 0.15, // sink slightly into slopes
      kind: t.kind,
      trunkR: t.trunkRadius,
      trunkH: t.height * trunkFrac,
      canopyR: t.canopyRadius,
      canopyH: t.height * (1 - trunkFrac) * (t.kind === 'tall' ? 2.2 : t.kind === 'round' ? 2.0 : 1.45),
      trunkIdx: i,
      canopyIdx: kindCounters[t.kind]++,
      squash: 1,
      target: 1,
    };
    info.set(t.id, p);
    writeTree(p, 1);
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  for (const kind of Object.keys(canopyMeshes)) canopyMeshes[kind].instanceMatrix.needsUpdate = true;

  const animating = new Set();

  return {
    info,
    setTreeFlattened(id, flattened) {
      const p = info.get(id);
      if (!p) return;
      p.target = flattened ? 0.07 : 1;
      animating.add(p);
    },
    update(dt) {
      if (animating.size === 0) return;
      const k = 1 - Math.exp(-9 * dt);
      for (const p of animating) {
        p.squash += (p.target - p.squash) * k;
        if (Math.abs(p.target - p.squash) < 0.01) {
          p.squash = p.target;
          animating.delete(p);
        }
        writeTree(p, p.squash);
      }
      trunkMesh.instanceMatrix.needsUpdate = true;
      for (const kind of Object.keys(canopyMeshes)) canopyMeshes[kind].instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// decor — instanced bushes / rocks / flowers (purely visual, never animated)
// ---------------------------------------------------------------------------

function buildDecor(course, group) {
  const byKind = { bush: [], rock: [], flower: [] };
  for (const d of course.decor) byKind[d.kind].push(d);

  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const vPos = new THREE.Vector3();
  const vScl = new THREE.Vector3();
  const place = (mesh, items, fn) => {
    items.forEach((d, i) => {
      const y = course.heightAt(d.x, d.z);
      fn(d, y, i);
      mesh.setMatrixAt(i, mat4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
  };

  if (byKind.bush.length) {
    const bushGeo = new THREE.SphereGeometry(1, 8, 6).scale(1, 0.7, 1);
    const bushes = new THREE.InstancedMesh(bushGeo, toonMaterial(0x3f9e3a), byKind.bush.length);
    place(bushes, byKind.bush, (d, y) => {
      vPos.set(d.x, y, d.z);
      vScl.setScalar(0.5 * d.scale + 0.25);
      mat4.compose(vPos, quat, vScl);
    });
  }
  if (byKind.rock.length) {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, toonMaterial(palette.grey), byKind.rock.length);
    place(rocks, byKind.rock, (d, y, i) => {
      vPos.set(d.x, y, d.z);
      quat.setFromEuler(new THREE.Euler(0, hashNoise(d.x, d.z) * Math.PI, 0));
      vScl.set(0.45 * d.scale, 0.3 * d.scale, 0.38 * d.scale);
      mat4.compose(vPos, quat, vScl);
    });
    quat.identity();
  }
  if (byKind.flower.length) {
    const headGeo = new THREE.SphereGeometry(1, 7, 6);
    const heads = new THREE.InstancedMesh(
      headGeo,
      toonMaterial(0xffffff),
      byKind.flower.length
    );
    const petal = [0xff5fa2, 0xffd93d, 0xff8a5c, 0xc792ff, 0xff6b6b];
    const col = new THREE.Color();
    place(heads, byKind.flower, (d, y, i) => {
      vPos.set(d.x, y + 0.22 * d.scale, d.z);
      vScl.setScalar(0.12 * d.scale + 0.05);
      mat4.compose(vPos, quat, vScl);
      heads.setColorAt(i, col.setHex(petal[i % petal.length]));
    });
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;

    const stemGeo = new THREE.CylinderGeometry(0.03, 0.035, 1, 5).translate(0, 0.5, 0);
    const stems = new THREE.InstancedMesh(stemGeo, toonMaterial(0x3d8c40), byKind.flower.length);
    place(stems, byKind.flower, (d, y) => {
      vPos.set(d.x, y, d.z);
      vScl.set(d.scale, 0.26 * d.scale, d.scale);
      mat4.compose(vPos, quat, vScl);
    });
  }
}

// ---------------------------------------------------------------------------
// baskets + tee pads
// ---------------------------------------------------------------------------

function buildBasket() {
  const g = new THREE.Group();
  const metal = toonMaterial(0xc8cdd6);
  const metalDark = toonMaterial(0x8b919c);
  const chain = toonMaterial(0xe8ecf4);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.62, 10), metal);
  pole.position.y = 0.81;
  g.add(pole);

  // tray basket
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.55, 0.26, 16, 1, true), metalDark);
  tray.position.y = 0.72;
  tray.material.side = THREE.DoubleSide;
  g.add(tray);
  const trayBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 16), metalDark);
  trayBottom.position.y = 0.6;
  g.add(trayBottom);

  // top band + chains hanging inward to a lower central ring
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 8, 20), metal);
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.58;
  g.add(band);
  const CHAINS = 10;
  for (let i = 0; i < CHAINS; i++) {
    const a = (i / CHAINS) * Math.PI * 2;
    const top = new THREE.Vector3(Math.sin(a) * 0.5, 1.58, Math.cos(a) * 0.5);
    const bot = new THREE.Vector3(Math.sin(a) * 0.08, 0.95, Math.cos(a) * 0.08);
    const len = top.distanceTo(bot);
    const link = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 5), chain);
    link.position.copy(top).add(bot).multiplyScalar(0.5);
    link.lookAt(bot);
    link.rotateX(Math.PI / 2);
    g.add(link);
  }
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), metal);
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.95;
  g.add(innerRing);
  return g;
}

function makeSignTexture(num, par) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f7efd8';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.fillStyle = '#33343d';
  ctx.textAlign = 'center';
  ctx.font = 'bold 64px "Trebuchet MS", Arial';
  ctx.fillText(String(num), 64, 72);
  ctx.font = 'bold 24px "Trebuchet MS", Arial';
  ctx.fillText('PAR ' + par, 64, 108);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Red pennant-on-a-pole, drawn into a transparent canvas — used for the floating
// "throw here" flag sprite above the active basket.
function makeFlagTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');

  // pole
  ctx.fillStyle = '#f3f4f8';
  ctx.fillRect(40, 14, 8, 104);
  ctx.fillStyle = '#c9ccd6';
  ctx.fillRect(46, 14, 2, 104);
  // knob on top
  ctx.beginPath();
  ctx.arc(44, 14, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd93d';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1d2233';
  ctx.stroke();
  // pennant
  ctx.beginPath();
  ctx.moveTo(48, 20);
  ctx.lineTo(116, 38);
  ctx.lineTo(48, 56);
  ctx.closePath();
  ctx.fillStyle = '#ff3b30';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1d2233';
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Draw distance text ("142 m") into an existing canvas/texture so the label can be
// updated cheaply in place.
function drawDistanceLabel(ctx, tex, text) {
  ctx.clearRect(0, 0, 256, 96);
  ctx.font = 'bold 56px "Trebuchet MS", Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(15, 18, 30, 0.95)';
  ctx.strokeText(text, 128, 50);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 50);
  tex.needsUpdate = true;
}

function buildTeePad(hole) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.14, 3.4),
    toonMaterial(0x5a5f6b)
  );
  pad.position.y = 0.07;
  g.add(pad);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.015, 0.18), toonMaterial(0xffffff));
  stripe.position.set(0, 0.15, -1.45);
  g.add(stripe);

  // hole-number signpost beside the pad
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.15, 7), toonMaterial(palette.darkBrown));
  post.position.set(1.5, 0.57, -1.2);
  g.add(post);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.85, 0.07),
    [
      toonMaterial(palette.brown), toonMaterial(palette.brown),
      toonMaterial(palette.brown), toonMaterial(palette.brown),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(hole.index + 1, hole.par) }),
      toonMaterial(palette.brown),
    ]
  );
  board.position.set(1.5, 1.45, -1.2);
  g.add(board);
  return g;
}

// ---------------------------------------------------------------------------
// buildCourseScene
// ---------------------------------------------------------------------------

export function buildCourseScene(course) {
  const group = new THREE.Group();

  group.add(buildTerrain(course));
  const treeCtl = buildTrees(course, group);
  buildDecor(course, group);

  // water ponds
  const waterMeshes = [];
  for (const w of course.waters) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(w.radius, 28),
      new THREE.MeshBasicMaterial({ color: palette.water, transparent: true, opacity: 0.62 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(w.x, course.heightAt(w.x, w.z) + 0.7, w.z);
    group.add(mesh);
    waterMeshes.push(mesh);
  }

  // baskets + tee pads
  const basketByHole = new Map();
  for (const hole of course.holes) {
    const basket = buildBasket();
    basket.position.set(hole.basket.x, hole.basket.y, hole.basket.z);
    group.add(basket);
    basketByHole.set(hole.index, basket);

    const pad = buildTeePad(hole);
    pad.position.set(hole.tee.x, hole.tee.y, hole.tee.z);
    const wp = hole.waypoints[1] || hole.basket;
    pad.rotation.y = Math.atan2(wp.x - hole.tee.x, wp.z - hole.tee.z) + Math.PI;
    group.add(pad);
  }

  // active-hole highlight: pulsing ring at the basket + glowing tee disc
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.09, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd93d, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  group.add(ring);
  const teeGlow = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 24),
    new THREE.MeshBasicMaterial({ color: 0x69db7c, transparent: true, opacity: 0.35 })
  );
  teeGlow.rotation.x = -Math.PI / 2;
  teeGlow.visible = false;
  group.add(teeGlow);

  // ---- floating "throw here" marker over the active basket ----------------
  // Tall light beam so the target is findable at distance, plus a flag + distance
  // label drawn always-on-top (depthTest off) so they show through hills/trees.
  const BEAM_H = 12;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.42, BEAM_H, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd93d,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  beam.visible = false;
  group.add(beam);

  const flagSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeFlagTexture(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  );
  flagSprite.scale.set(3.2, 3.2, 1);
  flagSprite.renderOrder = 999;
  flagSprite.visible = false;
  group.add(flagSprite);

  const distCanvas = document.createElement('canvas');
  distCanvas.width = 256;
  distCanvas.height = 96;
  const distCtx = distCanvas.getContext('2d');
  const distTex = new THREE.CanvasTexture(distCanvas);
  distTex.colorSpace = THREE.SRGBColorSpace;
  const distSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: distTex, transparent: true, depthTest: false, depthWrite: false })
  );
  distSprite.scale.set(4.2, 1.6, 1);
  distSprite.renderOrder = 1000;
  distSprite.visible = false;
  group.add(distSprite);

  let shownDist = -1; // last rendered metre value (avoids per-frame canvas redraws)

  let pulseT = 0;

  // treeMeshes contract: per-tree handles (instanced — exposes placement info)
  const treeMeshes = treeCtl.info;

  return {
    group,
    basketByHole,
    treeMeshes,

    setHoleHighlight(index) {
      const hole = course.holes[index];
      if (!hole) {
        ring.visible = false;
        teeGlow.visible = false;
        beam.visible = false;
        flagSprite.visible = false;
        distSprite.visible = false;
        return;
      }
      const b = hole.basket;
      ring.visible = true;
      ring.position.set(b.x, b.y + 0.25, b.z);
      teeGlow.visible = true;
      teeGlow.position.set(hole.tee.x, hole.tee.y + 0.18, hole.tee.z);

      beam.visible = true;
      beam.position.set(b.x, b.y + BEAM_H / 2, b.z);
      flagSprite.visible = true;
      flagSprite.position.set(b.x, b.y + BEAM_H + 0.4, b.z);
      // a new value forces a redraw on the next setTargetDistance call
      shownDist = -1;
    },

    // Live distance (m) from the player to the active basket, shown on the marker.
    // Pass null/undefined to hide the readout.
    setTargetDistance(meters) {
      if (meters == null || !flagSprite.visible) {
        distSprite.visible = false;
        return;
      }
      const m = Math.round(meters);
      distSprite.visible = true;
      if (m !== shownDist) {
        shownDist = m;
        drawDistanceLabel(distCtx, distTex, m + ' m');
      }
    },

    setTreeFlattened(treeId, flattened) {
      treeCtl.setTreeFlattened(treeId, flattened);
    },

    update(dt) {
      pulseT += dt;
      treeCtl.update(dt);
      if (ring.visible) {
        const s = 1 + 0.14 * Math.sin(pulseT * 4.5);
        ring.scale.set(s, s, 1);
        ring.material.opacity = 0.65 + 0.3 * Math.sin(pulseT * 4.5 + 1);
      }
      if (beam.visible) {
        beam.material.opacity = 0.24 + 0.12 * Math.sin(pulseT * 3);
        const bob = 0.25 * Math.sin(pulseT * 2.2);
        flagSprite.position.y = beam.position.y + BEAM_H / 2 + 0.4 + bob;
        distSprite.position.set(flagSprite.position.x, flagSprite.position.y - 2.0, flagSprite.position.z);
      }
      for (let i = 0; i < waterMeshes.length; i++) {
        waterMeshes[i].material.opacity = 0.58 + 0.07 * Math.sin(pulseT * 1.6 + i * 1.7);
      }
    },
  };
}
