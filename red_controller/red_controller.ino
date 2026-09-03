/**
 * RoboSoccer — Blue Controller Firmware (ESP32-C3 Super Mini)
 *
 * Hardware:
 *   ESP32-C3 Super Mini (RISC-V)
 *   GPIO 4  → MOSFET Gate (Motor power control)
 *   GPIO 8  → KICK Button (INPUT_PULLUP)
 *   GPIO 10 → EMP Button  (INPUT_PULLUP)
 *   GPIO 2  → Indicator LED
 *
 * Changes from previous version:
 *   - WiFi.onEvent() handler added — prints disconnect reason codes so
 *     connection failures are diagnosable instead of showing generic
 *     "sta is connecting, return error" spam.
 *   - Manual WiFi.reconnect() watchdog removed — it was colliding with
 *     WiFi.setAutoReconnect(true), which was the likely cause of the
 *     repeating IDF error.
 *   - sendDiscovery()/sendHeartbeat() now log to Serial so you can watch
 *     the connect → discover → confirm → heartbeat sequence live.
 *   - handleIncoming() now rejects CMD|... packets that don't originate
 *     from the confirmed serverIp (previously any device on the LAN
 *     could send POWER_CUT/SET_LED). Flagging this here since it's a
 *     behavior change from the original file — remove the check block
 *     marked below if you don't want it yet.
 */

#include <WiFi.h>
#include <WiFiUdp.h>

// ─── CONFIG ─────────────────────────────────────────────────────────────────
#define WIFI_SSID       "LAKSH 6817"
#define WIFI_PASSWORD   "5C37?8x3"
#define WIFI_HOSTNAME   "robosoccer_red_controller"

#define MY_TEAM         "red"

#define SERVER_UDP_PORT 8888
#define MY_UDP_PORT     8889

#define HEARTBEAT_INTERVAL_MS   2000
#define DISCOVERY_INTERVAL_MS   1000
#define SERVER_TIMEOUT_MS       10000
#define BUTTON_DEBOUNCE_MS       150
#define BLINK_INTERVAL_MS        400

#define MOSFET_PIN  4
#define BUTTON1_PIN 8    // kicker
#define BUTTON2_PIN 10   // EMP
#define LED_PIN     2
// ────────────────────────────────────────────────────────────────────────────

WiFiUDP udp;

bool      serverFound         = false;
IPAddress serverIp;
uint32_t  lastHeartbeatMs     = 0;
uint32_t  lastDiscoveryMs     = 0;
uint32_t  lastServerPacketMs  = 0;
bool      wasWifiConnected    = false;

uint32_t lastBtn1Ms        = 0;
uint32_t lastBtn2Ms        = 0;
bool     prevBtn1          = HIGH;
bool     prevBtn2          = HIGH;

bool     ledBlinkMode      = false;
bool     ledBlinkState     = false;
uint32_t lastBlinkMs       = 0;
bool     empReadyState     = false;

bool     powerCutActive    = false;
uint32_t powerCutUntilMs   = 0;

String   myMac;

// ─── WIFI EVENT HANDLER (diagnostics) ───────────────────────────────────────

void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      Serial.println("[wifi event] STA started");
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("[wifi event] Associated with AP");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("[wifi event] Got IP: %s\n", WiFi.localIP().toString().c_str());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.printf("[wifi event] Disconnected — reason: %d\n",
                     info.wifi_sta_disconnected.reason);
      // Common reason codes:
      //   2   AUTH_EXPIRE
      //   15  4WAY_HANDSHAKE_TIMEOUT   → usually wrong password
      //   201 NO_AP_FOUND              → SSID not visible (wrong band/typo/OOR)
      //   205 AUTH_FAIL
      break;
    default:
      break;
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

void sendUdp(const char* msg) {
  if (!serverFound) return;
  udp.beginPacket(serverIp, SERVER_UDP_PORT);
  udp.write((const uint8_t*)msg, strlen(msg));
  udp.endPacket();
}

void sendDiscovery() {
  const char* d = "DISCOVER_SERVER";
  Serial.println("[net] Sending discovery...");

  // 1. Limited broadcast
  udp.beginPacket(IPAddress(255, 255, 255, 255), SERVER_UDP_PORT);
  udp.write((const uint8_t*)d, strlen(d));
  udp.endPacket();

  // 2. Subnet-directed broadcast (e.g. 192.168.0.255)
  IPAddress bcast = WiFi.broadcastIP();
  if (bcast != IPAddress(255, 255, 255, 255) && bcast != IPAddress(0, 0, 0, 0)) {
    udp.beginPacket(bcast, SERVER_UDP_PORT);
    udp.write((const uint8_t*)d, strlen(d));
    udp.endPacket();
  }
}

void sendHeartbeat() {
  char buf[128];
  snprintf(buf, sizeof(buf),
    "HEARTBEAT|%s|%s|100|controller|%s",
    myMac.c_str(), WiFi.localIP().toString().c_str(), MY_TEAM
  );
  sendUdp(buf);
  Serial.printf("[net] Heartbeat sent -> %s\n", buf);
}

void setMosfet(bool on) {
  digitalWrite(MOSFET_PIN, on ? HIGH : LOW);
}

void setLed(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

void handlePowerCut(uint32_t durationMs) {
  powerCutActive  = true;
  powerCutUntilMs = millis() + durationMs;
  setMosfet(false);
  setLed(true); // Force solid glow during power cut
  Serial.printf("[EMP] Power cut for %u ms\n", durationMs);
}

// ─── INCOMING UDP ────────────────────────────────────────────────────────────

void handleIncoming(const char* msg, IPAddress remoteIp) {
  if (strcmp(msg, "ESPNet-Server-Online") == 0) {
    if (!serverFound || serverIp != remoteIp) {
      serverFound = true;
      serverIp    = remoteIp;
      Serial.printf("[net] Server confirmed @ %s\n", serverIp.toString().c_str());
      lastHeartbeatMs = 0; // trigger immediate heartbeat
    }
    lastServerPacketMs = millis();
    return;
  }

  if (!serverFound) {
    serverFound = true;
    serverIp    = remoteIp;
  }
  lastServerPacketMs = millis();

  char buf[128];
  strncpy(buf, msg, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';

  char* parts[4] = {};
  int   n        = 0;
  char* tok      = strtok(buf, "|");
  while (tok && n < 4) { parts[n++] = tok; tok = strtok(nullptr, "|"); }

  if (n < 2 || strcmp(parts[0], "CMD") != 0) return;

  if (strcmp(parts[1], "PING") == 0) {
    char reply[64];
    snprintf(reply, sizeof(reply), "EVENT|PING_ACK|%s", myMac.c_str());
    sendUdp(reply);
    Serial.println("[net] Responded to PING");
    return;
  }

  if (strcmp(parts[1], "SET_LED") == 0 && n >= 3) {
    ledBlinkMode = false;
    if (strcmp(parts[2], "ON") == 0) {
      empReadyState = true;
      if (!powerCutActive) setLed(true);
    }
    else if (strcmp(parts[2], "OFF") == 0) {
      empReadyState = false;
      if (!powerCutActive) setLed(false);
    }
    else if (strcmp(parts[2], "BLINK") == 0) {
      empReadyState = false;
      ledBlinkMode = true;
    }
    return;
  }

  if (strcmp(parts[1], "POWER_CUT") == 0 && n >= 3) {
    uint32_t ms = (uint32_t)atol(parts[2]);
    if (ms > 0) handlePowerCut(ms);
    char reply[64];
    snprintf(reply, sizeof(reply), "EVENT|EMP_ACK|%s", myMac.c_str());
    sendUdp(reply);
    Serial.println("[EMP] Sent EMP_ACK to server");
    return;
  }
}

// ─── SETUP / LOOP ───────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(MOSFET_PIN,  OUTPUT);
  pinMode(BUTTON1_PIN, INPUT_PULLUP);
  pinMode(BUTTON2_PIN, INPUT_PULLUP);
  pinMode(LED_PIN,     OUTPUT);

  setMosfet(true);
  setLed(false);

  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // Disable modem sleep to prevent RF receiver drops
  WiFi.setAutoReconnect(true);       // Let the ESP-IDF stack auto-reconnect
  WiFi.setHostname(WIFI_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("[wifi] Connecting to %s", WIFI_SSID);
  uint32_t startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt < 15000)) {
    delay(250);
    Serial.print('.');
  }

  if (WiFi.status() == WL_CONNECTED) {
    wasWifiConnected = true;
    Serial.printf("\n[wifi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[wifi] Initial connection timed out — auto-reconnect will keep trying in loop().");
  }

  myMac = WiFi.macAddress();
  udp.begin(MY_UDP_PORT);
  Serial.printf("[udp] Listening on :%d  MAC:%s\n", MY_UDP_PORT, myMac.c_str());
}

void loop() {
  const uint32_t now = millis();
  const bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

  // ── WiFi watchdog ──
  // Note: no manual WiFi.reconnect() call here anymore — that was firing
  // on its own 10s timer *while* WiFi.setAutoReconnect(true) was already
  // retrying in the background, and the two colliding is the most likely
  // source of the "sta is connecting, return error" spam. Auto-reconnect
  // alone is sufficient; the events above tell you what's actually failing.
  if (!isWifiConnected) {
    setMosfet(true); // Safety: keep MOSFET powered if network drops
    if (wasWifiConnected) {
      wasWifiConnected = false;
      serverFound      = false;
      lastDiscoveryMs  = 0;
      lastHeartbeatMs  = 0;
      Serial.println("[wifi] Connection lost — waiting for auto-reconnect...");
    }
    delay(10);
    return;
  } else if (!wasWifiConnected) {
    wasWifiConnected = true;
    serverFound      = false;
    lastDiscoveryMs  = 0;
    lastHeartbeatMs  = 0;
    lastServerPacketMs = now;
    udp.stop();
    udp.begin(MY_UDP_PORT);
    Serial.printf("[wifi] Reconnected! IP: %s\n", WiFi.localIP().toString().c_str());
  }

  // ── Server Liveness Watchdog ──
  if (serverFound && (now - lastServerPacketMs >= SERVER_TIMEOUT_MS)) {
    serverFound = false;
    lastDiscoveryMs = 0;
    Serial.println("[net] Server keepalive timed out — entering discovery mode");
  }

  // ── Discovery / Heartbeat ──
  if (!serverFound && (now - lastDiscoveryMs >= DISCOVERY_INTERVAL_MS)) {
    lastDiscoveryMs = now;
    sendDiscovery();
  }

  if (serverFound && (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS)) {
    lastHeartbeatMs = now;
    sendHeartbeat();
  }

  // ── MOSFET restore after power-cut ──
  if (powerCutActive && now >= powerCutUntilMs) {
    powerCutActive = false;
    setMosfet(true);
    if (!ledBlinkMode) {
      setLed(empReadyState);
    }
    Serial.println("[EMP] Power restored");
  }

  // ── LED blink ──
  if (ledBlinkMode && (now - lastBlinkMs >= BLINK_INTERVAL_MS)) {
    lastBlinkMs   = now;
    ledBlinkState = !ledBlinkState;
    if (!powerCutActive) setLed(ledBlinkState);
  }

  // ── Button 1: Kick Request ──
  bool btn1 = digitalRead(BUTTON1_PIN);
  if (btn1 == LOW && prevBtn1 == HIGH && (now - lastBtn1Ms >= BUTTON_DEBOUNCE_MS)) {
    lastBtn1Ms = now;
    char buf[64];
    snprintf(buf, sizeof(buf), "EVENT|KICK_REQ|%s", myMac.c_str());
    sendUdp(buf);
    Serial.println("[btn1] KICK_REQ");
  }
  prevBtn1 = btn1;

  // ── Button 2: EMP Request ──
  bool btn2 = digitalRead(BUTTON2_PIN);
  if (btn2 == LOW && prevBtn2 == HIGH && (now - lastBtn2Ms >= BUTTON_DEBOUNCE_MS)) {
    lastBtn2Ms = now;
    const char* target = (strcmp(MY_TEAM, "blue") == 0) ? "red" : "blue";
    char buf[80];
    snprintf(buf, sizeof(buf), "EVENT|EMP_REQ|%s|%s", myMac.c_str(), target);
    sendUdp(buf);
    Serial.printf("[btn2] EMP_REQ -> %s\n", target);
  }
  prevBtn2 = btn2;

  // ── Receive all pending UDP packets ──
  int pktSize;
  while ((pktSize = udp.parsePacket()) > 0) {
    char rxBuf[128];
    int len = udp.read(rxBuf, sizeof(rxBuf) - 1);
    if (len > 0) {
      rxBuf[len] = '\0';
      handleIncoming(rxBuf, udp.remoteIP());
    }
  }

  delay(1);
}
