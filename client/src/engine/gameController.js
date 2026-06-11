// client/src/engine/gameController.js — orchestrates ONE local player's round.
// All visuals (rig, discs, effects) arrive via constructor injection; this file
// never imports models/ or ui/ (see DESIGN.md).

import { Emitter } from './emitter.js';
import { createThrow, stepDisc } from './physics.js';
import {
  DISC_TYPES,
  HOLE_COUNT,
  RUN_SPEED,
  KILL_PENALTY_STROKES,
  PLAYER_HIT_RADIUS,
} from '../../../shared/constants.js';

const BAG_ORDER = ['driver', 'midrange', 'putter', 'blade', 'bomb'];
const HOLE_TRANSITION_S = 1.8;
const WATER_RESET_S = 1.2;
const DEATH_S = 1.6;

export class GameController extends Emitter {
  constructor({ scene, course, courseScene, playerRig, discFactory, effects, camera, input }) {
    super();
    this.scene = scene;
    this.course = course;
    this.courseScene = courseScene;
    this.rig = playerRig;
    this.discFactory = discFactory;
    this.effects = effects;
    this.camera = camera;
    this.input = input;

    this.bag = BAG_ORDER.map((type) => ({
      type,
      charges: DISC_TYPES[type].power ? DISC_TYPES[type].charges : null,
      selected: type === 'driver',
    }));

    this.holeIndex = -1;
    this.totalStrokes = 0;
    this.holeStrokes = 0;
    this.scorecard = []; // [{strokes, timeMs}] per hole
    this.flattenedTreeIds = new Set(); // mutated by integration on bomb events

    this._state = 'idle'; // idle|aiming|flying|running|water|dead|transition|done
    this._lie = { x: 0, z: 0 };
    this._prevLie = { x: 0, z: 0 };
    this._runTarget = null;
    this._timer = 0;
    this._holeStart = 0;
    this._disc = null;
    this._discVisual = null;
    this._remotePlayers = [];
    this._aimYaw = 0;

    input.onThrow = (params) => this._throw(params);
    input.onAim = (a) => {
      if (this._state !== 'aiming') return;
      if (a.active) {
        this._aimYaw = a.dirAngle;
        this.emit('aim', { power: a.power, curve: a.curve });
      } else {
        this.emit('aim', { power: null, curve: 0 });
      }
    };
  }

  // ---------------------------------------------------------------- round

  startRound(startHole = 0) {
    this.totalStrokes = 0;
    this.scorecard = [];
    this._startHole(startHole);
  }

  _startHole(i) {
    if (i >= HOLE_COUNT) {
      this._state = 'done';
      this.input.disable();
      this.emit('round-complete', { scorecard: this.scorecard });
      return;
    }
    this.holeIndex = i;
    this.holeStrokes = 0;
    this._holeStart = performance.now();
    const hole = this.course.holes[i];
    this._lie = { x: hole.tee.x, z: hole.tee.z };
    this._prevLie = { ...this._lie };
    this.courseScene.setHoleHighlight(i);
    this._placeRigAtLie();
    this.emit('hole-start', { holeIndex: i, par: hole.par });
    this._enterAiming();
  }

  get hole() {
    return this.course.holes[this.holeIndex];
  }

  get holeElapsedMs() {
    return this._state === 'done' ? 0 : performance.now() - this._holeStart;
  }

  // --------------------------------------------------------------- aiming

  _placeRigAtLie() {
    const y = this.course.heightAt(this._lie.x, this._lie.z);
    this.rig.group.position.set(this._lie.x, y, this._lie.z);
    const b = this.hole.basket;
    this.rig.group.rotation.y = Math.atan2(b.x - this._lie.x, b.z - this._lie.z);
  }

  _enterAiming() {
    this._state = 'aiming';
    this._cleanupDisc();
    this._placeRigAtLie();
    this.rig.setMoving(false);
    const y = this.course.heightAt(this._lie.x, this._lie.z);
    this.camera.setAimView({ x: this._lie.x, y, z: this._lie.z }, this.hole.basket);
    this.input.enable();
  }

  selectDisc(typeKey) {
    const slot = this.bag.find((s) => s.type === typeKey);
    if (!slot) return;
    if (slot.charges !== null && slot.charges <= 0) return; // spent power disc
    for (const s of this.bag) s.selected = s === slot;
    this.emit('bag-change', { bag: this.bag });
  }

  get selectedType() {
    return this.bag.find((s) => s.selected)?.type || 'driver';
  }

  _throw(params) {
    if (this._state !== 'aiming') return;
    const type = this.selectedType;
    this.input.disable();
    this.rig.setThrowing();
    this.rig.group.rotation.y = params.dirAngle;

    this._prevLie = { ...this._lie };
    const y = this.course.heightAt(this._lie.x, this._lie.z);
    const origin = { x: this._lie.x, y: y + 1.25, z: this._lie.z };

    this._disc = createThrow(type, origin, params);
    this._discVisual = this.discFactory(type);
    this.scene.add(this._discVisual.group);

    this.holeStrokes += 1;
    this.totalStrokes += 1;

    const slot = this.bag.find((s) => s.type === type);
    if (slot && slot.charges !== null) {
      slot.charges -= 1;
      this.emit('power-used', { type, chargesLeft: slot.charges });
      // auto fall back to driver for the next throw
      for (const s of this.bag) s.selected = s.type === 'driver';
      this.emit('bag-change', { bag: this.bag });
    }

    this.emit('throw', { discType: type, origin, throwParams: params });
    this.emit('stroke', { holeStrokes: this.holeStrokes, totalStrokes: this.totalStrokes });
    this.emit('aim', { power: null, curve: 0 });

    this._state = 'flying';
    this.camera.followDisc(() => this._disc.pos);
  }

  // --------------------------------------------------------------- events

  setRemotePlayers(list) {
    this._remotePlayers = (list || []).map((p) => ({
      id: p.id,
      pos: p.pos,
      radius: p.radius || PLAYER_HIT_RADIUS,
    }));
  }

  killedByOpponent() {
    if (this._state !== 'aiming' && this._state !== 'running') return false;
    this.input.disable();
    this._state = 'dead';
    this._timer = DEATH_S;
    this.rig.setMoving(false);
    const p = this.rig.group.position;
    this.effects.poof({ x: p.x, y: p.y, z: p.z });
    this.rig.poof();
    this.holeStrokes += KILL_PENALTY_STROKES;
    this.totalStrokes += KILL_PENALTY_STROKES;
    this.emit('stroke', { holeStrokes: this.holeStrokes, totalStrokes: this.totalStrokes });
    return true;
  }

  applyKnockback(fromPos, radius) {
    if (this._state !== 'aiming' && this._state !== 'running') return;
    const target = this._state === 'running' && this._runTarget ? this._runTarget : this._lie;
    const dx = target.x - fromPos.x;
    const dz = target.z - fromPos.z;
    const d = Math.hypot(dx, dz);
    if (d > radius) return;
    const nx = d > 0.01 ? dx / d : 1;
    const nz = d > 0.01 ? dz / d : 0;
    const push = radius - d + 4 + Math.random() * 6;
    const W = this.course.worldSize;
    target.x = Math.min(W.w - 10, Math.max(10, target.x + nx * push));
    target.z = Math.min(W.d - 10, Math.max(10, target.z + nz * push));
    if (this._state === 'aiming') {
      this._lie = { ...target };
      this._enterAiming(); // re-seat player + camera at the scattered lie
    }
    this.emit('knocked-back', { fromPos, radius });
  }

  // --------------------------------------------------------------- update

  update(dt) {
    this.rig.update(dt);
    if (this._discVisual) this._discVisual.update(dt, this._disc);
    this.input.baseAngle = this.camera.yaw;

    switch (this._state) {
      case 'aiming': {
        // face the live aim direction while dragging
        const targetYaw = this._aimYaw;
        const cur = this.rig.group.rotation.y;
        let diff = targetYaw - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.rig.group.rotation.y = cur + diff * Math.min(1, dt * 10);
        break;
      }

      case 'flying': {
        const world = {
          heightAt: this.course.heightAt,
          trees: this.course.trees,
          waters: this.course.waters,
          basket: this.hole.basket,
          players: this._remotePlayers,
          flattenedTreeIds: this.flattenedTreeIds,
        };
        const events = stepDisc(this._disc, dt, world);
        for (const ev of events) this._discEvent(ev);
        break;
      }

      case 'running': {
        const pos = this.rig.group.position;
        const dx = this._runTarget.x - pos.x;
        const dz = this._runTarget.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          this._lie = { x: this._runTarget.x, z: this._runTarget.z };
          this._runTarget = null;
          this._enterAiming();
          break;
        }
        const step = Math.min(d, RUN_SPEED * dt);
        pos.x += (dx / d) * step;
        pos.z += (dz / d) * step;
        pos.y = this.course.heightAt(pos.x, pos.z);
        this.rig.group.rotation.y = Math.atan2(dx, dz);
        break;
      }

      case 'water': {
        this._timer -= dt;
        if (this._timer <= 0) {
          this._lie = { ...this._prevLie };
          this._enterAiming();
        }
        break;
      }

      case 'dead': {
        this._timer -= dt;
        if (this._timer <= 0) {
          this.rig.unpoof();
          this._enterAiming();
        }
        break;
      }

      case 'transition': {
        this._timer -= dt;
        if (this._timer <= 0) this._startHole(this.holeIndex + 1);
        break;
      }
    }
  }

  _discEvent(ev) {
    const pos = { ...this._disc.pos };
    switch (ev.kind) {
      case 'treeHit':
        this.emit('disc-event', { kind: 'treeHit', pos });
        break;

      case 'chains':
        this.effects.chainsHit(pos);
        this.emit('disc-event', { kind: 'chains', pos });
        break;

      case 'playerHit':
        this.emit('opponent-hit', { playerId: ev.playerId, discType: this._disc.type });
        break;

      case 'water': {
        this.effects.splash(pos);
        this.emit('disc-event', { kind: 'water', pos });
        this.holeStrokes += 1;
        this.totalStrokes += 1;
        this.emit('stroke', { holeStrokes: this.holeStrokes, totalStrokes: this.totalStrokes });
        this.emit('water-penalty', {});
        this._state = 'water';
        this._timer = WATER_RESET_S;
        break;
      }

      case 'landed': {
        if (this._disc.type === 'bomb') {
          const radius = DISC_TYPES.bomb.blastRadius;
          this.effects.explosion(pos, radius);
          this.emit('bomb-landed', { pos, radius });
        }
        this.emit('disc-event', { kind: 'landed', pos });
        this._runTarget = { x: pos.x, z: pos.z };
        this._state = 'running';
        this.rig.setMoving(true);
        this.camera.followPoint(() => this.rig.group.position);
        break;
      }

      case 'basket': {
        const b = this.hole.basket;
        this.effects.confetti({ x: b.x, y: b.y + 1.4, z: b.z });
        const timeMs = Math.round(performance.now() - this._holeStart);
        this.scorecard[this.holeIndex] = { strokes: this.holeStrokes, timeMs };
        this.emit('holed', { holeIndex: this.holeIndex, strokes: this.holeStrokes, timeMs });
        this._state = 'transition';
        this._timer = HOLE_TRANSITION_S;
        break;
      }
    }
  }

  _cleanupDisc() {
    if (this._discVisual) {
      this._discVisual.dispose();
      this._discVisual = null;
    }
    this._disc = null;
  }

  // ------------------------------------------------------------ public state

  getPublicState() {
    const p = this.rig.group.position;
    return {
      pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      yaw: +this.rig.group.rotation.y.toFixed(2),
      anim: this._state === 'running' ? 'run' : 'idle',
      holeIndex: this.holeIndex,
      strokes: this.totalStrokes,
      holeStrokes: this.holeStrokes,
      thru: this.scorecard.filter(Boolean).length,
      discPos:
        this._disc && this._disc.state === 'flying'
          ? { x: +this._disc.pos.x.toFixed(2), y: +this._disc.pos.y.toFixed(2), z: +this._disc.pos.z.toFixed(2) }
          : null,
      discType: this._disc ? this._disc.type : null,
    };
  }
}
