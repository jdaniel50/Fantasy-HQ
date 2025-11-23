// app.js
// Fantasy-HQ main script
// This version updates the Power Rankings page to:
// - Add PF, All-Play, Standings, ROS Sched, ROS Top-8 columns
// - Compute Top-8 lineup strength from ROS CSV + Sleeper rosters
// - Auto-generate notes based on these 5 metrics
// - Make table horizontally scrollable & sortable
// - Use same metrics in Presentation Mode

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const NFL_STATE_URL = `${SLEEPER_BASE}/state/nfl`;

// Your leagues (static)
const LEAGUES = [
  { id: '1186844188245356544', name: 'League of Record', key: 'league_of_record' },
  { id: '1186825886808555520', name: 'Dynasty Champs', key: 'dynasty_champs' },
  { id: '1257084943821967360', name: 'FFL', key: 'ffl' }
];

const USERNAME = 'stuckabuc';

// Global-ish app state
const state = {
  currentLeagueId: null,
  leagueData: {},        // leagueId -> { league, users, rosters, matchupsByWeek, power }
  rosData: null,         // Array of ROS player objects
  weekData: null,        // This week CSV data (not needed for Power Rank calc)
  sleeperPlayers: null,  // full players dict from Sleeper
  nflState: null,        // current week info
  powerSort: { column: 'rank', direction: 'asc' } // for sortable columns
};

// UTIL: simple CSV parser (no quoted commas)
function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/);
  const headers = rows[0].split(',').map(h => h.trim());
  return rows.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
}

// UTIL: localStorage helpers
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadJson(key, fallback = null) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// --- Sleeper API helpers ---

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function loadNflState() {
  if (state.nflState) return state.nflState;
  state.nflState = await fetchJson(NFL_STATE_URL);
  return state.nflState;
}

async function loadSleeperPlayers() {
  if (state.sleeperPlayers) return state.sleeperPlayers;
  state.sleeperPlayers = await fetchJson(`${SLEEPER_BASE}/players/nfl`);
  return state.sleeperPlayers;
}

async function loadLeagueBundle(leagueId) {
  if (state.leagueData[leagueId]) return state.leagueData[leagueId];

  const league = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}`);
  const users = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}/users`);
  const rosters = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}/rosters`);

  state.leagueData[leagueId] = {
    league,
    users,
    rosters,
    matchupsByWeek: {}, // lazy-loaded
    power: null
  };

  return state.leagueData[leagueId];
}

async function loadMatchupsForWeeks(leagueId, weeks) {
  const bundle = await loadLeagueBundle(leagueId);
  for (const w of weeks) {
    if (!bundle.matchupsByWeek[w]) {
      try {
        const m = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}/matchups/${w}`);
        bundle.matchupsByWeek[w] = m;
      } catch (err) {
        console.error('Failed to load matchups for week', w, err);
        bundle.matchupsByWeek[w] = [];
      }
    }
  }
  return bundle.matchupsByWeek;
}

// Map roster_id -> user
function mapRostersWithUsers(bundle) {
  const userById = {};
  bundle.users.forEach(u => {
    userById[u.user_id] = u;
  });

  return bundle.rosters.map(r => {
    const u = userById[r.owner_id] || null;
    const displayName = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      name: displayName,
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pf: r.settings?.fpts + (r.settings?.fpts_decimal || 0) / 100 ?? 0,
      players: r.players || [],
      starters: r.starters || [],
      user: u
    };
  });
}

// --- ROS CSV handling & mapping to Sleeper players ---

function buildNameIndex(playersDict) {
  const idx = {};
  Object.values(playersDict).forEach(p => {
    if (!p.full_name) return;
    const key = p.full_name.toLowerCase().trim();
    if (!idx[key]) idx[key] = [];
    idx[key].push(p);
  });
  return idx;
}

function findPlayerIdByNameAndPos(name, position, playersDict, nameIndex) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  let candidates = nameIndex[key] || [];

  if (position) {
    candidates = candidates.filter(p => p.position === position);
  }

  if (candidates.length === 0 && position) {
    // Try fuzzy: full_name starts with given text
    candidates = Object.values(playersDict).filter(
      p =>
        p.full_name &&
        p.full_name.toLowerCase().startsWith(key) &&
        p.position === position
    );
  }

  if (candidates.length === 0) return null;
  return candidates[0].player_id;
}

// Attach Sleeper IDs to ROS entries once, based on name + position
async function attachSleeperIdsToRos() {
  if (!state.rosData) return;
  const playersDict = await loadSleeperPlayers();
  const nameIndex = buildNameIndex(playersDict);

  state.rosData.forEach(player => {
    const name = player.Player || player.player || player.name;
    let pos = player.Position || player.position;
    if (!name || !pos) return;

    pos = pos.toUpperCase();
    const pid = findPlayerIdByNameAndPos(name, pos, playersDict, nameIndex);
    player.sleeper_id = pid || null;
  });
}

// Find ROS entry by Sleeper player ID
function findRosByPlayerId(sleeperId) {
  if (!state.rosData || !sleeperId) return null;
  return state.rosData.find(p => p.sleeper_id === sleeperId) || null;
}

// --- Power Rankings Calculation ---

function rankArray(arr, key, asc = true) {
  const sorted = [...arr].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return asc ? av - bv : bv - av;
  });
  const ranks = new Map();
  sorted.forEach((item, idx) => {
    ranks.set(item.roster_id, idx + 1);
  });
  return ranks;
}

// Calculate Points For rank and Standing rank
function computePfAndStandingRanks(teams) {
  // PF: higher is better
  const pfRanks = rankArray(
    teams.map(t => ({ roster_id: t.roster_id, pfValue: t.pf })),
    'pfValue',
    false
  );

  // Standing: sort by wins desc, then PF desc
  const sorted = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pf - a.pf;
  });
  const standRanks = new Map();
  sorted.forEach((t, i) => {
    standRanks.set(t.roster_id, i + 1);
  });

  return { pfRanks, standRanks };
}

// Compute All-Play rank over last 3 weeks
function computeAllPlayRanks(teams, matchupsByWeek, weeks) {
  const scoresByRoster = {};
  teams.forEach(t => {
    scoresByRoster[t.roster_id] = [];
  });

  weeks.forEach(week => {
    const matchups = matchupsByWeek[week] || [];
    const byRoster = {};
    matchups.forEach(m => {
      if (!byRoster[m.roster_id]) byRoster[m.roster_id] = 0;
      const pts = (m.points || 0) + (m.points_decimal || 0) / 100;
      byRoster[m.roster_id] = pts;
    });

    const weekScores = Object.entries(byRoster).map(([rid, pts]) => ({
      roster_id: Number(rid),
      pts
    }));
    weekScores.sort((a, b) => b.pts - a.pts); // 1 = highest

    weekScores.forEach((entry, idx) => {
      const rank = idx + 1;
      scoresByRoster[entry.roster_id]?.push(rank);
    });
  });

  const allPlayRankSource = teams.map(t => {
    const ranks = scoresByRoster[t.roster_id] || [];
    if (!ranks.length) return { roster_id: t.roster_id, avgPlace: null };
    const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    return { roster_id: t.roster_id, avgPlace: avg };
  });

  const allPlayRanks = rankArray(allPlayRankSource, 'avgPlace', true);
  return allPlayRanks;
}

// Compute Top-8 ROS strength and team ROS schedule difficulty
function computeTop8AndScheduleRanks(teams) {
  const top8Source = [];
  const rosSchedSource = [];

  teams.forEach(team => {
    // Extract ROS entries for all players on this team
    const rosEntries = (team.players || [])
      .map(pid => findRosByPlayerId(pid))
      .filter(Boolean);

    if (!rosEntries.length) {
      top8Source.push({ roster_id: team.roster_id, top8Score: null });
      rosSchedSource.push({ roster_id: team.roster_id, rosSchedScore: null });
      return;
    }

    // Sort by Overall ROS rank ascending (1 = best)
    const sortedByRos = [...rosEntries].sort((a, b) => {
      const ar = Number(a.Overall || a.rank || a['Overall Rank'] || 9999);
      const br = Number(b.Overall || b.rank || b['Overall Rank'] || 9999);
      return ar - br;
    });

    const top8 = sortedByRos.slice(0, 8);

    let top8Score = 0;
    let rosValues = [];

    top8.forEach(p => {
      const rosRank = Number(p.Overall || p.rank || 9999);
      const sched = Number(p.ROS || p['ROS'] || 16);

      if (!isNaN(rosRank)) {
        // Higher score = better lineup; 200 is arbitrary ceiling
        top8Score += 200 - rosRank;
      }
      if (!isNaN(sched)) {
        rosValues.push(sched);
      }
    });

    if (!rosValues.length) rosValues.push(16);

    const rosAvg = rosValues.reduce((a, b) => a + b, 0) / rosValues.length;

    top8Source.push({ roster_id: team.roster_id, top8Score });
    rosSchedSource.push({ roster_id: team.roster_id, rosSchedScore: rosAvg });
  });

  // For top8Score, higher is better (desc)
  const top8Ranks = rankArray(top8Source, 'top8Score', false);
  // For rosSchedScore, lower is easier (asc)
  const rosSchedRanks = rankArray(rosSchedSource, 'rosSchedScore', true);

  return { top8Ranks, rosSchedRanks };
}

// Combine all metrics into a final Power Rank
function computeFinalPowerRanks(teams, metrics) {
  const {
    pfRanks,
    standRanks,
    allPlayRanks,
    top8Ranks,
    rosSchedRanks
  } = metrics;

  const compositeArray = teams.map(t => {
    const rId = t.roster_id;
    // Lower rank number is better for all
    const pf = pfRanks.get(rId) || 999;
    const st = standRanks.get(rId) || 999;
    const ap = allPlayRanks.get(rId) || 999;
    const t8 = top8Ranks.get(rId) || 999;
    const rs = rosSchedRanks.get(rId) || 999;

    // You can adjust weights here if you want
    const score =
      pf * 0.30 +
      ap * 0.25 +
      st * 0.20 +
      t8 * 0.20 +
      rs * 0.05;

    return {
      roster_id: rId,
      pfRank: pf,
      standRank: st,
      allPlayRank: ap,
      top8Rank: t8,
      rosSchedRank: rs,
      compositeScore: score
    };
  });

  compositeArray.sort((a, b) => a.compositeScore - b.compositeScore); // lower better
  const powerRanks = new Map();
  compositeArray.forEach((item, idx) => {
    powerRanks.set(item.roster_id, idx + 1);
  });

  return powerRanks;
}

// Build auto-generated notes for each team
function buildPowerNote(entry) {
  const pf = entry.pfRank;
  const ap = entry.allPlayRank;
  const st = entry.standRank;
  const rs = entry.rosSchedRank;
  const t8 = entry.top8Rank;

  const lines = [];
  lines.push(`PF: ${pf} | All-Play (3W): ${ap}`);
  lines.push(`Standings: ${st} | ROS Sched: ${rs}`);
  lines.push(`Top-8 ROS Strength: ${t8}`);

  // Short overall summary
  let overall;
  if (t8 <= 3 && pf <= 3) {
    overall = 'Overall: Elite lineup with top-tier scoring.';
  } else if (pf <= 4 && ap <= 4) {
    overall = 'Overall: Strong scoring with consistent weekly finishes.';
  } else if (st <= 4 && rs <= 4) {
    overall = 'Overall: Well-positioned in standings with favorable schedule.';
  } else if (pf >= 8 && st >= 8) {
    overall = 'Overall: Needs help in both scoring and results.';
  } else if (ap >= 8) {
    overall = 'Overall: Recent form has trended down over the last 3 weeks.';
  } else {
    overall = 'Overall: Competitive team with room to improve.';
  }

  lines.push(overall);
  return lines.join('\n');
}

// Load previous power ranks from localStorage for change calculation
function loadPreviousPowerRanks(leagueId) {
  return loadJson(`power_ranks_${leagueId}`, null);
}

function saveCurrentPowerRanks(leagueId, entries) {
  const simple = entries.map(e => ({
    roster_id: e.roster_id,
    rank: e.rank
  }));
  saveJson(`power_ranks_${leagueId}`, simple);
}

// --- Rendering Power Rankings ---

function getLeagueConfig(leagueId) {
  const conf = loadJson('league_config', {});
  return conf[leagueId] || {};
}

function renderPowerRankingsTable(leagueId) {
  const bundle = state.leagueData[leagueId];
  if (!bundle || !bundle.power) return;

  const { teams, entries } = bundle.power;
  const table = document.getElementById('power-rankings-table');
  if (!table) return;

  // Apply sorting
  let sortedEntries = [...entries];
  const { column, direction } = state.powerSort;
  if (column !== 'rank') {
    sortedEntries.sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (direction === 'asc') return av - bv;
      return bv - av;
    });
  } else {
    sortedEntries.sort((a, b) => a.rank - b.rank);
  }

  const leagueConfig = getLeagueConfig(leagueId);
  const primaryColor = leagueConfig.primaryColor || '#222631';

  // Build header
  table.innerHTML = `
    <thead>
      <tr>
        <th data-sort="rank">Rank</th>
        <th>Team</th>
        <th data-sort="change">Δ</th>
        <th data-sort="pfRank">PF</th>
        <th data-sort="allPlayRank">All-Play</th>
        <th data-sort="standRank">Stand</th>
        <th data-sort="rosSchedRank">ROS Sched</th>
        <th data-sort="top8Rank">ROS Top-8</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  sortedEntries.forEach(entry => {
    const team = teams.find(t => t.roster_id === entry.roster_id);
    if (!team) return;

    const change = entry.change;
    let changeText = '';
    if (change > 0) changeText = `▲${change}`;
    else if (change < 0) changeText = `▼${Math.abs(change)}`;
    else changeText = '–';

    const tr = document.createElement('tr');
    tr.classList.add('power-row');

    const teamCellBg = primaryColor;

    tr.innerHTML = `
      <td class="pr-rank">${entry.rank}</td>
      <td class="pr-team">
        <div class="pr-team-pill" style="background:${teamCellBg};">
          <span class="pr-team-name">${team.name}</span>
        </div>
      </td>
      <td class="pr-change">${changeText}</td>
      <td class="pr-metric">${entry.pfRank}</td>
      <td class="pr-metric">${entry.allPlayRank}</td>
      <td class="pr-metric">${entry.standRank}</td>
      <td class="pr-metric">${entry.rosSchedRank}</td>
      <td class="pr-metric">${entry.top8Rank}</td>
      <td class="pr-notes"><pre>${entry.notes}</pre></td>
    `;

    tbody.appendChild(tr);
  });

  // Attach sorting handlers
  const headers = table.querySelectorAll('th[data-sort]');
  headers.forEach(th => {
    const sortKey = th.getAttribute('data-sort');
    th.style.cursor = 'pointer';
    th.onclick = () => {
      if (sortKey === 'rank') {
        state.powerSort = { column: 'rank', direction: 'asc' };
      } else {
        if (state.powerSort.column === sortKey) {
          state.powerSort.direction =
            state.powerSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.powerSort = { column: sortKey, direction: 'asc' };
        }
      }
      renderPowerRankingsTable(leagueId);
    };
  });
}

// --- Presentation Mode ---

function buildPresentationOverlay(leagueId) {
  const overlay = document.getElementById('power-presentation-overlay');
  if (!overlay) return;
  const bundle = state.leagueData[leagueId];
  if (!bundle || !bundle.power) return;

  const { league, power } = bundle;
  const { teams, entries } = power;

  const leagueConfig = getLeagueConfig(leagueId);
  const logoUrl = leagueConfig.logoUrl || '';
  const week = state.nflState?.week || 'Current';

  // Slides order: header, then ranks 10 -> 1
  const sortedByRank = [...entries].sort((a, b) => a.rank - b.rank);
  const order = [];
  for (let i = sortedByRank.length - 1; i >= 0; i--) {
    order.push(sortedByRank[i]);
  }

  overlay.innerHTML = `
    <div class="power-present-inner">
      <div class="power-present-content">
        <div id="power-present-slide"></div>
        <button id="power-present-next" class="btn primary">Next</button>
      </div>
    </div>
  `;

  const slideEl = document.getElementById('power-present-slide');
  const nextBtn = document.getElementById('power-present-next');

  let step = -1; // -1 = header

  function renderStep() {
    if (step === -1) {
      slideEl.innerHTML = `
        <div class="power-header-slide">
          ${logoUrl ? `<img src="${logoUrl}" class="power-league-logo" />` : ''}
          <h1 class="power-header-title">Week ${week} Power Rankings</h1>
        </div>
      `;
      return;
    }

    const entry = order[step];
    if (!entry) return;
    const team = teams.find(t => t.roster_id === entry.roster_id);
    if (!team) return;

    slideEl.innerHTML = `
      <div class="power-team-slide">
        <div class="power-team-rank">#${entry.rank}</div>
        <div class="power-team-name">${team.name}</div>
        <div class="power-team-metrics">
          <div>Points For: ${entry.pfRank}</div>
          <div>All-Play (3W): ${entry.allPlayRank}</div>
          <div>Standings: ${entry.standRank}</div>
          <div>ROS Schedule: ${entry.rosSchedRank}</div>
          <div>ROS Top-8 Strength: ${entry.top8Rank}</div>
        </div>
        <div class="power-team-notes">
          ${entry.notes
            .split('\n')
            .map(line => `<div>${line}</div>`)
            .join('')}
        </div>
      </div>
    `;
  }

  nextBtn.onclick = () => {
    if (step < order.length - 1) {
      step++;
      renderStep();
    } else {
      // close overlay
      overlay.classList.remove('active');
    }
  };

  // Start at header
  step = -1;
  renderStep();
}

// Toggle presentation mode
function setupPresentationToggle() {
  const toggle = document.getElementById('power-presentation-toggle');
  const overlay = document.getElementById('power-presentation-overlay');
  if (!toggle || !overlay) return;

  toggle.onclick = () => {
    if (!state.currentLeagueId) return;
    buildPresentationOverlay(state.currentLeagueId);
    overlay.classList.add('active');
  };
}

// --- Main Power Rankings workflow ---

async function computeAndRenderPowerRankings(leagueId) {
  if (!state.rosData) {
    console.warn('ROS data not loaded; Power Rankings need ROS CSV.');
    return;
  }

  // Ensure ROS entries have Sleeper IDs
  await attachSleeperIdsToRos();
  await loadNflState();

  const bundle = await loadLeagueBundle(leagueId);
  const teams = mapRostersWithUsers(bundle);

  // Determine which 3 weeks to use for All-Play
  const currentWeek = state.nflState?.week || 1;
  const weeks = [];
  for (let w = currentWeek; w > currentWeek - 3 && w > 0; w--) {
    weeks.push(w);
  }

  await loadMatchupsForWeeks(leagueId, weeks);

  const { pfRanks, standRanks } = computePfAndStandingRanks(teams);
  const allPlayRanks = computeAllPlayRanks(
    teams,
    bundle.matchupsByWeek,
    weeks
  );
  const { top8Ranks, rosSchedRanks } = computeTop8AndScheduleRanks(teams);
  const powerRanks = computeFinalPowerRanks(teams, {
    pfRanks,
    standRanks,
    allPlayRanks,
    top8Ranks,
    rosSchedRanks
  });

  const previous = loadPreviousPowerRanks(leagueId) || [];
  const prevMap = new Map();
  previous.forEach(p => prevMap.set(p.roster_id, p.rank));

  const entries = teams.map(t => {
    const rId = t.roster_id;
    const rank = powerRanks.get(rId) || 999;
    const entry = {
      roster_id: rId,
      name: t.name,
      rank,
      pfRank: pfRanks.get(rId) || 10,
      standRank: standRanks.get(rId) || 10,
      allPlayRank: allPlayRanks.get(rId) || 10,
      top8Rank: top8Ranks.get(rId) || 10,
      rosSchedRank: rosSchedRanks.get(rId) || 10,
      notes: '' // fill below
    };
    entry.notes = buildPowerNote(entry);
    const prevRank = prevMap.get(rId);
    entry.change =
      typeof prevRank === 'number' ? prevRank - rank : 0; // positive = moved up
    return entry;
  });

  // Sort by official rank
  entries.sort((a, b) => a.rank - b.rank);

  bundle.power = { teams, entries };

  // Save current ranks for "change" next time
  saveCurrentPowerRanks(leagueId, entries);

  // Reset sort and render
  state.powerSort = { column: 'rank', direction: 'asc' };
  renderPowerRankingsTable(leagueId);
}

// --- CSV upload handlers (ROS + This Week) ---

function setupCsvUpload() {
  const rosInput = document.getElementById('ros-file-input');
  const weekInput = document.getElementById('week-file-input');

  if (rosInput) {
    rosInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const text = ev.target.result;
        const rows = parseCsv(text);
        state.rosData = rows;
        saveJson('ros_csv_data', rows);
        if (state.currentLeagueId) {
          computeAndRenderPowerRankings(state.currentLeagueId);
        }
      };
      reader.readAsText(file);
    });
  }

  if (weekInput) {
    weekInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const text = ev.target.result;
        const rows = parseCsv(text);
        state.weekData = rows;
        saveJson('week_csv_data', rows);
        // This Week tab uses this; Power Rankings does not.
      };
      reader.readAsText(file);
    });
  }

  // Load any persisted CSV
  const savedRos = loadJson('ros_csv_data', null);
  if (savedRos) state.rosData = savedRos;
  const savedWeek = loadJson('week_csv_data', null);
  if (savedWeek) state.weekData = savedWeek;
}

// --- League dropdown + init ---

function setupLeagueDropdown() {
  const sel = document.getElementById('league-select');
  if (!sel) return;

  sel.innerHTML = '';
  LEAGUES.forEach(lg => {
    const opt = document.createElement('option');
    opt.value = lg.id;
    opt.textContent = lg.name;
    sel.appendChild(opt);
  });

  sel.onchange = async () => {
    const leagueId = sel.value;
    state.currentLeagueId = leagueId;
    await loadLeagueBundle(leagueId);
    // Recompute Power Rankings for selected league
    computeAndRenderPowerRankings(leagueId);
  };

  // Default to first league
  if (LEAGUES.length > 0) {
    sel.value = LEAGUES[0].id;
    state.currentLeagueId = LEAGUES[0].id;
    loadLeagueBundle(LEAGUES[0].id).then(() =>
      computeAndRenderPowerRankings(LEAGUES[0].id)
    );
  }
}

// --- Admin league config (colors + logos) ---

function setupAdminConfig() {
  const adminContainer = document.getElementById('admin-league-config');
  const saveBtn = document.getElementById('admin-save-config');
  if (!adminContainer || !saveBtn) return;

  const existing = loadJson('league_config', {});

  adminContainer.innerHTML = '';
  LEAGUES.forEach(lg => {
    const conf = existing[lg.id] || {};
    const row = document.createElement('div');
    row.className = 'admin-league-row';
    row.innerHTML = `
      <div class="admin-league-name">${lg.name}</div>
      <label>
        Primary Color (hex)
        <input type="text" class="admin-color" data-league="${lg.id}" value="${
      conf.primaryColor || '#222631'
    }" />
      </label>
      <label>
        Logo URL or Path
        <input type="text" class="admin-logo" data-league="${lg.id}" value="${
      conf.logoUrl || ''
    }" />
      </label>
    `;
    adminContainer.appendChild(row);
  });

  saveBtn.onclick = () => {
    const newConf = {};
    const colorInputs = adminContainer.querySelectorAll('.admin-color');
    const logoInputs = adminContainer.querySelectorAll('.admin-logo');
    colorInputs.forEach(inp => {
      const leagueId = inp.getAttribute('data-league');
      if (!newConf[leagueId]) newConf[leagueId] = {};
      newConf[leagueId].primaryColor = inp.value || '#222631';
    });
    logoInputs.forEach(inp => {
      const leagueId = inp.getAttribute('data-league');
      if (!newConf[leagueId]) newConf[leagueId] = {};
      newConf[leagueId].logoUrl = inp.value || '';
    });

    saveJson('league_config', newConf);
    if (state.currentLeagueId) {
      // Re-render with new colors/logos
      renderPowerRankingsTable(state.currentLeagueId);
    }
  };
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  setupCsvUpload();
  setupLeagueDropdown();
  setupAdminConfig();
  setupPresentationToggle();
  // Other tab initializers (Teams, This Week, ROS) are assumed to be
  // already wired in this file in your existing version.
});
