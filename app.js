// app.js

const SLEEPER_USERNAME = 'stuckabuc';
const LEAGUE_IDS = ['1186844188245356544', '1186825886808555520'];

let sleeperState = null;
let playersById = {};
let playersByNameLower = new Map();
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

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCsvInputs();
  initSleeper().catch(err => {
    console.error(err);
    leagueSelect.innerHTML = '<option value="">Error loading leagues</option>';
  });
});

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
}

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
      skipEmptyLines: true,
      dynamicTyping: false
    });

    if (parsed.errors && parsed.errors.length) {
      console.error(parsed.errors);
      alert(`Error parsing CSV: ${parsed.errors[0].message}`);
      return;
    }

    if (type === 'ros') {
      rosData = parsed.data.map(normalizeRosRow).filter(r => r.player);
      rosByName.clear();
      rosData.forEach(row => {
        if (row.player) rosByName.set(row.player.toLowerCase(), row);
      });
      renderTeamsTab();
      renderRosTab();
    } else {
      weekData = parsed.data.map(normalizeWeekRow).filter(r => r.player);
      renderWeekTab();
    }
  };
  reader.readAsText(file);
}

// flexible ROS normalization
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
    rank: getNum('rank', 'overall'),
    player: getStr('player', 'name', 'player_name'),
    position: getStr('position', 'pos').toUpperCase(),
    pos_rank: getNum('pos_rank', 'position_rank'),
    tier: getNum('tier'),
    move: getNum('move', 'delta'),
    ros: getNum('ros', 'ros_schedule', 'schedule'),
    next4: getNum('next4', 'next_4', 'next4_schedule'),
    ppg: getNum('ppg', 'points_per_game'),
    bye: getNum('bye', 'bye_week')
  };
}

// flexible This Week normalization
function normalizeWeekRow(raw) {
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
    player: getStr('player', 'name', 'player_name'),
    position: getStr('position', 'pos').toUpperCase(),
    opponent: getStr('opponent', 'opp'),
    proj_points: getNum('proj_points', 'proj', 'projection', 'points'),
    matchup: getNum('matchup', 'match', 'matchup_grade', 'opp_rank'),
    tier: getNum('tier', 't')
  };
}

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

    const usersRes = await fetch(`htt
 
