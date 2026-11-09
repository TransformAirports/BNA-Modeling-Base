// Heads-up display: clock, live stats, flight board, flight card and flight tags.

import { AIRPORTS } from '../sim/airports.js';
import { formatClock } from '../sim/clock.js';
import { AIRCRAFT_TYPES, CARRIERS } from '../sim/fleet.js';
import { PHASE_LABELS } from '../sim/simulation.js';

const $ = (id) => document.getElementById(id);
const KT = 1.943844; // m/s → knots
const FT = 3.28084;

const SKY = {
  night: { label: 'Night', color: '#8ea2ff' },
  dawn: { label: 'Dawn', color: '#ff9f6b' },
  day: { label: 'Daylight', color: '#ffd27a' },
  dusk: { label: 'Dusk', color: '#ff7a8a' },
};

const STATUS_TONE = {
  Departed: 'done', 'At gate': 'done', Scheduled: '', 'En route': '',
  Boarding: 'ok', Landed: 'arr', Approach: 'arr',
};

export function createHud({ world, onSelect, onFollow }) {
  const { simulation } = world;
  const gateCount = world.airfield.stands.size;
  $('stat-gates').textContent = `/${gateCount}`;
  $('stat-moves-total').textContent = `/${simulation.totals.arrivals + simulation.totals.departures}`;

  // ------------------------------------------------------------- clock
  let lastClock = '';
  function setClock(t, lighting, isoDate) {
    const label = formatClock(t, { withSeconds: true });
    if (label === lastClock) return;
    lastClock = label;
    $('clock-hm').textContent = label.slice(0, 5);
    $('clock-s').textContent = label.slice(5);
    const sky = SKY[lighting.preset];
    const sun = lighting.sunElevation;
    $('sky-label').textContent = `${sky.label} · sun ${sun >= 0 ? '+' : '−'}${Math.abs(sun).toFixed(0)}°`;
    $('sky-label').style.setProperty('--sky', sky.color);
    if (!setClock.date) {
      const [y, m, d] = isoDate.split('-').map(Number);
      $('date-label').textContent = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      setClock.date = true;
    }
  }

  // ------------------------------------------------------------- stats
  function setStats(summary) {
    $('stat-airborne').textContent = summary.airborne;
    $('stat-taxiing').textContent = summary.taxiing;
    $('stat-parked').textContent = summary.parked;
    $('stat-moves').textContent = summary.landed + summary.departed;
  }

  // ------------------------------------------------------------- board
  let boardKind = 'departures';
  let selectedId = null;
  const tabs = [...document.querySelectorAll('[data-board]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      boardKind = tab.dataset.board;
      for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
      lastBoard = '';
    });
  }
  const rowsEl = $('board-rows');
  rowsEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-id]');
    if (row) onSelect(row.dataset.id);
  });
  let lastBoard = '';
  function setBoard(t) {
    const rows = simulation.board(t, boardKind, 8);
    const key = rows.map((r) => `${r.track.visit.id}:${r.status}`).join('|') + selectedId + boardKind;
    if (key === lastBoard) return;
    lastBoard = key;
    rowsEl.replaceChildren(...rows.map((row) => {
      const li = document.createElement('li');
      li.className = `board-row${row.track.visit.id === selectedId ? ' selected' : ''}`;
      li.dataset.id = row.track.visit.id;
      const carrier = CARRIERS[row.carrier];
      const city = AIRPORTS[row.airport]?.city ?? row.airport;
      const tone = STATUS_TONE[row.status] ?? (boardKind === 'arrivals' ? 'arr' : 'live');
      li.innerHTML = `
        <span class="t">${formatClock(row.scheduled)}</span>
        <span class="f"><b><i style="background:${carrier.ui}"></i>${row.flight}</b><span>${row.airport} · ${city}</span></span>
        <span class="g">${row.gate}</span>
        <span class="s" data-tone="${tone}">${row.status}</span>`;
      return li;
    }));
  }

  // ------------------------------------------------------- flight card
  const card = $('flight-card');
  $('fc-close').addEventListener('click', () => onSelect(null));
  $('fc-follow').addEventListener('click', () => onFollow(selectedId));
  let cardFor = null;
  function setCard(state, track, following) {
    if (!track) {
      card.hidden = true;
      cardFor = null;
      return;
    }
    card.hidden = false;
    const { visit } = track;
    const carrier = CARRIERS[visit.carrier];
    if (cardFor !== visit.id) {
      cardFor = visit.id;
      $('fc-stripe').style.background = carrier.ui;
      const leg = state?.phase && ['approach', 'landing', 'arrival-hold', 'taxi-in', 'docking'].includes(state.phase) ? visit.arrival : (visit.departure ?? visit.arrival);
      $('fc-flight').textContent = leg?.flight ?? visit.registration;
      $('fc-meta').textContent = `${carrier.name} · ${AIRCRAFT_TYPES[visit.type].name} · ${visit.registration}`;
      const ap = (code, label) => `<span class="ap">${code}<small>${label}</small></span>`;
      const from = visit.arrival ? ap(visit.arrival.origin, `in ${formatClock(visit.arrival.inBlock)}`) : ap('BNA', 'overnight');
      const to = visit.departure ? ap(visit.departure.destination, `out ${formatClock(visit.departure.offBlock)}`) : ap('BNA', 'overnight');
      $('fc-route').innerHTML = `${from}<span class="line"></span>${ap(visit.gate, 'gate')}<span class="line"></span>${to}`;
    }
    $('fc-phase').textContent = state ? PHASE_LABELS[state.phase] : 'Not at BNA right now';
    $('fc-speed').textContent = state ? `${Math.round(state.speed * KT)} kt` : '—';
    $('fc-alt').textContent = state ? (state.altitude > 3 ? `${Math.round((state.altitude * FT) / 10) * 10} ft` : 'Ground') : '—';
    $('fc-heading').textContent = state ? `${String(Math.round(state.heading) % 360).padStart(3, '0')}°` : '—';
    const runway = state && ['approach', 'landing', 'arrival-hold', 'taxi-in', 'docking'].includes(state.phase) ? track.runwayIn : track.runwayOut;
    $('fc-runway').textContent = runway ?? '—';
    const followBtn = $('fc-follow');
    followBtn.textContent = following ? 'Following · click map to stop' : 'Follow this aircraft';
    followBtn.classList.toggle('active', following);
    followBtn.disabled = !state;
  }

  // -------------------------------------------------------------- tags
  const tagsRoot = $('tags');
  const tags = new Map();
  tagsRoot.addEventListener('click', (event) => {
    const tag = event.target.closest('[data-id]');
    if (tag) onSelect(tag.dataset.id);
  });
  function tagFor(state) {
    let tag = tags.get(state.visit.id);
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'tag';
      tag.dataset.id = state.visit.id;
      tag.innerHTML = `<i style="background:${CARRIERS[state.visit.carrier].ui}"></i><b></b><span></span>`;
      tagsRoot.append(tag);
      tags.set(state.visit.id, tag);
    }
    return tag;
  }
  function setTags(states, screen, visible) {
    tagsRoot.classList.toggle('off', !visible);
    const seen = new Set();
    for (const state of states) {
      const moving = state.phase !== 'parked';
      const isSelected = state.visit.id === selectedId;
      const p = screen.get(state.visit.id);
      if (!p || !p.visible || (!moving && !isSelected) || state.opacity < 0.2) continue;
      seen.add(state.visit.id);
      const tag = tagFor(state);
      const arriving = ['approach', 'landing', 'arrival-hold', 'taxi-in', 'docking'].includes(state.phase);
      const leg = arriving ? state.visit.arrival : state.visit.departure;
      const text = leg?.flight ?? state.visit.registration;
      const feet = state.altitude * FT;
      const sub = !state.airborne
        ? `${Math.round(state.speed * KT)}kt`
        : feet >= 18000 ? `FL${String(Math.round(feet / 100)).padStart(3, '0')}` : `${(Math.round(feet / 50) * 50).toLocaleString('en-US')}ft`;
      if (tag.dataset.text !== text) {
        tag.querySelector('b').textContent = text;
        tag.dataset.text = text;
      }
      if (tag.dataset.sub !== sub) {
        tag.querySelector('span').textContent = sub;
        tag.dataset.sub = sub;
      }
      tag.classList.toggle('selected', isSelected);
      tag.style.transform = `translate3d(${p.x}px, ${p.y - 22}px, 0) translate(-50%, -100%)`;
    }
    for (const [id, tag] of tags) {
      if (!seen.has(id)) {
        tag.remove();
        tags.delete(id);
      }
    }
  }

  return {
    setClock,
    setStats,
    setBoard,
    setCard,
    setTags,
    setSelected(id) {
      selectedId = id;
      lastBoard = '';
    },
  };
}
