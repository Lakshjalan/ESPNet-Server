// UI Rendering and Animation Helpers
function setTimer(el, text) { 
  if (!el) return;
  const parts = text.split(':'); 
  el.innerHTML = parts[0] + '<span class="colon">:</span>' + parts[1]; 
}

function showScreen(name, el) {
  document.querySelectorAll('.nav-btn, .nav button').forEach(b => {
    b.classList.remove('active', 'border-b-2', 'border-text-primary', 'text-text-primary');
    b.classList.add('text-text-secondary');
  });
  if (el) {
    el.classList.add('active', 'border-b-2', 'border-text-primary', 'text-text-primary');
    el.classList.remove('text-text-secondary');
  }
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
  const timerEl = document.getElementById('timer');
  if (timerEl) setTimer(timerEl, fmtClock(matchSeconds));
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
  return `<div class="text-xs text-text-secondary py-2">${msg}</div>`; 
}

function shortMac(mac) { 
  return mac ? mac.slice(-8) : '—'; 
}

function changeDeviceTeam(mac, team) {
  api.setDeviceTeam(mac, team || null).then(bootstrapFromBackend).catch(err => alert("Team update failed: " + err.message));
}

function changeDeviceNodeType(mac, nodeType) {
  api.setDeviceType(mac, nodeType || null).then(bootstrapFromBackend).catch(err => alert("Node type update failed: " + err.message));
}

function removeDevice(mac) {
  if (!confirm("Remove device " + mac + "?")) return;
  api.deleteDevice(mac).then(bootstrapFromBackend).catch(err => alert("Delete device failed: " + err.message));
}

function pairControllerToTruck(controllerMac, selectId) {
  const truckSel = document.getElementById(selectId);
  if (!truckSel || !truckSel.value) return;
  api.pairDevices(controllerMac, truckSel.value).then(bootstrapFromBackend).catch(err => alert("Pairing failed: " + err.message));
}

function unpairController(mac) {
  api.unpairDevice(mac).then(bootstrapFromBackend).catch(err => alert("Unpairing failed: " + err.message));
}

function renderFleet(devices) {
  const controllersEl = document.getElementById('fleetControllers');
  const trucksEl = document.getElementById('fleetTrucks');
  const lightingEl = document.getElementById('fleetLighting');
  const unassignedEl = document.getElementById('fleetUnassigned');
  
  if (!devices || !devices.length) {
    if (controllersEl) controllersEl.innerHTML = emptyState('No controllers connected.');
    if (trucksEl) trucksEl.innerHTML = emptyState('No trucks connected.');
    if (lightingEl) lightingEl.innerHTML = emptyState('No lighting rigs connected.');
    if (unassignedEl) unassignedEl.innerHTML = emptyState('No unassigned devices.');
    const connDevices = document.getElementById('connDevices');
    if (connDevices) connDevices.textContent = '—';
    return;
  }

  const row = (d) => {
    const name = d.label || (d.team ? d.team.toUpperCase() + ' · ' : '') + shortMac(d.mac);
    return `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-surface-container-low border border-border-subtle rounded-lg gap-2">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-semibold text-text-primary">${name}</span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded ${d.isOnline ? 'bg-status-ready/20 text-status-ready' : 'bg-text-secondary/20 text-text-secondary'}">${d.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <div class="text-xs text-text-secondary font-mono">${d.mac} · IP: ${d.ip || 'N/A'} ${d.batteryPct != null ? '· Battery: ' + d.batteryPct + '%' : ''}</div>
        </div>
        <div class="flex items-center gap-2">
          <select onchange="changeDeviceTeam('${d.mac}', this.value)" class="bg-surface-container border border-border-subtle rounded text-xs px-2 py-1 text-text-primary focus:outline-none">
            <option value="" ${!d.team ? 'selected' : ''}>Unassigned Team</option>
            <option value="red" ${d.team === 'red' ? 'selected' : ''}>Red Team</option>
            <option value="blue" ${d.team === 'blue' ? 'selected' : ''}>Blue Team</option>
          </select>
          <select onchange="changeDeviceNodeType('${d.mac}', this.value)" class="bg-surface-container border border-border-subtle rounded text-xs px-2 py-1 text-text-primary focus:outline-none">
            <option value="" ${!d.nodeType ? 'selected' : ''}>Unassigned Type</option>
            <option value="controller" ${d.nodeType === 'controller' ? 'selected' : ''}>Controller</option>
            <option value="truck" ${d.nodeType === 'truck' ? 'selected' : ''}>Truck</option>
            <option value="lighting" ${d.nodeType === 'lighting' ? 'selected' : ''}>Lighting</option>
          </select>
          <button onclick="removeDevice('${d.mac}')" class="px-2 py-1 text-xs border border-status-error/40 text-status-error hover:bg-status-error/10 rounded transition-colors">Delete</button>
        </div>
      </div>
    `;
  };

  const controllers = devices.filter(d => d.nodeType === 'controller');
  const trucks = devices.filter(d => d.nodeType === 'truck');
  const lighting = devices.filter(d => d.nodeType === 'lighting');
  const unassigned = devices.filter(d => !d.nodeType);
  
  if (controllersEl) controllersEl.innerHTML = controllers.map(row).join('') || emptyState('No controllers connected.');
  if (trucksEl) trucksEl.innerHTML = trucks.map(row).join('') || emptyState('No trucks connected.');
  if (lightingEl) lightingEl.innerHTML = lighting.map(row).join('') || emptyState('No lighting rigs connected.');
  if (unassignedEl) unassignedEl.innerHTML = unassigned.map(row).join('') || emptyState('No unassigned devices.');

  const onlineCount = devices.filter(d => d.isOnline).length;
  const connDevices = document.getElementById('connDevices');
  if (connDevices) connDevices.textContent = `${onlineCount}/${devices.length} devices online`;
}

function renderPairing(devices) {
  const el = document.getElementById('pairingList');
  if (!el) return;
  const controllers = devices.filter(d => d.nodeType === 'controller');
  const trucks = devices.filter(d => d.nodeType === 'truck');

  if (!controllers.length) {
    el.innerHTML = emptyState('No controllers connected to pair.');
    return;
  }

  el.innerHTML = controllers.map((c, idx) => {
    const pairedTruck = c.pairedMac ? devices.find(d => d.mac === c.pairedMac) : null;
    const cName = c.label || (c.team ? c.team.toUpperCase() + ' · ' : '') + shortMac(c.mac);
    const selectId = `truckSelect_${idx}`;

    let rightSide = '';
    if (pairedTruck) {
      const tName = pairedTruck.label || (pairedTruck.team ? pairedTruck.team.toUpperCase() + ' · ' : '') + shortMac(pairedTruck.mac);
      rightSide = `
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm font-semibold text-text-primary">${tName}</span>
          <button onclick="unpairController('${c.mac}')" class="px-3 py-1 border border-status-error/40 text-status-error hover:bg-status-error/10 text-xs rounded font-semibold transition-colors">Unpair</button>
        </div>
      `;
    } else {
      const availableTrucks = trucks.filter(t => !t.pairedMac || t.pairedMac === c.mac);
      rightSide = `
        <div class="flex items-center gap-2">
          <select id="${selectId}" class="bg-surface-container border border-border-subtle text-xs text-text-primary rounded px-2 py-1 focus:outline-none">
            <option value="">Select Truck...</option>
            ${availableTrucks.map(t => `<option value="${t.mac}">${t.label || t.mac}</option>`).join('')}
          </select>
          <button onclick="pairControllerToTruck('${c.mac}', '${selectId}')" class="px-3 py-1 bg-text-primary text-background text-xs font-headline font-bold rounded hover:opacity-90 transition-opacity">Pair</button>
        </div>
      `;
    }

    return `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-surface-container-low border border-border-subtle rounded-xl gap-2">
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm font-semibold text-text-primary">${cName}</span>
          <span class="text-xs text-text-secondary font-mono">${c.mac}</span>
        </div>
        <span class="material-symbols-outlined text-text-secondary hidden sm:inline">arrow_forward</span>
        ${rightSide}
      </div>
    `;
  }).join('');
}

function refreshPowerupPills(devices) {
  const now = Date.now();
  ['red', 'blue'].forEach(side => {
    const controller = devices.find(d => d.nodeType === 'controller' && d.team === side);
    const truck = controller?.pairedMac ? devices.find(d => d.mac === controller.pairedMac) : null;

    // Fleet card: controller dot + battery
    const ctrlDot  = document.getElementById(side + 'ControllerDot');
    const ctrlBatt = document.getElementById(side + 'ControllerBatt');
    if (ctrlDot)  ctrlDot.className  = 'w-2 h-2 rounded-full ' + (controller?.isOnline ? 'bg-status-ready' : 'bg-text-secondary/40');
    if (ctrlBatt) ctrlBatt.textContent = controller?.batteryPct != null ? controller.batteryPct + '%' : '—';

    // Fleet card: truck dot + kicker card
    const truckDot   = document.getElementById(side + 'TruckDot');
    const kickerCard = document.getElementById(side + 'KickerCard');
    if (truckDot) truckDot.className = 'w-2 h-2 rounded-full ' + (truck?.isOnline ? 'bg-status-ready' : 'bg-text-secondary/40');

    // Powerup strip
    const kickerEl = document.getElementById(side + 'kicker');
    const empEl    = document.getElementById(side + 'emp');
    if (!kickerEl || !empEl) return;
    if (!controller) {
      kickerEl.textContent = 'No controller'; kickerEl.className = 'font-mono text-xs text-text-secondary';
      empEl.textContent    = 'No controller'; empEl.className    = 'font-mono text-xs text-text-secondary';
      if (kickerCard) { kickerCard.textContent = '—'; kickerCard.className = 'font-mono text-status-ready'; }
      return;
    }
    const kickerReady = !controller.kickerCooldownUntil || controller.kickerCooldownUntil <= now;
    kickerEl.className = kickerReady ? 'font-mono text-xs text-status-ready' : 'font-mono text-xs text-status-warning';
    kickerEl.textContent = kickerReady ? 'READY' : Math.ceil((controller.kickerCooldownUntil - now) / 1000) + 's';
    empEl.className = controller.powerupEmpReady ? 'font-mono text-xs text-status-ready' : 'font-mono text-xs text-status-warning';
    empEl.textContent = controller.powerupEmpReady ? 'READY' : 'LOCKED';

    if (kickerCard) {
      kickerCard.className = kickerReady ? 'font-mono text-status-ready' : 'font-mono text-status-warning';
      kickerCard.textContent = kickerReady ? 'Ready' : Math.ceil((controller.kickerCooldownUntil - now) / 1000) + 's';
    }
  });
}

function renderAudio() {
  const playbackEl = document.getElementById('audioPlayback');
  const soundsEl = document.getElementById('audioEventSounds');
  if (playbackEl) {
    playbackEl.innerHTML = `
      <div class="text-xs text-text-secondary mb-3">
        Spotify ducking is handled server-side via OAuth integration.
      </div>
      <a class="px-4 py-2 bg-text-primary text-background font-headline font-bold text-xs uppercase rounded-lg inline-block hover:opacity-90" href="/auth/spotify/login">Connect Spotify</a>`;
  }
  if (soundsEl) {
    soundsEl.innerHTML = emptyState('Event sounds play from built-in Web Audio synth on WebSocket events.');
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
    el.innerHTML = '<span id="tickerEmpty" class="text-text-secondary">No events yet — match ready.</span>';
    return;
  }
  el.innerHTML = tickerEvents.map(e => `<span class="mr-4"><b>${e.label}</b>${e.detail ? ' · ' + e.detail : ''}</span>`).join('');
}

function renderPlayers() {
  const tbody = document.getElementById('playersBody');
  if (!tbody) return;
  tbody.innerHTML = players.map(p => `
    <tr class="border-b border-border-subtle text-sm">
      <td class="py-3 px-2 font-medium text-text-primary">${p.name}</td>
      <td class="py-3 px-2"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${p.team === 'red' ? 'bg-team-red/20 text-team-red' : p.team === 'blue' ? 'bg-team-blue/20 text-team-blue' : 'bg-surface-container text-text-secondary'}">${p.team === 'bench' || !p.team ? 'Bench' : p.team}</span></td>
      <td class="py-3 px-2 font-mono text-xs text-text-secondary">${p.controller || p.controllerMac || '—'}</td>
      <td class="py-3 px-2 font-mono text-xs">${p.matches}</td>
      <td class="py-3 px-2 font-mono text-xs">${p.wins}</td>
      <td class="py-3 px-2">
        <div class="switch ${p.available ? 'on' : ''}" onclick="togglePlayerAvailable('${p.id}')" title="${p.available ? 'Available' : 'Unavailable'}"><div class="knob"></div></div>
      </td>
      <td class="py-3 px-2 text-right"><button class="text-status-error text-xs hover:underline font-semibold" onclick="removePlayer('${p.id}')">Remove</button></td>
    </tr>`).join('');
  renderPlayerSelects();
  renderCurrentMatchBanner();
}

function toggleSwitch(el) { 
  if (el) el.classList.toggle('on'); 
}

function renderQueue() {
  const listEl = document.getElementById('queueList');
  const emptyEl = document.getElementById('queueEmpty');
  if (!listEl || !emptyEl) return;
  if (!matchQueue || matchQueue.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = matchQueue.map(q => {
    const redId = q.playerRedId ?? q.redId;
    const blueId = q.playerBlueId ?? q.blueId;
    const redP = players.find(p => String(p.id) === String(redId));
    const blueP = players.find(p => String(p.id) === String(blueId));
    return `
      <div class="flex items-center justify-between p-3 bg-surface-container-low border border-border-subtle rounded-lg">
        <div class="font-headline font-bold text-sm">
          <span class="text-team-red">${redP ? redP.name : 'Unknown'}</span>
          <span class="text-text-secondary px-2">VS</span>
          <span class="text-team-blue">${blueP ? blueP.name : 'Unknown'}</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="px-3 py-1 bg-text-primary text-background font-headline font-bold text-xs rounded hover:opacity-90" onclick="startQueueMatch('${q.id}')">Start</button>
          <button class="px-3 py-1 border border-status-error/40 text-status-error text-xs font-semibold rounded hover:bg-status-error/10" onclick="removeFromQueue('${q.id}')">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}
