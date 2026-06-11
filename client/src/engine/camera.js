// client/src/engine/camera.js — FollowCamera: aim / disc-chase / follow modes
// with right-drag orbit and wheel zoom. ENGINE module.

import * as THREE from 'three';

const PITCH_MIN = -0.15;
const PITCH_MAX = 0.9;
const ZOOM_MIN = 4;
const ZOOM_MAX = 30;

export class FollowCamera {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this._mode = 'idle';        // 'aim' | 'disc' | 'point' | 'idle'
    this._baseYaw = 0;          // aim direction toward basket
    this._orbitYaw = 0;         // right-drag offset
    this._pitch = 0.32;
    this._dist = 7;
    this._heightAt = null;

    this._playerPos = new THREE.Vector3();
    this._basketPos = new THREE.Vector3();
    this._getPos = null;
    this._lastTarget = new THREE.Vector3();
    this._moveDir = new THREE.Vector3(0, 0, 1);

    this._pos = new THREE.Vector3();    // smoothed camera position
    this._look = new THREE.Vector3();   // smoothed look target
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._snap = true;                  // first update snaps instead of lerping

    this._yaw = 0;

    // ---- right-drag orbit + wheel zoom ----
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    domElement.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._orbitYaw -= dx * 0.005;
      this._pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this._pitch + dy * 0.004));
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this._dragging = false;
    });
    domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this._dist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this._dist + e.deltaY * 0.01));
      },
      { passive: false }
    );
  }

  get yaw() {
    return this._yaw;
  }

  setTerrain(fn) {
    this._heightAt = fn;
  }

  setAimView(playerPos, basketPos) {
    this._mode = 'aim';
    this._playerPos.set(playerPos.x, playerPos.y, playerPos.z);
    this._basketPos.set(basketPos.x, basketPos.y, basketPos.z);
    this._baseYaw = Math.atan2(basketPos.x - playerPos.x, basketPos.z - playerPos.z);
    this._orbitYaw = 0; // reset orbit when settling over a new lie
  }

  followDisc(getPos) {
    this._mode = 'disc';
    this._getPos = getPos;
    const p = getPos();
    this._lastTarget.set(p.x, p.y, p.z);
  }

  followPoint(getPos) {
    this._mode = 'point';
    this._getPos = getPos;
    const p = getPos();
    this._lastTarget.set(p.x, p.y, p.z);
  }

  update(dt) {
    if (this._mode === 'aim') {
      const yaw = this._baseYaw + this._orbitYaw;
      this._yaw = yaw;
      const back = Math.max(4.5, this._dist * 0.8);
      const h = 1.6 + this._pitch * 4.5;
      this._desiredPos.set(
        this._playerPos.x - Math.sin(yaw) * back,
        this._playerPos.y + h,
        this._playerPos.z - Math.cos(yaw) * back
      );
      this._desiredLook.set(
        this._playerPos.x + Math.sin(yaw) * 14,
        this._playerPos.y + 1.2 - this._pitch * 4,
        this._playerPos.z + Math.cos(yaw) * 14
      );
    } else if (this._mode === 'disc' || this._mode === 'point') {
      const p = this._getPos ? this._getPos() : this._lastTarget;
      const target = new THREE.Vector3(p.x, p.y, p.z);
      const delta = target.clone().sub(this._lastTarget);
      delta.y = 0;
      if (delta.lengthSq() > 0.0004) {
        this._moveDir.copy(delta.normalize());
      }
      this._lastTarget.copy(target);
      const yaw = Math.atan2(this._moveDir.x, this._moveDir.z) + this._orbitYaw;
      this._yaw = yaw;
      const back = this._mode === 'disc' ? Math.max(6, this._dist * 0.9) : this._dist;
      const h = this._mode === 'disc' ? 2.4 + this._pitch * 3 : 2 + this._pitch * 4;
      this._desiredPos.set(
        target.x - Math.sin(yaw) * back,
        target.y + h,
        target.z - Math.cos(yaw) * back
      );
      this._desiredLook.set(
        target.x + Math.sin(yaw) * 5,
        target.y + 0.6,
        target.z + Math.cos(yaw) * 5
      );
    } else {
      return;
    }

    // keep the camera above terrain
    if (this._heightAt) {
      const minY = this._heightAt(this._desiredPos.x, this._desiredPos.z) + 0.5;
      if (this._desiredPos.y < minY) this._desiredPos.y = minY;
    }

    if (this._snap) {
      this._pos.copy(this._desiredPos);
      this._look.copy(this._desiredLook);
      this._snap = false;
    } else {
      const k = 1 - Math.exp(-5.5 * dt);
      this._pos.lerp(this._desiredPos, k);
      this._look.lerp(this._desiredLook, 1 - Math.exp(-7 * dt));
    }

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
  }
}
