// In-game HUD overlay for DISC MAYHEM!
// The whole screen is pointer-events:none; only the disc bag slots are
// clickable, so mouse flicks always reach the game canvas.

import { DISC_TYPES } from '/shared/constants.js';
import { el, cssColor, fmtTime } from './util.js';

export function createHUD(emit) {
  const screen = el('div', 'screen screen-hud');

  // ---- top-left: hole info ----
  const holePanel = el('div', 'panel hud-panel hud-top-left');
  const holeEl = el('div', 'hud-hole', 'HOLE 1');
  const parEl = el('div', 'hud-par', 'PAR 3');
  holePanel.append(holeEl, parEl);

  // ---- top-center: timer ----
  const timerPanel = el('div', 'panel hud-panel hud-top-center');
  const timerEl = el('div', 'hud-timer', '0:00');
  timerPanel.append(timerEl);

  // ---- top-right: strokes + mini standings under it ----
  const rightStack = el('div', 'hud-top-right');
  const strokesPanel = el('div', 'panel hud-panel hud-strokes-panel');
  strokesPanel.append(el('div', 'hud-strokes-label', 'STROKES'));
  const strokesEl = el('div', 'hud-strokes', '0 / 0');
  strokesPanel.append(strokesEl);

  const standingsPanel = el('div', 'panel hud-panel standings hidden');
  rightStack.append(strokesPanel, standingsPanel);

  // ---- bottom-left: power bar ----
  const powerWrap = el('div', 'power-wrap hidden');
  const powerBar = el('div', 'power-bar');
  const powerFill = el('div', 'power-fill');
  powerBar.append(powerFill);
  powerWrap.append(powerBar, el('div', 'power-label', 'POWER'));

  // ---- bottom-center: disc bag ----
  const bagEl = el('div', 'bag');

  // ---- center: big pop messages ----
  const msgLayer = el('div', 'hud-msg-layer');

  screen.append(holePanel, timerPanel, rightStack, powerWrap, bagEl, msgLayer);

  // ------------------------------------------------------------ bag
  let bag = [];

  function renderBag() {
    bagEl.innerHTML = '';
    bag.forEach((slot, i) => {
      if (!slot || !slot.type) return;
      const stats = DISC_TYPES[slot.type] || {};
      const slotEl = el('button', 'bag-slot');
      if (slot.selected) slotEl.classList.add('selected');
      const charges = slot.charges != null ? slot.charges : (stats.charges != null ? stats.charges : null);
      const isEmpty = !!stats.power && (charges != null && charges <= 0);
      if (isEmpty) slotEl.classList.add('empty');

      const chip = el('div', 'disc-chip');
      chip.style.background = cssColor(stats.color != null ? stats.color : 0x888888);
      chip.append(el('span', 'slot-key', String(i + 1)));
      slotEl.append(chip);

      slotEl.append(el('div', 'slot-name', stats.name || slot.type));

      if (stats.power) {
        const pips = el('div', 'pips');
        const max = stats.charges != null ? stats.charges : (charges || 0);
        for (let p = 0; p < max; p++) {
          const pip = el('span', 'pip');
          if (charges != null && p < charges) pip.classList.add('filled');
          pips.append(pip);
        }
        slotEl.append(pips);
      }

      slotEl.addEventListener('click', () => emit('select-disc', { type: slot.type }));
      bagEl.append(slotEl);
    });
  }

  // ------------------------------------------------------- standings
  function renderStandings(rows) {
    standingsPanel.innerHTML = '';
    if (!Array.isArray(rows) || rows.length === 0) {
      standingsPanel.classList.add('hidden');
      return;
    }
    standingsPanel.classList.remove('hidden');
    const table = el('table', 'standings-table');
    const head = el('tr', 'standings-head');
    head.append(el('th', null, ''), el('th', null, 'THRU'), el('th', null, 'STR'));
    table.append(head);
    rows.forEach((r) => {
      const tr = el('tr', 'standings-row');
      if (r && r.you) tr.classList.add('you');
      tr.append(
        el('td', 'st-name', (r && r.name) || '?'),
        el('td', 'st-thru', String(r && r.thru != null ? r.thru : '-')),
        el('td', 'st-str', String(r && r.strokes != null ? r.strokes : '-')),
      );
      table.append(tr);
    });
    standingsPanel.append(table);
  }

  // --------------------------------------------------------- the api
  const api = {
    setHole(holeIndex, par) {
      // holeIndex is 0-based everywhere in the codebase.
      holeEl.textContent = 'HOLE ' + ((Number(holeIndex) || 0) + 1);
      parEl.textContent = 'PAR ' + par;
    },
    setStrokes(hole, total) {
      strokesEl.textContent = (hole != null ? hole : 0) + ' / ' + (total != null ? total : 0);
    },
    setTimer(ms) {
      timerEl.textContent = fmtTime(ms);
    },
    setBag(newBag) {
      bag = Array.isArray(newBag) ? newBag : [];
      renderBag();
    },
    setPower(p) {
      if (p == null || Number.isNaN(Number(p))) {
        powerWrap.classList.add('hidden');
        return;
      }
      const v = Math.min(1, Math.max(0, Number(p)));
      powerWrap.classList.remove('hidden');
      powerFill.style.height = (v * 100).toFixed(1) + '%';
    },
    showMessage(text, ms) {
      const dur = Math.max(300, Number(ms) || 1800);
      const msg = el('div', 'hud-message', String(text));
      msg.style.animationDuration = dur + 'ms';
      msgLayer.append(msg);
      let removed = false;
      const remove = () => {
        if (removed) return;
        removed = true;
        msg.remove();
      };
      msg.addEventListener('animationend', remove);
      setTimeout(remove, dur + 250); // safety net
    },
    setStandings(rows) {
      renderStandings(rows);
    },
  };

  return {
    el: screen,
    api,
    getSlotType(i) {
      const slot = bag[i];
      return slot && slot.type ? slot.type : null;
    },
  };
}
