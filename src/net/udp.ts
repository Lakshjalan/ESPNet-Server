import dgram from "node:dgram";
import os from "node:os";
import { config } from "../config.js";
import type { DeviceRegistry } from "../state/deviceRegistry.js";
import { encodeServerOnline, encodeSetLed, encodeMotorCut, parseInbound } from "./messages.js";
import type { Team } from "../types.js";

function getBroadcastAddresses(): string[] {
  const addresses = new Set<string>(["255.255.255.255"]);
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === "IPv4" && !net.internal && net.address && net.netmask) {
        const ipParts = net.address.split(".").map(Number);
        const maskParts = net.netmask.split(".").map(Number);
        if (ipParts.length === 4 && maskParts.length === 4) {
          const bcast = ipParts.map((p, i) => (p | (~maskParts[i]! & 255))).join(".");
          addresses.add(bcast);
        }
      }
    }
  }
  return [...addresses];
}

export interface UdpFleetHandlers {
  onKickRequest(mac: string): void;
  onEmpRequest(mac: string, targetTeam: Team): void;
}

/**
 * Single UDP socket for the whole fleet: listens on `config.udpPort` for
 * everything ESP32s send, and unicasts replies/commands back to the sender's
 * IP on `config.espPort` (mirrors the reference Rust server's port split).
 *
 * Malformed packets are logged and dropped, never thrown — see
 * `messages.ts` for why that matters for a UDP listener that has to survive
 * a whole arena's worth of flaky microcontrollers.
 */
export class UdpFleet {
  private socket: dgram.Socket;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private lastUnknownWarn = new Map<string, number>();

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly handlers: UdpFleetHandlers,
  ) {
    this.socket = dgram.createSocket("udp4");
  }

  async start(): Promise<void> {
    this.socket.on("message", (buf, rinfo) => this.handleMessage(buf, rinfo));
    this.socket.on("error", (err) => {
      console.error(`[udp] socket error: ${err.message}`);
    });

    await new Promise<void>((resolve) => {
      this.socket.bind(config.udpPort, "0.0.0.0", () => {
        this.socket.setBroadcast(true);
        resolve();
      });
    });
    console.log(`[udp] listening on 0.0.0.0:${config.udpPort}`);

    this.discoveryTimer = setInterval(() => this.broadcastDiscovery(), config.discoveryBroadcastIntervalMs);
    this.broadcastDiscovery();
  }

  private handleMessage(buf: Buffer, rinfo: dgram.RemoteInfo): void {
    const msg = parseInbound(buf.toString("utf-8"));

    switch (msg.kind) {
      case "discover":
        this.sendTo(rinfo.address, encodeServerOnline());
        break;
      case "heartbeat": {
        const isNew = !this.registry.get(msg.mac);
        this.registry.upsertFromHeartbeat(msg);
        console.log(`[udp] heartbeat from ${msg.mac} (${msg.ip}) team=${msg.team ?? "?"} batt=${msg.batteryPct ?? "?"}%`);
        if (isNew) this.sendTo(rinfo.address, encodeServerOnline());

        const dev = this.registry.get(msg.mac);
        if (dev && dev.motorCutUntil !== null) {
          const remainingMs = dev.motorCutUntil - Date.now();
          if (remainingMs > 0) {
            this.sendTo(rinfo.address, encodeMotorCut(remainingMs));
          } else {
            this.registry.setMotorCutUntil(msg.mac, null);
          }
        }
        break;
      }
      case "kick_req":
        this.handlers.onKickRequest(msg.mac);
        break;
      case "emp_req":
        this.handlers.onEmpRequest(msg.mac, msg.targetTeam);
        break;
      case "unknown": {
        const now = Date.now();
        const last = this.lastUnknownWarn.get(rinfo.address) ?? 0;
        if (now - last > 5000) {
          this.lastUnknownWarn.set(rinfo.address, now);
          console.warn(`[udp] unrecognized packet from ${rinfo.address}: ${msg.raw.slice(0, 64)}`);
        }
        break;
      }
    }
  }

  /** Send CMD|SET_LED to a controller when its EMP-ready status changes. */
  sendLedForDevice(ip: string, empReady: boolean): void {
    this.sendTo(ip, encodeSetLed(empReady ? "ON" : "OFF"));
  }

  /** Unicast a command/reply to a device's ESP_PORT. Fire-and-forget (UDP has no delivery guarantee). */
  sendTo(ip: string, message: string): void {
    const payload = Buffer.from(message, "utf-8");
    this.socket.send(payload, config.espPort, ip, (err) => {
      if (err) console.error(`[udp] send to ${ip}:${config.espPort} failed: ${err.message}`);
    });
  }

  /**
   * Send a command with multiple staggered retries to survive UDP packet loss bursts on busy arena WiFi.
   */
  sendWithRetry(ip: string, message: string, retryDelaysMs: number[] = [60, 180]): void {
    this.sendTo(ip, message);
    for (const delay of retryDelaysMs) {
      setTimeout(() => this.sendTo(ip, message), delay);
    }
  }

  private broadcastDiscovery(): void {
    const payload = Buffer.from(encodeServerOnline(), "utf-8");
    const targets = getBroadcastAddresses();
    for (const target of targets) {
      try {
        this.socket.send(payload, config.espPort, target, (err) => {
          // Ignore normal Windows unroutable broadcast interface errors (EHOSTUNREACH / ENETUNREACH)
          if (err && err.message && !err.message.includes("EHOSTUNREACH") && !err.message.includes("ENETUNREACH") && !err.message.includes("EPERM")) {
            console.error(`[udp] discovery broadcast to ${target} failed: ${err.message}`);
          }
        });
      } catch (err) {
        // Ignore synchronous send failures on inactive virtual interfaces
      }
    }
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }
}
