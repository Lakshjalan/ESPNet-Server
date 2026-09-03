// REST API and WebSocket Connection Manager
async function apiCall(path, options = {}) {
  const res = await fetch(CONFIG.API_BASE + path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error("API error " + res.status + " on " + path);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function normalizePlayer(raw) {
  const p = raw?.player ?? raw;
  return {
    id: p.id,
    name: p.name ?? '',
    team: p.team ?? 'bench',
    controller: p.controller ?? p.controllerMac ?? '—',
    controllerMac: p.controllerMac ?? null,
    matches: p.matches ?? 0,
    wins: p.wins ?? 0,
    available: p.available ?? true,
    createdAt: p.createdAt
  };
}

var api = { 
  getStatus:          () => apiCall("/api/status"), 
  getSettings:        () => apiCall("/api/settings"),
  saveSettings:       (settings) => apiCall("/api/settings", { method: "PUT", body: settings }),
  getDevices:         () => apiCall("/api/devices"), 
  setDeviceTeam:      (mac, team) => apiCall(`/api/devices/${mac}/team`, { method: "PUT", body: { team } }), 
  setDeviceType:      (mac, nodeType) => apiCall(`/api/devices/${mac}/node-type`, { method: "PUT", body: { nodeType } }), 
  setDeviceLabel:     (mac, label) => apiCall(`/api/devices/${mac}/label`, { method: "PUT", body: { label } }), 
  deleteDevice:       (mac) => apiCall(`/api/devices/${mac}`, { method: "DELETE" }), 
  getMatchState:      () => apiCall("/api/match/state"), 
  getMatchHistory:    () => apiCall("/api/match/history"), 
  deleteMatchHistory: () => apiCall("/api/match/history", { method: "DELETE" }),
  deleteHistoryEntry: (matchId) => apiCall(`/api/match/history/${matchId}`, { method: "DELETE" }),
  startMatch:         (playerRedName, playerBlueName) => apiCall("/api/match/start", { method: "POST", body: { playerRedName, playerBlueName } }), 
  pauseMatch:         () => apiCall("/api/match/pause", { method: "POST" }), 
  resumeMatch:        () => apiCall("/api/match/resume", { method: "POST" }), 
  resetMatch:         () => apiCall("/api/match/reset", { method: "POST" }), 
  adjustTime:         (deltaMs) => apiCall("/api/match/time", { method: "POST", body: { deltaMs } }), 
  scoreGoal:          (team) => apiCall("/api/match/goal", { method: "POST", body: { team } }), 
  undoGoal:           () => apiCall("/api/match/undo", { method: "POST" }), 
  triggerKick:        (mac) => apiCall("/api/powerups/kick", { method: "POST", body: { mac } }), 
  triggerEmp:         (mac, targetTeam) => apiCall("/api/powerups/emp", { method: "POST", body: { mac, targetTeam } }), 
  pingDevice:         (mac) => apiCall(`/api/test/ping/${mac}`, { method: "POST" }),
  testKick:           (team) => apiCall(`/api/test/kick/${team}`, { method: "POST" }),
  testEmp:            (attackerTeam) => apiCall(`/api/test/emp/${attackerTeam}`, { method: "POST" }),
  simKick:            (mac) => apiCall(`/api/test/sim-kick/${mac}`, { method: "POST" }),
  simEmp:             (mac) => apiCall(`/api/test/sim-emp/${mac}`, { method: "POST" }),
  getPlayers: async () => { 
    const res = await apiCall("/api/players"); 
    const list = Array.isArray(res) ? res : (res?.players ?? []); 
    return list.map(normalizePlayer); 
  }, 
  addPlayer: async (player) => { 
    const backendPlayer = { 
      name: player.name, 
      team: player.team === "bench" ? null : player.team, 
      controllerMac: player.controllerMac ?? null 
    }; 
    const res = await apiCall("/api/players", { method: "POST", body: backendPlayer }); 
    return normalizePlayer(res); 
  }, 
  updatePlayer: async (id, patch) => { 
    const res = await apiCall(`/api/players/${id}`, { method: "PUT", body: patch }); 
    return normalizePlayer(res); 
  }, 
  removePlayer: async (id) => { 
    return apiCall(`/api/players/${id}`, { method: "DELETE" }); 
  }, 
  getQueue:           () => apiCall("/api/queue"), 
  addToQueue:         (redPlayerId, bluePlayerId) => apiCall("/api/queue", { method: "POST", body: { redPlayerId, bluePlayerId } }), 
  removeFromQueue:    (id) => apiCall(`/api/queue/${id}`, { method: "DELETE" }), 
  reassignQueue:      (id, side, playerId) => apiCall(`/api/queue/${id}`, { method: "PATCH", body: { side, playerId } }), 
  startQueueMatch:    (id) => apiCall(`/api/queue/${id}/start`, { method: "POST" }), 
};

// Tiny pub/sub so WebSocket events and local fallback code can share renderers
var bus = { 
  handlers: {}, 
  on(type, fn){ (this.handlers[type] ||= []).push(fn); }, 
  emit(type, payload){ (this.handlers[type]||[]).forEach(fn=>fn(payload)); } 
};

function setConnStatus(text, ok) {
  const el = document.getElementById('connStatus');
  if (el) el.textContent = (ok ? '● ' : '○ ') + text;
}

var socket = null;
function connectWebSocket() {
  if (!CONFIG.WS_URL) { 
    setConnStatus('No backend configured', false); 
    return; 
  }
  socket = new WebSocket(CONFIG.WS_URL);
  socket.onopen = () => setConnStatus('Arena online', true);
  socket.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      bus.emit(msg.type, msg);
    } catch(e) { 
      console.error('Bad WS message', e); 
    }
  };
  socket.onclose = () => { 
    setConnStatus('Reconnecting…', false); 
    setTimeout(connectWebSocket, 2000); 
  };
  socket.onerror = () => setConnStatus('Connection error', false);
}
