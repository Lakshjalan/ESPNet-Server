/**
 * RoboSoccer — Blue Controller Firmware (ESP32-S3 Super Mini)
 * [UPDATE]: Added LED sabotage logic, dual broadcast discovery, dynamic server tracking & modem sleep disabled
 */

#include <WiFi.h>
#include <WiFiUdp.h>

// ─── CONFIG ─────────────────────────────────────────────────────────────────
#define WIFI_SSID       "OpenWrt"
#define WIFI_PASSWORD   "Tonu@4059$"
#define WIFI_HOSTNAME   "robosoccer_blue_controller"

#define MY_TEAM         "blue"

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
uint32_t  lastWifiCheckMs     = 0;
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

// ─── HELPERS ────────────────────────────────────────────────────────────────

void sendUdp(const char* msg) {
  if (!serverFound) return;
  udp.beginPacket(serverIp, SERVER_UDP_PORT);
  udp.write((const uint8_t*)msg, strlen(msg));
  udp.endPacket();
}

void sendDiscovery() {
  const char* d = "DISCOVER_SERVER";
  
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
  lastServerPacketMs = millis();

  if (strcmp(msg, "ESPNet-Server-Online") == 0) {
    if (!serverFound || serverIp != remoteIp) {
      serverFound = true;
      serverIp    = remoteIp;
      Serial.printf("[net] Server confirmed @ %s\n", serverIp.toString().c_str());
      lastHeartbeatMs = 0;
    }
    return;
  }

  char buf[128];
  strncpy(buf, msg, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';

  char* parts[4] = {};
  int   n        = 0;
  char* tok      = strtok(buf, "|");
  while (tok && n < 4) { parts[n++] = tok; tok = strtok(nullptr, "|"); }

  if (n < 2 || strcmp(parts[0], "CMD") != 0) return;

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

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // Prevent WiFi modem sleep
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
    Serial.println("\n[wifi] Initial connection timed out, will retry in loop...");
  }

  myMac = WiFi.macAddress();
  udp.begin(MY_UDP_PORT);
  Serial.printf("[udp] Listening on :%d  MAC:%s\n", MY_UDP_PORT, myMac.c_str());
}

void loop() {
  const uint32_t now = millis();
  const bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

  // ── WiFi watchdog ──
  if (!isWifiConnected) {
    setMosfet(true); // Safety: enable MOSFET if network drops
    if (wasWifiConnected) {
      wasWifiConnected = false;
      serverFound      = false;
      lastDiscoveryMs  = 0;
      lastHeartbeatMs  = 0;
      Serial.println("[wifi] Connection lost — waiting for reconnect...");
    }
    if (now - lastWifiCheckMs >= 10000) {
      lastWifiCheckMs = now;
      WiFi.reconnect();
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
    const char* target = (strcmp(MY_TEAM, "red") == 0) ? "blue" : "red";
    char buf[80];
    snprintf(buf, sizeof(buf), "EVENT|EMP_REQ|%s|%s", myMac.c_str(), target);
    sendUdp(buf);
    Serial.printf("[btn2] EMP_REQ → %s\n", target);
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