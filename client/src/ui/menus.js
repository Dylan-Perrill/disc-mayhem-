// Menu / Customize / Lobby screens for DISC MAYHEM!
// Each create* returns { el, ...api }. `emit` fires UI contract events,
// `nav` does internal screen switching (provided by ui.js).

import { CUSTOMIZATION_OPTIONS, DEFAULT_CUSTOMIZATION } from '/shared/constants.js';
import { el, cssColor } from './util.js';

const HINT_TEXT =
  'Hold LEFT mouse + FLICK to throw - flick speed = power, curve your flick ' +
  'to bend the shot. RIGHT drag = look, wheel = zoom, 1-5 discs, Tab = scorecard';

// ---------------------------------------------------------------- MENU

export function createMenuScreen(emit, nav) {
  const screen = el('div', 'screen screen-solid screen-menu');

  // Bouncy per-letter title.
  const title = el('h1', 'game-title');
  const word = 'DISC MAYHEM!';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const span = el('span', 'title-letter', ch === ' ' ? ' ' : ch);
    span.style.animationDelay = (i * 0.08) + 's';
    if (ch === '!') span.classList.add('title-bang');
    title.append(span);
  }

  const buttons = el('div', 'menu-buttons');

  const soloBtn = el('button', 'btn btn-big', 'Play Solo');
  soloBtn.addEventListener('click', () => emit('play-solo'));

  const hostBtn = el('button', 'btn btn-big', 'Host Online Game');
  hostBtn.addEventListener('click', () => emit('host-game'));

  const joinBtn = el('button', 'btn btn-big', 'Join Game');
  const joinRow = el('div', 'join-row hidden');
  const codeInput = el('input', 'code-input');
  codeInput.type = 'text';
  codeInput.maxLength = 4;
  codeInput.placeholder = 'CODE';
  codeInput.autocomplete = 'off';
  codeInput.spellcheck = false;
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });
  const goBtn = el('button', 'btn btn-go', 'Go!');
  const tryJoin = () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length === 4) {
      emit('join-game', { code });
    } else {
      codeInput.classList.remove('shake');
      void codeInput.offsetWidth; // restart animation
      codeInput.classList.add('shake');
    }
  };
  goBtn.addEventListener('click', tryJoin);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryJoin();
  });
  joinRow.append(codeInput, goBtn);
  joinBtn.addEventListener('click', () => {
    joinRow.classList.toggle('hidden');
    if (!joinRow.classList.contains('hidden')) codeInput.focus();
  });

  const customizeBtn = el('button', 'btn btn-big', 'Customize');
  customizeBtn.addEventListener('click', () => nav.toCustomize());

  buttons.append(soloBtn, hostBtn, joinBtn, joinRow, customizeBtn);

  const footer = el('div', 'menu-footer', HINT_TEXT);

  screen.append(title, buttons, footer);
  return { el: screen };
}

// ------------------------------------------------------------ CUSTOMIZE
// Central area stays transparent (integration may render a live 3D preview
// behind it); all controls live in side panels.

export function createCustomizeScreen(emit, nav) {
  const screen = el('div', 'screen screen-customize');

  let state = { ...DEFAULT_CUSTOMIZATION };

  const emitChange = () => emit('customize-change', { customization: { ...state } });

  // ---- left panel: heading, name, body color, back ----
  const left = el('div', 'panel cust-panel cust-left');
  left.append(el('h2', 'cust-title', 'CUSTOMIZE'));

  const nameSection = el('div', 'cust-section');
  nameSection.append(el('div', 'cust-label', 'Name'));
  const nameInput = el('input', 'name-input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.placeholder = 'Player';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value.slice(0, 12);
    emitChange();
  });
  nameSection.append(nameInput);
  left.append(nameSection);

  const bodySection = el('div', 'cust-section');
  bodySection.append(el('div', 'cust-label', 'Body Color'));
  const bodyRow = el('div', 'swatch-row');
  bodySection.append(bodyRow);
  left.append(bodySection);

  const backBtn = el('button', 'btn btn-back', 'Back');
  backBtn.addEventListener('click', () => {
    nav.toMenu();
    emit('back-to-menu');
  });
  left.append(el('div', 'cust-spacer'), backBtn);

  // ---- right panel: hat, eyes, trail ----
  const right = el('div', 'panel cust-panel cust-right');

  const hatSection = el('div', 'cust-section');
  hatSection.append(el('div', 'cust-label', 'Hat'));
  const hatRow = el('div', 'pill-row');
  hatSection.append(hatRow);

  const eyesSection = el('div', 'cust-section');
  eyesSection.append(el('div', 'cust-label', 'Eyes'));
  const eyesRow = el('div', 'pill-row');
  eyesSection.append(eyesRow);

  const trailSection = el('div', 'cust-section');
  trailSection.append(el('div', 'cust-label', 'Trail Color'));
  const trailRow = el('div', 'swatch-row');
  trailSection.append(trailRow);

  right.append(hatSection, eyesSection, trailSection);
  screen.append(left, right);

  // ---- control builders ----
  function renderSwatches(row, colors, key) {
    row.innerHTML = '';
    for (const color of colors) {
      const sw = el('button', 'swatch');
      sw.style.background = cssColor(color);
      sw.title = cssColor(color);
      if (state[key] === color) sw.classList.add('selected');
      sw.addEventListener('click', () => {
        state[key] = color;
        renderSwatches(row, colors, key);
        emitChange();
      });
      row.append(sw);
    }
  }

  function renderPills(row, options, key) {
    row.innerHTML = '';
    for (const opt of options) {
      const label = opt.charAt(0).toUpperCase() + opt.slice(1);
      const pill = el('button', 'pill', label);
      if (state[key] === opt) pill.classList.add('selected');
      pill.addEventListener('click', () => {
        state[key] = opt;
        renderPills(row, options, key);
        emitChange();
      });
      row.append(pill);
    }
  }

  function renderAll() {
    nameInput.value = state.name || '';
    renderSwatches(bodyRow, CUSTOMIZATION_OPTIONS.bodyColors, 'bodyColor');
    renderPills(hatRow, CUSTOMIZATION_OPTIONS.hats, 'hat');
    renderPills(eyesRow, CUSTOMIZATION_OPTIONS.eyes, 'eyes');
    renderSwatches(trailRow, CUSTOMIZATION_OPTIONS.trails, 'trail');
  }

  renderAll();

  return {
    el: screen,
    setState(current) {
      state = { ...DEFAULT_CUSTOMIZATION, ...(current || {}) };
      renderAll();
    },
    getState: () => ({ ...state }),
  };
}

// ---------------------------------------------------------------- LOBBY

export function createLobbyScreen(emit, nav, toast) {
  const screen = el('div', 'screen screen-solid screen-lobby');

  const panel = el('div', 'panel lobby-panel');
  panel.append(el('h2', 'lobby-title', 'LOBBY'));

  panel.append(el('div', 'lobby-code-label', 'Room code (click to copy)'));
  const codeEl = el('div', 'room-code', '----');
  codeEl.title = 'Click to copy';
  codeEl.addEventListener('click', () => {
    const code = codeEl.textContent || '';
    const done = () => toast('Code "' + code + '" copied!');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, () => fallbackCopy(code, done));
    } else {
      fallbackCopy(code, done);
    }
  });
  panel.append(codeEl);

  const list = el('div', 'player-list');
  panel.append(list);

  const buttonRow = el('div', 'lobby-buttons');
  const startBtn = el('button', 'btn btn-big btn-start hidden', 'Start Match');
  startBtn.addEventListener('click', () => emit('start-match'));
  const leaveBtn = el('button', 'btn btn-leave', 'Leave');
  leaveBtn.addEventListener('click', () => {
    nav.toMenu();
    emit('back-to-menu');
  });
  buttonRow.append(startBtn, leaveBtn);
  panel.append(buttonRow);

  screen.append(panel);

  let hostId = null;

  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (err) {
      toast('Copy failed - code is ' + text);
    }
  }

  function playerName(p) {
    if (!p) return 'Player';
    return p.name || (p.profile && p.profile.name) ||
      (p.customization && p.customization.name) || 'Player';
  }

  function playerColor(p) {
    const c = p && (
      p.bodyColor != null ? p.bodyColor :
      p.profile && p.profile.bodyColor != null ? p.profile.bodyColor :
      p.customization && p.customization.bodyColor != null ? p.customization.bodyColor :
      p.color != null ? p.color : null
    );
    return c != null ? c : 0x4dabf7;
  }

  function isHostPlayer(p) {
    if (!p) return false;
    if (p.isHost || p.host) return true;
    return hostId != null && p.id === hostId;
  }

  function updatePlayers(players) {
    list.innerHTML = '';
    const arr = Array.isArray(players) ? players : [];
    for (const p of arr) {
      const row = el('div', 'player-row');
      const dot = el('span', 'player-dot');
      dot.style.background = cssColor(playerColor(p));
      row.append(dot, el('span', 'player-name', playerName(p)));
      if (isHostPlayer(p)) {
        const crown = el('span', 'host-crown', '\u{1F451}');
        crown.title = 'Host';
        row.append(crown);
      }
      list.append(row);
    }
    if (!arr.length) list.append(el('div', 'player-row player-row-empty', 'Waiting for players...'));
  }

  return {
    el: screen,
    set(info) {
      const { code, players, isHost } = info || {};
      hostId = info && info.hostId != null ? info.hostId : null;
      codeEl.textContent = code || '----';
      startBtn.classList.toggle('hidden', !isHost);
      updatePlayers(players);
    },
    updatePlayers,
  };
}
