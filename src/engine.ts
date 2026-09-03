import { config } from "./config.js";
import { DeviceRegistry } from "./state/deviceRegistry.js";
import { MatchStateManager, computeEmpEligibility } from "./state/matchState.js";
import { PlayerRegistry } from "./state/playerRegistry.js";
import { QueueRegistry } from "./state/queueRegistry.js";
import { SettingsRegistry } from "./state/settingsRegistry.js";
import { UdpFleet } from "./net/udp.js";
import { WsHub } from "./http/ws.js";
import { SpotifyClient } from "./audio/spotify.js";
import { evaluateKick, evaluateEmp } from "./game/powerups.js";
import { goalAmbiance, intenseAmbiance, empAmbiance, matchEndAmbiance, matchStartAmbiance } from "./game/ambiance.js";
import { encodeKickFire, encodeMotorCut, encodeLightFx } from "./net/messages.js";
import type { Server as HttpServer } from "node:http";
import type { Team } from "./types.js";

export class Engine {
  readonly registry = new DeviceRegistry();
  readonly players = new PlayerRegistry();
  readonly queue = new QueueRegistry();
  readonly settings = new SettingsRegistry();
  readonly spotify = new SpotifyClient();
  readonly match: MatchStateManager;
  udp!: UdpFleet;
  ws!: WsHub;

  constructor() {
    this.match = new MatchStateManager({
      onGoal: (team) => this.handleGoalAmbiance(team),
      onIntenseChange: (isIntense) => this.handleIntenseChange(isIntense),
      onMatchEnd: () => this.handleMatchEnd(),
      onChange: () => this.broadcastState(),
    }, this.settings);
  }

  async init(httpServer: HttpServer): Promise<void> {
    await this.registry.init();
    await this.players.init();
    await this.queue.init();
    await this.settings.init();
    await this.match.init();
    await this.spotify.init();
    this.registry.onChange(() => this.broadcastState());
    
    this.udp = new UdpFleet(this.registry, {
      onKickRequest: (mac) => this.handleKickRequest(mac),
      onEmpRequest: (mac, team) => this.handleEmpRequest(mac, team),
    });
    await this.udp.start();

    this.ws = new WsHub(httpServer, (socket) => {
      socket.send(JSON.stringify({
        type: "state",
        devices: this.registry.list(),
        match: this.match.get(),
      }));
    });

    setInterval(() => this.registry.sweepOffline(), 2000);
  }

  broadcastState(): void {
    if (this.ws) {
      this.ws.broadcast({
        type: "state",
        devices: this.registry.list(),
        match: this.match.get(),
      });
    }
  }

  handleKickRequest(controllerMac: string): void {
    const controller = this.registry.get(controllerMac);
    const truck = controller?.pairedMac ? this.registry.get(controller.pairedMac) : undefined;
    const settings = this.settings.get();
    const result = evaluateKick(controller, truck, Date.now(), settings.kickerEnabled);

    if (!result.ok) {
      console.warn(`[powerup] kick rejected for ${controllerMac}: ${result.reason}`);
      if (this.ws) {
        this.ws.broadcast({ type: "powerup_rejected", action: "kick", mac: controllerMac, reason: result.reason });
      }
      return;
    }

    const cooldownMs = settings.kickerCooldownSec * 1000;
    this.registry.setKickerCooldown(controllerMac, Date.now() + cooldownMs);
    const truckDevice = this.registry.get(result.truckMac);
    if (truckDevice) {
      this.udp.sendWithRetry(truckDevice.ip, encodeKickFire());
    }

    if (this.ws) {
      this.ws.broadcast({ type: "audio_event", event: "kick_fired" });
    }
  }

  handleEmpRequest(controllerMac: string, targetTeam: Team): void {
    const controller = this.registry.get(controllerMac);
    // Find the opponent team's controller (relay/MOSFET target)
    const targetController = this.registry.list().find(
      d => d.nodeType === "controller" && d.team === targetTeam
    );
    const settings = this.settings.get();
    const result = evaluateEmp(controller, targetController, Date.now(), settings.empEnabled);

    if (!result.ok) {
      console.warn(`[powerup] emp rejected for ${controllerMac}: ${result.reason}`);
      if (this.ws) {
        this.ws.broadcast({ type: "powerup_rejected", action: "emp", mac: controllerMac, reason: result.reason });
      }
      return;
    }

    if (controller?.team) {
      for (const dev of this.registry.list()) {
        if (dev.nodeType === "controller" && dev.team === controller.team) {
          this.registry.setEmpReady(dev.mac, false);
        }
      }
    } else {
      this.registry.setEmpReady(controllerMac, false);
    }
    const empDurationMs = settings.empCooldownSec * 1000;
    const until = Date.now() + empDurationMs;
    this.registry.setMotorCutUntil(result.targetControllerMac, until);

    const targetControllerDevice = this.registry.get(result.targetControllerMac);
    if (targetControllerDevice) {
      this.udp.sendWithRetry(targetControllerDevice.ip, encodeMotorCut(empDurationMs));
    }

    setTimeout(() => {
      const dev = this.registry.get(result.targetControllerMac);
      if (dev?.motorCutUntil === until) {
        this.registry.setMotorCutUntil(result.targetControllerMac, null);
      }
    }, empDurationMs + 50);

    const { audio, light } = empAmbiance();
    if (this.ws) {
      this.ws.broadcast({ type: "audio_event", event: audio });
      this.ws.broadcast({ type: "light_event", ...light });
    }
    this.dispatchLightFx(light.pattern);
  }

  private handleGoalAmbiance(team: Team): void {
    const eligibility = computeEmpEligibility(this.match.get());
    for (const controller of this.registry.list()) {
      if (controller.nodeType === "controller" && controller.team && eligibility[controller.team]) {
        this.registry.setEmpReady(controller.mac, true);
      }
    }

    const { audio, light } = goalAmbiance(team);
    void this.spotify.duck();

    if (this.ws) {
      this.ws.broadcast({ type: "audio_event", event: audio });
      this.ws.broadcast({ type: "light_event", ...light });
    }
    this.dispatchLightFx(light.pattern);
    setTimeout(() => void this.spotify.resume(), 4000);
  }

  private handleIntenseChange(isIntense: boolean): void {
    const { audio, light } = intenseAmbiance(isIntense);
    if (this.ws) {
      this.ws.broadcast({ type: "audio_event", event: audio });
      this.ws.broadcast({ type: "light_event", ...light });
    }
    this.dispatchLightFx(light.pattern);
  }

  private handleMatchEnd(): void {
    const { audio, light } = matchEndAmbiance(this.match.get());
    if (this.ws) {
      this.ws.broadcast({ type: "audio_event", event: audio });
      this.ws.broadcast({ type: "light_event", ...light });
      this.ws.broadcast({ type: "history", entries: this.match.getHistory() });
    }
    this.dispatchLightFx(light.pattern);
  }

  announceMatchStart(): void {
    const { audio, light } = matchStartAmbiance();
    if (this.ws) {
      this.ws.broadcast({ type: "audio_event", event: audio });
    }
    this.dispatchLightFx(light.pattern);
  }

  private dispatchLightFx(pattern: string): void {
    if (!this.udp) return;
    const lighting = this.registry.list().find(d => d.nodeType === "lighting");
    if (lighting?.isOnline) {
      this.udp.sendTo(lighting.ip, encodeLightFx(pattern));
    }
  }

  async shutdown(): Promise<void> {
    if (this.udp) await this.udp.stop();
    await this.registry.flush();
    await this.players.flush();
    await this.queue.flush();
    await this.settings.flush();
    await this.match.flush();
  }
}