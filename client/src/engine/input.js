// client/src/engine/input.js — FlickInput: mouse-flick throw gesture. ENGINE.
// Hold LEFT mouse and flick: flick speed = power, trail bow = curve,
// release direction (relative to screen-up, rotated by baseAngle) = aim.

const MIN_DRAG_PX = 30;     // total drags shorter than this cancel silently
const SPEED_WINDOW_MS = 120; // power comes from the last ~120ms of movement

// Power calibration differs by input: a finger flick on a phone travels fewer
// CSS pixels than a mouse swipe, so touch hits full power at a lower speed.
const CALIBRATION = {
  mouse: { lazy: 0.5, full: 3.5 },  // px/ms -> power 0.3 / 1.0
  touch: { lazy: 0.4, full: 2.6 },
};

export class FlickInput {
  constructor(domElement) {
    this.dom = domElement;
    this.baseAngle = 0;       // set by integration each frame to camera yaw
    this.onAim = () => {};
    this.onThrow = () => {};

    this._enabled = false;
    this._trail = null;       // [{x, y, t}] while dragging
    this._pointerId = null;
    this._pointerType = 'mouse';
    this._activePointers = new Set(); // every pointer currently down on the canvas
    this._suppressed = false; // true while a 2nd finger steals the gesture for the camera

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this._cancel = this._cancel.bind(this);
    this._pointerGone = this._pointerGone.bind(this);

    domElement.addEventListener('pointerdown', this._down);
    domElement.addEventListener('pointermove', this._move);
    domElement.addEventListener('pointerup', this._up);
    domElement.addEventListener('pointercancel', this._cancel);
  }

  enable() {
    this._enabled = true;
  }

  disable() {
    this._enabled = false;
    if (this._trail) this._abortFlick();
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._down);
    this.dom.removeEventListener('pointermove', this._move);
    this.dom.removeEventListener('pointerup', this._up);
    this.dom.removeEventListener('pointercancel', this._cancel);
  }

  _down(e) {
    if (!this._enabled || e.button !== 0) return; // left button / primary touch only
    this._activePointers.add(e.pointerId);

    // A 2nd finger means the player is reaching for the camera (two-finger
    // orbit / pinch). Hand the gesture off: kill any in-progress flick and stay
    // suppressed until every finger lifts.
    if (this._activePointers.size >= 2) {
      this._suppressed = true;
      if (this._trail) this._abortFlick();
      return;
    }
    if (this._suppressed) return;

    e.preventDefault();
    this._pointerId = e.pointerId;
    this._pointerType = e.pointerType || 'mouse';
    this.dom.setPointerCapture?.(e.pointerId);
    this._trail = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  }

  _move(e) {
    if (!this._trail || e.pointerId !== this._pointerId) return;
    this._trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (this._trail.length > 240) this._trail.splice(0, 60);
    const est = this._estimate();
    if (est) this.onAim({ active: true, ...est });
  }

  _up(e) {
    this._pointerGone(e);
    if (!this._trail || e.pointerId !== this._pointerId) return;
    this._trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    const trail = this._trail;
    this._trail = null;
    this._pointerId = null;

    const first = trail[0];
    const last = trail[trail.length - 1];
    const totalPx = Math.hypot(last.x - first.x, last.y - first.y);
    this.onAim({ active: false, dirAngle: 0, power: 0, curve: 0 });
    if (totalPx < MIN_DRAG_PX) return; // tiny drag: cancel silently

    const est = this._estimate(trail);
    if (est && est.power > 0.02) this.onThrow(est);
  }

  _cancel(e) {
    this._pointerGone(e);
    if (e && e.pointerId !== this._pointerId) return;
    this._abortFlick();
  }

  // Remove a lifted/cancelled pointer from the active set; once the screen is
  // clear of fingers, allow flicks again.
  _pointerGone(e) {
    if (!e) return;
    this._activePointers.delete(e.pointerId);
    if (this._activePointers.size === 0) this._suppressed = false;
  }

  // Drop the current flick without throwing (no event arg needed).
  _abortFlick() {
    if (this._pointerId != null) this.dom.releasePointerCapture?.(this._pointerId);
    this._trail = null;
    this._pointerId = null;
    this.onAim({ active: false, dirAngle: 0, power: 0, curve: 0 });
  }

  // Compute {dirAngle, power, curve} from a trail (defaults to the live one).
  _estimate(trail = this._trail) {
    if (!trail || trail.length < 2) return null;
    const last = trail[trail.length - 1];

    // --- velocity over the final SPEED_WINDOW_MS ---
    let i0 = trail.length - 1;
    while (i0 > 0 && last.t - trail[i0 - 1].t <= SPEED_WINDOW_MS) i0--;
    const p0 = trail[i0];
    const dtms = Math.max(1, last.t - p0.t);
    const vx = (last.x - p0.x) / dtms;
    const vy = (last.y - p0.y) / dtms;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.02) return null;

    const cal = CALIBRATION[this._pointerType] || CALIBRATION.mouse;
    const power = Math.min(
      1,
      Math.max(0.05, 0.3 + ((speed - cal.lazy) * 0.7) / (cal.full - cal.lazy))
    );

    // --- direction: screen-up = camera forward, rotated by baseAngle ---
    // screen y grows downward, so "up the screen" is -vy.
    const screenAng = Math.atan2(vx, -vy);
    const dirAngle = this.baseAngle + screenAng;

    // --- curve: signed perpendicular bow of the trail vs its chord ---
    // positive = trail bows right of travel = disc curves right.
    const first = trail[0];
    const cx = last.x - first.x;
    const cy = last.y - first.y;
    const clen = Math.hypot(cx, cy);
    let curve = 0;
    if (clen > 24) {
      let maxDev = 0;
      for (let i = 1; i < trail.length - 1; i++) {
        const ox = trail[i].x - first.x;
        const oy = trail[i].y - first.y;
        // 2D cross product; screen y-down makes positive = right of chord
        const dev = (cx * oy - cy * ox) / clen;
        if (Math.abs(dev) > Math.abs(maxDev)) maxDev = dev;
      }
      curve = Math.min(1, Math.max(-1, maxDev / clen / 0.22));
    }

    return { dirAngle, power, curve };
  }
}
