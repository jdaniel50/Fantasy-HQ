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
const upgradeCard = document.getElementById('upgradeCard');
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

let controlsInitialized = false;

// Power rankings state
let lastPowerRows = [];
let powerRevealOrder = [];
let powerPresentationActive = false;
let powerPresentationStep = -1;

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
      renderStandingsTab();
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
  renderMatchupsTab();
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
  renderMatchupsTab();
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
    upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) {
    teamsContent.innerHTML = '<div class="muted-text">Unable to load league data.</div>';
    upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const rosterIdStr = teamSelect.value;
  if (!rosterIdStr) {
    teamsContent.innerHTML = '<div class="muted-text">Select a team to view its lineup.</div>';
    upgradeCard.style.display = 'none';
    teamOwnerLabel.textContent = '';
    return;
  }

  const rosterId = Number(rosterIdStr);
  const roster = league.rosters.find(r => r.roster_id === rosterId);
  if (!roster) {
    teamsContent.innerHTML = '<div class="muted-text">Roster not found.</div>';
    upgradeCard.style.display = 'none';
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
    upgradeCard.style.display = 'none';
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
    tdName.textContent = p.displayName || p.rosRow?.player || p.sleeperName || 'Unknown';
    tr.appendChild(tdName);

    const tdRank = document.createElement('td');
    tdRank.textContent = p.rosRow?.rank ?? '';
    applyOverallRankColor(tdRank, p.rosRow?.rank);
    tr.appendChild(tdRank);

    const tdPosRank = document.createElement('td');
    tdPosRank.textContent = p.rosRow?.pos_rank ?? '';
    applyPosRankColor(tdPosRank, p.position, p.rosRow?.pos_rank);
    tr.appendChild(tdPosRank);

    const tdTier = document.createElement('td');
    tdTier.textContent = p.rosRow?.tier ?? '';
    tr.appendChild(tdTier);

    const tdPpg = document.createElement('td');
    tdPpg.textContent = p.rosRow?.ppg ?? '';
    tr.appendChild(tdPpg);

    const tdBye = document.createElement('td');
    tdBye.textContent = p.rosRow?.bye ?? '';
    applyByeColor(tdBye, p.rosRow?.bye);
    tr.appendChild(tdBye);

    const tdRos = document.createElement('td');
    tdRos.textContent = p.rosRow?.ros ?? '';
    applyScheduleColor(tdRos, p.rosRow?.ros, null);
    tr.appendChild(tdRos);

    const tdNext4 = document.createElement('td');
    tdNext4.textContent = p.rosRow?.next4 ?? '';
    applyScheduleColor(tdNext4, p.rosRow?.next4, null);
    tr.appendChild(tdNext4);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  teamsContent.innerHTML = '';
  teamsContent.appendChild(table);

  const isMyTeam = roster.owner_id === myUserId;
  if (isMyTeam && rosData.length) {
    const ownershipContext = buildOwnershipContext(league);
    renderTopFreeAgents(ownershipContext);
  } else {
    upgradeCard.style.display = 'none';
  }
}

function playerWithRos(playerId) {
  const p = playersById[playerId];
  if (!p) return null;
  const name = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  if (!name) return null;
  const key = name.toLowerCase();
  const rosRow = rosByName.get(key) || null;
  const pos = rosRow?.position || p.position || 'FLEX';
  return {
    playerId,
    sleeperName: name,
    displayName: name,
    rosRow,
    position: pos
  };
}

function renderTopFreeAgents(ownershipContext) {
  const freeAgents = [];

  rosData.forEach(row => {
    const pid = lookupPlayerId(row.player, { position: row.position, team: row.team });
    if (!pid) return;
    if (!ownershipContext.playerToRoster.has(pid)) {
      freeAgents.push(row);
    }
  });

  if (!freeAgents.length) {
    upgradeContent.innerHTML = '<div class="muted-text">No free agents found based on your ROS file and this league.</div>';
    upgradeCard.style.display = 'block';
    return;
  }

  freeAgents.sort((a, b) => {
    const ar = a.rank ?? 9999;
    const br = b.rank ?? 9999;
    return ar - br;
  });

  const topFive = freeAgents.slice(0, 5);

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
  topFive.forEach(row => {
    const tr = document.createElement('tr');

    const tdPlayer = document.createElement('td');
    tdPlayer.textContent = row.player;
    tr.appendChild(tdPlayer);

    const tdRank = document.createElement('td');
    tdRank.textContent = row.rank ?? '';
    applyOverallRankColor(tdRank, row.rank);
    tr.appendChild(tdRank);

    const tdPosRank = document.createElement('td');
    tdPosRank.textContent = row.pos_rank ?? '';
    applyPosRankColor(tdPosRank, row.position, row.pos_rank);
    tr.appendChild(tdPosRank);

    const tdTier = document.createElement('td');
    tdTier.textContent = row.tier ?? '';
    tr.appendChild(tdTier);

    const tdPpg = document.createElement('td');
    tdPpg.textContent = row.ppg ?? '';
    tr.appendChild(tdPpg);

    const tdBye = document.createElement('td');
    tdBye.textContent = row.bye ?? '';
    applyByeColor(tdBye, row.bye);
    tr.appendChild(tdBye);

    const tdRos = document.createElement('td');
    tdRos.textContent = row.ros ?? '';
    applyScheduleColor(tdRos, row.ros, null);
    tr.appendChild(tdRos);

    const tdNext4 = document.createElement('td');
    tdNext4.textContent = row.next4 ?? '';
    applyScheduleColor(tdNext4, row.next4, null);
    tr.appendChild(tdNext4);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  upgradeContent.innerHTML = '';
  upgradeContent.appendChild(table);
  upgradeCard.style.display = 'block';
}

// THIS WEEK TAB

function renderWeekTab() {
  if (!weekData.length) {
    weekContent.innerHTML = '<div class="muted-text">Upload your This Week CSV to see positional tables.</div>';
    return;
  }

  const grouped = {};
  weekData.forEach(row => {
    const g = row.group || row.position || 'FLEX';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(row);
  });

  const posFilter = weekPositionSelect ? (weekPositionSelect.value || 'QB') : 'QB';
  const rows = grouped[posFilter] || [];

  if (!rows.length) {
    weekContent.innerHTML = `<div class="muted-text">No data for ${posFilter} in this week's CSV.</div>`;
    return;
  }

  rows.sort((a, b) => {
    const ar = a.rank;
    const br = b.rank;
    if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) {
      return ar - br;
    }
    if (Number.isFinite(ar) && !Number.isFinite(br)) return -1;
    if (!Number.isFinite(ar) && Number.isFinite(br)) return 1;

    const at = a.tier ?? 99;
    const bt = b.tier ?? 99;
    if (at !== bt) return at - bt;

    const ap = a.proj_points ?? 0;
    const bp = b.proj_points ?? 0;
    return bp - ap;
  });

  const table = document.createElement('table');
  table.className = 'table week-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      <th>${posFilter}</th>
      <th>Opp</th>
      <th>Proj</th>
      <th>Match</th>
      <th>Tier</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  const projVals = rows.map(r => r.proj_points).filter(isFinite);
  const matchupVals = rows.map(r => r.matchup).filter(isFinite);

  const projSummary = summarizeSeries(projVals);
  const matchupSummary = summarizeSeries(matchupVals);

  let ownershipContext = null;
  if (activeLeagueId) {
    const league = leaguesMap.get(activeLeagueId);
    if (league) {
      ownershipContext = buildOwnershipContext(league);
    }
  }

  let lastTier = null;

  rows.forEach(r => {
    const tr = document.createElement('tr');

    if (ownershipContext) {
      const status = getOwnershipStatus(r.player, r.position, r.team, ownershipContext);
      if (status === 'MINE') tr.classList.add('row-mine');
      else if (status === 'FA') tr.classList.add('row-fa');
    }

    if (r.tier != null && r.tier !== lastTier) {
      const tierRow = document.createElement('tr');
      tierRow.className = 'tier-label-row';
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = `Tier ${r.tier}`;
      tierRow.appendChild(td);
      tbody.appendChild(tierRow);
      lastTier = r.tier;
    }

    const tdRank = document.createElement('td');
    tdRank.textContent = r.rank ?? '';
    tr.appendChild(tdRank);

    const tdPlayer = document.createElement('td');
    tdPlayer.textContent = r.player;
    tr.appendChild(tdPlayer);

    const tdOpp = document.createElement('td');
    tdOpp.textContent = r.opponent;
    tr.appendChild(tdOpp);

    const tdProj = document.createElement('td');
    tdProj.textContent = r.proj_points ?? '';
    applyProjectionColor(tdProj, r.proj_points, projSummary);
    tr.appendChild(tdProj);

    const tdMatch = document.createElement('td');
    tdMatch.textContent = r.matchup ?? '';
    applyMatchupColor(tdMatch, r.matchup, matchupSummary);
    tr.appendChild(tdMatch);

    const tdTier = document.createElement('td');
    tdTier.textContent = r.tier ?? '';
    tr.appendChild(tdTier);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  weekContent.innerHTML = '';
  weekContent.appendChild(table);
}

// ROS TAB

function renderRosTab() {
  if (!rosData.length) {
    rosContent.innerHTML = '<div class="muted-text">Upload your ROS CSV to see the big board.</div>';
    return;
  }

  const sorted = [...rosData].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  const wrapper = document.createElement('div');
  wrapper.className = 'table-section';

  const table = document.createElement('table');
  table.className = 'table ros-table';

  let ownershipContext = null;
  if (activeLeagueId) {
    const league = leaguesMap.get(activeLeagueId);
    if (league) {
      ownershipContext = buildOwnershipContext(league);
    }
  }

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      <th>Player</th>
      <th>Pos</th>
      <th>Pos Rank</th>
      <th>Tier</th>
      <th>Move</th>
      <th>ROS</th>
      <th>Next 4</th>
      <th>PPG</th>
      <th>Bye</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  const rosVals = sorted.map(r => r.ros).filter(isFinite);
  const next4Vals = sorted.map(r => r.next4).filter(isFinite);
  const ppgVals = sorted.map(r => r.ppg).filter(isFinite);

  const rosSummary = summarizeSeries(rosVals);
  const next4Summary = summarizeSeries(next4Vals);
  const ppgSummary = summarizeSeries(ppgVals);

  let lastTier = null;

  sorted.forEach(row => {
    const tr = document.createElement('tr');

    if (ownershipContext) {
      const status = getOwnershipStatus(row.player, row.position, row.team, ownershipContext);
      if (status === 'MINE') tr.classList.add('row-mine');
      else if (status === 'FA') tr.classList.add('row-fa');
    }

    if (row.tier != null && row.tier !== lastTier) {
      const tierRow = document.createElement('tr');
      tierRow.className = 'tier-label-row';
      const td = document.createElement('td');
      td.colSpan = 10;
      td.textContent = `Tier ${row.tier}`;
      tierRow.appendChild(td);
      tbody.appendChild(tierRow);
      lastTier = row.tier;
    }

    const tdRank = document.createElement('td');
    tdRank.textContent = row.rank ?? '';
    tr.appendChild(tdRank);

    const tdPlayer = document.createElement('td');
    tdPlayer.textContent = row.player;
    tr.appendChild(tdPlayer);

    const tdPos = document.createElement('td');
    tdPos.textContent = row.position;
    tr.appendChild(tdPos);

    const tdPosRank = document.createElement('td');
    tdPosRank.textContent = row.pos_rank ?? '';
    tr.appendChild(tdPosRank);

    const tdTier = document.createElement('td');
    tdTier.textContent = row.tier ?? '';
    tr.appendChild(tdTier);

    const tdMove = document.createElement('td');
    setMoveCell(tdMove, row.move);
    tr.appendChild(tdMove);

    const tdRos = document.createElement('td');
    tdRos.textContent = row.ros ?? '';
    applyScheduleColor(tdRos, row.ros, rosSummary);
    tr.appendChild(tdRos);

    const tdNext4 = document.createElement('td');
    tdNext4.textContent = row.next4 ?? '';
    applyScheduleColor(tdNext4, row.next4, next4Summary);
    tr.appendChild(tdNext4);

    const tdPpg = document.createElement('td');
    tdPpg.textContent = row.ppg ?? '';
    applyProjectionColor(tdPpg, row.ppg, ppgSummary);
    tr.appendChild(tdPpg);

    const tdBye = document.createElement('td');
    tdBye.textContent = row.bye ?? '';
    applyByeColor(tdBye, row.bye);
    tr.appendChild(tdBye);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);

  rosContent.innerHTML = '';
  rosContent.appendChild(wrapper);
}

// POWER RANKINGS TAB

async function renderPowerTab() {
  if (!powerTableContainer) return;

  if (!activeLeagueId) {
    powerTableContainer.innerHTML = '<div class="muted-text">Select a league to view power rankings.</div>';
    return;
  }

  if (!rosData.length) {
    powerTableContainer.innerHTML = '<div class="muted-text">Upload your ROS CSV to generate power rankings.</div>';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) {
    powerTableContainer.innerHTML = '<div class="muted-text">Unable to load league data.</div>';
    return;
  }

  powerTableContainer.innerHTML = '<div class="muted-text">Calculating power rankings...</div>';

  try {
    const powerRows = await computePowerRankingsForLeague(activeLeagueId);

    if (!powerRows || !powerRows.length) {
      powerTableContainer.innerHTML = '<div class="muted-text">Not enough data to compute power rankings.</div>';
      return;
    }

    const prevKey = `fantasy_power_prev_${activeLeagueId}`;
    let prevMap = new Map();
    try {
      const prevJson = localStorage.getItem(prevKey);
      if (prevJson) {
        const prevArr = JSON.parse(prevJson);
        if (Array.isArray(prevArr)) {
          prevArr.forEach(p => {
            if (p && p.roster_id != null && p.rank != null) {
              prevMap.set(p.roster_id, p.rank);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Error reading previous power ranks', e);
    }

    // Sort by final powerScore and assign rank
    powerRows.sort((a, b) => a.powerScore - b.powerScore);
    powerRows.forEach((row, idx) => {
      row.rank = idx + 1;
    });

    // Compute change and summaries
    const numTeams = powerRows.length;
    powerRows.forEach(row => {
      const prevRank = prevMap.get(row.roster_id);
      if (Number.isFinite(prevRank)) {
        row.change = prevRank - row.rank;
      } else {
        row.change = null;
      }
      row.summary = buildPowerSummary(row, numTeams);
    });

    try {
      const toStore = powerRows.map(r => ({ roster_id: r.roster_id, rank: r.rank }));
      localStorage.setItem(prevKey, JSON.stringify(toStore));
    } catch (e) {
      console.warn('Error storing power ranks', e);
    }

    lastPowerRows = powerRows;
    powerRevealOrder = [...powerRows].sort((a, b) => b.rank - a.rank);

    const table = document.createElement('table');
    table.className = 'table power-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Rank</th>
        <th>Team</th>
        <th>Change</th>
        <th>Standing</th>
        <th>All-Play</th>
        <th>ROS</th>
        <th>Schedule</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    powerRows.forEach(row => {
      const tr = document.createElement('tr');

      const colorMeta = getTeamColorMeta(row.teamName, activeLeagueId);

      const tdRank = document.createElement('td');
      tdRank.textContent = row.rank;
      tdRank.classList.add('power-rank-cell');
      tr.appendChild(tdRank);

      const tdTeam = document.createElement('td');
      tdTeam.textContent = row.teamName;
      tdTeam.classList.add('power-team-cell');
      tdTeam.style.background = colorMeta.gradient;
      tdTeam.style.color = '#ffffff';
      tr.appendChild(tdTeam);

      const tdChange = document.createElement('td');
      if (!Number.isFinite(row.change) || row.change === 0) {
        tdChange.textContent = '–';
      } else if (row.change > 0) {
        tdChange.textContent = `▲${row.change}`;
        tdChange.style.color = '#00D26A';
      } else {
        tdChange.textContent = `▼${Math.abs(row.change)}`;
        tdChange.style.color = '#E74C3C';
      }
      tr.appendChild(tdChange);

      const tdStanding = document.createElement('td');
      tdStanding.textContent = row.standingRank ?? '';
      tr.appendChild(tdStanding);

      const tdAllPlay = document.createElement('td');
      tdAllPlay.textContent = row.allPlayRank ?? '';
      tr.appendChild(tdAllPlay);

      const tdRos = document.createElement('td');
      tdRos.textContent = row.rosRank ?? '';
      tr.appendChild(tdRos);

      const tdSchedule = document.createElement('td');
      tdSchedule.textContent = row.scheduleRank ?? '';
      tr.appendChild(tdSchedule);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    powerTableContainer.innerHTML = '';
    powerTableContainer.appendChild(table);

    if (powerAdminPanel && !powerAdminPanel.classList.contains('hidden')) {
      renderPowerAdminPanel();
    }
  } catch (e) {
    console.error(e);
    powerTableContainer.innerHTML = '<div class="muted-text">Error calculating power rankings.</div>';
  }
}

// STANDINGS TAB

function renderStandingsTab() {
  if (!standingsContent) return;

  if (!activeLeagueId) {
    standingsContent.innerHTML = '<div class="muted-text">Select a league to view standings.</div>';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) {
    standingsContent.innerHTML = '<div class="muted-text">Unable to load league data.</div>';
    return;
  }

  const { rosters, users } = league;
  if (!rosters || !rosters.length) {
    standingsContent.innerHTML = '<div class="muted-text">No teams found in this league.</div>';
    return;
  }

  const usersById = new Map();
  users.forEach(u => usersById.set(u.user_id, u));

  const standingsMap = computeStandingRanks(league);
  const pointsMap = computePointsForRanks(league);

  const rows = rosters.map(r => {
    const ownerUser = usersById.get(r.owner_id);
    const displayName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      ownerUser?.username ||
      `Team ${r.roster_id}`;
    const isMine = ownerUser?.user_id === myUserId;
    const s = r.settings || {};
    const wins = Number(s.wins ?? 0);
    const losses = Number(s.losses ?? 0);
    const ties = Number(s.ties ?? 0);
    const fpts = Number(s.fpts ?? 0);
    const fptsDec = Number(s.fpts_decimal ?? 0);
    const pf = fpts + fptsDec / 100;
    const fptsAgainst = Number(s.fpts_against ?? 0);
    const fptsAgainstDec = Number(s.fpts_against_decimal ?? 0);
    const pa = fptsAgainst + fptsAgainstDec / 100;
    const rank = standingsMap.get(r.roster_id) ?? 999;
    const pointsRank = pointsMap.get(r.roster_id) ?? 999;

    return {
      roster_id: r.roster_id,
      displayName,
      isMine,
      wins,
      losses,
      ties,
      pf,
      pa,
      rank,
      pointsRank
    };
  });

  rows.sort((a, b) => a.rank - b.rank);

  const table = document.createElement('table');
  table.className = 'table standings-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      <th>Team</th>
      <th>Record</th>
      <th>PF</th>
      <th>PA</th>
      <th>PF Rank</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (row.isMine) {
      tr.classList.add('row-mine');
    }

    const tdRank = document.createElement('td');
    tdRank.textContent = row.rank;
    tr.appendChild(tdRank);

    const tdTeam = document.createElement('td');
    tdTeam.textContent = row.displayName;
    tr.appendChild(tdTeam);

    const tdRecord = document.createElement('td');
    const record = `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`;
    tdRecord.textContent = record;
    tr.appendChild(tdRecord);

    const tdPf = document.createElement('td');
    tdPf.textContent = row.pf.toFixed(2);
    tr.appendChild(tdPf);

    const tdPa = document.createElement('td');
    tdPa.textContent = row.pa.toFixed(2);
    tr.appendChild(tdPa);

    const tdPfRank = document.createElement('td');
    tdPfRank.textContent = row.pointsRank;
    tr.appendChild(tdPfRank);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  standingsContent.innerHTML = '';
  standingsContent.appendChild(table);
}

// MATCHUPS TAB

async function renderMatchupsTab() {
  if (!matchupsContent) return;

  if (!activeLeagueId) {
    matchupsContent.innerHTML = '<div class="muted-text">Select a league to view matchups.</div>';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) {
    matchupsContent.innerHTML = '<div class="muted-text">Unable to load league data.</div>';
    return;
  }

  const currentWeek = Number(sleeperState?.week ?? 0);
  if (!currentWeek) {
    matchupsContent.innerHTML = '<div class="muted-text">Current NFL week is not available yet.</div>';
    return;
  }

  matchupsContent.innerHTML = '<div class="muted-text">Loading matchups...</div>';

  const { rosters, users } = league;
  const usersById = new Map();
  users.forEach(u => usersById.set(u.user_id, u));

  const rosterMetaById = new Map();
  rosters.forEach(r => {
    const ownerUser = usersById.get(r.owner_id);
    const displayName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      ownerUser?.username ||
      `Team ${r.roster_id}`;
    const isMine = ownerUser?.user_id === myUserId;
    const s = r.settings || {};
    const wins = Number(s.wins ?? 0);
    const losses = Number(s.losses ?? 0);
    const ties = Number(s.ties ?? 0);
    const fpts = Number(s.fpts ?? 0);
    const fptsDec = Number(s.fpts_decimal ?? 0);
    const pf = fpts + fptsDec / 100;

    rosterMetaById.set(r.roster_id, {
      roster_id: r.roster_id,
      displayName,
      isMine,
      wins,
      losses,
      ties,
      pf
    });
  });

  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeagueId}/matchups/${currentWeek}`);
    const matchups = await res.json();

    if (!Array.isArray(matchups) || !matchups.length) {
      matchupsContent.innerHTML = '<div class="muted-text">No matchup data found for this week.</div>';
      return;
    }

    const pods = new Map();
    matchups.forEach(m => {
      const mid = m.matchup_id;
      if (mid == null) return;
      if (!pods.has(mid)) pods.set(mid, []);
      pods.get(mid).push(m);
    });

    const rows = [];
    pods.forEach(group => {
      const teams = group
        .filter(m => m.roster_id != null)
        .map(m => rosterMetaById.get(m.roster_id))
        .filter(Boolean);

      if (!teams.length) return;

      const isMyMatch = teams.some(t => t.isMine);
      rows.push({ teams, isMyMatch });
    });

    if (!rows.length) {
      matchupsContent.innerHTML = '<div class="muted-text">No head-to-head matchups scheduled for this week.</div>';
      return;
    }

    // Sort with your matchup first, then alphabetically
    rows.sort((a, b) => {
      if (a.isMyMatch && !b.isMyMatch) return -1;
      if (!a.isMyMatch && b.isMyMatch) return 1;
      const nameA = a.teams[0]?.displayName || '';
      const nameB = b.teams[0]?.displayName || '';
      return nameA.localeCompare(nameB);
    });

    const table = document.createElement('table');
    table.className = 'table matchups-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Matchup (Week ${currentWeek})</th>
        <th>Records</th>
        <th>Points For</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    rows.forEach(row => {
      const tr = document.createElement('tr');
      if (row.isMyMatch) {
        tr.classList.add('row-mine');
      }

      const names = row.teams.map(t => t.displayName).join(' vs ');
      const records = row.teams
        .map(t => `${t.displayName}: ${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}`)
        .join(' | ');
      const pointsFor = row.teams
        .map(t => `${t.displayName}: ${t.pf.toFixed(2)}`)
        .join(' | ');

      const tdMatch = document.createElement('td');
      tdMatch.textContent = names;
      tr.appendChild(tdMatch);

      const tdRecord = document.createElement('td');
      tdRecord.textContent = records;
      tr.appendChild(tdRecord);

      const tdPf = document.createElement('td');
      tdPf.textContent = pointsFor;
      tr.appendChild(tdPf);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    matchupsContent.innerHTML = '';
    matchupsContent.appendChild(table);
  } catch (e) {
    console.error('Error loading matchups', e);
    matchupsContent.innerHTML = '<div class="muted-text">Error loading matchups for this week.</div>';
  }
}

// TEAM COLORS & LOGOS STORAGE

function loadTeamColors(leagueId) {
  try {
    const raw = localStorage.getItem(`fantasy_team_colors_${leagueId}`);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function saveTeamColors(leagueId, colorsObj) {
  try {
    localStorage.setItem(`fantasy_team_colors_${leagueId}`, JSON.stringify(colorsObj));
  } catch (e) {
    console.warn('Unable to store team colors', e);
  }
}

function loadLeagueLogo(leagueId) {
  try {
    return localStorage.getItem(`fantasy_league_logo_${leagueId}`) || null;
  } catch {
    return null;
  }
}

function saveLeagueLogo(leagueId, dataUrl) {
  try {
    localStorage.setItem(`fantasy_league_logo_${leagueId}`, dataUrl);
  } catch (e) {
    console.warn('Unable to store league logo', e);
  }
}

// ADMIN PANEL (POWER TAB)

function renderPowerAdminPanel() {
  if (!powerAdminPanel) return;

  if (!activeLeagueId) {
    powerAdminPanel.innerHTML = '<div class="admin-panel-title">Admin</div><div class="muted-text">Select a league to edit settings.</div>';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) {
    powerAdminPanel.innerHTML = '<div class="admin-panel-title">Admin</div><div class="muted-text">Unable to load league data.</div>';
    return;
  }

  const { rosters, users } = league;
  const usersById = new Map();
  users.forEach(u => usersById.set(u.user_id, u));

  const teams = rosters.map(r => {
    const ownerUser = usersById.get(r.owner_id);
    const displayName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      ownerUser?.username ||
      `Team ${r.roster_id}`;
    return {
      roster_id: r.roster_id,
      displayName
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));

  const colors = loadTeamColors(activeLeagueId);
  const logoUrl = loadLeagueLogo(activeLeagueId);

  const wrapper = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'admin-panel-title';
  title.textContent = 'League Settings';
  wrapper.appendChild(title);

  const logoRow = document.createElement('div');
  logoRow.className = 'admin-logo-wrapper';

  const logoPreview = document.createElement('img');
  logoPreview.className = 'admin-logo-preview';
  if (logoUrl) {
    logoPreview.src = logoUrl;
  } else {
    logoPreview.alt = 'No logo uploaded';
  }
  logoRow.appendChild(logoPreview);

  const logoControls = document.createElement('div');
  const logoLabel = document.createElement('div');
  logoLabel.style.fontSize = '11px';
  logoLabel.style.color = 'var(--text-secondary)';
  logoLabel.textContent = 'League Logo (used in Presentation intro)';
  const logoInput = document.createElement('input');
  logoInput.type = 'file';
  logoInput.accept = 'image/*';
  logoInput.style.fontSize = '11px';
  logoInput.addEventListener('change', () => {
    const file = logoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      saveLeagueLogo(activeLeagueId, dataUrl);
      logoPreview.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

  logoControls.appendChild(logoLabel);
  logoControls.appendChild(logoInput);
  logoRow.appendChild(logoControls);
  wrapper.appendChild(logoRow);

  const title2 = document.createElement('div');
  title2.className = 'admin-panel-title';
  title2.textContent = 'Team Colors (used in Power Rankings & Presentation)';
  wrapper.appendChild(title2);

  const table = document.createElement('table');
  table.className = 'admin-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Team</th><th>Color</th><th>Preview</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  teams.forEach(team => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = team.displayName;
    tr.appendChild(tdName);

    const tdInput = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'admin-color-input';
    input.placeholder = '#123456';
    input.value = colors[team.displayName] || '';
    tdInput.appendChild(input);
    tr.appendChild(tdInput);

    const tdPreview = document.createElement('td');
    const preview = document.createElement('div');
    preview.className = 'admin-color-preview';
    if (colors[team.displayName]) {
      preview.style.background = colors[team.displayName];
    } else {
      preview.style.background = 'transparent';
    }
    tdPreview.appendChild(preview);
    tr.appendChild(tdPreview);

    input.addEventListener('change', () => {
      let value = input.value.trim();
      if (value && !value.startsWith('#')) {
        value = '#' + value;
      }
      if (!/^#[0-9a-fA-F]{3,6}$/.test(value)) {
        input.style.borderColor = '#E74C3C';
        return;
      }
      input.style.borderColor = '#30354a';
      colors[team.displayName] = value;
      preview.style.background = value;
      saveTeamColors(activeLeagueId, colors);
      renderPowerTab();
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);

  powerAdminPanel.innerHTML = '';
  powerAdminPanel.appendChild(wrapper);
}

// PRESENTATION MODE

function enterPowerPresentationMode() {
  if (!lastPowerRows.length) return;

  powerPresentationActive = true;
  powerPresentationStep = -1;

  if (powerTableContainer) powerTableContainer.classList.add('hidden');
  if (powerAdminPanel) powerAdminPanel.classList.add('hidden');
  if (powerPresentationContainer) powerPresentationContainer.classList.remove('hidden');

  powerPresentationContainer.innerHTML = `
    <div class="presentation-inner">
      <div id="powerSlides" class="presentation-slides"></div>
      <button id="powerNextBtn" class="btn btn-primary presentation-next-btn">Next</button>
    </div>
  `;

  const nextBtn = document.getElementById('powerNextBtn');
  const slides = document.getElementById('powerSlides');

  nextBtn.addEventListener('click', () => {
    handlePowerNext(slides, nextBtn);
  });
}

function exitPowerPresentationMode() {
  powerPresentationActive = false;
  powerPresentationStep = -1;
  if (powerPresentationContainer) {
    powerPresentationContainer.classList.add('hidden');
    powerPresentationContainer.innerHTML = '';
  }
  if (powerTableContainer) powerTableContainer.classList.remove('hidden');
}

function handlePowerNext(slidesContainer, nextBtn) {
  if (!slidesContainer) return;

  const totalTeams = powerRevealOrder.length;

  if (powerPresentationStep === -1) {
    const intro = document.createElement('div');
    intro.className = 'presentation-slide presentation-intro';

    const logoUrl = loadLeagueLogo(activeLeagueId);
    if (logoUrl) {
      const img = document.createElement('img');
      img.src = logoUrl;
      img.alt = 'League logo';
      img.className = 'presentation-logo';
      intro.appendChild(img);
    }

    const title = document.createElement('div');
    title.className = 'presentation-title';
    title.textContent = 'Week ' + (sleeperState?.week ?? '') + ' Power Rankings';
    intro.appendChild(title);

    slidesContainer.appendChild(intro);

    powerPresentationStep = 0;
    return;
  }

  if (powerPresentationStep < totalTeams) {
    const row = powerRevealOrder[powerPresentationStep];

    const slide = document.createElement('div');
    slide.className = 'presentation-slide';

    const header = document.createElement('div');
    header.className = 'presentation-team-header';

    const rankEl = document.createElement('div');
    rankEl.className = 'presentation-team-rank';
    rankEl.textContent = row.rank;
    header.appendChild(rankEl);

    const nameEl = document.createElement('div');
    nameEl.className = 'presentation-team-name';
    nameEl.textContent = row.teamName;
    header.appendChild(nameEl);

    slide.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'presentation-team-meta';
    const changeText = (!Number.isFinite(row.change) || row.change === 0)
      ? 'No change'
      : row.change > 0
        ? `Up ${row.change}`
        : `Down ${Math.abs(row.change)}`;
    meta.textContent = `Standing: ${row.standingRank} • All-Play: ${row.allPlayRank} • ${changeText}`;
    slide.appendChild(meta);

    const starsBlock = document.createElement('div');
    starsBlock.className = 'presentation-stars-block';
    starsBlock.innerHTML = `
      <div>Scoring Output: ${starsToGlyph(row.scoringStars)}</div>
      <div>Schedule Outlook: ${starsToGlyph(row.scheduleStars)}</div>
      <div>Standing Strength: ${starsToGlyph(row.standingStars)}</div>
      <div>Recent Form (All-Play): ${starsToGlyph(row.allPlayStars)}</div>
    `;
    slide.appendChild(starsBlock);

    if (row.summary) {
      const notesLabel = document.createElement('div');
      notesLabel.className = 'presentation-notes-label';
      notesLabel.textContent = 'Summary';
      slide.appendChild(notesLabel);

      const notesBody = document.createElement('div');
      notesBody.className = 'presentation-notes-text';
      notesBody.textContent = row.summary;
      slide.appendChild(notesBody);
    }

    const colorMeta = getTeamColorMeta(row.teamName, activeLeagueId);
    slide.style.background = `linear-gradient(135deg, ${colorMeta.headerDark}, ${colorMeta.headerLight})`;

    slidesContainer.insertBefore(slide, slidesContainer.children[1] || null);

    powerPresentationStep += 1;

    if (powerPresentationStep === totalTeams) {
      nextBtn.textContent = 'Exit Presentation Mode';
    }

    return;
  }

  exitPowerPresentationMode();
}

// TEAM COLOR META

function getTeamColorMeta(teamName, leagueId) {
  const defaultHue = hashStringToHue(teamName || '');
  let baseColor = `hsl(${defaultHue}, 70%, 40%)`;

  if (leagueId) {
    const colors = loadTeamColors(leagueId);
    if (colors && colors[teamName]) {
      baseColor = colors[teamName];
    }
  }

  let headerDark = baseColor;
  let headerLight = baseColor;

  if (baseColor.startsWith('#')) {
    const { r, g, b } = hexToRgb(baseColor);
    headerDark = `rgba(${r}, ${g}, ${b}, 0.85)`;
    headerLight = `rgba(${r}, ${g}, ${b}, 1)`;
  } else {
    headerDark = baseColor;
    headerLight = baseColor;
  }

  const gradient = `linear-gradient(90deg, ${headerDark} 0%, ${headerLight} 55%, transparent 100%)`;
  return { headerDark, headerLight, gradient };
}

function hashStringToHue(str) {
  let hash = 0;
  const s = str || 'team';
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  const hue = (hash % 360 + 360) % 360;
  return hue;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

// POWER RANKINGS CALC

async function computePowerRankingsForLeague(leagueId) {
  const league = leaguesMap.get(leagueId);
  if (!league) return [];

  const { rosters, users } = league;
  if (!rosters || !rosters.length) return [];

  const usersByIdMap = new Map();
  users.forEach(u => usersByIdMap.set(u.user_id, u));

  const teamInfos = rosters.map(r => {
    const ownerUser = usersByIdMap.get(r.owner_id);
    const displayName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      ownerUser?.username ||
      `Team ${r.roster_id}`;
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      displayName
    };
  });

  // ROS + schedule scores based on top 8 players (combined ROS/Next 4)
  const rosScores = new Map();
  const scheduleScores = new Map();
  rosters.forEach(r => {
    const { rosScore, scheduleScore } = calcTeamRosAndScheduleScore(r);
    rosScores.set(r.roster_id, rosScore);
    scheduleScores.set(r.roster_id, scheduleScore);
  });

  const rosRankByRoster = new Map();
  const sortedRos = [...rosScores.entries()].sort((a, b) => a[1] - b[1]);
  let rosRankCounter = 1;
  sortedRos.forEach(([rid]) => {
    rosRankByRoster.set(rid, rosRankCounter++);
  });

  const scheduleRankByRoster = new Map();
  const sortedSched = [...scheduleScores.entries()].sort((a, b) => a[1] - b[1]); // lower scheduleScore = easier
  let schedRankCounter = 1;
  sortedSched.forEach(([rid]) => {
    scheduleRankByRoster.set(rid, schedRankCounter++);
  });

  const standingRanks = computeStandingRanks(league);
  const allPlayRanks = await computeAllPlayRanks(leagueId, league);
  const pointsForRanks = computePointsForRanks(league);

  const numTeams = rosters.length;
  const results = [];

  teamInfos.forEach(info => {
    const rid = info.roster_id;
    const rosRank = rosRankByRoster.get(rid) ?? numTeams;
    const standingRank = standingRanks.get(rid) ?? numTeams;
    const allPlayRank = allPlayRanks.get(rid) ?? Math.ceil(numTeams / 2);
    const scheduleRank = scheduleRankByRoster.get(rid) ?? Math.ceil(numTeams / 2);
    const pointsRank = pointsForRanks.get(rid) ?? Math.ceil(numTeams / 2);

    const scoringRank = Math.round((rosRank + pointsRank) / 2);
    const scoringStars = rankToStars(scoringRank, numTeams);
    const scheduleStars = rankToStars(scheduleRank, numTeams);
    const standingStars = rankToStars(standingRank, numTeams);
    const allPlayStars = rankToStars(allPlayRank, numTeams);

    // Main power score (lower is better)
    const powerScore = 0.4 * rosRank + 0.3 * standingRank + 0.3 * allPlayRank;

    results.push({
      roster_id: rid,
      teamName: info.displayName,
      rosRank,
      scheduleRank,
      standingRank,
      allPlayRank,
      scoringRank,
      pointsRank,
      rosScore: rosScores.get(rid),
      scheduleScore: scheduleScores.get(rid),
      scoringStars,
      scheduleStars,
      standingStars,
      allPlayStars,
      powerScore
    });
  });

  return results;
}

// Calculate top-8 ROS rank and combined schedule score
function calcTeamRosAndScheduleScore(roster) {
  const allIds = new Set([
    ...(roster.players || []),
    ...(roster.taxi || []),
    ...(roster.reserve || [])
  ]);

  const rows = [];
  allIds.forEach(pid => {
    const p = playersById[pid];
    if (!p) return;
    const name = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (!name) return;
    const row = rosByName.get(name.toLowerCase());
    if (!row || !Number.isFinite(row.rank)) return;
    rows.push(row);
  });

  if (!rows.length) {
    return { rosScore: Infinity, scheduleScore: Infinity };
  }

  rows.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const limit = Math.min(8, rows.length);
  const top = rows.slice(0, limit);

  const avgRosRank = top.reduce((sum, r) => sum + (r.rank ?? 9999), 0) / limit;

  const schedVals = [];
  top.forEach(r => {
    if (Number.isFinite(r.ros)) schedVals.push(r.ros);
    if (Number.isFinite(r.next4)) schedVals.push(r.next4);
  });

  let scheduleScore;
  if (!schedVals.length) {
    scheduleScore = 16; // middle-of-the-road
  } else {
    scheduleScore = schedVals.reduce((s, v) => s + v, 0) / schedVals.length;
  }

  return { rosScore: avgRosRank, scheduleScore };
}

// Legacy helper kept for compatibility if needed
function calcTeamRosScore(roster) {
  const { rosScore } = calcTeamRosAndScheduleScore(roster);
  return rosScore;
}

function computeStandingRanks(league) {
  const { rosters } = league;
  const arr = rosters.map(r => {
    const s = r.settings || {};
    const wins = Number(s.wins ?? 0);
    const losses = Number(s.losses ?? 0);
    const ties = Number(s.ties ?? 0);
    const fpts = Number(s.fpts ?? 0);
    const fptsDec = Number(s.fpts_decimal ?? 0);
    const points = fpts + fptsDec / 100;
    return {
      roster_id: r.roster_id,
      wins,
      losses,
      ties,
      points
    };
  });

  arr.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.points !== b.points) return b.points - a.points;
    return a.roster_id - b.roster_id;
  });

  const map = new Map();
  arr.forEach((entry, idx) => {
    map.set(entry.roster_id, idx + 1);
  });
  return map;
}

function computePointsForRanks(league) {
  const { rosters } = league;
  const arr = rosters.map(r => {
    const s = r.settings || {};
    const fpts = Number(s.fpts ?? 0);
    const fptsDec = Number(s.fpts_decimal ?? 0);
    const points = fpts + fptsDec / 100;
    return {
      roster_id: r.roster_id,
      points
    };
  });

  arr.sort((a, b) => b.points - a.points);

  const map = new Map();
  arr.forEach((entry, idx) => {
    map.set(entry.roster_id, idx + 1);
  });
  return map;
}

async function computeAllPlayRanks(leagueId, league) {
  const { rosters } = league;
  const rosterIds = rosters.map(r => r.roster_id);

  const ranksPerRoster = new Map();
  rosterIds.forEach(id => ranksPerRoster.set(id, []));

  const currentWeek = Number(sleeperState?.week ?? 0);
  if (!currentWeek) return new Map();

  const weeks = [];
  for (let w = currentWeek; w >= 1 && weeks.length < 3; w--) {
    weeks.push(w);
  }

  for (const w of weeks) {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`);
      const matchups = await res.json();
      if (!Array.isArray(matchups) || !matchups.length) continue;

      const pointsByRoster = new Map();
      matchups.forEach(m => {
        if (m.roster_id != null) {
          pointsByRoster.set(m.roster_id, Number(m.points ?? 0));
        }
      });

      const weekArr = rosterIds.map(rid => ({
        roster_id: rid,
        points: pointsByRoster.has(rid) ? pointsByRoster.get(rid) : 0
      }));

      weekArr.sort((a, b) => b.points - a.points);
      weekArr.forEach((entry, idx) => {
        const list = ranksPerRoster.get(entry.roster_id);
        if (list) list.push(idx + 1);
      });
    } catch (e) {
      console.warn('Error fetching matchups for week', w, e);
    }
  }

  const avgPosByRoster = new Map();
  rosterIds.forEach(rid => {
    const list = ranksPerRoster.get(rid) || [];
    if (!list.length) {
      avgPosByRoster.set(rid, rosterIds.length / 2);
    } else {
      const avg = list.reduce((s, v) => s + v, 0) / list.length;
      avgPosByRoster.set(rid, avg);
    }
  });

  const sorted = [...avgPosByRoster.entries()].sort((a, b) => a[1] - b[1]);
  const rankByRoster = new Map();
  sorted.forEach(([rid], idx) => {
    rankByRoster.set(rid, idx + 1);
  });

  return rankByRoster;
}

// OWNERSHIP CONTEXT

function buildOwnershipContext(league) {
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
    const isMine = ownerUser?.user_id === myUserId;
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      displayName,
      isMine
    };
  });

  teams.sort((a, b) => {
    if (a.isMine && !b.isMine) return -1;
    if (!a.isMine && b.isMine) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const teamNames = teams.map(t => t.displayName + (t.isMine ? ' (You)' : ''));
  const rosterIdToIndex = new Map();
  teams.forEach((t, idx) => rosterIdToIndex.set(t.roster_id, idx));

  const myRosterIds = new Set(teams.filter(t => t.isMine).map(t => t.roster_id));

  const playerToRoster = new Map();
  rosters.forEach(r => {
    const allPlayers = new Set([
      ...(r.players || []),
      ...(r.taxi || []),
      ...(r.reserve || [])
    ]);
    allPlayers.forEach(pid => {
      if (!playerToRoster.has(pid)) {
        playerToRoster.set(pid, r.roster_id);
      }
    });
  });

  return { teamNames, rosterIdToIndex, playerToRoster, myRosterIds };
}

function getOwnershipStatus(playerName, position, team, ownershipContext) {
  if (!ownershipContext) return 'unknown';
  const pid = lookupPlayerId(playerName, { position, team });
  if (!pid) return 'unknown';
  const rosterId = ownershipContext.playerToRoster.get(pid);
  if (!rosterId) return 'FA';
  if (ownershipContext.myRosterIds.has(rosterId)) return 'MINE';
  return 'OTHER';
}

// UTILITIES & COLOR HELPERS

function summarizeSeries(values) {
  if (!values.length) {
    return { min: null, median: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const midIdx = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[midIdx]
    : (sorted[midIdx - 1] + sorted[midIdx]) / 2;
  return { min, median, max };
}

function setCellColor(td, color) {
  if (!color) return;
  td.classList.add('col-badge');
  td.style.background = `linear-gradient(135deg, ${color}, rgba(0,0,0,0.35))`;
  td.style.color = '#ffffff';
}

// Overall rank gradient: best (1) green -> mid yellow -> worst red
function applyOverallRankColor(td, rank) {
  if (!Number.isFinite(rank) || rank === 0) return;

  let color;
  if (rank <= 1) {
    color = 'hsl(120, 70%, 40%)';
  } else if (rank >= 125) {
    color = 'hsl(0, 70%, 50%)';
  } else if (rank <= 55) {
    const t = (rank - 1) / (55 - 1);
    const hue = 120 - (120 - 60) * t;
    color = `hsl(${hue}, 70%, 45%)`;
  } else {
    const t = (rank - 55) / (125 - 55);
    const hue = 60 - 60 * t;
    color = `hsl(${hue}, 70%, 45%)`;
  }
  setCellColor(td, color);
}

// Position rank thresholds
function applyPosRankColor(td, position, rank) {
  if (!Number.isFinite(rank) || rank === 0) return;

  let mid, max;
  const pos = position.toUpperCase();
  if (pos === 'QB' || pos === 'TE') {
    mid = 11;
    max = 21;
  } else if (pos === 'RB' || pos === 'WR') {
    mid = 21;
    max = 51;
  } else {
    mid = 21;
    max = 51;
  }

  let color;
  if (rank <= 1) {
    color = 'hsl(120, 70%, 40%)';
  } else if (rank >= max) {
    color = 'hsl(0, 70%, 50%)';
  } else if (rank <= mid) {
    const t = (rank - 1) / (mid - 1);
    const hue = 120 - (120 - 60) * t;
    color = `hsl(${hue}, 70%, 45%)`;
  } else {
    const t = (rank - mid) / (max - mid);
    const hue = 60 - 60 * t;
    color = `hsl(${hue}, 70%, 45%)`;
  }
  setCellColor(td, color);
}

// Projections / PPG: higher = green, lowest = red, median golden
function applyProjectionColor(td, value, summary) {
  if (!Number.isFinite(value) || !summary) return;
  const { min, median, max } = summary;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;

  let color;
  if (value === max) {
    color = 'hsl(120, 70%, 40%)';
  } else if (value === min) {
    color = 'hsl(0, 70%, 50%)';
  } else if (value === median) {
    color = 'hsl(50, 100%, 60%)';
  } else if (value > median) {
    const t = (value - median) / (max - median || 1);
    const hue = 80 + (120 - 80) * t;
    const lightness = 75 - 25 * t;
    color = `hsl(${hue}, 70%, ${lightness}%)`;
  } else {
    const t = (median - value) / (median - min || 1);
    const hue = 50 - 50 * t;
    const lightness = 75 - 25 * t;
    color = `hsl(${hue}, 70%, ${lightness}%)`;
  }
  setCellColor(td, color);
}

// Matchup / schedule: lower = green, higher = red, median golden
function applyMatchupColor(td, value, summary) {
  if (!Number.isFinite(value) || !summary) return;
  const { min, median, max } = summary;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;

  let color;
  if (value === min) {
    color = 'hsl(120, 70%, 40%)';
  } else if (value === max) {
    color = 'hsl(0, 70%, 50%)';
  } else if (value === median) {
    color = 'hsl(50, 100%, 60%)';
  } else if (value < median) {
    const t = (median - value) / (median - min || 1);
    const hue = 80 + (120 - 80) * t;
    const lightness = 75 - 25 * t;
    color = `hsl(${hue}, 70%, ${lightness}%)`;
  } else {
    const t = (value - median) / (max - median || 1);
    const hue = 50 - 50 * t;
    const lightness = 75 - 25 * t;
    color = `hsl(${hue}, 70%, ${lightness}%)`;
  }
  setCellColor(td, color);
}

function applyScheduleColor(td, value, summary) {
  if (!Number.isFinite(value)) return;
  if (!summary) {
    const tmpSummary = summarizeSeries([1, 16, 32]);
    applyMatchupColor(td, value, tmpSummary);
  } else {
    applyMatchupColor(td, value, summary);
  }
}

function setMoveCell(td, move) {
  if (!Number.isFinite(move) || move === 0) {
    td.textContent = '';
    return;
  }
  const dirUp = move > 0;
  const magnitude = Math.abs(move);
  const arrow = dirUp ? '↑' : '↓';
  td.textContent = `${arrow} ${magnitude}`;

  const capped = Math.min(magnitude, 3);
  const lightness = 80 - (capped - 1) * 10;
  const color = dirUp
    ? `hsl(120, 70%, ${lightness}%)`
    : `hsl(0, 70%, ${lightness}%)`;
  setCellColor(td, color);
}

// Bye: this week = red X, past = green check, future = number only
function applyByeColor(td, byeWeek) {
  if (!sleeperState || !Number.isFinite(byeWeek)) return;
  const currentWeek = Number(sleeperState.week);
  if (!Number.isFinite(currentWeek)) return;

  if (byeWeek === currentWeek) {
    td.innerHTML = `<span style="color:#E74C3C;">❌</span> ${byeWeek}`;
  } else if (byeWeek < currentWeek) {
    td.innerHTML = `<span style="color:#00D26A;">✔</span> ${byeWeek}`;
  } else {
    td.textContent = String(byeWeek);
  }
}

// Power helpers

function rankToStars(rank, numTeams) {
  if (!Number.isFinite(rank) || !numTeams) return 3;
  const pct = rank / numTeams;
  if (pct <= 0.2) return 5;
  if (pct <= 0.4) return 4;
  if (pct <= 0.6) return 3;
  if (pct <= 0.8) return 2;
  return 1;
}

function starsToGlyph(n) {
  const clamped = Math.max(1, Math.min(5, n || 3));
  const full = '★'.repeat(clamped);
  const empty = '☆'.repeat(5 - clamped);
  return full + empty;
}

function buildPowerSummary(row, numTeams) {
  const parts = [];

  if (row.scoringStars >= 4) {
    parts.push('Strong scoring profile with top-tier roster talent.');
  } else if (row.scoringStars <= 2) {
    parts.push('Limited scoring ceiling compared to the league leaders.');
  }

  if (row.scheduleStars >= 4) {
    parts.push('Favorable schedule ahead should help maintain or improve this spot.');
  } else if (row.scheduleStars <= 2) {
    parts.push('Challenging schedule could make it harder to climb the standings.');
  }

  if (row.standingRank <= 3) {
    parts.push('Current record reflects a clear contender.');
  } else if (row.standingRank >= numTeams - 1) {
    parts.push('Needs wins soon to stay in the playoff hunt.');
  }

  if (row.allPlayStars >= 4) {
    parts.push('Recent form has been strong based on all-play results.');
  } else if (row.allPlayStars <= 2) {
    parts.push('Recent all-play results show some inconsistency.');
  }

  if (!parts.length) {
    return 'Solid middle-of-the-pack profile with room to move in either direction.';
  }

  return parts.join(' ');
}
