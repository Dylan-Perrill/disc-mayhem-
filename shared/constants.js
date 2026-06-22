// Game-wide tuning constants. Zero imports (loads in browser + Node).

export const HOLE_COUNT = 18;
export const GRAVITY = 9.81;

// Basket
export const BASKET_CATCH_RADIUS = 1.2; // horizontal catch radius (m)
export const BASKET_HEIGHT = 1.3;       // chain height (m)

// Player
export const PLAYER_HEIGHT = 1.7;
export const PLAYER_HIT_RADIUS = 0.9;   // blade-disc hit detection radius
export const RUN_SPEED = 7.2;           // m/s auto-run to disc
export const KILL_PENALTY_STROKES = 1;

// Net
export const DEFAULT_PORT = 3000;
export const STATE_SEND_HZ = 10;        // client -> server state rate
export const MAX_ROOM_PLAYERS = 8;

// Disc stats. maxSpeed = launch speed (m/s) at power 1.0.
// turn: negative = turns right early at high speed (RHBH). fade: drifts left late.
// `power: true` discs are limited-charge power-ups.
export const DISC_TYPES = {
  driver:   { name: 'Driver',   maxSpeed: 28, glide: 1.15, turn: -0.35, fade: 0.50, color: 0xff5533, power: false },
  midrange: { name: 'Midrange', maxSpeed: 22, glide: 1.00, turn: -0.10, fade: 0.35, color: 0xffcc33, power: false },
  putter:   { name: 'Putter',   maxSpeed: 16, glide: 0.90, turn:  0.00, fade: 0.20, color: 0x44aaff, power: false },
  blade:    { name: 'Blade',    maxSpeed: 30, glide: 0.80, turn:  0.00, fade: 0.10, color: 0xcc2222, power: true, charges: 2 },
  bomb:     { name: 'Bomb',     maxSpeed: 20, glide: 0.70, turn:  0.00, fade: 0.30, color: 0x333344, power: true, charges: 2, blastRadius: 12 },
};

export const BOMB_TREE_FLATTEN_MS = 12000; // flattened trees pop back after this

export const CUSTOMIZATION_OPTIONS = {
  bodyColors: [0xff6b6b, 0xffa94d, 0xffe66d, 0x69db7c, 0x4dabf7, 0xb197fc, 0xf783ac, 0x63e6e2],
  hats: ['none', 'cap', 'tophat', 'beanie', 'crown'],
  eyes: ['normal', 'happy', 'angry', 'sleepy'],
  trails: [0xffffff, 0xff5533, 0xffe66d, 0x69db7c, 0x4dabf7, 0xf783ac],
};

export const DEFAULT_CUSTOMIZATION = {
  name: 'Player',
  bodyColor: 0x4dabf7,
  hat: 'cap',
  eyes: 'normal',
  trail: 0xffffff,
};
