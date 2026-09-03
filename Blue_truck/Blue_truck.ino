/**
 * RoboSoccer — Truck Firmware (ESP32-S3 Super Mini)
 *
 * Wire protocol (ARCHITECTURE.md §3):
 *   TX → Server (UDP :8888)
 *     DISCOVER_SERVER            — sent on boot until server replies
 *     HEARTBEAT|mac|ip|batt|truck|<team>  — every 2 s
 *
 *   RX ← Server (UDP :8889)
 *     ESPNet-Server-Online       — server found
 *     CMD|KICK_FIRE              — actuate servo 0°→90°→0°
 *
 * Pins (ESP32-S3 Super Mini):
 *   GPIO 9  — Servo signal (kicker mechanism)
 *
 * ── HARD-CODE YOUR TEAM AND WIFI BELOW ──────────────────────────────────────
 */

#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESP32Servo.h>

// ─── CONFIG ─────────────────────────────────────────────────────────────────
#define WIFI_SSID       "Openwrt"
#define WIFI_PASSWORD   "Tonu@4059$"

// "red" or "blue" — hard-code per truck unit
#define MY_TEAM         "blue"

#define SERVER_UDP_PORT 8888
#define MY_UDP_PORT     8889

#define HEARTBEAT_INTERVAL_MS  2000
#define DISCOVERY_INTERVAL_MS  1000

// Kicker servo
#define SERVO_PIN      9
#define SERVO_REST     0    // degrees — resting position
#define SERVO_KICK     90   // degrees — kick position
#define KICK_HOLD_MS   200  // time to hold kick position
#define KICK_RETURN_MS 400  // time to return (total cycle ~600ms)
// ────────────────────────────────────────────────────────────────────────────

WiFiUDP  udp;
Servo    kickerServo;

bool     serverFound     = false;
IPAddress serverIp;
uint32_t lastHeartbeatMs = 0;
uint32_t lastDiscoveryMs = 0;

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
  udp.beginPacket(IPAddress(255, 255, 255, 255), SERVER_UDP_PORT);
  const char* d = "DISCOVER_SERVER";
  udp.write((const uint8_t*)d, strlen(d));
  udp.endPacket();
}

void sendHeartbeat() {
  // ponytail: battery hardcoded 100 — add ADC read when voltage divider wired
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
  Serial.printf("[RX] %s\n", msg);

  if (strcmp(msg, "ESPNet-Server-Online") == 0) {
    if (!serverFound) {
      serverFound = true;
      serverIp    = remoteIp;
      Serial.printf("[net] Server @ %s\n", serverIp.toString().c_str());
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

  if (n >= 2 && strcmp(parts[0], "CMD") == 0 && strcmp(parts[1], "KICK_FIRE") == 0) {
    startKick();
  }
}

// ─── SETUP / LOOP ───────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);

  kickerServo.attach(SERVO_PIN);
  kickerServo.write(SERVO_REST);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] Connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }
  Serial.printf("\n[wifi] IP: %s\n", WiFi.localIP().toString().c_str());

  myMac = WiFi.macAddress();
  udp.begin(MY_UDP_PORT);
  Serial.printf("[udp] Listening on :%d  MAC:%s\n", MY_UDP_PORT, myMac.c_str());
}

void loop() {
  const uint32_t now = millis();

  // WiFi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(500);
    return;
  }

  // Discovery
  if (!serverFound && (now - lastDiscoveryMs >= DISCOVERY_INTERVAL_MS)) {
    lastDiscoveryMs = now;
    sendDiscovery();
  }

  // Heartbeat
  if (serverFound && (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS)) {
    lastHeartbeatMs = now;
    sendHeartbeat();
  }

  // Non-blocking servo: hold kick → return to rest
  if (kickInProgress) {
    if (!kickReturnPhase && now >= kickPhaseEndMs) {
      kickReturnPhase = true;
      kickerServo.write(SERVO_REST);
      kickPhaseEndMs = now + KICK_RETURN_MS;
    } else if (kickReturnPhase && now >= kickPhaseEndMs) {
      kickInProgress = false;
    }
  }

  // Receive UDP
  int pktSize = udp.parsePacket();
  if (pktSize > 0) {
    char rxBuf[128];
    int  len = udp.read(rxBuf, sizeof(rxBuf) - 1);
    if (len > 0) {
      rxBuf[len] = '\0';
      handleIncoming(rxBuf, udp.remoteIP());
    }
  }
}