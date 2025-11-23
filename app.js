// app.js
// Fantasy-HQ dashboard

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const NFL_STATE_URL = `${SLEEPER_BASE}/state/nfl`;

const LEAGUES = [
  { id: '1186844188245356544', name: 'League of Record', key: 'league_of_record' },
  { id: '1186825886808555520', name: 'Dynasty Champs', key: 'dynasty_champs' },
  { id: '1257084943821967360', name: 'FFL', key: 'ffl' }
];

const USERNAME = 'stuckabuc';

const state = {
  currentLeagueId: null,
  leagueData: {},          // leagueId -> { league, users, rosters, matchupsByWeek, ownership }
  rosData: null,           // raw ROS CSV rows
  weekDataRaw: null,       // raw "wide" this-week rows
  weekByPosition: {},      // derived: QB/RB/WR/TE/FLEX/DST arrays
  sleeperPlayers: null,    // players dictionary
  nflState: null,
  myUserId: null,
  powerSort: { column: 'rank', direction: 'asc' }
};

// --- Utilities ---

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
}

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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// --- Sleeper loading ---

async function loadNflState() {
  if (state.nflState) return state.nflState;
  state.nflState = await fetchJson(NFL_STATE_URL);
  const seasonLabel = document.getElementById('currentSeasonLabel');
  const weekLabel = document.getElementById('currentWeekLabel');
  if (seasonLabel) seasonLabel.textContent = `Season: ${state.nflState.season}`;
  if (weekLabel) weekLabel.textContent = `Week ${state.nflState.week}`;
  return state.nflState;
}

async function loadSleeperPlayers() {
  if (state.sleeperPlayers) return state.sleeperPlayers;
  state.sleeperPlayers = await fetchJson(`${SLEEPER_BASE}/players/nfl`);
  return state.sleeperPlayers;
}

async function loadMyUser() {
  if (state.myUserId) return state.myUserId;
  const user = await fetchJson(`${SLEEPER_BASE}/user/${USERNAME}`);
  state.myUserId = user.user_id;
  return state.myUserId;
}

async function loadLeagueBundle(leagueId, force = false) {
  if (state.leagueData[leagueId] && !force) return state.leagueData[leagueId];

  const league = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}`);
  const users = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}/users`);
  const rosters = await fetchJson(`${SLEEPER_BASE}/league/${leagueId}/rosters`);
  const myUserId = await loadMyUser();

  const ownershipMap = {}; // player_id -> { roster_id, isMine }

  rosters.forEach(r => {
    const isMine = r.owner_id === myUserId;
    (r.players || []).forEach(pid => {
      ownershipMap[pid] = {
        roster_id: r.roster_id,
        isMine
      };
    });
  });

  state.leagueData[leagueId] = {
    league,
    users,
    rosters,
    matchupsByWeek: {},
    ownership: ownershipMap
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
        console.error('Failed matchups week', w, err);
        bundle.matchupsByWeek[w] = [];
      }
    }
  }
  return bundle.matchupsByWeek;
}

function mapRostersWithUsers(bundle) {
  const userById = {};
  bundle.users.forEach(u => {
    userById[u.user_id] = u;
  });
  return bundle.rosters.map(r => {
    const u = userById[r.owner_id] || null;
    const displayName = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
    const pf = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      name: displayName,
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pf,
      players: r.players || [],
      starters: r.starters || [],
      isMine: r.owner_id === state.myUserId
    };
  });
}

// --- Player mapping between ROS/ThisWeek and Sleeper ---

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
    const up = position.toUpperCase();
    candidates = candidates.filter(p => p.position === up);
  }
  if (!candidates.length) {
    candidates = Object.values(playersDict).filter(
      p =>
        p.full_name &&
        p.full_name.toLowerCase().startsWith(key) &&
        (!position || p.position === position.toUpperCase())
    );
  }
  if (!candidates.length) return null;
  return candidates[0].player_id;
}

async function attachSleeperIdsToRos() {
  if (!state.rosData) return;
  const playersDict = await loadSleeperPlayers();
  const nameIndex = buildNameIndex(playersDict);

  state.rosData.forEach(row => {
    const name = row.Player || row.player || row.name;
    let pos = row.Position || row.position;
    if (!name || !pos) return;
    pos = pos.toUpperCase();
    const pid = findPlayerIdByNameAndPos(name, pos, playersDict, nameIndex);
    row.sleeper_id = pid || null;
  });
}

function findRosByPlayerId(pid) {
  if (!state.rosData || !pid) return null;
  return state.rosData.find(r => r.sleeper_id === pid) || null;
}

async function findSleeperIdByName(name) {
  if (!name) return null;
  const dict = await loadSleeperPlayers();
  const nameIndex = buildNameIndex(dict);
  const key = name.toLowerCase().trim();
  const candidates = nameIndex[key];
  if (!candidates || !candidates.length) return null;
  return candidates[0].player_id;
}

// --- Conditional formatting helpers ---

function interpolateColor(t, c1, c2) {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function getGradientColor(value, min, mid, max, invert = false) {
  if (value == null || isNaN(value)) return '';
  if (value <= min) value = min;
  if (value >= max) value = max;
  let t;
  if (value <= mid) {
    t = (value - min) / (mid - min || 1);
    // green -> yellow
    const start = invert ? [239, 68, 68] : [34, 197, 94];
    const end = [250, 204, 21];
    return interpolateColor(t, start, end);
  } else {
    t = (value - mid) / (max - mid || 1);
    // yellow -> red
    const start = [250, 204, 21];
    const end = invert ? [34, 197, 94] : [239, 68, 68];
    return interpolateColor(t, start, end);
  }
}

// --- CSV uploads ---

function setupCsvUpload() {
  const rosInput = document.getElementById('ros-file-input');
  const weekInput = document.getElementById('week-file-input');

  if (rosInput) {
    rosInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async ev => {
        const text = ev.target.result;
        const rows = parseCsv(text);
        state.rosData = rows;
        saveJson('ros_csv_data', rows);
        await attachSleeperIdsToRos();
        if (state.currentLeagueId) {
          renderTeamsTab();
          renderRosTab();
          computeAndRenderPowerRankings(state.currentLeagueId);
        } else {
          renderRosTab();
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
      reader.onload = async ev => {
        const text = ev.target.result;
        const rows = parseCsv(text);
        state.weekDataRaw = rows;
        saveJson('week_csv_data', rows);
        deriveWeekByPosition();
        renderWeekTab();
      };
      reader.readAsText(file);
    });
  }

  // Load saved
  const savedRos = loadJson('ros_csv_data', null);
  if (savedRos) {
    state.rosData = savedRos;
    attachSleeperIdsToRos();
  }
  const savedWeek = loadJson('week_csv_data', null);
  if (savedWeek) {
    state.weekDataRaw = savedWeek;
    deriveWeekByPosition();
  }
}

// Parse "wide" This Week CSV into per-position arrays
function deriveWeekByPosition() {
  const raw = state.weekDataRaw;
  if (!raw) {
    state.weekByPosition = {};
    return;
  }
  const byPos = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    FLEX: [],
    DST: []
  };

  raw.forEach(row => {
    const cells = Object.values(row);
    // Expecting the specific wide layout described.
    const qbRank = cells[0];
    const qbName = cells[1];
    const qbTeam = cells[2];
    const qbOpp = cells[3];
    const qbTotal = cells[4];
    const qbMatch = cells[5];
    const qbTier = cells[6];

    const rbRank = cells[7];
    const rbName = cells[8];
    const rbTeam = cells[9];
    const rbOpp = cells[10];
    const rbTotal = cells[11];
    const rbMatch = cells[12];
    const rbTier = cells[13];

    const wrRank = cells[14];
    const wrName = cells[15];
    const wrTeam = cells[16];
    const wrOpp = cells[17];
    const wrTotal = cells[18];
    const wrMatch = cells[19];
    const wrTier = cells[20];

    const teRank = cells[21];
    const teName = cells[22];
    const teTeam = cells[23];
    const teOpp = cells[24];
    const teTotal = cells[25];
    const teMatch = cells[26];
    const teTier = cells[27];

    const dstRank = cells[28];
    const dstName = cells[29];
    const dstOpp = cells[30];
    const dstSpread = cells[31];
    const dstTier = cells[32];

    const flex1Rank = cells[33];
    const flex1Name = cells[34];
    const flex1Team = cells[35];
    const flex1Opp = cells[36];
    const flex1Total = cells[37];
    const flex1Pos = cells[38];
    const flex1Match = cells[39];

    const flex2Rank = cells[40];
    const flex2Name = cells[41];
    const flex2Team = cells[42];
    const flex2Opp = cells[43];
    const flex2Total = cells[44];
    const flex2Pos = cells[45];
    const flex2Match = cells[46];

    function pushIfValid(target, obj) {
      if (obj.name && obj.rank) target.push(obj);
    }

    pushIfValid(byPos.QB, {
      rank: Number(qbRank),
      name: qbName,
      team: qbTeam,
      opp: qbOpp,
      total: Number(qbTotal),
      matchup: Number(qbMatch),
      tier: qbTier
    });

    pushIfValid(byPos.RB, {
      rank: Number(rbRank),
      name: rbName,
      team: rbTeam,
      opp: rbOpp,
      total: Number(rbTotal),
      matchup: Number(rbMatch),
      tier: rbTier
    });

    pushIfValid(byPos.WR, {
      rank: Number(wrRank),
      name: wrName,
      team: wrTeam,
      opp: wrOpp,
      total: Number(wrTotal),
      matchup: Number(wrMatch),
      tier: wrTier
    });

    pushIfValid(byPos.TE, {
      rank: Number(teRank),
      name: teName,
      team: teTeam,
      opp: teOpp,
      total: Number(teTotal),
      matchup: Number(teMatch),
      tier: teTier
    });

    pushIfValid(byPos.DST, {
      rank: Number(dstRank),
      name: dstName,
      opp: dstOpp,
      spread: Number(dstSpread),
      tier: dstTier
    });

    function pushFlex(rank, name, team, opp, total, pos, match) {
      if (!name || !rank) return;
      byPos.FLEX.push({
        rank: Number(rank),
        name,
        team,
        opp,
        total: Number(total),
        pos,
        matchup: Number(match)
      });
    }

    pushFlex(flex1Rank, flex1Name, flex1Team, flex1Opp, flex1Total, flex1Pos, flex1Match);
    pushFlex(flex2Rank, flex2Name, flex2Team, flex2Opp, flex2Total, flex2Pos, flex2Match);
  });

  Object.keys(byPos).forEach(p => {
    byPos[p].sort((a, b) => a.rank - b.rank);
  });

  state.weekByPosition = byPos;
}

// --- League dropdown & refresh ---

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
    const id = sel.value;
    state.currentLeagueId = id || null;
    if (!id) return;
    await loadLeagueBundle(id);
    renderTeamsTab();
    renderRosTab();
    computeAndRenderPowerRankings(id);
    renderWeekTab(); // for ownership highlighting
    populateTeamSelect();
  };

  if (LEAGUES.length > 0) {
    sel.value = LEAGUES[0].id;
    state.currentLeagueId = LEAGUES[0].id;
    loadLeagueBundle(LEAGUES[0].id).then(() => {
      renderTeamsTab();
      renderRosTab();
      computeAndRenderPowerRankings(LEAGUES[0].id);
      renderWeekTab();
      populateTeamSelect();
    });
  }

  const refBtn = document.getElementById('refreshSleeperBtn');
  if (refBtn) {
    refBtn.onclick = async () => {
      if (!state.currentLeagueId) return;
      // Force reload current league
      await loadLeagueBundle(state.currentLeagueId, true);
      renderTeamsTab();
      renderRosTab();
      computeAndRenderPowerRankings(state.currentLeagueId);
      renderWeekTab();
      populateTeamSelect();
    };
  }
}

// --- Tabs ---

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  const contents = document.querySelectorAll('.tab-content');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tgt = btn.getAttribute('data-tab');
      buttons.forEach(b => b.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const sec = document.getElementById(tgt);
      if (sec) sec.classList.add('active');
    });
  });
}

// --- Teams tab ---

function populateTeamSelect() {
  const sel = document.getElementById('teamSelect');
  const ownerLabel = document.getElementById('teamOwnerLabel');
  if (!sel || !state.currentLeagueId) return;

  const bundle = state.leagueData[state.currentLeagueId];
  if (!bundle) return;

  const teams = mapRostersWithUsers(bundle);

  sel.innerHTML = '<option value="">Select a team</option>';
  teams.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.roster_id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });

  sel.onchange = () => {
    const rid = Number(sel.value);
    const team = teams.find(t => t.roster_id === rid);
    if (ownerLabel) {
      if (team?.isMine) {
        ownerLabel.textContent = 'My team';
      } else if (team) {
        ownerLabel.textContent = team.name;
      } else {
        ownerLabel.textContent = '';
      }
    }
    renderTeamsTab();
  };
}

function renderTeamsTab() {
  const container = document.getElementById('teamsContent');
  const upgradeCard = document.getElementById('upgradeCard');
  const upgradeContent = document.getElementById('upgradeContent');
  const sel = document.getElementById('teamSelect');
  if (!container) return;

  if (!state.currentLeagueId) {
    container.innerHTML = '<div class="muted-text">Select a league to view teams.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    return;
  }
  const bundle = state.leagueData[state.currentLeagueId];
  if (!bundle) {
    container.innerHTML = '<div class="muted-text">Loading league data...</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    return;
  }
  if (!state.rosData) {
    container.innerHTML = '<div class="muted-text">Upload your ROS CSV to see team strength.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    return;
  }

  const teams = mapRostersWithUsers(bundle);
  let targetRoster = null;

  if (sel && sel.value) {
    targetRoster = teams.find(t => t.roster_id === Number(sel.value));
  } else {
    targetRoster = teams.find(t => t.isMine) || teams[0];
    if (sel && targetRoster) {
      sel.value = String(targetRoster.roster_id);
    }
  }

  if (!targetRoster) {
    container.innerHTML = '<div class="muted-text">No team selected.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    return;
  }

  const players = targetRoster.players || [];
  const byPos = { QB: [], RB: [], WR: [], TE: [], OTHER: [] };
  players.forEach(pid => {
    const ros = findRosByPlayerId(pid);
    const pos = ros?.Position || ros?.position || 'OTHER';
    const up = pos.toUpperCase();
    const bucket = byPos[up] || byPos.OTHER;
    bucket.push({ pid, ros, pos: up });
  });

  function buildPositionTable(label, list) {
    if (!list.length) return '';
    let html = `<h4>${label}</h4>`;
    html += `
      <table class="data-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Rank</th>
            <th>Pos Rank</th>
            <th>Tier</th>
            <th>PPG</th>
            <th>Bye</th>
            <th>ROS</th>
            <th>Next 4</th>
          </tr>
        </thead>
        <tbody>
    `;
    // Sort by overall rank
    const sorted = [...list].sort((a, b) => {
      const ar = Number(a.ros?.Overall || a.ros?.rank || 9999);
      const br = Number(b.ros?.Overall || b.ros?.rank || 9999);
      return ar - br;
    });

    sorted.forEach(item => {
      const r = item.ros;
      const name = r?.Player || r?.player || 'Unknown';
      const overall = Number(r?.Overall || r?.rank || '');
      const posRank = Number(r?.['Positional Rank'] || r?.pos_rank || '');
      const tier = r?.Tier || r?.tier || '';
      const ppg = Number(r?.PPG || '');
      const bye = r?.Bye || '';
      const ros = Number(r?.ROS || '');
      const next4 = Number(r?.['Next 4'] || r?.Next4 || '');

      const overallBg = overall ? getGradientColor(overall, 1, 70, 150, false) : '';
      const posBg = posRank ? getGradientColor(posRank, 1, 15, 50, false) : '';
      const rosBg = ros ? getGradientColor(ros, 1, 16, 32, true) : '';
      const nextBg = next4 ? getGradientColor(next4, 1, 16, 32, true) : '';
      const ppgBg = ppg ? getGradientColor(ppg, 8, 15, 30, false) : '';

      html += `
        <tr>
          <td>${name}</td>
          <td style="background:${overallBg}">${overall || ''}</td>
          <td style="background:${posBg}">${posRank || ''}</td>
          <td>${tier || ''}</td>
          <td style="background:${ppgBg}">${ppg || ''}</td>
          <td>${bye || ''}</td>
          <td style="background:${rosBg}">${ros || ''}</td>
          <td style="background:${nextBg}">${next4 || ''}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    return html;
  }

  let html = '';
  html += buildPositionTable('Quarterback', byPos.QB);
  html += buildPositionTable('Running Back', byPos.RB);
  html += buildPositionTable('Wide Receiver', byPos.WR);
  html += buildPositionTable('Tight End', byPos.TE);

  if (!html) {
    html = '<div class="muted-text">No ROS-ranked players found for this team.</div>';
  }

  container.innerHTML = html;

  // Free agents (top 5)
  if (!upgradeCard || !upgradeContent) return;
  const ownedSet = new Set(bundle.rosters.flatMap(r => r.players || []));
  const candidates = (state.rosData || [])
    .filter(r => r.sleeper_id && !ownedSet.has(r.sleeper_id))
    .sort((a, b) => Number(a.Overall || a.rank || 9999) - Number(b.Overall || b.rank || 9999))
    .slice(0, 5);

  if (!candidates.length) {
    upgradeCard.style.display = 'none';
    return;
  }

  let upHtml = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Pos</th>
          <th>Rank</th>
          <th>Pos Rank</th>
          <th>Tier</th>
          <th>PPG</th>
          <th>Bye</th>
        </tr>
      </thead>
      <tbody>
  `;

  candidates.forEach(r => {
    const name = r.Player || r.player || 'Unknown';
    const pos = r.Position || r.position || '';
    const overall = Number(r.Overall || r.rank || '');
    const posRank = Number(r['Positional Rank'] || r.pos_rank || '');
    const tier = r.Tier || r.tier || '';
    const ppg = Number(r.PPG || '');
    const bye = r.Bye || '';

    const overallBg = overall ? getGradientColor(overall, 1, 70, 150, false) : '';
    const ppgBg = ppg ? getGradientColor(ppg, 8, 15, 30, false) : '';

    upHtml += `
      <tr class="row-fa">
        <td>${name}</td>
        <td>${pos}</td>
        <td style="background:${overallBg}">${overall || ''}</td>
        <td>${posRank || ''}</td>
        <td>${tier || ''}</td>
        <td style="background:${ppgBg}">${ppg || ''}</td>
        <td>${bye || ''}</td>
      </tr>
    `;
  });

  upHtml += '</tbody></table>';
  upgradeContent.innerHTML = upHtml;
  upgradeCard.style.display = 'block';
}

// --- This Week tab ---

function setupWeekControls() {
  const posSelect = document.getElementById('weekPositionSelect');
  if (!posSelect) return;
  posSelect.onchange = () => renderWeekTab();
}

async function renderWeekTab() {
  const container = document.getElementById('weekContent');
  const posSelect = document.getElementById('weekPositionSelect');
  if (!container) return;

  if (!state.weekByPosition || !Object.keys(state.weekByPosition).length) {
    container.innerHTML = '<div class="muted-text">Upload your This Week CSV to see rankings.</div>';
    return;
  }
  const pos = posSelect?.value || 'QB';
  const data = state.weekByPosition[pos] || [];
  if (!data.length) {
    container.innerHTML = `<div class="muted-text">No data loaded for ${pos}.</div>`;
    return;
  }

  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'data-table';
  const isFlex = pos === 'FLEX';
  const isDst = pos === 'DST';

  let headHtml = '<tr><th>Rank</th><th>Player</th>';
  if (!isDst) headHtml += '<th>Team</th>';
  headHtml += '<th>Opp</th>';
  if (isDst) headHtml += '<th>Spread</th>';
  else headHtml += '<th>Proj</th>';
  if (!isDst) headHtml += '<th>Match</th>';
  if (!isDst && !isFlex) headHtml += '<th>Tier</th>';
  if (isFlex) headHtml += '<th>Pos</th>';
  headHtml += '</tr>';

  table.innerHTML = `<thead>${headHtml}</thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  // Precompute numeric ranges for proj + matchup
  const projVals = data.map(d => d.total).filter(v => !isNaN(v));
  const matchVals = data.map(d => d.matchup).filter(v => !isNaN(v));
  const projMin = Math.min(...projVals, 0);
  const projMax = Math.max(...projVals, 0);
  const projMid = (projMin + projMax) / 2 || projMin || 1;
  const matchMin = Math.min(...matchVals, 1);
  const matchMax = Math.max(...matchVals, 32);
  const matchMid = (matchMin + matchMax) / 2 || matchMin || 1;

  // Ownership mapping
  let ownership = null;
  if (state.currentLeagueId) {
    ownership = state.leagueData[state.currentLeagueId]?.ownership || null;
  }

  const dict = await loadSleeperPlayers();
  const nameIndex = buildNameIndex(dict);

  for (const row of data) {
    const tr = document.createElement('tr');

    let sleeperId = null;
    const key = (row.name || '').toLowerCase().trim();
    if (nameIndex[key]) sleeperId = nameIndex[key][0].player_id;

    let rowClass = '';
    if (ownership && sleeperId && ownership[sleeperId]) {
      if (ownership[sleeperId].isMine) rowClass = 'row-mine';
      else rowClass = '';
    } else if (ownership && sleeperId && !ownership[sleeperId]) {
      rowClass = 'row-fa';
    }
    if (rowClass) tr.classList.add(rowClass);

    const projColor = !isDst && !isNaN(row.total)
      ? getGradientColor(row.total, projMin, projMid, projMax, false)
      : '';
    const matchColor = !isDst && !isNaN(row.matchup)
      ? getGradientColor(row.matchup, matchMin, matchMid, matchMax, true)
      : '';

    let rowHtml = `<td>${row.rank || ''}</td><td>${row.name || ''}</td>`;
    if (!isDst) rowHtml += `<td>${row.team || ''}</td>`;
    rowHtml += `<td>${row.opp || ''}</td>`;
    if (isDst) {
      rowHtml += `<td style="background:${projColor}">${isNaN(row.spread) ? '' : row.spread}</td>`;
    } else {
      rowHtml += `<td style="background:${projColor}">${isNaN(row.total) ? '' : row.total}</td>`;
    }
    if (!isDst) {
      rowHtml += `<td style="background:${matchColor}">${isNaN(row.matchup) ? '' : row.matchup}</td>`;
    }
    if (!isDst && !isFlex) {
      rowHtml += `<td>${row.tier || ''}</td>`;
    }
    if (isFlex) {
      rowHtml += `<td>${row.pos || ''}</td>`;
    }

    tr.innerHTML = rowHtml;
    tbody.appendChild(tr);
  }

  container.appendChild(table);
}

// --- ROS tab ---

async function renderRosTab() {
  const container = document.getElementById('rosContent');
  if (!container) return;
  if (!state.rosData) {
    container.innerHTML = '<div class="muted-text">Upload your ROS CSV to see the big board.</div>';
    return;
  }

  await attachSleeperIdsToRos();
  await loadNflState();

  const rows = [...state.rosData].sort(
    (a, b) => Number(a.Overall || a.rank || 9999) - Number(b.Overall || b.rank || 9999)
  );

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Rank</th>
        <th>Player</th>
        <th>Pos</th>
        <th>Pos Rank</th>
        <th>Tier</th>
        <th>Team</th>
        <th>ROS</th>
        <th>Next 4</th>
        <th>PPG</th>
        <th>Bye</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  const currentWeek = state.nflState?.week || 1;

  let ownership = null;
  if (state.currentLeagueId) {
    ownership = state.leagueData[state.currentLeagueId]?.ownership || null;
  }

  const rosVals = rows
    .map(r => Number(r.ROS || r['ROS']))
    .filter(v => !isNaN(v));
  const nextVals = rows
    .map(r => Number(r['Next 4'] || r.Next4))
    .filter(v => !isNaN(v));
  const ppgVals = rows
    .map(r => Number(r.PPG))
    .filter(v => !isNaN(v));

  const rosMin = Math.min(...rosVals, 1);
  const rosMax = Math.max(...rosVals, 32);
  const rosMid = (rosMin + rosMax) / 2 || rosMin || 1;

  const nextMin = rosMin;
  const nextMax = rosMax;
  const nextMid = rosMid;

  const ppgMin = Math.min(...ppgVals, 5);
  const ppgMax = Math.max(...ppgVals, 30);
  const ppgMid = (ppgMin + ppgMax) / 2 || ppgMin || 1;

  rows.forEach(r => {
    const tr = document.createElement('tr');

    const pid = r.sleeper_id;
    let rowClass = '';
    if (ownership && pid && ownership[pid]) {
      rowClass = ownership[pid].isMine ? 'row-mine' : '';
    } else if (ownership && pid && !ownership[pid]) {
      rowClass = 'row-fa';
    }
    if (rowClass) tr.classList.add(rowClass);

    const rank = Number(r.Overall || r.rank || '');
    const pos = r.Position || r.position || '';
    const posRank = Number(r['Positional Rank'] || r.pos_rank || '');
    const tier = r.Tier || r.tier || '';
    const team = r.Team || r.team || '';
    const ros = Number(r.ROS || r['ROS'] || '');
    const next4 = Number(r['Next 4'] || r.Next4 || '');
    const ppg = Number(r.PPG || '');
    const bye = Number(r.Bye || '');

    const rosBg = !isNaN(ros) ? getGradientColor(ros, rosMin, rosMid, rosMax, true) : '';
    const nextBg = !isNaN(next4) ? getGradientColor(next4, nextMin, nextMid, nextMax, true) : '';
    const ppgBg = !isNaN(ppg) ? getGradientColor(ppg, ppgMin, ppgMid, ppgMax, false) : '';

    let byeHtml = '';
    if (!isNaN(bye) && bye > 0) {
      if (bye < currentWeek) {
        byeHtml = `<span class="bye-cell"><span class="bye-check">✔</span>${bye}</span>`;
      } else if (bye === currentWeek) {
        byeHtml = `<span class="bye-cell"><span class="bye-x">✖</span>${bye}</span>`;
      } else {
        byeHtml = String(bye);
      }
    }

    tr.innerHTML = `
      <td>${isNaN(rank) ? '' : rank}</td>
      <td>${r.Player || r.player || 'Unknown'}</td>
      <td>${pos}</td>
      <td>${isNaN(posRank) ? '' : posRank}</td>
      <td>${tier}</td>
      <td>${team}</td>
      <td style="background:${rosBg}">${isNaN(ros) ? '' : ros}</td>
      <td style="background:${nextBg}">${isNaN(next4) ? '' : next4}</td>
      <td style="background:${ppgBg}">${isNaN(ppg) ? '' : ppg}</td>
      <td>${byeHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll-x';
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

// --- Power Rankings helpers & rendering ---

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

function computePfAndStandingRanks(teams) {
  const pfSource = teams.map(t => ({
    roster_id: t.roster_id,
    pfValue: t.pf
  }));
  const pfRanks = rankArray(pfSource, 'pfValue', false);

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
    weekScores.sort((a, b) => b.pts - a.pts);

    weekScores.forEach((entry, idx) => {
      const rank = idx + 1;
      scoresByRoster[entry.roster_id]?.push(rank);
    });
  });

  const src = teams.map(t => {
    const ranks = scoresByRoster[t.roster_id] || [];
    if (!ranks.length) return { roster_id: t.roster_id, avgPlace: 999 };
    const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    return { roster_id: t.roster_id, avgPlace: avg };
  });

  return rankArray(src, 'avgPlace', true);
}

function computeTop8AndScheduleRanks(teams) {
  const top8Source = [];
  const rosSchedSource = [];

  teams.forEach(team => {
    const rosEntries = (team.players || [])
      .map(pid => findRosByPlayerId(pid))
      .filter(Boolean);

    if (!rosEntries.length) {
      top8Source.push({ roster_id: team.roster_id, top8Score: null });
      rosSchedSource.push({ roster_id: team.roster_id, rosSchedScore: null });
      return;
    }

    const sortedByRos = [...rosEntries].sort((a, b) => {
      const ar = Number(a.Overall || a.rank || 9999);
      const br = Number(b.Overall || b.rank || 9999);
      return ar - br;
    });

    const top8 = sortedByRos.slice(0, 8);
    let top8Score = 0;
    const schedVals = [];

    top8.forEach(p => {
      const rosRank = Number(p.Overall || p.rank || 9999);
      const sched = Number(p.ROS || p['ROS'] || 16);
      if (!isNaN(rosRank)) top8Score += 200 - rosRank;
      if (!isNaN(sched)) schedVals.push(sched);
    });

    const rosAvg = schedVals.length
      ? schedVals.reduce((a, b) => a + b, 0) / schedVals.length
      : 16;

    top8Source.push({ roster_id: team.roster_id, top8Score });
    rosSchedSource.push({ roster_id: team.roster_id, rosSchedScore: rosAvg });
  });

  const top8Ranks = rankArray(top8Source, 'top8Score', false);
  const rosSchedRanks = rankArray(rosSchedSource, 'rosSchedScore', true);

  return { top8Ranks, rosSchedRanks };
}

function computeFinalPowerRanks(teams, metrics) {
  const { pfRanks, standRanks, allPlayRanks, top8Ranks, rosSchedRanks } = metrics;

  const composite = teams.map(t => {
    const rId = t.roster_id;
    const pf = pfRanks.get(rId) || 999;
    const st = standRanks.get(rId) || 999;
    const ap = allPlayRanks.get(rId) || 999;
    const t8 = top8Ranks.get(rId) || 999;
    const rs = rosSchedRanks.get(rId) || 999;
    const score = pf * 0.3 + ap * 0.25 + st * 0.2 + t8 * 0.2 + rs * 0.05;
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

  composite.sort((a, b) => a.compositeScore - b.compositeScore);
  const powerRanks = new Map();
  composite.forEach((item, idx) => {
    powerRanks.set(item.roster_id, idx + 1);
  });
  return powerRanks;
}

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

  let sortedEntries = [...entries];
  const { column, direction } = state.powerSort;
  if (column !== 'rank') {
    sortedEntries.sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return direction === 'asc' ? av - bv : bv - av;
    });
  } else {
    sortedEntries.sort((a, b) => a.rank - b.rank);
  }

  const leagueConfig = getLeagueConfig(leagueId);
  const primaryColor = leagueConfig.primaryColor || '#222631';

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

    tr.innerHTML = `
      <td class="pr-rank">${entry.rank}</td>
      <td class="pr-team">
        <div class="pr-team-pill" style="background:${primaryColor};padding:4px 8px;border-radius:999px;">
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

  const headers = table.querySelectorAll('th[data-sort]');
  headers.forEach(th => {
    const key = th.getAttribute('data-sort');
    th.style.cursor = 'pointer';
    th.onclick = () => {
      if (key === 'rank') {
        state.powerSort = { column: 'rank', direction: 'asc' };
      } else {
        if (state.powerSort.column === key) {
          state.powerSort.direction =
            state.powerSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.powerSort = { column: key, direction: 'asc' };
        }
      }
      renderPowerRankingsTable(leagueId);
    };
  });
}

function buildPresentationOverlay(leagueId) {
  const overlay = document.getElementById('power-presentation-overlay');
  if (!overlay) return;
  const bundle = state.leagueData[leagueId];
  if (!bundle || !bundle.power) return;
  const { teams, entries } = bundle.power;

  const leagueConfig = getLeagueConfig(leagueId);
  const logoUrl = leagueConfig.logoUrl || '';
  const week = state.nflState?.week || 'Current';

  const sortedByRank = [...entries].sort((a, b) => a.rank - b.rank);
  const order = [];
  for (let i = sortedByRank.length - 1; i >= 0; i--) order.push(sortedByRank[i]);

  overlay.innerHTML = `
    <div class="power-present-inner">
      <div class="power-present-content">
        <div id="power-present-slide"></div>
        <button id="power-present-next" class="btn btn-primary">Next</button>
      </div>
    </div>
  `;
  const slideEl = document.getElementById('power-present-slide');
  const nextBtn = document.getElementById('power-present-next');

  let step = -1;

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
      overlay.classList.remove('active');
    }
  };

  step = -1;
  renderStep();
}

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

async function computeAndRenderPowerRankings(leagueId) {
  if (!state.rosData) {
    const tbl = document.getElementById('power-rankings-table');
    if (tbl) {
      tbl.innerHTML = `
        <thead>
          <tr>
            <th>Rank</th><th>Team</th><th>Δ</th>
            <th>PF</th><th>All-Play</th><th>Stand</th>
            <th>ROS Sched</th><th>ROS Top-8</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="9">Upload ROS CSV to generate power rankings.</td></tr>
        </tbody>
      `;
    }
    return;
  }

  await attachSleeperIdsToRos();
  await loadNflState();
  const bundle = await loadLeagueBundle(leagueId);
  const teams = mapRostersWithUsers(bundle);

  const currentWeek = state.nflState?.week || 1;
  const weeks = [];
  for (let w = currentWeek; w > currentWeek - 3 && w > 0; w--) weeks.push(w);
  await loadMatchupsForWeeks(leagueId, weeks);

  const { pfRanks, standRanks } = computePfAndStandingRanks(teams);
  const allPlayRanks = computeAllPlayRanks(teams, bundle.matchupsByWeek, weeks);
  const { top8Ranks, rosSchedRanks } = computeTop8AndScheduleRanks(teams);
  const powerRanks = computeFinalPowerRanks(teams, {
    pfRanks,
    standRanks,
    allPlayRanks,
    top8Ranks,
    rosSchedRanks
  });

  const prev = loadPreviousPowerRanks(leagueId) || [];
  const prevMap = new Map();
  prev.forEach(p => prevMap.set(p.roster_id, p.rank));

  const entries = teams.map(t => {
    const rId = t.roster_id;
    const rank = powerRanks.get(rId) || 999;
    const entry = {
      roster_id: rId,
      rank,
      pfRank: pfRanks.get(rId) || 10,
      standRank: standRanks.get(rId) || 10,
      allPlayRank: allPlayRanks.get(rId) || 10,
      top8Rank: top8Ranks.get(rId) || 10,
      rosSchedRank: rosSchedRanks.get(rId) || 10,
      change: 0,
      notes: ''
    };
    const prevRank = prevMap.get(rId);
    if (typeof prevRank === 'number') {
      entry.change = prevRank - rank;
    } else {
      entry.change = 0;
    }
    entry.notes = buildPowerNote(entry);
    return entry;
  });

  entries.sort((a, b) => a.rank - b.rank);
  bundle.power = { teams, entries };
  saveCurrentPowerRanks(leagueId, entries);

  state.powerSort = { column: 'rank', direction: 'asc' };
  renderPowerRankingsTable(leagueId);
}

// --- Admin config (colors + logos) ---

function setupAdminConfig() {
  const container = document.getElementById('admin-league-config');
  const saveBtn = document.getElementById('admin-save-config');
  if (!container || !saveBtn) return;

  const existing = loadJson('league_config', {});
  container.innerHTML = '';

  LEAGUES.forEach(lg => {
    const conf = existing[lg.id] || {};
    const row = document.createElement('div');
    row.className = 'admin-league-row';
    row.innerHTML = `
      <div class="admin-league-name">${lg.name}</div>
      <label>
        Primary Color (hex)
        <input type="text" class="admin-color" data-league="${lg.id}" value="${conf.primaryColor || '#222631'}" />
      </label>
      <label>
        Logo URL or Path
        <input type="text" class="admin-logo" data-league="${lg.id}" value="${conf.logoUrl || ''}" />
      </label>
    `;
    container.appendChild(row);
  });

  saveBtn.onclick = () => {
    const newConf = {};
    const colorInputs = container.querySelectorAll('.admin-color');
    const logoInputs = container.querySelectorAll('.admin-logo');

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
      renderPowerRankingsTable(state.currentLeagueId);
    }
  };
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  loadNflState();
  setupCsvUpload();
  setupTabs();
  setupLeagueDropdown();
  setupWeekControls();
  setupAdminConfig();
  setupPresentationToggle();
});
