// Tiny event emitter shared by engine classes. No dependencies.

export class Emitter {
  constructor() {
    this._listeners = new Map(); // event -> Set<fn>
  }

  on(event, fn) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return this;
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
    return this;
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    // copy so listeners can on/off during dispatch
    for (const fn of [...set]) fn(payload);
  }
}
