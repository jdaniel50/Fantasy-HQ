// app.js

// CONFIG
const SLEEPER_USERNAME = 'stuckabuc';
const LEAGUE_IDS = [
  '1186844188245356544', // League of Record
  '1186825886808555520', // Dynasty Champs
  '1257084943821967360'  // FFL
];

// STATE
let sleeperState = null;
let playersById = {};
let playersByNameLower = new Map();
let playersBySimpleNameLower = new Map();
let leaguesMap = new Map();
let activeLeagueId = null;
let myUserId = null;

let rosData = [];
let rosByName = new Map();
let weekData = [];

const leagueSelect = document.getElementById('leagueSelect');
const teamSelect = document.getElementById('teamSelect');
const teamsContent = document.getElementById('teamsContent');
const teamOwnerLabel = document.getElementById('teamOwnerLabel');
const upgradeCard = document.getElementElementById?.('upgradeCard') || document.getElementById('upgradeCard');
const upgradeContent = document.getElementById('upgradeContent');
const weekContent = document.getElementById('weekContent');
const rosContent = document.getElementById('rosContent');
const currentSeasonLabel = document.getElementById('currentSeasonLabel');
const currentWeekLabel = document.getElementById('currentWeekLabel');
const weekPositionSelect = document.getElementById('weekPositionSelect');
const refreshSleeperBtn = document.getElementById('refreshSleeperBtn');

const powerTableContainer = document.getElementById('powerTableContainer');
const powerPresentationContainer = document.getElementById('powerPresentationContainer');
const powerPresentationBtn = document.getElementById('powerPresentationBtn');
const powerAdminPanel = document.getElementById('powerAdminPanel');
const powerAdminToggle = document.getElementById('powerAdminToggle');

// New containers for added tabs
const standingsContent = document.getElementById('standingsContent');
const matchupsContent = document.getElementById('matchupsContent');
const matchupWeekSelect = document.getElementById('matchupWeekSelect');

let controlsInitialized = false;

// Power rankings state
let lastPowerRows = [];
let powerRevealOrder = [];
let powerPresentationActive = false;
let powerPresentationStep = -1;

let lastAllPlayDetailByLeague = new Map();

// INIT

document.addEventListener('DOMContentLoaded', () => {
  loadFromLocal();
  initTabs();
  initCsvInputs();
  initControls();
  initSleeper().catch(err => {
    console.error(err);
    leagueSelect.innerHTML = '<option value="">Error loading leagues</option>';
  });
});

// LOCAL STORAGE

function loadFromLocal() {
  try {
    const rosJson = localStorage.getItem('fantasy_ros_data');
    if (rosJson) {
      const parsed = JSON.parse(rosJson);
      if (Array.isArray(parsed)) {
        rosData = parsed;
        rosByName = new Map();
        rosData.forEach(r => {
          if (r && r.player) {
            rosByName.set(r.player.toLowerCase(), r);
          }
        });
      }
    }
    const weekJson = localStorage.getItem('fantasy_week_data');
    if (weekJson) {
      const parsedWeek = JSON.parse(weekJson);
      if (Array.isArray(parsedWeek)) {
        weekData = parsedWeek;
      }
    }
  } catch (e) {
    console.error('Failed to load from localStorage', e);
  }
}

// TABS

function initTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  const tabs = document.querySelectorAll('.tab-content');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.dataset.tab;
      tabs.forEach(tab => {
        if (tab.id === targetId) tab.classList.add('active');
        else tab.classList.remove('active');
      });

      if (targetId === 'teamsTab') renderTeamsTab();
      else if (targetId === 'weekTab') renderWeekTab();
      else if (targetId === 'rosTab') renderRosTab();
      else if (targetId === 'powerTab') renderPowerTab();
      else if (targetId === 'standingsTab') renderStandingsTab();
      else if (targetId === 'matchupsTab') renderMatchupsTab();
    });
  });

  if (weekPositionSelect) {
    weekPositionSelect.addEventListener('change', () => {
      renderWeekTab();
    });
  }
}

// CONTROLS

function initControls() {
  if (controlsInitialized) return;

  leagueSelect.addEventListener('change', () => {
    activeLeagueId = leagueSelect.value || null;
    populateTeamSelect();
    renderTeamsTab();
    renderWeekTab();
    renderRosTab();
    renderPowerTab();
    renderStandingsTab();
    renderMatchupsTab();
  });

  teamSelect.addEventListener('change', () => {
    renderTeamsTab();
  });

  if (refreshSleeperBtn) {
    refreshSleeperBtn.addEventListener('click', async () => {
      await refreshSleeperData();
    });
  }

  if (matchupWeekSelect) {
    matchupWeekSelect.addEventListener('change', () => {
      renderMatchupsTab();
    });
  }

  if (powerPresentationBtn) {
    powerPresentationBtn.addEventListener('click', () => {
      if (!lastPowerRows.length) {
        renderPowerTab().then(() => {
          if (lastPowerRows.length) enterPowerPresentationMode();
        }).catch(() => {});
      } else {
        enterPowerPresentationMode();
      }
    });
  }

  if (powerAdminToggle && powerAdminPanel) {
    powerAdminToggle.addEventListener('click', () => {
      const nowHidden = powerAdminPanel.classList.toggle('hidden');
      if (!nowHidden) {
        renderPowerAdminPanel();
      }
    });
  }

  controlsInitialized = true;
}

// CSV INPUTS

function initCsvInputs() {
  const rosInput = document.getElementById('rosCsvInput');
  const weekInput = document.getElementById('weekCsvInput');

  rosInput.addEventListener('change', () => handleCsvInput(rosInput, 'ros'));
  weekInput.addEventListener('change', () => handleCsvInput(weekInput, 'week'));
}

function handleCsvInput(inputEl, type) {
  const file = inputEl.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;

    if (type === 'ros') {
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false
      });

      if (parsed.errors && parsed.errors.length) {
        console.error(parsed.errors);
        alert(`ROS CSV parse error: ${parsed.errors[0].message}`);
        return;
      }

      const prevMap = new Map();
      rosData.forEach(r => {
        if (!r || !r.player) return;
        const key = r.player.toLowerCase();
        if (!prevMap.has(key) && Number.isFinite(r.rank)) {
          prevMap.set(key, r.rank);
        }
      });

      const newRos = parsed.data.map(normalizeRosRow).filter(r => r.player);
      newRos.forEach(row => {
        const key = row.player.toLowerCase();
        const prevRank = prevMap.get(key);
        if (Number.isFinite(prevRank) && Number.isFinite(row.rank)) {
          row.move = prevRank - row.rank;
        } else {
          row.move = null;
        }
      });

      rosData = newRos;
      rosByName.clear();
      rosData.forEach(row => {
        rosByName.set(row.player.toLowerCase(), row);
      });

      try {
        localStorage.setItem('fantasy_ros_data', JSON.stringify(rosData));
      } catch (e) {
        console.warn('Unable to store ROS data in localStorage', e);
      }

      renderTeamsTab();
      renderRosTab();
      renderPowerTab();
    } else if (type === 'week') {
      const parsed = Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: false
      });

      if (parsed.errors && parsed.errors.length) {
        console.error(parsed.errors);
        alert(`This Week CSV parse error: ${parsed.errors[0].message}`);
        return;
      }

      weekData = buildWeekDataFromRows(parsed.data);

      try {
        localStorage.setItem('fantasy_week_data', JSON.stringify(weekData));
      } catch (e) {
        console.warn('Unable to store week data in localStorage', e);
      }

      renderWeekTab();
    }
  };
  reader.readAsText(file);
}

// ROS NORMALIZATION

function normalizeRosRow(raw) {
  const lowerMap = {};
  Object.entries(raw || {}).forEach(([k, v]) => {
    if (!k) return;
    lowerMap[k.toLowerCase()] = v;
  });

  const getStr = (...names) => {
    for (const n of names) {
      if (lowerMap[n] != null && String(lowerMap[n]).trim() !== '') {
        return String(lowerMap[n]).trim();
      }
    }
    return '';
  };

  const getNum = (...names) => {
    const s = getStr(...names);
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  return {
    rank: getNum('overall', 'rank'),
    player: getStr('player', 'name', 'player_name'),
    position: getStr('position', 'pos').toUpperCase(),
    pos_rank: getNum('positional rank', 'pos_rank', 'position_rank'),
    tier: getNum('tier'),
    move: null,
    team: getStr('team'),
    ros: getNum('ros', 'ros schedule', 'ros_schedule'),
    next4: getNum('next 4', 'next4', 'next_4'),
    ppg: getNum('ppg', 'points per game', 'points_per_game'),
    bye: getNum('bye', 'bye week')
  };
}

// THIS WEEK NORMALIZATION FROM WIDE FORMAT

function buildWeekDataFromRows(rows) {
  if (!rows || rows.length === 0) return [];

  const header = rows[0].map(c => (c || '').trim());
  const dataRows = rows.slice(1);

  const findIndex = (label, from = 0) => header.indexOf(label, from);

  const segments = [];

  const qbNameIdx = findIndex('Quarterback');
  if (qbNameIdx !== -1) {
    segments.push({
      group: 'QB',
      rankIdx: qbNameIdx - 1,
      nameIdx: qbNameIdx,
      teamIdx: qbNameIdx + 1,
      oppIdx: qbNameIdx + 2,
      totalIdx: qbNameIdx + 3,
      matchupIdx: qbNameIdx + 4,
      tierIdx: qbNameIdx + 5,
      posIdx: null,
      fromFlex: false
    });
  }

  const rbNameIdx = findIndex('Running Back');
  if (rbNameIdx !== -1) {
    segments.push({
      group: 'RB',
      rankIdx: rbNameIdx - 1,
      nameIdx: rbNameIdx,
      teamIdx: rbNameIdx + 1,
      oppIdx: rbNameIdx + 2,
      totalIdx: rbNameIdx + 3,
      matchupIdx: rbNameIdx + 4,
      tierIdx: rbNameIdx + 5,
      posIdx: null,
      fromFlex: false
    });
  }

  const wrNameIdx = findIndex('Wide Receiver');
  if (wrNameIdx !== -1) {
    segments.push({
      group: 'WR',
      rankIdx: wrNameIdx - 1,
      nameIdx: wrNameIdx,
      teamIdx: wrNameIdx + 1,
      oppIdx: wrNameIdx + 2,
      totalIdx: wrNameIdx + 3,
      matchupIdx: wrNameIdx + 4,
      tierIdx: wrNameIdx + 5,
      posIdx: null,
      fromFlex: false
    });
  }

  const teNameIdx = findIndex('Tight End');
  if (teNameIdx !== -1) {
    segments.push({
      group: 'TE',
      rankIdx: teNameIdx - 1,
      nameIdx: teNameIdx,
      teamIdx: teNameIdx + 1,
      oppIdx: teNameIdx + 2,
      totalIdx: teNameIdx + 3,
      matchupIdx: teNameIdx + 4,
      tierIdx: teNameIdx + 5,
      posIdx: null,
      fromFlex: false
    });
  }

  const defNameIdx = findIndex('Defense');
  if (defNameIdx !== -1) {
    segments.push({
      group: 'DST',
      rankIdx: defNameIdx - 1,
      nameIdx: defNameIdx,
      teamIdx: null,
      oppIdx: defNameIdx + 1,
      totalIdx: null,
      matchupIdx: defNameIdx + 3,
      tierIdx: defNameIdx + 4,
      posIdx: null,
      fromFlex: false
    });
  }

  const flex1NameIdx = findIndex('FLEX');
  if (flex1NameIdx !== -1) {
    segments.push({
      group: 'FLEX',
      rankIdx: flex1NameIdx - 1,
      nameIdx: flex1NameIdx,
      teamIdx: flex1NameIdx + 1,
      oppIdx: flex1NameIdx + 2,
      totalIdx: flex1NameIdx + 3,
      matchupIdx: flex1NameIdx + 5,
      tierIdx: null,
      posIdx: flex1NameIdx + 4,
      fromFlex: true
    });
  }

  const flex2NameIdx = flex1NameIdx !== -1 ? findIndex('FLEX', flex1NameIdx + 1) : -1;
  if (flex2NameIdx !== -1) {
    segments.push({
      group: 'FLEX',
      rankIdx: flex2NameIdx - 1,
      nameIdx: flex2NameIdx,
      teamIdx: flex2NameIdx + 1,
      oppIdx: flex2NameIdx + 2,
      totalIdx: flex2NameIdx + 3,
      matchupIdx: flex2NameIdx + 5,
      tierIdx: null,
      posIdx: flex2NameIdx + 4,
      fromFlex: true
    });
  }

  const flat = [];

  dataRows.forEach(rowArr => {
    const row = rowArr || [];
    const trimmed = row.map(c => (c || '').toString().trim());
    const allBlank = trimmed.every(c => c === '');
    if (allBlank) return;

    segments.forEach(seg => {
      const name = trimmed[seg.nameIdx] || '';
      if (!name) return;

      const basePos = seg.fromFlex
        ? (trimmed[seg.posIdx] || 'FLEX').toUpperCase()
        : seg.group;

      const group = seg.group;
      const team = seg.teamIdx != null ? (trimmed[seg.teamIdx] || '') : '';
      const opponent = seg.oppIdx != null ? (trimmed[seg.oppIdx] || '') : '';
      const totalStr = seg.totalIdx != null ? trimmed[seg.totalIdx] : '';
      const projPoints = totalStr ? Number(totalStr) : null;

      const matchupStr = seg.matchupIdx != null ? trimmed[seg.matchupIdx] : '';
      const matchupVal = matchupStr ? Number(matchupStr) : null;

      const tierStr = seg.tierIdx != null ? trimmed[seg.tierIdx] : '';
      const tierVal = tierStr ? Number(tierStr) : null;

      const rankStr = seg.rankIdx != null ? trimmed[seg.rankIdx] : '';
      const rankVal = rankStr ? Number(rankStr) : null;

      flat.push({
        player: name,
        team,
        group,
        position: basePos,
        opponent,
        proj_points: Number.isFinite(projPoints) ? projPoints : null,
        matchup: Number.isFinite(matchupVal) ? matchupVal : null,
        tier: Number.isFinite(tierVal) ? tierVal : null,
        rank: Number.isFinite(rankVal) ? rankVal : null
      });
    });
  });

  return flat;
}

// SLEEPER INIT

async function initSleeper() {
  await fetchSleeperCoreData();
  populateLeagueSelect();
  populateTeamSelect();
  renderTeamsTab();
  renderWeekTab();
  renderRosTab();
  await renderPowerTab();
  renderStandingsTab();
  await renderMatchupsTab();
}

async function refreshSleeperData() {
  await fetchSleeperCoreData();
  populateLeagueSelect();
  populateTeamSelect();
  renderTeamsTab();
  renderWeekTab();
  renderRosTab();
  await renderPowerTab();
  renderStandingsTab();
  await renderMatchupsTab();
}

async function fetchSleeperCoreData() {
  const stateRes = await fetch('https://api.sleeper.app/v1/state/nfl');
  sleeperState = await stateRes.json();
  if (sleeperState.season) {
    currentSeasonLabel.textContent = `Season ${sleeperState.season}`;
  }
  if (sleeperState.week) {
    currentWeekLabel.textContent = `Week ${sleeperState.week}`;
  }

  const userRes = await fetch(`https://api.sleeper.app/v1/user/${SLEEPER_USERNAME}`);
  const user = await userRes.json();
  myUserId = user.user_id;

  const playersRes = await fetch('https://api.sleeper.app/v1/players/nfl');
  playersById = await playersRes.json();
  buildPlayersByNameIndex();

  leaguesMap.clear();
  for (const leagueId of LEAGUE_IDS) {
    const infoRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
    const info = await infoRes.json();

    const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
    const rosters = await rostersRes.json();

    const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
    const users = await usersRes.json();

    leaguesMap.set(leagueId, { info, rosters, users });
  }
}

// NAME INDEXING & LOOKUP

function normalizeNameKey(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.replace(/[^a-z\s]/g, ' ');
  n = n.replace(/\b(jr|sr|ii|iii|iv|v|vi)\b/g, '');
  n = n.replace(/\s+/g, ' ').trim();
  const parts = n.split(' ');
  if (parts.length >= 2) {
    n = parts[0] + ' ' + parts[parts.length - 1];
  }
  return n;
}

function buildPlayersByNameIndex() {
  playersByNameLower.clear();
  playersBySimpleNameLower.clear();

  Object.entries(playersById).forEach(([playerId, p]) => {
    const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (!fullName) return;

    const key = fullName.toLowerCase();
    if (!playersByNameLower.has(key)) {
      playersByNameLower.set(key, playerId);
    }

    const simple = normalizeNameKey(fullName);
    if (simple && !playersBySimpleNameLower.has(simple)) {
      playersBySimpleNameLower.set(simple, playerId);
    }
  });
}

function lookupPlayerId(name, meta = {}) {
  if (!name) return null;
  const exactKey = name.toLowerCase();
  const targetPos = meta.position ? meta.position.toUpperCase() : null;
  const targetTeam = meta.team ? meta.team.toUpperCase() : null;

  let pid = playersByNameLower.get(exactKey);
  if (pid) {
    const p = playersById[pid];
    if (p) {
      const posMatch = targetPos ? (p.position === targetPos) : true;
      const teamMatch = targetTeam ? (p.team === targetTeam) : true;
      if (posMatch && teamMatch) {
        return pid;
      }
    }
  }

  const simple = normalizeNameKey(name);
  if (!simple) return null;

  const simpleParts = simple.split(' ');
  const lastName = simpleParts[simpleParts.length - 1] || '';
  const inputFirst = simpleParts[0];

  let bestId = null;
  let bestScore = -1;

  if (lastName) {
    for (const [candidateId, p] of Object.entries(playersById)) {
      const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
      if (!fullName) continue;

      const sleeperSimple = normalizeNameKey(fullName);
      const ssParts = sleeperSimple.split(' ');
      const sleeperLast = ssParts[ssParts.length - 1] || '';
      const sleeperFirst = ssParts[0];

      if (sleeperLast !== lastName) continue;

      let score = 1;

      if (inputFirst && sleeperFirst && inputFirst === sleeperFirst) {
        score += 2;
      }

      if (targetPos && p.position === targetPos) score += 3;
      if (targetTeam && p.team === targetTeam) score += 3;

      if (score > bestScore) {
        bestScore = score;
        bestId = candidateId;
      }
    }
  }

  if (bestId && bestScore >= 2) {
    return bestId;
  }

  return null;
}

// LEAGUE & TEAM SELECT

function populateLeagueSelect() {
  leagueSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a league';
  leagueSelect.appendChild(placeholder);

  const existingIds = [...leaguesMap.keys()];

  existingIds.forEach(id => {
    const info = leaguesMap.get(id)?.info;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = info?.name || `League ${id}`;
    leagueSelect.appendChild(opt);
  });

  if (activeLeagueId && leaguesMap.has(activeLeagueId)) {
    leagueSelect.value = activeLeagueId;
  } else if (existingIds.length) {
    activeLeagueId = existingIds[0];
    leagueSelect.value = activeLeagueId;
  } else {
    activeLeagueId = null;
    leagueSelect.value = '';
  }
}

function populateTeamSelect() {
  teamSelect.innerHTML = '';
  if (!activeLeagueId) {
    teamSelect.innerHTML = '<option value="">Select a league first</option>';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) return;

  const { rosters, users } = league;

  const usersByIdMap = new Map();
  users.forEach(u => usersByIdMap.set(u.user_id, u));

  const teams = rosters.map(r => {
    const ownerUser = usersByIdMap.get(r.owner_id);
    const displayName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      ownerUser?.username ||
      `Team ${r.roster_id}`;
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      displayName,
      isMine: ownerUser?.user_id === myUserId
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (!teams.length) {
    teamSelect.innerHTML = '<option value="">No rosters found</option>';
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a team';
  teamSelect.appendChild(placeholder);

  teams.forEach(team => {
    const o = document.createElement('option');
    o.value = String(team.roster_id);
    o.textContent = team.displayName + (team.isMine ? ' (You)' : '');
    teamSelect.appendChild(o);
  });
}

// TEAMS TAB

function renderTeamsTab() {
  if (!activeLeagueId) {
    teamsContent.innerHTML = '<div class="muted-text">Select a league to view rosters.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) {
    teamsContent.innerHTML = '<div class="muted-text">Unable to load league data.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const rosterIdStr = teamSelect.value;
  if (!rosterIdStr) {
    teamsContent.innerHTML = '<div class="muted-text">Select a team to view its lineup.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const rosterId = Number(rosterIdStr);
  const roster = league.rosters.find(r => r.roster_id === rosterId);
  if (!roster) {
    teamsContent.innerHTML = '<div class="muted-text">Roster not found.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const ownerUser = league.users.find(u => u.user_id === roster.owner_id);
  const ownerName = ownerUser?.display_name || ownerUser?.username || 'Unknown owner';
  teamOwnerLabel.textContent = `Owner: ${ownerName}`;

  const allIds = new Set([
    ...(roster.players || []),
    ...(roster.taxi || []),
    ...(roster.reserve || [])
  ]);
  const allPlayers = [...allIds]
    .filter(id => id && id !== '0')
    .map(playerWithRos)
    .filter(Boolean);

  if (!allPlayers.length) {
    teamsContent.innerHTML = '<div class="muted-text">No players found for this team.</div>';
    if (upgradeCard) upgradeCard.style.display = 'none';
    return;
  }

  const posOrder = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'K', 'IDP'];
  const positionSortKey = p => {
    const idx = posOrder.indexOf(p);
    return idx === -1 ? 99 : idx;
  };

  const sorted = [...allPlayers].sort((a, b) => {
    const pa = positionSortKey(a.position);
    const pb = positionSortKey(b.position);
    if (pa !== pb) return pa - pb;

    const at = a.rosRow?.tier ?? 99;
    const bt = b.rosRow?.tier ?? 99;
    if (at !== bt) return at - bt;

    const ar = a.rosRow?.rank ?? 9999;
    const br = b.rosRow?.rank ?? 9999;
    if (ar !== br) return ar - br;

    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  const table = document.createElement('table');
  table.className = 'table teams-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
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
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  let lastPos = null;

  sorted.forEach(p => {
    if (p.position !== lastPos) {
      const posRow = document.createElement('tr');
      posRow.className = 'position-label-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = p.position || 'Pos';
      posRow.appendChild(td);
      tbody.appendChild(posRow);
      lastPos = p.position;
    }

    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = p.displayName || p.rosRow?.player || p.sleeperName || 'Unknown
