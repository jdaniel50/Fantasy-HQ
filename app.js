// app.js

// CONFIG
const SLEEPER_USERNAME = 'stuckabuc';
const LEAGUE_IDS = ['1186844188245356544', '1186825886808555520'];

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
let weekData = []; // flattened per-player rows from "This Week"

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

// INIT
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCsvInputs();
  initSleeper().catch(err => {
    console.error(err);
    leagueSelect.innerHTML = '<option value="">Error loading leagues</option>';
  });
});

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
      if (targetId === 'weekTab') renderWeekTab();
      if (targetId === 'rosTab') renderRosTab();
    });
  });

  if (weekPositionSelect) {
    weekPositionSelect.addEventListener('change', () => {
      renderWeekTab();
    });
  }
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

      rosData = parsed.data.map(normalizeRosRow).filter(r => r.player);
      rosByName.clear();
      rosData.forEach(row => {
        rosByName.set(row.player.toLowerCase(), row);
      });

      renderTeamsTab();
      renderRosTab();
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
    move: null, // optional; not in your format yet
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

  // QB
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

  // RB
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

  // WR
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

  // TE
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

  // Defense
  const defNameIdx = findIndex('Defense');
  if (defNameIdx !== -1) {
    segments.push({
      group: 'DST',
      rankIdx: defNameIdx - 1,
      nameIdx: defNameIdx,
      teamIdx: null,
      oppIdx: defNameIdx + 1,
      totalIdx: null,
      matchupIdx: defNameIdx + 3, // Spread used as matchup-ish metric
      tierIdx: defNameIdx + 4,
      posIdx: null,
      fromFlex: false
    });
  }

  // FLEX1
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

  // FLEX2
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
      const opponent = seg.oppIdx != null ? (trimmed[seg.oppIdx] || '') : '';
      const totalStr = seg.totalIdx != null ? trimmed[seg.totalIdx] : '';
      const projPoints = totalStr ? Number(totalStr) : null;

      const matchupStr = seg.matchupIdx != null ? trimmed[seg.matchupIdx] : '';
      const matchupVal = matchupStr ? Number(matchupStr) : null;

      const tierStr = seg.tierIdx != null ? trimmed[seg.tierIdx] : '';
      const tierVal = tierStr ? Number(tierStr) : null;

      flat.push({
        player: name,
        group,           // QB/RB/WR/TE/DST/FLEX
        position: basePos, // actual player position (QB/RB/WR/TE/DST/etc)
        opponent,
        proj_points: Number.isFinite(projPoints) ? projPoints : null,
        matchup: Number.isFinite(matchupVal) ? matchupVal : null,
        tier: Number.isFinite(tierVal) ? tierVal : null
      });
    });
  });

  return flat;
}

// SLEEPER INIT
async function initSleeper() {
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

  const leagueOptions = [];
  for (const leagueId of LEAGUE_IDS) {
    const infoRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
    const info = await infoRes.json();

    const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
    const rosters = await rostersRes.json();

    const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
    const users = await usersRes.json();

    leaguesMap.set(leagueId, { info, rosters, users });

    leagueOptions.push({
      id: leagueId,
      name: info.name || `League ${leagueId}`
    });
  }

  populateLeagueSelect(leagueOptions);
}

// NAME INDEXING

function normalizeNameKey(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.replace(/[^a-z\s]/g, ' '); // remove punctuation/digits
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

function lookupPlayerIdByName(name) {
  if (!name) return null;
  const exactKey = name.toLowerCase();
  let pid = playersByNameLower.get(exactKey);
  if (pid) return pid;

  const simple = normalizeNameKey(name);
  if (simple) {
    pid = playersBySimpleNameLower.get(simple);
    if (pid) return pid;
  }

  return null;
}

// LEAGUE SELECT

function populateLeagueSelect(options) {
  leagueSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a league';
  leagueSelect.appendChild(placeholder);

  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.name;
    leagueSelect.appendChild(o);
  });

  leagueSelect.addEventListener('change', () => {
    activeLeagueId = leagueSelect.value || null;
    populateTeamSelect();
    renderTeamsTab();
    renderRosTab();
    renderWeekTab();
  });
}

// TEAMS TAB

function populateTeamSelect() {
  teamSelect.innerHTML = '';
  if (!activeLeagueId) {
    teamSelect.innerHTML = '<option value="">Select a league first</option>';
    return;
  }

  const league = leaguesMap.get(activeLeagueId);
  if (!league) return;

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

  teamSelect.addEventListener('change', () => {
    renderTeamsTab();
  });
}

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

  const sortedByPosThenRank = [...allPlayers].sort((a, b) => {
    const pa = positionSortKey(a.position);
    const pb = positionSortKey(b.position);
    if (pa !== pb) return pa - pb;
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
      <th>POS</th>
      <th>Rank</th>
      <th>Pos Rank</th>
      <th>Tier</th>
      <th>PPG</th>
      <th>BYE</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  let lastPos = null;

  sortedByPosThenRank.forEach(p => {
    if (p.position !== lastPos) {
      const posRow = document.createElement('tr');
      posRow.className = 'position-label-row';
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = p.position;
      posRow.appendChild(td);
      tbody.appendChild(posRow);
      lastPos = p.position;
    }

    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = p.displayName || p.rosRow?.player || p.sleeperName || 'Unknown';
    tr.appendChild(tdName);

    const tdPos = document.createElement('td');
    tdPos.textContent = p.position;
    tr.appendChild(tdPos);

    const tdOverall = document.createElement('td');
    tdOverall.textContent = p.rosRow?.rank ?? '';
    applyOverallRankColor(tdOverall, p.rosRow?.rank);
    tr.appendChild(tdOverall);

    const tdPosRank = document.createElement('td');
    tdPosRank.textContent = p.rosRow?.pos_rank ?? '';
    applyPosRankColor(tdPosRank, p.position, p.rosRow?.pos_rank);
    tr.appendChild(tdPosRank);

    const tdTier = document.createElement('td');
    tdTier.textContent = p.rosRow?.tier ?? '';
    tr.appendChild(tdTier);

    const tdPpg = document.createElement('td');
    tdPpg.textContent = p.rosRow?.ppg ?? '';
    applyProjectionColor(tdPpg, p.rosRow?.ppg, null);
    tr.appendChild(tdPpg);

    const tdBye = document.createElement('td');
    tdBye.textContent = p.rosRow?.bye ?? '';
    applyByeColor(tdBye, p.rosRow?.bye);
    tr.appendChild(tdBye);

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
    const pid = lookupPlayerIdByName(row.player);
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
  table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      <th>Player</th>
      <th>Pos</th>
      <th>Pos Rank</th>
      <th>Tier</th>
      <th>ROS</th>
      <th>Next 4</th>
      <th>PPG</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  topFive.forEach(row => {
    const tr = document.createElement('tr');

    const tdRank = document.createElement('td');
    tdRank.textContent = row.rank ?? '';
    applyOverallRankColor(tdRank, row.rank);
    tr.appendChild(tdRank);

    const tdPlayer = document.createElement('td');
    tdPlayer.textContent = row.player;
    tr.appendChild(tdPlayer);

    const tdPos = document.createElement('td');
    tdPos.textContent = row.position;
    tr.appendChild(tdPos);

    const tdPosRank = document.createElement('td');
    tdPosRank.textContent = row.pos_rank ?? '';
    applyPosRankColor(tdPosRank, row.position, row.pos_rank);
    tr.appendChild(tdPosRank);

    const tdTier = document.createElement('td');
    tdTier.textContent = row.tier ?? '';
    tr.appendChild(tdTier);

    const tdRos = document.createElement('td');
    tdRos.textContent = row.ros ?? '';
    applyScheduleColor(tdRos, row.ros, null);
    tr.appendChild(tdRos);

    const tdNext4 = document.createElement('td');
    tdNext4.textContent = row.next4 ?? '';
    applyScheduleColor(tdNext4, row.next4, null);
    tr.appendChild(tdNext4);

    const tdPpg = document.createElement('td');
    tdPpg.textContent = row.ppg ?? '';
    applyProjectionColor(tdPpg, row.ppg, null);
    tr.appendChild(tdPpg);

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
    if ((a.tier ?? 99) !== (b.tier ?? 99)) {
      return (a.tier ?? 99) - (b.tier ?? 99);
    }
    const ap = a.proj_points ?? 0;
    const bp = b.proj_points ?? 0;
    return bp - ap;
  });

  const table = document.createElement('table');
  table.className = 'table week-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>${posFilter}</th>
      <th>POS</th>
      <th>Opp</th>
      <th>Proj</th>
      <th>Match</h>
      <th>Tier</th>
    </tr>
  `;
  // Fix small typo in header
  thead.innerHTML = `
    <tr>
      <th>${posFilter}</th>
      <th>POS</th>
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

  let prevTier = rows[0]?.tier ?? null;

  let ownershipContext = null;
  if (activeLeagueId) {
    const league = leaguesMap.get(activeLeagueId);
    if (league) {
      ownershipContext = buildOwnershipContext(league);
    }
  }

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');

    if (idx > 0 && r.tier != null && r.tier !== prevTier) {
      tr.classList.add('tier-break-row');
    }
    prevTier = r.tier;

    const tdPlayer = document.createElement('td');
    const status = ownershipContext ? getOwnershipStatus(r.player, ownershipContext) : 'unknown';
    const icon = createOwnershipIcon(status);
    if (icon) tdPlayer.appendChild(icon);
    tdPlayer.appendChild(document.createTextNode(r.player));
    tr.appendChild(tdPlayer);

    const tdPos = document.createElement('td');
    tdPos.textContent = r.position || posFilter;
    tr.appendChild(tdPos);

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
  const table = document.createElement('table');
  table.className = 'table ros-table';

  const hasLeague = !!activeLeagueId;
  const league = hasLeague ? leaguesMap.get(activeLeagueId) : null;

  const teamHeaderCells = [];
  let ownershipContext = null;

  if (hasLeague && league) {
    ownershipContext = buildOwnershipContext(league);
    teamHeaderCells.push('FA', ...ownershipContext.teamNames);
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
      <th>ROS</h>
      <th>Next 4</th>
      <th>PPG</th>
      <th>Bye</th>
      ${teamHeaderCells.map(th => `<th>${th}</th>`).join('')}
    </tr>
  `;
  // small fix "ROS</h>" -> "ROS</th>"
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
      ${teamHeaderCells.map(th => `<th>${th}</th>`).join('')}
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

  sorted.forEach(row => {
    const tr = document.createElement('tr');

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
    tdMove.textContent = row.move ?? '';
    applyMoveColor(tdMove, row.move);
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

    if (ownershipContext) {
      const faCell = document.createElement('td');
      faCell.className = 'cell-fa';
      const ownCells = ownershipContext.teamNames.map(() => {
        const td = document.createElement('td');
        td.className = 'cell-own';
        return td;
      });

      const playerId = lookupPlayerIdByName(row.player);
      if (playerId) {
        const owningRoster = ownershipContext.playerToRoster.get(playerId) ?? null;
        if (!owningRoster) {
          faCell.innerHTML = '<span class="icon-fa">FA</span>';
        } else {
          const idx = ownershipContext.rosterIdToIndex.get(owningRoster);
          if (idx != null) {
            ownCells[idx].innerHTML = '<span class="icon-own">●</span>';
          }
        }
      }

      tr.appendChild(faCell);
      ownCells.forEach(td => tr.appendChild(td));
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);

  rosContent.innerHTML = '';
  rosContent.appendChild(wrapper);

  // Column highlight logic
  if (ownershipContext) {
    const headerRow = thead.querySelector('tr');
    const headerCells = Array.from(headerRow.children);
    const firstTeamColIndex = 10; // 0-based index: FA is col 10 when present

    for (let i = firstTeamColIndex; i < headerCells.length; i++) {
      const cell = headerCells[i];
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => {
        toggleColumnHighlight(table, i);
      });
    }
  }
}

// OWNERSHIP CONTEXT

function buildOwnershipContext(league) {
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

function getOwnershipStatus(playerName, ownershipContext) {
  if (!ownershipContext) return 'unknown';
  const pid = lookupPlayerIdByName(playerName);
  if (!pid) return 'unknown';
  const rosterId = ownershipContext.playerToRoster.get(pid);
  if (!rosterId) return 'FA';
  if (ownershipContext.myRosterIds.has(rosterId)) return 'MINE';
  return 'OTHER';
}

function createOwnershipIcon(status) {
  if (status === 'FA') {
    const span = document.createElement('span');
    span.className = 'icon-fa';
    span.textContent = 'FA';
    return span;
  }
  if (status === 'MINE') {
    const span = document.createElement('span');
    span.className = 'icon-own';
    span.textContent = '●';
    return span;
  }
  return null;
}

// COLUMN HIGHLIGHT

function toggleColumnHighlight(table, colIndex) {
  const rows = table.querySelectorAll('tr');
  let turningOn = true;

  // First check if it's already highlighted
  const firstRowCell = rows[0].children[colIndex];
  if (firstRowCell.classList.contains('col-highlight')) {
    turningOn = false;
  }

  rows.forEach(row => {
    const cells = row.children;
    if (cells[colIndex]) {
      if (turningOn) {
        cells[colIndex].classList.add('col-highlight');
      } else {
        cells[colIndex].classList.remove('col-highlight');
      }
    }
  });
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

function setColorDot(td, color) {
  if (!color) return;
  const existing = td.querySelector('.color-dot');
  if (existing) existing.remove();
  const dot = document.createElement('span');
  dot.className = 'color-dot';
  dot.style.backgroundColor = color;
  td.insertBefore(dot, td.firstChild);
}

// Overall rank gradient: 1 green, 55 yellow, 125 red
function applyOverallRankColor(td, rank) {
  if (!rank || rank === 0) return;

  let color;
  if (rank <= 1) {
    color = 'hsl(120, 70%, 40%)';
  } else if (rank >= 125) {
    color = 'hsl(0, 70%, 50%)';
  } else if (rank <= 55) {
    const t = (rank - 1) / (55 - 1);
    const hue = 120 - (120 - 60) * t; // 120 -> 60
    color = `hsl(${hue}, 70%, 45%)`;
  } else {
    const t = (rank - 55) / (125 - 55);
    const hue = 60 - 60 * t; // 60 -> 0
    color = `hsl(${hue}, 70%, 45%)`;
  }
  setColorDot(td, color);
}

// Position rank thresholds
function applyPosRankColor(td, position, rank) {
  if (!rank || rank === 0) return;

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
  setColorDot(td, color);
}

// Projections: higher = green, lowest = red, median = yellow
function applyProjectionColor(td, value, summary) {
  if (!isFinite(value) || !summary) return;
  const { min, median, max } = summary;
  if (!isFinite(min) || !isFinite(max) || min === max) return;

  let color;
  if (value === max) {
    color = 'hsl(120, 70%, 40%)';
  } else if (value === min) {
    color = 'hsl(0, 70%, 50%)';
  } else if (value === median) {
    color = 'hsl(50, 100%, 65%)';
  } else if (value > median) {
    const t = (value - median) / (max - median || 1);
    const lightness = 80 - 25 * t; // 80 -> 55
    color = `hsl(120, 70%, ${lightness}%)`;
  } else {
    const t = (median - value) / (median - min || 1);
    const lightness = 80 - 25 * t;
    color = `hsl(0, 70%, ${lightness}%)`;
  }
  setColorDot(td, color);
}

// Matchup / schedule: lower = green, higher = red, median = yellow
function applyMatchupColor(td, value, summary) {
  if (!isFinite(value) || !summary) return;
  const { min, median, max } = summary;
  if (!isFinite(min) || !isFinite(max) || min === max) return;

  let color;
  if (value === min) {
    color = 'hsl(120, 70%, 40%)';
  } else if (value === max) {
    color = 'hsl(0, 70%, 50%)';
  } else if (value === median) {
    color = 'hsl(50, 100%, 65%)';
  } else if (value < median) {
    const t = (median - value) / (median - min || 1);
    const lightness = 80 - 25 * t;
    color = `hsl(120, 70%, ${lightness}%)`;
  } else {
    const t = (value - median) / (max - median || 1);
    const lightness = 80 - 25 * t;
    color = `hsl(0, 70%, ${lightness}%)`;
  }
  setColorDot(td, color);
}

function applyScheduleColor(td, value, summary) {
  if (!isFinite(value)) return;
  if (!summary) {
    // assume 1-32 scale
    const tmpSummary = summarizeSeries([1, 16, 32]);
    applyMatchupColor(td, value, tmpSummary);
  } else {
    applyMatchupColor(td, value, summary);
  }
}

// Move: 1/2/3 green shades, -1/-2/-3 red shades
function applyMoveColor(td, move) {
  if (!Number.isFinite(move)) return;
  if (move === 0) return;

  let color;
  if (move > 0) {
    const level = Math.min(move, 3);
    const lightness = 80 - (level - 1) * 10;
    color = `hsl(120, 70%, ${lightness}%)`;
  } else {
    const level = Math.min(-move, 3);
    const lightness = 80 - (level - 1) * 10;
    color = `hsl(0, 70%, ${lightness}%)`;
  }
  setColorDot(td, color);
}

// Bye: this week = red, past = green, future = yellow
function applyByeColor(td, byeWeek) {
  if (!sleeperState || !Number.isFinite(byeWeek)) return;
  const currentWeek = Number(sleeperState.week);
  if (!Number.isFinite(currentWeek)) return;

  let color;
  if (byeWeek === currentWeek) {
    color = 'hsl(0, 70%, 50%)';
  } else if (byeWeek < currentWeek) {
    color = 'hsl(120, 70%, 40%)';
  } else {
    color = 'hsl(50, 100%, 65%)';
  }
  setColorDot(td, color);
}
