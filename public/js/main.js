// Application Entry Point & Event Orchestration
document.addEventListener("DOMContentLoaded", () => {
  // Bind WebSocket event receivers to state updates
  bus.on('state', applyServerState);
  
  bus.on('powerup_rejected', (msg) => {
    pushTickerEvent({
      label: (msg.action === 'kick' ? 'KICKER' : 'EMP') + ' REJECTED', 
      detail: msg.reason || ''
    });
  });
  
  bus.on('history', (msg) => { 
    if (Array.isArray(msg.entries)) { 
      matchHistory = msg.entries; 
      renderHistory(); 
    } 
  });
  
  bus.on('players', (msg) => { 
    if (Array.isArray(msg.players)) { 
      players = msg.players; 
      renderPlayers(); 
    } 
  });
  
  bus.on('queue', (msg) => { 
    if (Array.isArray(msg.queue)) { 
      matchQueue = msg.queue; 
      renderQueue(); 
    } 
  });

  // Start background ticker loop for power-up pills liveness
  setInterval(() => { 
    if (latestDevices.length) {
      refreshPowerupPills(latestDevices); 
    }
  }, 1000);

  // Initialize UI components
  renderPlayers();
  renderQueue();
  renderHistory();
  renderAudio();
  renderTicker();
  refSyncDisplay();

  // Connect WebSocket & fetch initial backend datasets
  connectWebSocket();
  bootstrapFromBackend();
  loadSettingsFromBackend();
  setupSettingsBackend();

  console.log("[RoboSoccer] Frontend dashboard initialized");
});
