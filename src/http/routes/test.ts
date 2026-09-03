import { Router } from "express";
import { encodeKickFire, encodeMotorCut } from "../../net/messages.js";
import type { Engine } from "../../engine.js";

export function testRouter(engine: Engine): Router {
  const router = Router();

  /** Ping specific ESP by MAC */
  router.post("/ping/:mac", (req, res) => {
    const { mac } = req.params;
    const ok = engine.udp.sendPing(mac);
    if (!ok) return res.status(404).json({ success: false, error: `Device ${mac} is offline or not registered` });
    res.json({ success: true, message: `PING sent to ${mac}` });
  });

  /** Test Kick: sends KICK_FIRE to target team's truck (for hardware testing) */
  router.post("/kick/:team", (req, res) => {
    const { team } = req.params;
    if (team !== "red" && team !== "blue") {
      return res.status(400).json({ success: false, error: "Invalid team" });
    }
    let truck = engine.registry.list().find(d => d.nodeType === "truck" && d.team === team);
    if (!truck) {
      // Fallback: find any online truck if team was unassigned
      truck = engine.registry.list().find(d => d.nodeType === "truck" && d.isOnline);
    }
    if (!truck) {
      return res.status(404).json({ success: false, error: `No truck node found for Team ${team.toUpperCase()}` });
    }
    if (!truck.isOnline) {
      return res.status(404).json({ success: false, error: `Team ${team.toUpperCase()} Truck (${truck.mac}) is OFFLINE` });
    }
    
    // Send KICK_FIRE command multiple times via UDP for reliable physical actuation
    engine.udp.sendWithRetry(truck.ip, encodeKickFire());
    if (engine.ws) {
      engine.ws.broadcast({ type: "audio_event", event: "kick_fired" });
    }
    res.json({
      success: true,
      mac: truck.mac,
      ip: truck.ip,
      message: `CMD|KICK_FIRE sent to ${team.toUpperCase()} Truck (${truck.mac} @ ${truck.ip})`,
    });
  });

  /** Test EMP: sends POWER_CUT to target opponent controller (for hardware testing) */
  router.post("/emp/:attackerTeam", (req, res) => {
    const { attackerTeam } = req.params;
    if (attackerTeam !== "red" && attackerTeam !== "blue") {
      return res.status(400).json({ success: false, error: "Invalid team" });
    }
    const targetTeam = attackerTeam === "red" ? "blue" : "red";
    let targetController = engine.registry.list().find(d => d.nodeType === "controller" && d.team === targetTeam);
    if (!targetController) {
      // Fallback: find any online controller that is not the attacker
      targetController = engine.registry.list().find(d => d.nodeType === "controller" && d.isOnline);
    }
    if (!targetController) {
      return res.status(404).json({ success: false, error: `No target controller found for Team ${targetTeam.toUpperCase()}` });
    }
    if (!targetController.isOnline) {
      return res.status(404).json({ success: false, error: `Target Team ${targetTeam.toUpperCase()} Controller (${targetController.mac}) is OFFLINE` });
    }

    const empDurationMs = engine.settings.get().empCooldownSec * 1000;
    engine.registry.setMotorCutUntil(targetController.mac, Date.now() + empDurationMs);
    engine.udp.sendWithRetry(targetController.ip, encodeMotorCut(empDurationMs));
    res.json({
      success: true,
      mac: targetController.mac,
      ip: targetController.ip,
      durationMs: empDurationMs,
      message: `CMD|POWER_CUT (${empDurationMs / 1000}s) sent to ${targetTeam.toUpperCase()} Controller (${targetController.mac} @ ${targetController.ip})`,
    });
  });

  return router;
}
