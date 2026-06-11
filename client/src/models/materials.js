// materials.js — shared toon material factory + bright cartoon palette.
// MODELS agent. Plain ES module, no build step.

import * as THREE from 'three';

// One cached 3-step gradient map shared by every toon material in the game.
// NearestFilter gives the hard banding that sells the cel-shaded look.
let _gradientMap = null;

export function getToonGradientMap() {
  if (!_gradientMap) {
    // 3 luminance steps: shadow, mid, light (RGBA so it works everywhere).
    const steps = [90, 180, 255];
    const data = new Uint8Array(steps.length * 4);
    for (let i = 0; i < steps.length; i++) {
      data[i * 4 + 0] = steps[i];
      data[i * 4 + 1] = steps[i];
      data[i * 4 + 2] = steps[i];
      data[i * 4 + 3] = 255;
    }
    _gradientMap = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    _gradientMap.minFilter = THREE.NearestFilter;
    _gradientMap.magFilter = THREE.NearestFilter;
    _gradientMap.generateMipmaps = false;
    _gradientMap.needsUpdate = true;
  }
  return _gradientMap;
}

// toonMaterial(color, opts) -> THREE.MeshToonMaterial using the shared gradient
// map. Any extra MeshToonMaterial options pass straight through (emissive,
// transparent, opacity, side, ...).
export function toonMaterial(color, opts = {}) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonGradientMap(),
    ...opts,
  });
}

// Bright, saturated cartoon palette. Shared art-direction reference for all
// model/effect modules (and anyone else who wants on-brand colors).
export const palette = {
  grassGreen: 0x7ed957,
  grassDark: 0x4cb944,
  skyBlue: 0x8fd3ff,
  sunYellow: 0xffd93d,
  orange: 0xff9f43,
  red: 0xff5533,
  pink: 0xf783ac,
  purple: 0xb197fc,
  blue: 0x4dabf7,
  teal: 0x63e6e2,
  white: 0xffffff,
  cream: 0xfff4e0,
  brown: 0x8d6748,
  darkBrown: 0x5c4030,
  grey: 0x9aa0a8,
  smokeGrey: 0x8b8f99,
  charcoal: 0x33343d,
  nearBlack: 0x1d1e26,
  gold: 0xffc933,
  water: 0x4dc3ff,
  dirt: 0x7a5b3a,
};
