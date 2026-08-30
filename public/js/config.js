// Configuration for the RoboSoccer Dashboard
var CONFIG = {
  // Same-origin by default. Set to a specific host (e.g. "http://192.168.1.50:8880") if needed.
  API_BASE: "",
  // WebSocket URL, auto-computed from host
  WS_URL: (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws",
};
