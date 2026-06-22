// DISC MAYHEM! UI entry point.
//
//   import { createUI } from '/client/src/ui/ui.js';
//   const ui = createUI(document.getElementById('ui'));
//
// Events emitted (subscribe with ui.on(event, fn)):
//   'play-solo'                          (no payload)
//   'host-game'                          (no payload)
//   'join-game'        { code }          4-letter room code
//   'start-match'                        (no payload, host only)
//   'customize-change' { customization } full {name, bodyColor, hat, eyes, trail}
//   'select-disc'      { type }          disc type key ('driver', 'bomb', ...)
//   'back-to-menu'                       (no payload)
//
// The root overlay is pointer-events:none; only widgets/screens that need the
// mouse opt back in, so flick gestures always reach the game canvas.

import { createMenuScreen, createCustomizeScreen, createLobbyScreen } from './menus.js';
import { createHUD } from './hud.js';
import { createScorecard, createResults } from './scorecard.js';
import { el } from './util.js';

export function createUI(root) {
  // ---------------------------------------------------------- emitter
  const listeners = new Map();
  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  }
  function off(event, fn) {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  }
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[ui] listener error for "' + event + '"', err);
      }
    }
  }

  // ------------------------------------------------------------ layout
  root.classList.add('ui-root');
  // Touch devices get the on-screen scorecard button and larger tap targets
  // (CSS keys off this class); desktop keeps the keyboard/mouse affordances.
  const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || 'ontouchstart' in window;
  root.classList.toggle('touch', isTouch);
  root.innerHTML = '';

  const toastLayer = el('div', 'toast-layer');

  function toast(text) {
    const t = el('div', 'toast', String(text));
    toastLayer.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  // internal navigation handed to screens (Customize button, Back buttons).
  const nav = {
    toMenu: () => show('menu'),
    toCustomize: () => show('customize'),
  };

  const menu = createMenuScreen(emit, nav);
  const customize = createCustomizeScreen(emit, nav);
  const lobby = createLobbyScreen(emit, nav, toast);
  const hud = createHUD(emit);
  const scorecard = createScorecard();
  const results = createResults(emit, nav);

  const screens = {
    menu: menu.el,
    customize: customize.el,
    lobby: lobby.el,
    hud: hud.el,
    results: results.el,
  };

  let activeScreen = null;
  function show(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('active', key === name);
    }
    activeScreen = name;
  }

  root.append(menu.el, customize.el, lobby.el, hud.el, results.el, scorecard.el, toastLayer);

  // ----------------------------------------------------- global keys
  let lastScorecardData = null;
  let tabHeld = false;

  function isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault(); // never let Tab steal focus from the game
      if (!e.repeat && activeScreen === 'hud' && lastScorecardData && !scorecard.isVisible()) {
        scorecard.show(lastScorecardData);
        tabHeld = true;
      }
      return;
    }
    if (activeScreen !== 'hud' || isTyping()) return;
    const m = /^Digit([1-5])$/.exec(e.code);
    if (m) {
      const type = hud.getSlotType(Number(m[1]) - 1);
      if (type) emit('select-disc', { type });
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Tab' && tabHeld) {
      tabHeld = false;
      scorecard.hide();
    }
  });

  // Touch: the on-screen CARD button toggles the scorecard (no Tab key on phones).
  hud.scorecardBtn.addEventListener('click', () => {
    if (scorecard.isVisible()) {
      scorecard.hide();
    } else if (lastScorecardData) {
      scorecard.show(lastScorecardData);
    }
  });

  // -------------------------------------------------------- public API
  show('menu');

  return {
    on,
    off,

    showMenu() {
      show('menu');
    },
    showCustomize(current) {
      customize.setState(current);
      show('customize');
    },
    showLobby(info) {
      lobby.set(info || {});
      show('lobby');
    },
    updateLobby(players) {
      lobby.updatePlayers(players);
    },
    showHUD(bag) {
      if (bag) hud.api.setBag(bag);
      show('hud');
    },
    hud: hud.api,
    showScorecard(data) {
      lastScorecardData = data;
      scorecard.show(data);
    },
    hideScorecard() {
      tabHeld = false;
      scorecard.hide();
    },
    showResults(standings) {
      results.show(standings);
      show('results');
    },
    toast,
  };
}
