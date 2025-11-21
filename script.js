/* ------------------------------------------
   CONFIGURATION
-------------------------------------------*/

const LEAGUES = {
  lor: {
    name: "League of Record",
    id: "1186844188245356544",
    hasDivisions: true,
    divisions: {
      East: [
        "Gridiron Man",
        "Scuttlebucs",
        "Pigskin Prophtz",
        "🦅Go Birds🦅",
        "Game of Throws"
      ],
      West: [
        "Mighty Mallards",
        "The Aman-Ra Stars",
        "The Juggernauts",
        "Overdrive",
        "Black Panther"
      ]
    }
  },
  ffl: {
    name: "FFL",
    id: "1257084943821967360",
    hasDivisions: false
  },
  dynasty: {
    name: "Dynasty Champs",
    id: "1186825886808555520",
    hasDivisions: true,
    divisions: {
      East: [
        "Black Panther",
        "Knights of Columbus",
        "Venomous Vipers",
        "Swamp Pirates",
        "Baby Got Dak"
      ],
      West: [
        "Gotham City",
        "WillXposU",
        "Howling Commandos",
        "Aggressive Chickens",
        "Game of Throws"
      ]
    }
  }
};

/* ------------------------------------------
   LAST WEEK SNAPSHOTS (WEEK 10)
-------------------------------------------*/

const LAST_WEEK_STANDINGS = {
  lor: {
    East: [
      "Gridiron Man",
      "Scuttlebucs",
      "Pigskin Prophtz",
      "🦅Go Birds🦅",
      "Game of Throws"
    ],
    West: [
      "Mighty Mallards",
      "The Aman-Ra Stars",
      "The Juggernauts",
      "Overdrive",
      "Black Panther"
    ]
  },
  ffl: [
    "UCDUST",
    "Primetime Primates",
    "The Chancla Warriors",
    "Metros Fields of Dreams",
    "Aggressive Chickens",
    "StreetGliders",
    "UnstoppableBoyz",
    "Team HazeHunters13",
    "Dom Perignons",
    "Cabuloso"
  ],
  dynasty: {
    East: [
      "Black Panther",
      "Knights of Columbus",
      "Venomous Vipers",
      "Swamp Pirates",
      "Baby Got Dak"
    ],
    West: [
      "Gotham City",
      "WillXposU",
      "Howling Commandos",
      "Aggressive Chickens",
      "Game of Throws"
    ]
  }
};

const LAST_WEEK_POWER = {
  lor: [
    "Scuttlebucs",
    "Gridiron Man",
    "The Aman-Ra Stars",
    "Mighty Mallards",
    "The Juggernauts",
    "Pigskin Prophtz",
    "🦅Go Birds🦅",
    "Game of Throws",
    "Overdrive",
    "Black Panther"
  ],
  ffl: [
    "Metros Fields of Dreams",
    "UnstoppableBoyz",
    "UCDUST",
    "Primetime Primates",
    "Team HazeHunters13",
    "The Chancla Warriors",
    "StreetGliders",
    "Cabuloso",
    "Aggressive Chickens",
    "Dom Perignons"
  ],
  dynasty: [
    "Gotham City",
    "Black Panther",
    "Swamp Pirates",
    "Knights of Columbus",
    "WillXposU",
    "Howling Commandos",
    "Venomous Vipers",
    "Baby Got Dak",
    "Aggressive Chickens",
    "Game of Throws"
  ]
};

/* ------------------------------------------
   GLOBAL STATE
-------------------------------------------*/

let currentLeagueKey = null;
let currentWeek = null;
const leagueDataCache = {};

let presentationMode = false;
let revealIndex = 0;

let presenterBubble, presenterTitle, presenterNext;

/* ------------------------------------------
   TEAM COLOR / GRADIENT SUPPORT
-------------------------------------------*/

const teamColorCache = {};
const BASE_DARK = { r: 12, g: 16, b: 32 };

const colorCanvas = document.createElement("canvas");
colorCanvas.width = 16;
colorCanvas.height = 16;
const colorCtx = colorCanvas.getContext("2d");

function computeAvatarColor(avatarId) {
  return new Promise(resolve => {
    if (!avatarId) {
      resolve(BASE_DARK);
      return;
    }
    if (teamColorCache[avatarId]) {
      resolve(teamColorCache[avatarId]);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `https://sleepercdn.com/avatars/thumbs/${avatarId}`;

    img.onload = () => {
      try {
        colorCtx.clearRect(0, 0, 16, 16);
        colorCtx.drawImage(img, 0, 0, 16, 16);
        const data = colorCtx.getImageData(0, 0, 16, 16).data;
        let r = 0,
          g = 0,
          b = 0,
          count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        if (!count) {
          teamColorCache[avatarId] = BASE_DARK;
          resolve(BASE_DARK);
          return;
        }

        const color = {
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        };
        teamColorCache[avatarId] = color;
        resolve(color);
      } catch (err) {
        teamColorCache[avatarId] = BASE_DARK;
        resolve(BASE_DARK);
      }
    };

    img.onerror = () => {
      teamColorCache[avatarId] = BASE_DARK;
      resolve(BASE_DARK);
    };
  });
}

function applyRowGradients() {
  const rows = document.querySelectorAll("[data-avatar-id]");
  rows.forEach(el => {
    const avatarId = el.dataset.avatarId;
    if (!avatarId) {
      el.style.background =
        "linear-gradient(to right, rgba(12,16,32,0.92), rgba(21,26,46,0.6))";
      return;
    }
    computeAvatarColor(avatarId).then(color => {
      const { r, g, b } = color;
      el.style.background = `linear-gradient(to right, rgba(12,16,32,0.92), rgba(${r},${g},${b},0.42))`;
    });
  });
}

/* ------------------------------------------
   UTILITIES
-------------------------------------------*/

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function normalize(str) {
  return String(str).trim().toLowerCase().replace(/\s+/g, "");
}

function getTeamName(roster, ownerMap) {
  const owner = ownerMap[roster.owner_id];
  return owner?.metadata?.team_name || owner?.display_name || "Unknown";
}

function teamAvatarHtml(roster, ownerMap) {
  if (!roster)
    return `<div class="team-with-avatar"><span>Unknown</span></div>`;

  const owner = ownerMap[roster.owner_id];
  const name = getTeamName(roster, ownerMap);
  const avatarId = owner?.avatar;

  if (!avatarId) {
    return `<div class="team-with-avatar fade-in"><span>${name}</span></div>`;
  }

  const url = `https://sleepercdn.com/avatars/thumbs/${avatarId}`;
  return `
    <div class="team-with-avatar fade-in">
      <img class="avatar" src="${url}" alt="${name} logo" />
      <span>${name}</span>
    </div>`;
}

function arrow(prev, now) {
  if (!prev || !now || prev === now) return "";
  const diff = prev - now;
  return diff > 0 ? `↑${Math.abs(diff)}` : `↓${Math.abs(diff)}`;
}

/* ------------------------------------------
   DOMContentLoaded
-------------------------------------------*/

document.addEventListener("DOMContentLoaded", () => {
  presenterBubble = document.getElementById("presenter-bubble");
  presenterTitle = document.getElementById("presenter-title");
  presenterNext = document.getElementById("presenter-next");

  const leagueButtons = document.querySelectorAll(".league-tabs .tab-btn");
  const subtabsEl = document.getElementById("subtabs");
  const subtabButtons = subtabsEl.querySelectorAll(".tab-btn");
  const toggleBtn = document.getElementById("presentation-toggle");

  /* League switching */
  leagueButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      leagueButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentLeagueKey = btn.dataset.league;

      subtabsEl.style.display = "flex";
      subtabButtons.forEach(b => b.classList.remove("active"));
      subtabsEl
        .querySelector('[data-section="standings"]')
        .classList.add("active");

      loadSection("standings");
    });
  });

  /* Subtab switching */
  subtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      subtabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadSection(btn.dataset.section);
    });
  });

  /* Presentation mode toggle */
  toggleBtn.addEventListener("click", () => {
    presentationMode = !presentationMode;

    toggleBtn.textContent = presentationMode
      ? "Presentation Mode: ON"
      : "Presentation Mode: OFF";

    revealIndex = 0;

    if (presentationMode) {
      document.body.classList.add("presentation-mode");
      syncPresentationNotes();
    } else {
      document.body.classList.remove("presentation-mode");
    }

    updatePresenterBubbleVisibility();

    if (currentLeagueKey) {
      const activeSection = document.querySelector(
        ".subtabs .tab-btn.active"
      )?.dataset.section;
      if (activeSection) loadSection(activeSection);
    }
  });

  /* NEXT button in presenter bubble */
  presenterNext.addEventListener("click", () => {
    if (presentationMode) {
      revealIndex++;
      applyReveal();
    }
  });

  /* Keyboard shortcuts */
  document.addEventListener("keydown", handleKeyboardShortcuts);

  /* Fetch NFL week */
  fetchJson("https://api.sleeper.app/v1/state/nfl")
    .then(state => {
      currentWeek = state.display_week || state.week || 11;
    })
    .catch(() => {
      currentWeek = 11;
    });

  /* Select the first league by default */
  leagueButtons[0]?.click();
});

/* ------------------------------------------
   KEYBOARD SHORTCUTS
-------------------------------------------*/

function handleKeyboardShortcuts(e) {
  if (!presentationMode) {
    if (e.key === "q") selectLeague("lor");
    if (e.key === "w") selectLeague("ffl");
    if (e.key === "e") selectLeague("dynasty");

    if (e.key === "1") switchSubtab("standings");
    if (e.key === "2") switchSubtab("matchups");
    if (e.key === "3") switchSubtab("power");
    return;
  }

  switch (e.key) {
    case "ArrowRight":
    case " ":
      revealIndex++;
      applyReveal();
      break;

    case "ArrowLeft":
      revealIndex = Math.max(0, revealIndex - 1);
      applyReveal();
      break;

    case "q":
      selectLeague("lor");
      break;

    case "w":
      selectLeague("ffl");
      break;

    case "e":
      selectLeague("dynasty");
      break;

    case "1":
      switchSubtab("standings");
      break;

    case "2":
      switchSubtab("matchups");
      break;

    case "3":
      switchSubtab("power");
      break;

    case "Escape":
      exitPresentationMode();
      break;
  }
}

function selectLeague(key) {
  const btn = document.querySelector(
    `.league-tabs .tab-btn[data-league="${key}"]`
  );
  btn?.click();
}

function switchSubtab(section) {
  const btn = document.querySelector(
    `.subtabs .tab-btn[data-section="${section}"]`
  );
  btn?.click();
}

function exitPresentationMode() {
  presentationMode = false;
  revealIndex = 0;
  presenterBubble.style.display = "none";
  document.body.classList.remove("presentation-mode");
  document.getElementById("presentation-toggle").textContent =
    "Presentation Mode: OFF";
}

/* ------------------------------------------
   SECTION LOADING
-------------------------------------------*/

async function loadSection(section) {
  const container = document.getElementById("content");
  container.innerHTML = "<div class='section'>Loading...</div>";

  if (!currentLeagueKey) return;
  const league = LEAGUES[currentLeagueKey];

  if (!leagueDataCache[league.id]) {
    try {
      const [users, rosters] = await Promise.all([
        fetchJson(`https://api.sleeper.app/v1/league/${league.id}/users`),
        fetchJson(`https://api.sleeper.app/v1/league/${league.id}/rosters`)
      ]);
      leagueDataCache[league.id] = { users, rosters };
    } catch (err) {
      container.innerHTML =
        "<div class='section'>Could not load league data.</div>";
      return;
    }
  }

  if (section === "standings") renderStandings(league);
  if (section === "matchups") renderMatchups(league);
  if (section === "power") renderPowerRankings(league);
}

/* ------------------------------------------
   STANDINGS
-------------------------------------------*/

function renderStandings(league) {
  const container = document.getElementById("content");
  const { users, rosters } = leagueDataCache[league.id];

  const ownerMap = {};
  users.forEach(u => (ownerMap[u.user_id] = u));

  const sorted = [...rosters].sort((a, b) => {
    const wa = a.settings.wins || 0;
    const la = a.settings.losses || 0;
    const wb = b.settings.wins || 0;
    const lb = b.settings.losses || 0;
    const pctA = wa + la === 0 ? 0 : wa / (wa + la);
    const pctB = wb + lb === 0 ? 0 : wb / (wb + lb);
    if (pctB !== pctA) return pctB - pctA;
    const pfa = Number(a.settings.fpts ?? 0);
    const pfb = Number(b.settings.fpts ?? 0);
    return pfb - pfa;
  });

  const lastWeek = LAST_WEEK_STANDINGS[currentLeagueKey];

  let html = `<div class="section"><h2>${league.name} Standings</h2>`;

  if (league.hasDivisions && league.divisions) {
    Object.keys(league.divisions).forEach(divName => {
      const divList = league.divisions[divName];
      const lastWeekList = lastWeek[divName];
      html += `<h3>${divName} Division</h3>`;
      html += buildStandingsTable(
        league,
        sorted,
        ownerMap,
        divList,
        lastWeekList
      );
    });
  } else {
    html += buildStandingsTable(
      league,
      sorted,
      ownerMap,
      null,
      lastWeek
    );
  }

  html += "</div>";
  container.innerHTML = html;

  attachNoteHandlers();

  if (presentationMode) {
    revealIndex = 0;
    updatePresenterBubbleTitle();
    syncPresentationNotes();
    applyReveal();
  }

  applyRowGradients();
}

function buildStandingsTable(
  league,
  sortedRosters,
  ownerMap,
  divisionNames,
  lastWeekList
) {
  let filtered = sortedRosters;

  if (divisionNames) {
    const norms = divisionNames.map(normalize);
    filtered = sortedRosters.filter(r =>
      norms.includes(normalize(getTeamName(r, ownerMap)))
    );
  }

  let groups = "";

  filtered.forEach((team, idx) => {
    const name = getTeamName(team, ownerMap);
    const norm = normalize(name);
    const prevIndex = Array.isArray(lastWeekList)
      ? lastWeekList.findIndex(x => normalize(x) === norm)
      : -1;

    const thisRank = idx + 1;
    const prevRank = prevIndex === -1 ? null : prevIndex + 1;
    const changeDisplay = prevRank ? arrow(prevRank, thisRank) : "";

    const noteKey = `stand_note_${league.id}_${team.roster_id}`;
    const savedNote = localStorage.getItem(noteKey) || "";
    const owner = ownerMap[team.owner_id];
    const avatarId = owner?.avatar || "";

    groups += `
      <tbody class="reveal-item fade-in" data-avatar-id="${avatarId}">
        <tr>
          <td>${thisRank}</td>
          <td>${teamAvatarHtml(team, ownerMap)}</td>
          <td>${team.settings.wins || 0}-${team.settings.losses || 0}</td>
          <td>${Number(team.settings.fpts ?? 0).toFixed(2)}</td>
          <td>${changeDisplay}</td>
        </tr>
        <tr>
          <td colspan="5">
            <div class="presentation-note-view" data-note-view="${noteKey}">${savedNote}</div>
            <textarea class="note-box" data-save="${noteKey}" placeholder="Add note...">${savedNote}</textarea>
          </td>
        </tr>
      </tbody>
    `;
  });

  return `
    <table>
      <tr>
        <th>#</th>
        <th>Team</th>
        <th>Record</th>
        <th>PF</th>
        <th>Chg</th>
      </tr>
      ${groups}
    </table>
  `;
}

/* ------------------------------------------
   MATCHUPS
-------------------------------------------*/

async function renderMatchups(league) {
  const container = document.getElementById("content");
  const { users, rosters } = leagueDataCache[league.id];

  const ownerMap = {};
  users.forEach(u => (ownerMap[u.user_id] = u));

  const week = currentWeek || 1;
  let matchups;

  try {
    matchups = await fetchJson(
      `https://api.sleeper.app/v1/league/${league.id}/matchups/${week}`
    );
  } catch (err) {
    container.innerHTML = "Could not load matchups.";
    return;
  }

  const rosterMap = {};
  rosters.forEach(r => (rosterMap[r.roster_id] = r));

  const grouped = {};
  matchups.forEach(m => {
    if (!grouped[m.matchup_id]) grouped[m.matchup_id] = [];
    grouped[m.matchup_id].push(m);
  });

  let html = `<div class="section"><h2>${league.name} — Week ${week} Matchups</h2>`;

  Object.keys(grouped)
    .sort((a, b) => Number(a) - Number(b))
    .forEach(mid => {
      const teams = grouped[mid];
      const t1 = teams[0];
      const t2 = teams[1];

      const p1 = t1?.points != null ? t1.points.toFixed(2) : "-";
      const p2 = t2?.points != null ? t2.points.toFixed(2) : "-";

      const noteKey = `match_note_${league.id}_${week}_${mid}`;
      const savedNote = localStorage.getItem(noteKey) || "";

      const roster1 = rosterMap[t1.roster_id];
      const owner1 = roster1 ? ownerMap[roster1.owner_id] : null;
      const avatarId = owner1?.avatar || "";

      html += `
        <div class="reveal-item fade-in" data-avatar-id="${avatarId}">
          <h3>Matchup ${mid}</h3>
          <table>
            <tr><th>Team</th><th>Points</th></tr>
            <tr>
              <td>${teamAvatarHtml(roster1, ownerMap)}</td>
              <td><strong>${p1}</strong></td>
            </tr>
            ${
              t2
                ? `<tr>
                    <td>${teamAvatarHtml(rosterMap[t2.roster_id], ownerMap)}</td>
                    <td><strong>${p2}</strong></td>
                  </tr>`
                : ""
            }
          </table>
          <div class="presentation-note-view" data-note-view="${noteKey}">${savedNote}</div>
          <textarea class="note-box" data-save="${noteKey}" placeholder="Add note...">${savedNote}</textarea>
        </div>
      `;
    });

  html += "</div>";
  container.innerHTML = html;

  attachNoteHandlers();

  if (presentationMode) {
    revealIndex = 0;
    updatePresenterBubbleTitle();
    syncPresentationNotes();
    applyReveal();
  }

  applyRowGradients();
}

/* ------------------------------------------
   POWER RANKINGS
-------------------------------------------*/

function renderPowerRankings(league) {
  const container = document.getElementById("content");
  const { users, rosters } = leagueDataCache[league.id];

  const ownerMap = {};
  users.forEach(u => (ownerMap[u.user_id] = u));

  const lastWeekList = LAST_WEEK_POWER[currentLeagueKey];
  const week = currentWeek || 1;

  let list = rosters.map(r => {
    const name = getTeamName(r, ownerMap);
    const rankKey = `power_${league.id}_${week}_${r.roster_id}`;
    const noteKey = `power_note_${league.id}_${week}_${r.roster_id}`;
    return {
      roster: r,
      ownerMap,
      name,
      rankKey,
      noteKey,
      rank: localStorage.getItem(rankKey)
        ? Number(localStorage.getItem(rankKey))
        : null,
      note: localStorage.getItem(noteKey) || ""
    };
  });

  list.sort((a, b) => {
    if (!a.rank && !b.rank) return 0;
    if (!a.rank) return 1;
    if (!b.rank) return -1;
    return a.rank - b.rank;
  });

  let html = `
    <div class="section">
      <h2>${league.name} Power Rankings — Week ${week}</h2>
      <p class="small-label">Enter rankings. List auto-sorts after each change.</p>
      <table>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Rank</th>
          <th>Chg</th>
        </tr>
  `;

  list.forEach(item => {
    const prevIndex = lastWeekList.findIndex(
      x => normalize(x) === normalize(item.name)
    );
    const change =
      prevIndex !== -1 && item.rank
        ? arrow(prevIndex + 1, item.rank)
        : "";

    const owner = item.ownerMap[item.roster.owner_id];
    const avatarId = owner?.avatar || "";

    html += `
      <tbody class="reveal-item fade-in" data-avatar-id="${avatarId}">
        <tr>
          <td>${item.rank ?? ""}</td>
          <td>${teamAvatarHtml(item.roster, item.ownerMap)}</td>
          <td>
            <input
              class="power-input"
              type="number"
              min="1"
              max="${rosters.length}"
              data-save="${item.rankKey}"
              value="${item.rank ?? ""}"
            />
          </td>
          <td>${change}</td>
        </tr>
        <tr>
          <td colspan="4">
            <div class="presentation-note-view" data-note-view="${item.noteKey}">${item.note}</div>
            <textarea class="note-box" data-save="${item.noteKey}" placeholder="Add note...">${item.note}</textarea>
          </td>
        </tr>
      </tbody>
    `;
  });

  html += "</table></div>";
  container.innerHTML = html;

  attachPowerHandlers(league);
  attachNoteHandlers();

  if (presentationMode) {
    revealIndex = 0;
    updatePresenterBubbleTitle();
    syncPresentationNotes();
    applyReveal();
  }

  applyRowGradients();
}

/* ------------------------------------------
   PRESENTATION MODE REVEAL
-------------------------------------------*/

function applyReveal() {
  if (!presentationMode) return;

  const section = document.querySelector(".subtabs .active")?.dataset.section;
  const items = Array.from(document.querySelectorAll(".reveal-item"));
  const total = items.length;

  items.forEach(el => {
    el.style.display = "none";
  });

  if (section === "power") {
    // Reveal from bottom (10 → 1)
    for (let i = 0; i < revealIndex && i < total; i++) {
      const idx = total - 1 - i;
      const item = items[idx];
      item.style.display = "";
      item.classList.add("fade-in");
    }
  } else {
    // Standings & Matchups → top-down
    for (let i = 0; i < revealIndex && i < total; i++) {
      const item = items[i];
      item.style.display = "";
      item.classList.add("fade-in");
    }
  }

  updatePresenterBubbleVisibility();
}

/* ------------------------------------------
   PRESENTER BUBBLE
-------------------------------------------*/

function updatePresenterBubbleTitle() {
  if (!presentationMode) return;

  const leagueName = LEAGUES[currentLeagueKey].name;
  const section =
    document.querySelector(".subtabs .active")?.dataset.section || "";

  const sectionTitle =
    section === "standings"
      ? "Standings"
      : section === "matchups"
      ? "Matchups"
      : "Power Rankings";

  presenterTitle.textContent = `${leagueName} — ${sectionTitle}`;
}

function updatePresenterBubbleVisibility() {
  if (!presentationMode) {
    presenterBubble.style.display = "none";
    return;
  }

  const items = document.querySelectorAll(".reveal-item");
  if (revealIndex >= items.length) {
    presenterBubble.style.display = "none";
    return;
  }

  updatePresenterBubbleTitle();
  presenterBubble.style.display = "block";
}

/* ------------------------------------------
   NOTES HANDLING
-------------------------------------------*/ 

function syncPresentationNotes() {
  const views = document.querySelectorAll("[data-note-view]");
  views.forEach(v => {
    const key = v.dataset.noteView;
    const val = localStorage.getItem(key) || "";
    v.textContent = val.trim();
  });
}

function attachNoteHandlers() {
  document.querySelectorAll(".note-box[data-save]").forEach(el => {
    el.removeEventListener("input", noteInputHandler);
    el.addEventListener("input", noteInputHandler);
  });
}

function noteInputHandler(e) {
  const key = e.target.dataset.save;
  localStorage.setItem(key, e.target.value);
  syncPresentationNotes();
}

function attachPowerHandlers(league) {
  document.querySelectorAll(".power-input[data-save]").forEach(el => {
    el.removeEventListener("input", powerInputHandler);
    el.addEventListener("input", powerInputHandler.bind(null, league));
  });
}

function powerInputHandler(league, e) {
  const key = e.target.dataset.save;
  const val = e.target.value;
  if (val === "") localStorage.removeItem(key);
  else localStorage.setItem(key, val);

  renderPowerRankings(league);
}
