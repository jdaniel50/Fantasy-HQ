// app.js

// ------------ CONFIG -------------
const SLEEPER_USERNAME = 'stuckabuc';
const LEAGUE_IDS = ['1186844188245356544', '1186825886808555520'];

// ------------ APP STATE ----------
let sleeperState = null;            // current NFL state (week, season)
let playersById = {};               // Sleeper players map
let playersByNameLower = new Map(); // "ceee dee lamb" => player_id
let leaguesMap = new Map();         // leagueId => { info, rosters, users }
let activeLeagueId = null;
let myUserId = null;

// CSV data
let rosData = [];        // array of ROS rows
let rosByName = new Map();
let weekData = [];       // array of this-week rows

// DOM references
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

// ------------ INIT ---------------
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCsvInputs();
  initSleeper().catch(err => {
    console.error(err);
    leagueSelect.innerHTML = `<option value="">Error loading leagues</option>`;
  });
});

// ------------ TABS ---------------
function initTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  const tabs = document.querySelectorAll('.tab-content');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.dataset.tab;
      tabs.forEach(tab => {
        tab.id === targetId ? tab.classList.add('active') : tab.classList.remove('active');
      });

      // re-render active tab in case data changed
      if (targetId === 'teamsTab') renderTeamsTab();
      if (targetId === 'weekTab') renderWeekTab();
      if (targetId === 'rosTab') renderRosTab();
    });
  });
}

// ------------ CSV HANDLERS -------
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
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true
    });

    if (parsed.errors && parsed.errors.length) {
      console.error(parsed.errors);
      alert(`Error parsing CSV: ${parsed.errors[0].message}`);
      return;
    }

    if (type === 'ros') {
      rosData = parsed.data.map(normalizeRosRow);
      rosByName.clear();
      rosData.forEach(row => {
        if (row.player) rosByName.set(row.player.toLowerCase(), row);
      });
      renderTeamsTab();
      renderRosTab();
    } else {
      weekData = parsed.data.map(normalizeWeekRow);
      renderWeekTab();
    }
  };
  reader.readAsText(file);
}

// Expected ROS headers: rank,player,position,pos_rank,tier,move,ros,next4,ppg,bye
function normalizeRosRow(raw) {
  const safe = key => (raw[key] ?? '').toString().trim();
  const toNum = (key) => {
    const v = safe(key);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    rank: toNum('rank'),
    player: safe('player'),
    position: safe('position').toUpperCase(),
    pos_rank: toNum('pos_rank'),
    tier: toNum('tier'),
    move: toNum('move'),
    ros: toNum('ros'),     // schedule difficulty 1 - 32
    next4: toNum('next4'), // schedule difficulty 1 - 32
    ppg: toNum('ppg'),
    bye: toNum('bye')
  };
}

// Expected Week headers: player,position,opponent,proj_points,matchup,tier
function normalizeWeekRow(raw) {
  const safe = key => (raw[key] ?? '').toString().trim();
  const toNum = (key) => {
    const v = safe(key);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    player: safe('player'),
    position: safe('position').toUpperCase(),
    opponent: safe('opponent'),
    proj_points: toNum('proj_points'),
    matchup: toNum('matchup'),
    tier: toNum('tier')
  };
}

// ------------ SLEEPER INIT -------
async function initSleeper() {
  // 1) Get global state (season, week)
  const stateRes = await fetch('https://api.sleeper.app/v1/state/nfl');
  sleeperState = await stateRes.json();
  if (sleeperState.season) {
    currentSeasonLabel.textContent = `Season ${sleeperState.season}`;
  }
  if (sleeperState.week) {
    currentWeekLabel.textContent = `Week ${sleeperState.week}`;
  }

  // 2) Get user by username
  const userRes = await fetch(`https://api.sleeper.app/v1/user/${SLEEPER_USERNAME}`);
  const user = await userRes.json();
  myUserId = user.user_id;

  // 3) Get players
  const playersRes = await fetch('https://api.sleeper.app/v1/players/nfl');
  playersById = await playersRes.json();
  buildPlayersByNameIndex();

  // 4) Load leagues, rosters, users
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

function buildPlayersByNameIndex() {
  playersByNameLower.clear();
  Object.entries(playersById).forEach(([playerId, p]) => {
    const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (fullName) {
      const key = fullName.toLowerCase();
      if (!playersByNameLower.has(key)) {
        playersByNameLower.set(key, playerId);
      }
    }
  });
}

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
  });
}

// ------------ TEAMS TAB ----------
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
    const displayName = ownerUser?.metadata?.team_name ||
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

  // Use starters only for the main lineup
  const starterIds = (roster.starters || []).filter(id => id && id !== '0');
  const starterPlayers = starterIds.map(pid => playerWithRos(pid)).filter(Boolean);

  if (!starterPlayers.length) {
    teamsContent.innerHTML = '<div class="muted-text">No starters found for this team.</div>';
    upgradeCard.style.display = 'none';
    return;
  }

  const grouped = groupByPosition(starterPlayers);
  const container = document.createElement('div');

  ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
    const players = grouped[pos] || [];
    if (!players.length) return;

    const label = document.createElement('div');
    label.className = 'position-label';
    label.textContent = pos;
    container.appendChild(label);

    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Player</th>
        <th>Overall ROS</th>
        <th>Pos Rank</th>
        <th>Tier</th>
        <th>PPG</th>
        <th>Bye</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    players.forEach(p => {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = p.displayName || p.rosRow?.player || p.sleeperName || 'Unknown';
      tr.appendChild(tdName);

      const tdOverall = document.createElement('td');
      tdOverall.textContent = p.rosRow?.rank ?? '';
      applyOverallRankColor(tdOverall, p.rosRow?.rank);
      tr.appendChild(tdOverall);

      const tdPosRank = document.createElement('td');
      tdPosRank.textContent = p.rosRow?.pos_rank ?? '';
      applyPosRankColor(tdPosRank, pos, p.rosRow?.pos_rank);
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

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  });

  teamsContent.innerHTML = '';
  teamsContent.appendChild(container);

  // Upgrade candidates only for your roster
  const isMyTeam = roster.owner_id === myUserId;
  if (isMyTeam && rosData.length) {
    renderUpgradeTable(starterPlayers);
  } else {
    upgradeCard.style.display = 'none';
  }
}

// Returns { displayName, sleeperName, rosRow, pos }
function playerWithRos(playerId) {
  const p = playersById[playerId];
  if (!p) return null;
  const name = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
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

function groupByPosition(players) {
  const grouped = {};
  players.forEach(p => {
    const pos = p.position || 'FLEX';
    if (!grouped[pos]) grouped[pos] = [];
    grouped[pos].push(p);
  });
  return grouped;
}

function renderUpgradeTable(starterPlayers) {
  // Worst (highest) pos_rank for each position among starters
  const worstByPos = {};
  starterPlayers.forEach(p => {
    const pos = p.position;
    const rank = p.rosRow?.pos_rank;
    if (!rank || rank <= 0) return;
    if (!worstByPos[pos] || rank > worstByPos[pos]) {
      worstByPos[pos] = rank;
    }
  });

  const candidates = [];
  rosData.forEach(row => {
    const pos = row.position;
    const worst = worstByPos[pos];
    if (!worst) return;
    if (row.pos_rank && row.pos_rank > 0 && row.pos_rank < worst) {
      candidates.push(row);
    }
  });

  if (!candidates.length) {
    upgradeContent.innerHTML = '<div class="muted-text">No obvious upgrade candidates based on your current starters.</div>';
    upgradeCard.style.display = 'block';
    return;
  }

  // sort by rank ascending
  candidates.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

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
  candidates.forEach(row => {
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
    applyScheduleColor(tdRos, row.ros);
    tr.appendChild(tdRos);

    const tdNext4 = document.createElement('td');
    tdNext4.textContent = row.next4 ?? '';
    applyScheduleColor(tdNext4, row.next4);
    tr.appendChild(tdNext4);

    const tdPpg = document.createElement('td');
    tdPpg.textContent = row.ppg ?? '';
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  upgradeContent.innerHTML = '';
  upgradeContent.appendChild(table);
  upgradeCard.style.display = 'block';
}

// ------------ THIS WEEK TAB ------
function renderWeekTab() {
  if (!weekData.length) {
    weekContent.innerHTML = '<div class="muted-text">Upload your "This Week" CSV to see positional tables.</div>';
    return;
  }

  const grouped = {};
  weekData.forEach(row => {
    const pos = row.position || 'FLEX';
    if (!grouped[pos]) grouped[pos] = [];
    grouped[pos].push(row);
  });

  const container = document.createElement('div');

  Object.entries(grouped).forEach(([pos, rows]) => {
    if (!rows.length) return;

    // sort by tier then proj_points desc
    rows.sort((a, b) => {
      if ((a.tier ?? 99) !== (b.tier ?? 99)) {
        return (a.tier ?? 99) - (b.tier ?? 99);
      }
      return (b.proj_points ?? 0) - (a.proj_points ?? 0);
    });

    const label = document.createElement('div');
    label.className = 'position-label';
    label.textContent = pos;
    container.appendChild(label);

    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Player</th>
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

    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');

      if (idx > 0 && r.tier != null && r.tier !== prevTier) {
        tr.classList.add('tier-break-row');
      }
      prevTier = r.tier;

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
    container.appendChild(table);
  });

  weekContent.innerHTML = '';
  weekContent.appendChild(container);
}

// ------------ ROS TAB -----------
function renderRosTab() {
  if (!rosData.length) {
    rosContent.innerHTML = '<div class="muted-text">Upload your ROS CSV to see the big board.</div>';
    return;
  }

  // Sort by rank ascending
  const sorted = [...rosData].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  const wrapper = document.createElement('div');
  const table = document.createElement('table');
  table.className = 'table';

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
      <th>ROS</th>
      <th>Next 4</th>
      <th>PPG</th>
      <th>Bye</th>
      ${teamHeaderCells.map(th => `<th>${th}</th>`).join('')}
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  // Precompute series summaries for ROS, next4, PPG
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
      // FA + team columns
      const faCell = document.createElement('td');
      faCell.className = 'cell-fa';
      const ownCells = ownershipContext.teamNames.map(() => {
        const td = document.createElement('td');
        td.className = 'cell-own';
        return td;
      });

      const playerId = lookupPlayerIdByName(row.player);
      if (!playerId) {
        // leave blank
      } else {
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
}

function buildOwnershipContext(league) {
  const { rosters, users } = league;

  const usersById = new Map();
  users.forEach(u => usersById.set(u.user_id, u));

  const teams = rosters.map(r => {
    const ownerUser = usersById.get(r.owner_id);
    const displayName = ownerUser?.metadata?.team_name ||
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

  // Sort: my team first, then alphabetical
  teams.sort((a, b) => {
    if (a.isMine && !b.isMine) return -1;
    if (!a.isMine && b.isMine) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const teamNames = teams.map(t => t.displayName + (t.isMine ? ' (You)' : ''));
  const rosterIdToIndex = new Map();
  teams.forEach((t, idx) => rosterIdToIndex.set(t.roster_id, idx));

  // playerId -> rosterId
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

  return { teamNames, rosterIdToIndex, playerToRoster };
}

function lookupPlayerIdByName(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  return playersByNameLower.get(key) || null;
}

// ------------ COLOR HELPERS ------

// Overall rank gradient: 1 (green) -> 55 (yellow) -> 125 (red)
function applyOverallRankColor(td, rank) {
  if (!rank || rank === 0) return;

  if (rank <= 1) {
    td.style.backgroundColor = 'hsl(120, 70%, 40%)';
    return;
  }
  if (rank >= 125) {
    td.style.backgroundColor = 'hsl(0, 70%, 50%)';
    return;
  }

  if (rank <= 55) {
    const t = (rank - 1) / (55 - 1);
    const hue = 120 - (120 - 60) * t; // 120 -> 60
    td.style.backgroundColor = `hsl(${hue}, 70%, 45%)`;
  } else {
    const t = (rank - 55) / (125 - 55);
    const hue = 60 - 60 * t; // 60 -> 0
    td.style.backgroundColor = `hsl(${hue}, 70%, 45%)`;
  }
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

  if (rank <= 1) {
    td.style.backgroundColor = 'hsl(120, 70%, 40%)';
    return;
  }
  if (rank >= max) {
    td.style.backgroundColor = 'hsl(0, 70%, 50%)';
    return;
  }

  if (rank <= mid) {
    const t = (rank - 1) / (mid - 1);
    const hue = 120 - (120 - 60) * t; // 120 -> 60
    td.style.backgroundColor = `hsl(${hue}, 70%, 45%)`;
  } else {
    const t = (rank - mid) / (max - mid);
    const hue = 60 - 60 * t; // 60 -> 0
    td.style.backgroundColor = `hsl(${hue}, 70%, 45%)`;
  }
}

// Series summary for min/median/max
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

// Projections: higher = green, lower = red, median = white
function applyProjectionColor(td, value, summary) {
  if (!isFinite(value) || !summary) return;
  const { min, median, max } = summary;
  if (!isFinite(min) || !isFinite(max) || min === max) return;

  if (value === max) {
    td.style.backgroundColor = 'hsl(120, 70%, 40%)';
    return;
  }
  if (value === min) {
    td.style.backgroundColor = 'hsl(0, 70%, 50%)';
    return;
  }
  if (value === median) {
    td.style.backgroundColor = '#ffffff';
    td.style.color = '#111';
    return;
  }

  if (value > median) {
    const t = (value - median) / (max - median || 1);
    const lightness = 100 - 40 * t; // 100 -> 60
    td.style.backgroundColor = `hsl(120, 70%, ${lightness}%)`;
    if (lightness < 80) td.style.color = '#111';
  } else {
    const t = (median - value) / (median - min || 1);
    const lightness = 100 - 40 * t;
    td.style.backgroundColor = `hsl(0, 70%, ${lightness}%)`;
    if (lightness < 80) td.style.color = '#111';
  }
}

// Matchup or schedule: lower (1) = green, median = white, higher = red
function applyMatchupColor(td, value, summary) {
  if (!isFinite(value) || !summary) return;
  const { min, median, max } = summary;
  if (!isFinite(min) || !isFinite(max) || min === max) return;

  // Usually min = 1 and max = 32
  if (value === min) {
    td.style.backgroundColor = 'hsl(120, 70%, 40%)';
    return;
  }
  if (value === max) {
    td.style.backgroundColor = 'hsl(0, 70%, 50%)';
    return;
  }
  if (value === median) {
    td.style.backgroundColor = '#ffffff';
    td.style.color = '#111';
    return;
  }

  if (value < median) {
    const t = (median - value) / (median - min || 1);
    const lightness = 100 - 40 * t; // towards green
    td.style.backgroundColor = `hsl(120, 70%, ${lightness}%)`;
    if (lightness < 80) td.style.color = '#111';
  } else {
    const t = (value - median) / (max - median || 1);
    const lightness = 100 - 40 * t; // towards red
    td.style.backgroundColor = `hsl(0, 70%, ${lightness}%)`;
    if (lightness < 80) td.style.color = '#111';
  }
}

// For ROS / Next4 schedule difficulty (reuses matchup logic)
function applyScheduleColor(td, value, summary) {
  if (!summary) {
    // Fallback: assume 1 - 32 if no summary provided
    applyMatchupColor(td, value, summarizeSeries([value, 1, 32]));
  } else {
    applyMatchupColor(td, value, summary);
  }
}

// Move: 1,2,3 green shades; -1,-2,-3 red shades
function applyMoveColor(td, move) {
  if (!Number.isFinite(move)) return;
  const m = move;
  if (m === 0) return;

  if (m > 0) {
    const level = Math.min(m, 3);
    const lightness = 85 - (level - 1) * 10; // 85,75,65
    td.style.backgroundColor = `hsl(120,70%,${lightness}%)`;
    if (lightness < 80) td.style.color = '#111';
  } else {
    const level = Math.min(-m, 3);
    const lightness = 85 - (level - 1) * 10;
    td.style.backgroundColor = `hsl(0,70%,${lightness}%)`;
    if (lightness < 80) td.style.color = '#111';
  }
}

// Bye: this week = red, past = green, future = white
function applyByeColor(td, byeWeek) {
  if (!sleeperState || !Number.isFinite(byeWeek)) return;
  const currentWeek = Number(sleeperState.week);
  if (!Number.isFinite(currentWeek)) return;

  if (byeWeek === currentWeek) {
    td.style.backgroundColor = 'hsl(0, 70%, 50%)';
  } else if (byeWeek < currentWeek) {
    td.style.backgroundColor = 'hsl(120, 70%, 40%)';
  } else {
    td.style.backgroundColor = '#ffffff';
    td.style.color = '#111';
  }
}
