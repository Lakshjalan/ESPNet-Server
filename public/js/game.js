// Match State and Game Logic Controllers
var redScore = 0;
var blueScore = 0;
var matchSeconds = 0;
var matchRunning = false;
var matchHasEnded = false;
var refTimerInterval = null;
var latestDevices = [];

var players = [];
var playerIdCounter = 1;
var matchQueue = [];
var queueIdCounter = 1;
var currentMatch = { redId: null, blueId: null };
var matchHistory = [];
var matchCounter = 1;
var previousMatchHasEnded = false;

function applyServerState(s) {
  if (!s) return;
  if (Array.isArray(s.devices)) {
    latestDevices = s.devices;
    renderFleet(latestDevices);
    renderPairing(latestDevices);
    refreshPowerupPills(latestDevices);
  }
  const m = s.match;
  if (!m) return;
  redScore = m.scoreRed ?? 0;
  blueScore = m.scoreBlue ?? 0;
  matchSeconds = typeof m.timeRemainingMs === 'number' ? m.timeRemainingMs / 1000 : matchSeconds;
  matchRunning = !!m.matchActive && !m.isPaused;
  matchHasEnded = !m.matchActive && !!m.winner;
  if (matchHasEnded && !previousMatchHasEnded) refreshHistoryOnMatchEnd();
  previousMatchHasEnded = matchHasEnded;

  const redscoreEl = document.getElementById('redscore');
  const bluescoreEl = document.getElementById('bluescore');
  const redPnameEl = document.getElementById('redPname');
  const bluePnameEl = document.getElementById('bluePname');
  const currentRedNameEl = document.getElementById('currentRedName');
  const currentBlueNameEl = document.getElementById('currentBlueName');

  if (redscoreEl) redscoreEl.textContent = String(redScore).padStart(2, '0');
  if (bluescoreEl) bluescoreEl.textContent = String(blueScore).padStart(2, '0');
  if (redPnameEl) redPnameEl.textContent = m.playerRedName || '—';
  if (bluePnameEl) bluePnameEl.textContent = m.playerBlueName || '—';
  if (currentRedNameEl) currentRedNameEl.textContent = m.playerRedName || '—';
  if (currentBlueNameEl) currentBlueNameEl.textContent = m.playerBlueName || '—';

  const arena = document.getElementById('arena');
  if (arena) arena.classList.toggle('intense', !!m.isIntenseMode);

  let label;
  if (m.winner) {
    label = m.winner === 'draw' ? `Match drawn ${redScore} – ${blueScore}`
      : `${m.winner === 'red' ? 'Red' : 'Blue'} wins ${redScore} – ${blueScore}`;
  } else if (!m.matchActive) {
    label = 'Match ready';
  } else if (m.isPaused) {
    label = 'Match paused';
  } else if (m.isIntenseMode) {
    label = 'Intense mode';
  } else {
    label = 'Match live';
  }
  const statelabelEl = document.getElementById('statelabel');
  const matchstateEl = document.getElementById('matchstate');
  const statedotEl = document.getElementById('statedot');

  if (statelabelEl) statelabelEl.textContent = label;
  if (matchstateEl) {
    matchstateEl.textContent = label;
    matchstateEl.classList.toggle('live', matchRunning);
  }
  if (statedotEl) statedotEl.classList.toggle('live', matchRunning);

  refSetStateLine(label);
  refSyncDisplay();

  if (matchRunning) refRunInterval(); else clearInterval(refTimerInterval);
}

function playGoalAnimation(side) {
  const arena = document.getElementById('arena');
  if (!arena) return;
  arena.classList.remove('goal', 'goal-red', 'goal-blue');
  void arena.offsetWidth;
  const goaltext = document.getElementById('goaltext');
  const scoreEl = document.getElementById(side === 'red' ? 'redscore' : 'bluescore');
  if (scoreEl) {
    scoreEl.classList.remove('pop'); 
    void scoreEl.offsetWidth; 
    scoreEl.classList.add('pop');
  }
  if (side === 'red') {
    if (goaltext) goaltext.textContent = 'RED SCORES!'; 
    arena.classList.add('goal', 'goal-red'); 
    burstConfetti('#ff3b4e'); 
    kickBallTo('right', 'red');
  } else {
    if (goaltext) goaltext.textContent = 'BLUE SCORES!'; 
    arena.classList.add('goal', 'goal-blue'); 
    burstConfetti('#2fb2ff'); 
    kickBallTo('left', 'blue');
  }
  setTimeout(() => arena.classList.remove('goal', 'goal-red', 'goal-blue'), 1500);
}

function refTriggerKick(side) {
  const controller = latestDevices.find(d => d.nodeType === 'controller' && d.team === side);
  if (!controller) { pushTickerEvent({ label: 'KICK FAILED', detail: 'No controller assigned to ' + side }); return; }
  api.triggerKick(controller.mac).catch(err => pushTickerEvent({ label: 'KICK FAILED', detail: err.message }));
}

function refTriggerEmp(side) {
  const controller = latestDevices.find(d => d.nodeType === 'controller' && d.team === side);
  if (!controller) { pushTickerEvent({ label: 'EMP FAILED', detail: 'No controller assigned to ' + side }); return; }
  const targetTeam = side === 'red' ? 'blue' : 'red';
  api.triggerEmp(controller.mac, targetTeam).catch(err => pushTickerEvent({ label: 'EMP FAILED', detail: err.message }));
}

async function bootstrapFromBackend() {
  try {
    try {
      const p = await api.getPlayers();
      players = Array.isArray(p) ? p : [];
      renderPlayers();
    } catch (err) {
      console.error("Failed to load players:", err);
      players = [];
    }

    try {
      const q = await api.getQueue();
      if (Array.isArray(q)) {
        matchQueue = q;
      } else if (q && Array.isArray(q.queue)) {
        matchQueue = q.queue;
      } else {
        matchQueue = [];
      }
      renderQueue();
    } catch (err) {
      console.error("Failed to load queue:", err);
      matchQueue = [];
      renderQueue();
    }
  } catch (err) {
    console.error("Backend bootstrap failed:", err);
  }
}

function refStart() {
  if (matchRunning || matchHasEnded) return;
  const redNameEl = document.getElementById('redPname');
  const blueNameEl = document.getElementById('bluePname');
  const redName = redNameEl ? redNameEl.textContent.trim() : '';
  const blueName = blueNameEl ? blueNameEl.textContent.trim() : '';
  api.startMatch(redName && redName !== '—' ? redName : undefined, blueName && blueName !== '—' ? blueName : undefined)
    .then(applyServerState)
    .catch(err => pushTickerEvent({ label: 'START FAILED', detail: err.message }));
}

function refPause() {
  if (!matchRunning) return;
  api.pauseMatch().then(applyServerState).catch(err => pushTickerEvent({ label: 'PAUSE FAILED', detail: err.message }));
}

function refResume() {
  if (matchRunning || matchHasEnded) return;
  api.resumeMatch().then(applyServerState).catch(err => pushTickerEvent({ label: 'RESUME FAILED', detail: err.message }));
}

function refRunInterval() {
  clearInterval(refTimerInterval);
  refTimerInterval = setInterval(() => {
    if (!matchRunning) return;
    matchSeconds = Math.max(0, matchSeconds - 1);
    refSyncDisplay();
  }, 1000);
}

function refReset() {
  if (!confirm('Reset match? This clears the score, timer and power-up cooldowns.')) return;
  api.resetMatch().then(applyServerState).catch(err => pushTickerEvent({ label: 'RESET FAILED', detail: err.message }));
}

function refGoal(side) {
  api.scoreGoal(side).catch(err => pushTickerEvent({ label: 'GOAL FAILED', detail: err.message }));
}

function refUndoGoal() {
  api.undoGoal().then(applyServerState).catch(err => pushTickerEvent({ label: 'UNDO FAILED', detail: err.message }));
}

function refAdjustTimer(deltaMs) {
  api.adjustTime(deltaMs).then(applyServerState).catch(err => pushTickerEvent({ label: 'TIMER ADJUST FAILED', detail: err.message }));
}

function togglePlayerAvailable(id) {
  const p = players.find(p => p.id === id);
  if (p) p.available = !p.available;
  api.updatePlayer(id, { available: p ? p.available : undefined }).catch(() => {});
  renderPlayers();
  renderQueue();
}

function addPlayer() {
  const nameEl = document.getElementById('newPlayerName');
  const teamEl = document.getElementById('newPlayerTeam');
  const ctrlEl = document.getElementById('newPlayerController');
  const availEl = document.getElementById('newPlayerAvailable');
  if (!nameEl || !teamEl || !ctrlEl || !availEl) return;
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  const newPlayer = {
    name, 
    team: teamEl.value, 
    controller: ctrlEl.value, 
    matches: 0, 
    wins: 0,
    available: availEl.classList.contains('on')
  };
  api.addPlayer(newPlayer).then(created => {
    players.push(created); 
    renderPlayers();
  }).catch(() => {
    players.push({ id: playerIdCounter++, ...newPlayer });
    renderPlayers();
  });
  nameEl.value = '';
}

function removePlayer(id) {
  api.removePlayer(id).catch(() => {});
  players = players.filter(p => p.id !== id);
  matchQueue.forEach(q => {
    if (q.redId === id) q.issue = 'red';
    if (q.blueId === id) q.issue = 'blue';
  });
  renderPlayers();
  renderQueue();
}

function renderPlayerSelects() {
  const redSel = document.getElementById('matchRedPlayer');
  const blueSel = document.getElementById('matchBluePlayer');
  if (!redSel || !blueSel) return;

  const prevRed = redSel.value;
  const prevBlue = blueSel.value;
  const avail = players.filter(p => p.available);
  const redPlayers = avail.filter(p => p.team === 'red');
  const bluePlayers = avail.filter(p => p.team === 'blue');

  const redOpts = redPlayers.map(p => `<option value="${p.id}">${p.name} · red</option>`).join('');
  const blueOpts = bluePlayers.map(p => `<option value="${p.id}">${p.name} · blue</option>`).join('');

  redSel.innerHTML = redOpts;
  blueSel.innerHTML = blueOpts;

  if (redPlayers.some(p => String(p.id) === String(prevRed))) {
    redSel.value = prevRed;
  } else if (redPlayers.length > 0) {
    redSel.value = redPlayers[0].id;
  }

  if (bluePlayers.some(p => String(p.id) === String(prevBlue))) {
    blueSel.value = prevBlue;
  } else if (bluePlayers.length > 0) {
    blueSel.value = bluePlayers[0].id;
  }

  const warning = document.getElementById('setupWarning');
  if (warning) {
    warning.style.display = (redPlayers.length === 0 || bluePlayers.length === 0) ? 'block' : 'none';
  }
}

function renderCurrentMatchBanner() {
  const redEl = document.getElementById('currentRedName');
  const blueEl = document.getElementById('currentBlueName');
  if (!redEl || !blueEl) return;
  const redP = players.find(p => p.id === currentMatch.redId);
  const blueP = players.find(p => p.id === currentMatch.blueId);
  redEl.textContent = redP ? redP.name : '—';
  blueEl.textContent = blueP ? blueP.name : '—';
}

function applyMatch(redId, blueId) {
  currentMatch = { redId, blueId };
  const redP = players.find(p => p.id === redId);
  const bluePlayer = players.find(p => p.id === blueId);
  
  const redPnameEl = document.querySelector('.truckside.red .pname');
  const bluePnameEl = document.querySelector('.truckside.blue .pname');
  if (redPnameEl) redPnameEl.textContent = redP ? redP.name : 'Red';
  if (bluePnameEl) bluePnameEl.textContent = bluePlayer ? bluePlayer.name : 'Blue';
  
  renderCurrentMatchBanner();
  showScreen('live', document.getElementById('navLiveBtn'));
  resetLiveDisplayToReady();
  api.startMatch(redP ? redP.name : undefined, bluePlayer ? bluePlayer.name : undefined)
    .then(applyServerState)
    .catch(err => pushTickerEvent({ label: 'START FAILED', detail: err.message }));
}

function resetLiveDisplayToReady() {
  const arena = document.getElementById('arena');
  if (arena) arena.classList.remove('intense', 'goal', 'goal-red', 'goal-blue');
  const statedotEl = document.getElementById('statedot');
  const statelabelEl = document.getElementById('statelabel');
  const matchstateEl = document.getElementById('matchstate');
  
  if (statedotEl) statedotEl.classList.remove('live');
  if (statelabelEl) statelabelEl.textContent = 'Match ready';
  if (matchstateEl) {
    matchstateEl.textContent = 'Match ready';
    matchstateEl.classList.remove('live');
  }
  refSetStateLine('Match ready');
  matchRunning = false; 
  matchHasEnded = false;
  clearInterval(refTimerInterval);
  refSyncDisplay();
}

function startMatchNow() {
  const redSel = document.getElementById('matchRedPlayer');
  const blueSel = document.getElementById('matchBluePlayer');
  const errEl = document.getElementById('setupError');
  if (!redSel || !blueSel) return;
  if (!redSel.value || !blueSel.value) return;
  if (redSel.value === blueSel.value) {
    if (errEl) {
      errEl.textContent = '⚠ Red aur Blue ke liye alag-alag player choose karo.';
      errEl.style.display = 'block';
    }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  applyMatch(Number(redSel.value), Number(blueSel.value));
}

function addToQueue() {
  const redSel = document.getElementById('matchRedPlayer');
  const blueSel = document.getElementById('matchBluePlayer');
  if (!redSel || !blueSel) return;
  if (!redSel.value || !blueSel.value || redSel.value === blueSel.value) return;

  const redId = redSel.value;
  const blueId = blueSel.value;

  api.addToQueue(redId, blueId)
    .then(item => {
      const queueItem = item?.queue ? item.queue[item.queue.length - 1] : item;
      if (queueItem) {
        matchQueue.push(queueItem);
        renderQueue();
      }
    })
    .catch(err => {
      console.error("Queue add failed:", err);
    });
}

async function removeFromQueue(id) {
  try {
    console.log("[queue] removing:", id);
    const response = await api.removeFromQueue(id);
    console.log("[queue] removed successfully:", response);
    matchQueue = matchQueue.filter(q => q.id !== id);
    renderQueue();
  } catch (error) {
    console.error("[queue] remove failed:", error);
    alert("Failed to remove queue item. Check the server.");
  }
}

function reassignQueueSlot(qid, side) {
  const item = matchQueue.find(q => q.id === qid);
  const subSel = document.getElementById('sub-' + qid);
  if (!item || !subSel || !subSel.value) return;
  const playerId = Number(subSel.value);
  api.reassignQueue(qid, side, playerId).catch(() => {});
  if (side === 'red') item.redId = playerId; else item.blueId = playerId;
  item.issue = null;
  renderQueue();
}

function startQueueMatch(id) {
  const item = matchQueue.find(q => String(q.id) === String(id));
  if (!item) return;

  const redId = item.playerRedId ?? item.redId;
  const blueId = item.playerBlueId ?? item.blueId;

  const redP = players.find(p => String(p.id) === String(redId));
  const blueP = players.find(p => String(p.id) === String(blueId));

  if (!redP || !redP.available || !blueP || !blueP.available) {
    renderQueue();
    return;
  }

  api.startQueueMatch(id)
    .then(() => {
      matchQueue = matchQueue.filter(q => String(q.id) !== String(id));
      renderQueue();
      applyMatch(redP.id, blueP.id);
    })
    .catch(err => {
      console.error("Failed to start queued match:", err);
    });
}

function refreshHistoryOnMatchEnd() {
  api.getMatchHistory().then(h => { if (Array.isArray(h)) { matchHistory = h; renderHistory(); } }).catch(() => {});
}

function normalizeHistoryEntry(m, i) {
  return {
    id: m.matchId ?? m.id ?? i,
    redName: m.playerRedName ?? m.redName ?? 'Red',
    blueName: m.playerBlueName ?? m.blueName ?? 'Blue',
    redScore: m.scoreRed ?? m.redScore ?? 0,
    blueScore: m.scoreBlue ?? m.blueScore ?? 0,
    winner: m.winner ?? null,
    when: m.endedAt ? new Date(m.endedAt).toLocaleString() : (m.date ?? ''),
  };
}

function renderHistory() {
  const box = document.getElementById('historyList');
  if (!box) return;

  const deleteButton = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
      <button class="btn danger" onclick="deleteAllMatchHistory()">✕ DELETE HISTORY</button>
    </div>
  `;

  if (!matchHistory.length) {
    box.innerHTML = deleteButton + emptyState('No completed matches yet.');
    return;
  }

  box.innerHTML = deleteButton + matchHistory.map((raw, i) => {
    const m = normalizeHistoryEntry(raw, i);
    return `
      <div class="match-card">
        <div class="side red">
          <div class="tn">Red</div>
          <div>${m.redName}</div>
          <div class="sc">${String(m.redScore).padStart(2, '0')}</div>
        </div>
        <div class="mid">
          Match ${m.id}<br>
          ${m.when}<br>
          <span class="winner">
            ${m.winner === 'draw' ? 'Draw' : 'Winner: ' + (m.winner === 'red' ? 'Red' : 'Blue')}
          </span>
          <br>
          <button class="btn small danger" onclick="deleteHistoryEntry('${raw.matchId}')" style="margin-top:10px;">✕ Delete</button>
        </div>
        <div class="side blue">
          <div class="tn">Blue</div>
          <div>${m.blueName}</div>
          <div class="sc">${String(m.blueScore).padStart(2, '0')}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteAllMatchHistory() {
  const confirmed = confirm("Are you sure you want to delete ALL match history?");
  if (!confirmed) return;

  try {
    console.log("[history] deleting all match history...");
    const response = await api.deleteMatchHistory();
    console.log("[history] deleted successfully:", response);
    matchHistory = [];
    renderHistory();
    alert("Match history deleted successfully.");
  } catch (error) {
    console.error("[history] delete failed:", error);
    alert("Failed to delete match history. Check the server.");
  }
}

async function deleteHistoryEntry(matchId) {
  const confirmed = confirm("Are you sure you want to delete this match history?");
  if (!confirmed) return;

  try {
    console.log("[history] deleting entry:", matchId);
    const response = await api.deleteHistoryEntry(matchId);
    console.log("[history] entry deleted successfully:", response);
    matchHistory = matchHistory.filter(entry => entry.matchId !== matchId);
    renderHistory();
  } catch (error) {
    console.error("[history] individual delete failed:", error);
    alert("Failed to delete this match history.");
  }
}

function collectSettingsPayload() {
  const s = document.getElementById('screen-settings');
  if (!s) return {};
  const nums = [...s.querySelectorAll('input[type="number"]')].map(i => Number(i.value));
  const selects = [...s.querySelectorAll('select')].map(sel => sel.value);
  const toggles = [...s.querySelectorAll('.switch')].map(sw => sw.classList.contains('on'));
  const range = s.querySelector('input[type="range"]');
  return {
    matchDurationMin: nums[0], intenseModeTriggerSec: nums[1], goalLimit: nums[2],
    kickerCooldownSec: nums[3], empCooldownSec: nums[4],
    winCondition: selects[0], lightingMode: selects[1],
    suddenDeathOnTie: toggles[0], autoPauseOnDisconnect: toggles[1],
    kickerEnabled: toggles[2], empEnabled: toggles[3],
    confettiOnGoal: toggles[4], arenaShakeOnGoal: toggles[5], ledSweepInIntense: toggles[6],
    goalSound: toggles[7], intenseModeMusic: toggles[8], matchEndMusic: toggles[9],
    masterVolume: range ? Number(range.value) : undefined,
  };
}

async function loadSettingsFromBackend() {
  try {
    const response = await api.getSettings();
    const settings = response?.settings ?? response;
    if (!settings) {
      throw new Error("Settings not received from backend");
    }
    const screen = document.getElementById("screen-settings");
    if (!screen) return;

    const nums = [...screen.querySelectorAll('input[type="number"]')];
    if (nums[0]) nums[0].value = settings.matchDurationMin;
    if (nums[1]) nums[1].value = settings.intenseModeTriggerSec;
    if (nums[2]) nums[2].value = settings.goalLimit;
    if (nums[3]) nums[3].value = settings.kickerCooldownSec;
    if (nums[4]) nums[4].value = settings.empCooldownSec;

    const selects = [...screen.querySelectorAll("select")];
    if (selects[0]) selects[0].value = settings.winCondition;
    if (selects[1]) selects[1].value = settings.lightingMode;

    const values = [
      settings.suddenDeathOnTie,
      settings.autoPauseOnDisconnect,
      settings.kickerEnabled,
      settings.empEnabled,
      settings.confettiOnGoal,
      settings.arenaShakeOnGoal,
      settings.ledSweepInIntense,
      settings.goalSound,
      settings.intenseModeMusic,
      settings.matchEndMusic,
    ];
    const switches = [...screen.querySelectorAll(".switch")];
    switches.forEach((sw, index) => {
      sw.classList.toggle("on", Boolean(values[index]));
    });

    const range = screen.querySelector('input[type="range"]');
    if (range && settings.masterVolume !== undefined) {
      range.value = settings.masterVolume;
    }
    console.log("[settings] loaded from backend", settings);
  } catch (error) {
    console.error("[settings] failed to load:", error);
  }
}

async function saveSettingsToBackend() {
  try {
    const payload = collectSettingsPayload();
    console.log("[settings] saving:", payload);
    const response = await api.saveSettings(payload);
    const settings = response?.settings ?? response;
    console.log("[settings] saved successfully:", settings);
    alert("Settings saved successfully.");
  } catch (error) {
    console.error("[settings] save failed:", error);
    alert("Failed to save settings. Check the server.");
  }
}

function setupSettingsBackend() {
  const screen = document.getElementById("screen-settings");
  if (!screen) return;
  const saveButton = screen.querySelector("button");
  if (!saveButton) return;
  if (saveButton.textContent.trim().toLowerCase().includes("save settings")) {
    saveButton.addEventListener("click", saveSettingsToBackend);
  }
}
