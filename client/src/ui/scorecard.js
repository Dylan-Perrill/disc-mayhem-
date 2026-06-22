// Scorecard overlay + end-of-round results screen for DISC MAYHEM!

import { HOLE_COUNT } from '/shared/constants.js';
import { el, fmtTime } from './util.js';

// Accepts BOTH shapes and anything in between:
//   solo:  { holes: [{par, strokes|null}, ...] }
//   multi: { pars: [...], players: [{name, strokes: [...], you}, ...] }
function normalize(data) {
  const d = data || {};
  let pars = [];
  if (Array.isArray(d.pars)) {
    pars = d.pars.slice();
  } else if (Array.isArray(d.holes)) {
    pars = d.holes.map((h) => (h && h.par != null ? h.par : null));
  }

  let players = [];
  if (Array.isArray(d.players) && d.players.length) {
    players = d.players.map((p) => ({
      name: (p && p.name) || 'Player',
      you: !!(p && p.you),
      strokes: Array.isArray(p && p.strokes)
        ? p.strokes.slice()
        : Array.isArray(p && p.holes)
          ? p.holes.map((h) => (h && h.strokes != null ? h.strokes : null))
          : [],
    }));
  } else if (Array.isArray(d.holes)) {
    players = [{
      name: 'You',
      you: true,
      strokes: d.holes.map((h) => (h && h.strokes != null ? h.strokes : null)),
    }];
  }

  let n = Math.max(HOLE_COUNT, pars.length);
  for (const p of players) n = Math.max(n, p.strokes.length);
  return { pars, players, n };
}

function sum(arr) {
  let t = 0;
  let any = false;
  for (const v of arr) {
    if (typeof v === 'number' && !Number.isNaN(v)) { t += v; any = true; }
  }
  return any ? t : null;
}

// Builds the hole-by-hole table (HOLE / PAR / each player) wrapped in a
// horizontal scroller. Shared by the in-game scorecard overlay and the
// end-of-round results screen.
export function buildScorecardTable(data) {
  const { pars, players, n } = normalize(data);
  const table = el('table', 'scorecard-table');

  // header: HOLE 1..n TOT
  const head = el('tr', 'sc-head');
  head.append(el('th', 'sc-corner', 'HOLE'));
  for (let i = 0; i < n; i++) head.append(el('th', null, String(i + 1)));
  head.append(el('th', 'sc-tot', 'TOT'));
  table.append(head);

  // par row
  const parRow = el('tr', 'sc-par-row');
  parRow.append(el('td', 'sc-rowname', 'PAR'));
  for (let i = 0; i < n; i++) {
    parRow.append(el('td', null, pars[i] != null ? String(pars[i]) : '-'));
  }
  const parTot = sum(pars);
  parRow.append(el('td', 'sc-tot', parTot != null ? String(parTot) : '-'));
  table.append(parRow);

  // player rows
  for (const p of players) {
    const tr = el('tr', 'sc-player-row');
    if (p.you) tr.classList.add('sc-you');
    tr.append(el('td', 'sc-rowname', p.name));
    for (let i = 0; i < n; i++) {
      const s = p.strokes[i];
      const td = el('td', null, s != null ? String(s) : '');
      const par = pars[i];
      if (s != null && par != null) {
        if (s < par) td.classList.add('sc-under');
        else if (s > par) td.classList.add('sc-over');
        else td.classList.add('sc-even');
      }
      tr.append(td);
    }
    const tot = sum(p.strokes);
    tr.append(el('td', 'sc-tot', tot != null ? String(tot) : ''));
    table.append(tr);
  }

  const scroller = el('div', 'scorecard-scroll');
  scroller.append(table);
  return scroller;
}

export function createScorecard() {
  const overlay = el('div', 'scorecard-overlay');
  const panel = el('div', 'panel scorecard-panel');
  overlay.append(panel);

  function render(data) {
    panel.innerHTML = '';
    panel.append(el('h2', 'scorecard-title', 'SCORECARD'));
    panel.append(buildScorecardTable(data));
  }

  return {
    el: overlay,
    show(data) {
      render(data);
      overlay.classList.add('visible');
    },
    hide() {
      overlay.classList.remove('visible');
    },
    isVisible: () => overlay.classList.contains('visible'),
  };
}

// ---------------------------------------------------------------- RESULTS

export function createResults(emit, nav) {
  const screen = el('div', 'screen screen-solid screen-results');

  function render(standings, scorecardData) {
    screen.innerHTML = '';
    screen.append(el('h1', 'results-title', 'FINAL RESULTS'));

    const rows = Array.isArray(standings) ? standings.slice() : [];
    rows.sort((a, b) => ((a && a.rank) || 99) - ((b && b.rank) || 99));

    const top3 = rows.filter((r) => r && r.rank >= 1 && r.rank <= 3);
    const rest = rows.filter((r) => !(r && r.rank >= 1 && r.rank <= 3));

    // podium: 2nd | 1st | 3rd
    const podium = el('div', 'podium');
    const order = [2, 1, 3];
    for (const rank of order) {
      const r = top3.find((x) => x.rank === rank);
      const step = el('div', 'podium-step p-' + rank);
      if (!r) {
        step.classList.add('podium-empty');
        podium.append(step);
        continue;
      }
      if (r.you) step.classList.add('you');
      const medal = el('div', 'podium-medal', String(rank));
      const name = el('div', 'podium-name', r.name || 'Player');
      const score = el('div', 'podium-score',
        (r.totalStrokes != null ? r.totalStrokes : '-') + ' strokes');
      const time = el('div', 'podium-time',
        r.totalTimeMs != null ? fmtTime(r.totalTimeMs) : '');
      const block = el('div', 'podium-block');
      block.append(medal);
      step.append(name, score, time, block);
      podium.append(step);
    }
    screen.append(podium);

    if (rest.length) {
      const list = el('div', 'results-list');
      for (const r of rest) {
        const row = el('div', 'results-row');
        if (r && r.you) row.classList.add('you');
        row.append(
          el('span', 'res-rank', String((r && r.rank) || '-')),
          el('span', 'res-name', (r && r.name) || 'Player'),
          el('span', 'res-strokes', (r && r.totalStrokes != null ? r.totalStrokes : '-') + ' strokes'),
          el('span', 'res-time', r && r.totalTimeMs != null ? fmtTime(r.totalTimeMs) : ''),
        );
        list.append(row);
      }
      screen.append(list);
    }

    // full hole-by-hole scorecard under the standings
    if (scorecardData) {
      const card = el('div', 'panel results-scorecard');
      card.append(el('h2', 'results-scorecard-title', 'SCORECARD'));
      card.append(buildScorecardTable(scorecardData));
      screen.append(card);
    }

    const backBtn = el('button', 'btn btn-big', 'Back to Menu');
    backBtn.addEventListener('click', () => {
      nav.toMenu();
      emit('back-to-menu');
    });
    screen.append(backBtn);
  }

  return {
    el: screen,
    show(standings, scorecardData) {
      render(standings, scorecardData);
    },
  };
}
