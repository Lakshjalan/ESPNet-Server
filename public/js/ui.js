// UI Rendering and Animation Helpers
function setTimer(el, text) { 
  if (!el) return;
  const parts = text.split(':'); 
  el.innerHTML = parts[0] + '<span class="colon">:</span>' + parts[1]; 
}

function showScreen(name, el) {
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const targetScreen = document.getElementById('screen-' + name);
  if (targetScreen) targetScreen.classList.add('active');
}

function burstConfetti(color) {
  const box = document.getElementById('confetti');
  if (!box) return;
  box.innerHTML = '';
  const colors = [color, '#ffcf4d', '#ffffff'];
  for (let i = 0; i < 24; i++) {
    const c = document.createElement('i');
    c.style.left = (Math.random() * 100) + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = (Math.random() * .4) + 's';
    c.style.animationDuration = (1.2 + Math.random() * .8) + 's';
    box.appendChild(c);
  }
}

var __ballTimer1 = null, __ballTimer2 = null, __ballTimer3 = null;

function triggerTruckKick(side) {
  const truck = document.querySelector('.truckside.' + side);
  if (!truck) return;
  truck.classList.remove('kicking');
  void truck.offsetWidth;
  truck.classList.add('kicking');
  setTimeout(() => truck.classList.remove('kicking'), 650);
}

function kickBallTo(direction, side) {
  const ballWrap = document.getElementById('ballWrap');
  const goal = document.querySelector('.goalpost.' + direction);
  if (!ballWrap || !goal) return;
  clearTimeout(__ballTimer1); 
  clearTimeout(__ballTimer2); 
  clearTimeout(__ballTimer3);

  const ballRect = ballWrap.getBoundingClientRect();
  const goalRect = goal.getBoundingClientRect();
  const dx = (goalRect.left + goalRect.width / 2) - (ballRect.left + ballWrap.offsetWidth / 2);
  ballWrap.style.setProperty('--kick-dx', dx + 'px');

  ballWrap.classList.remove('returning');
  ballWrap.classList.add('kicking');
  triggerTruckKick(side);

  __ballTimer1 = setTimeout(() => {
    goal.classList.add('flash');
    setTimeout(() => goal.classList.remove('flash'), 550);
  }, 830);

  __ballTimer2 = setTimeout(() => {
    ballWrap.classList.remove('kicking');
    void ballWrap.offsetWidth;
    ballWrap.classList.add('returning');
  }, 900);

  __ballTimer3 = setTimeout(() => {
    ballWrap.classList.remove('returning');
  }, 1400);
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function refSyncDisplay() {
  setTimer(document.getElementById('timer'), fmtClock(matchSeconds));
  const clockLine = document.getElementById('refClockLine');
  const scoreLine = document.getElementById('refScoreLine');
  if (clockLine) clockLine.textContent = fmtClock(matchSeconds);
  if (scoreLine) scoreLine.textContent = String(redScore).padStart(2, '0') + ' – ' + String(blueScore).padStart(2, '0');
}

function refSetStateLine(label) { 
  const el = document.getElementById('refStateLine');
  if (el) el.textContent = label; 
}

function emptyState(msg) { 
  return `<div style="font-size:12px;color:var(--sub);padding:6px 0;">${msg}</div>`; 
}

function shortMac(mac) { 
  return mac ? mac.slice(-8) : '—'; 
}

function renderFleet(devices) {
  const controllersEl = document.getElementById('fleetControllers');
  const trucksEl = document.getElementById('fleetTrucks');
  const lightingEl = document.getElementById('fleetLighting');
  if (!devices || !devices.length) {
    if (controllersEl) controllersEl.innerHTML = emptyState('No controllers have connected yet.');
    if (trucksEl) trucksEl.innerHTML = emptyState('No trucks have connected yet.');
    if (lightingEl) lightingEl.innerHTML = emptyState('No lighting rig has connected yet.');
    const connDevices = document.getElementById('connDevices');
    if (connDevices) connDevices.textContent = '—';
    return;
  }
  const row = (d) => {
    const name = d.label || (d.team ? d.team.toUpperCase() + ' · ' : '') + shortMac(d.mac);
    const meta = [d.team ? d.team : null, d.batteryPct != null ? d.batteryPct + '%' : null, d.mac].filter(Boolean).join(' · ');
    return `<div class="device"><div><div class="name">${name}</div><div class="meta">${meta}</div></div><span class="${d.isOnline ? 'stat-online' : 'stat-offline'}">${d.isOnline ? 'Online' : 'Offline'}</span></div>`;
  };
  const controllers = devices.filter(d => d.nodeType === 'controller');
  const trucks = devices.filter(d => d.nodeType === 'truck');
  const lighting = devices.filter(d => d.nodeType === 'lighting');
  if (controllersEl) controllersEl.innerHTML = controllers.map(row).join('') || emptyState('No controllers have connected yet.');
  if (trucksEl) trucksEl.innerHTML = trucks.map(row).join('') || emptyState('No trucks have connected yet.');
  if (lightingEl) lightingEl.innerHTML = lighting.map(row).join('') || emptyState('No lighting rig has connected yet.');
  const onlineCount = devices.filter(d => d.isOnline).length;
  const connDevices = document.getElementById('connDevices');
  if (connDevices) connDevices.textContent = `${onlineCount}/${devices.length} devices`;
  setConnStatus(onlineCount > 0 ? 'Arena online' : 'No devices online', onlineCount > 0);
}

function renderPairing(devices) {
  const el = document.getElementById('pairingList');
  if (!el) return;
  const controllers = devices.filter(d => d.nodeType === 'controller');
  if (!controllers.length) { el.innerHTML = emptyState('No controllers have connected yet.'); return; }
  el.innerHTML = controllers.map(c => {
    const truck = c.pairedMac ? devices.find(d => d.mac === c.pairedMac) : null;
    const cName = c.label || (c.team ? c.team.toUpperCase() + ' · ' : '') + shortMac(c.mac);
    const tName = truck ? (truck.label || 'Truck · ' + shortMac(truck.mac)) : '—';
    return `<div class="pair-chain"><div class="node">${cName}</div><div class="arrow">→</div>
      <div class="node">${tName}</div>
      <span class="${truck ? 'stat-online' : 'stat-offline'}">${truck ? 'Linked' : 'Not paired'}</span></div>`;
  }).join('');
}

function refreshPowerupPills(devices) {
  const now = Date.now();
  ['red', 'blue'].forEach(side => {
    const controller = devices.find(d => d.nodeType === 'controller' && d.team === side);
    const kickerEl = document.getElementById(side + 'kicker');
    const empEl = document.getElementById(side + 'emp');
    if (!kickerEl || !empEl) return;
    if (!controller) {
      kickerEl.textContent = 'Kicker · No controller'; kickerEl.classList.remove('ready');
      empEl.textContent = 'EMP · No controller'; empEl.classList.remove('ready');
      return;
    }
    const kickerReady = !controller.kickerCooldownUntil || controller.kickerCooldownUntil <= now;
    kickerEl.classList.toggle('ready', kickerReady);
    kickerEl.textContent = kickerReady ? 'Kicker · Ready' : 'Kicker · ' + Math.ceil((controller.kickerCooldownUntil - now) / 1000) + 's';
    empEl.classList.toggle('ready', !!controller.powerupEmpReady);
    empEl.textContent = 'EMP · ' + (controller.powerupEmpReady ? 'Ready' : 'Not unlocked');
  });
}

function renderAudio() {
  const playbackEl = document.getElementById('audioPlayback');
  const soundsEl = document.getElementById('audioEventSounds');
  if (playbackEl) {
    playbackEl.innerHTML = `
      <div style="font-size:12px;color:var(--sub);margin-bottom:10px;">
        Spotify ducking is handled server-side (OAuth, safe no-op if unconfigured).
        There's no live "now playing" endpoint yet — see BACKEND_TODO.md if you want one.
      </div>
      <a class="btn-primary" style="display:inline-block;text-decoration:none;" href="/auth/spotify/login">Connect Spotify</a>`;
  }
  if (soundsEl) {
    soundsEl.innerHTML = emptyState('Event sounds play from the built-in Web Audio synth on audio_event / light_event — no per-sound toggle exists in the API yet.');
  }
}

var tickerEvents = [];
function pushTickerEvent(entry) {
  tickerEvents.unshift(entry);
  tickerEvents = tickerEvents.slice(0, 8);
  renderTicker();
}

function renderTicker() {
  const el = document.getElementById('ticker');
  if (!el) return;
  if (!tickerEvents.length) {
    el.innerHTML = '<span id="tickerEmpty" style="color:var(--sub);">No events yet — actions will appear here as they happen.</span>';
    return;
  }
  el.innerHTML = tickerEvents.map(e => `<span><b>${e.label}</b>${e.detail ? ' · ' + e.detail : ''}</span>`).join('');
}

function renderPlayers() {
  const tbody = document.getElementById('playersBody');
  if (!tbody) return;
  tbody.innerHTML = players.map(p => `
    <tr>
      <td>${p.name}</td>
      <td><span class="team-badge ${p.team}">${p.team === 'bench' ? 'Bench' : p.team}</span></td>
      <td>${p.controller}</td>
      <td>${p.matches}</td>
      <td>${p.wins}</td>
      <td>
        <div class="switch status-switch ${p.available ? 'on' : ''}" onclick="togglePlayerAvailable('${p.id}')" title="${p.available ? 'Available' : 'Unavailable'}"><div class="knob"></div></div>
      </td>
      <td><button class="icon-btn" onclick="removePlayer('${p.id}')">✕ Remove</button></td>
    </tr>`).join('');
  renderPlayerSelects();
  renderCurrentMatchBanner();
}

function toggleSwitch(el) { 
  if (el) el.classList.toggle('on'); 
}
