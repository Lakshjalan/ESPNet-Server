/**
 * RoboSoccer — Red Truck Firmware (ESP32-S3 Super Mini)
 *
 * Wire protocol (ARCHITECTURE.md §3):
 *   TX → Server (UDP :8888)
 *     DISCOVER_SERVER                   — sent on boot / when disconnected until server replies
 *     HEARTBEAT|mac|ip|batt|truck|red   — every 2 s
 *
 *   RX ← Server (UDP :8889)
 *     ESPNet-Server-Online              — server found / alive
 *     CMD|KICK_FIRE                     — actuate servo 0°→90°→0°
 *
 * Hardware (ESP32-S3 Super Mini):
 *   GPIO 9  — Servo signal (kicker mechanism)
 */

#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESP32Servo.h>

// ─── CONFIG ─────────────────────────────────────────────────────────────────
#define WIFI_SSID       "LAKSH 6817"
#define WIFI_PASSWORD   "5C37?8x3"
#define WIFI_HOSTNAME   "robosoccer_red_truck"

#define MY_TEAM         "red"

#define SERVER_UDP_PORT 8888
#define MY_UDP_PORT     8889

#define HEARTBEAT_INTERVAL_MS   2000
#define DISCOVERY_INTERVAL_MS   1000
#define SERVER_TIMEOUT_MS       10000

// Kicker servo
#define SERVO_PIN      9
#define SERVO_REST     0    // degrees — resting position
#define SERVO_KICK     90   // degrees — kick position
#define KICK_HOLD_MS   200  // time to hold kick position
#define KICK_RETURN_MS 400  // time to return (total cycle ~600ms)
// ────────────────────────────────────────────────────────────────────────────

WiFiUDP  udp;
Servo    kickerServo;

bool      serverFound         = false;
IPAddress serverIp;
uint32_t  lastHeartbeatMs     = 0;
uint32_t  lastDiscoveryMs     = 0;
uint32_t  lastServerPacketMs  = 0;
uint32_t  lastWifiCheckMs     = 0;
bool      wasWifiConnected    = false;

// Kicker state machine (non-blocking)
bool     kickInProgress  = false;
bool     kickReturnPhase = false;
uint32_t kickPhaseEndMs  = 0;

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
    "HEARTBEAT|%s|%s|100|truck|%s",
    myMac.c_str(), WiFi.localIP().toString().c_str(), MY_TEAM
  );
  sendUdp(buf);
}

void startKick() {
  if (kickInProgress) return;   // already kicking, ignore duplicate
  kickInProgress  = true;
  kickReturnPhase = false;
  kickerServo.write(SERVO_KICK);
  kickPhaseEndMs  = millis() + KICK_HOLD_MS;
  Serial.println("[kick] Fired!");
}

// ─── INCOMING UDP ────────────────────────────────────────────────────────────

void handleIncoming(const char* msg, IPAddress remoteIp) {
  lastServerPacketMs = millis();

  if (strcmp(msg, "ESPNet-Server-Online") == 0) {
    if (!serverFound || serverIp != remoteIp) {
      serverFound = true;
      serverIp    = remoteIp;
      Serial.printf("[net] Server confirmed @ %s\n", serverIp.toString().c_str());
      // Trigger an immediate heartbeat on first connection
      lastHeartbeatMs = 0;
    }
    return;
  }

  char buf[64];
  strncpy(buf, msg, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';

  char* parts[3] = {};
  int   n        = 0;
  char* tok      = strtok(buf, "|");
  while (tok && n < 3) { parts[n++] = tok; tok = strtok(nullptr, "|"); }

  if (n >= 2 && strcmp(parts[0], "CMD") == 0) {
    if (strcmp(parts[1], "PING") == 0) {
      char reply[64];
      snprintf(reply, sizeof(reply), "EVENT|PING_ACK|%s", myMac.c_str());
      sendUdp(reply);
      Serial.println("[net] Responded to PING");
      return;
    }
    if (strcmp(parts[1], "KICK_FIRE") == 0) {
      startKick();
    }
  }
}

// ─── SETUP / LOOP ───────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);

  kickerServo.setPeriodHertz(50);
  kickerServo.attach(SERVO_PIN, 500, 2400);
  kickerServo.write(SERVO_REST);

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
    Serial.println("\n[wifi] Initial connection timed out, will retry in loop...");
  }

  myMac = WiFi.macAddress();
  udp.begin(MY_UDP_PORT);
  Serial.printf("[udp] Listening on :%d  MAC:%s\n", MY_UDP_PORT, myMac.c_str());
}

void loop() {
  const uint32_t now = millis();
  const bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

  // ── WiFi connection watchdog ──
  if (!isWifiConnected) {
    if (wasWifiConnected) {
      wasWifiConnected = false;
      serverFound      = false;
      lastDiscoveryMs  = 0;
      lastHeartbeatMs  = 0;
      Serial.println("[wifi] Connection lost — waiting for reconnect...");
    }
    // Reconnect trigger if disconnected for over 10 seconds
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

  // ── Non-blocking Servo Kick Motion ──
  if (kickInProgress) {
    if (!kickReturnPhase && now >= kickPhaseEndMs) {
      kickReturnPhase = true;
      kickerServo.write(SERVO_REST);
      kickPhaseEndMs = now + KICK_RETURN_MS;
    } else if (kickReturnPhase && now >= kickPhaseEndMs) {
      kickInProgress = false;
    }
  }

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