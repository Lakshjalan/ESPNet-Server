import { Router } from "express";
import { encodeKickFire, encodeMotorCut } from "../../net/messages.js";
import type { Engine } from "../../engine.js";

export function testRouter(engine: Engine): Router {
  const router = Router();

  /** Ping specific ESP by MAC */
  router.post("/ping/:mac", (req, res) => {
    const { mac } = req.params;
    const ok = engine.udp.sendPing(mac);
    if (!ok) return res.status(404).json({ success: false, error: "Device offline or not found" });
    res.json({ success: true, message: `Ping sent to ${mac}` });
  });

  /** Force test kick on specific team's truck (bypasses game rules) */
  router.post("/kick/:team", (req, res) => {
    const { team } = req.params;
    if (team !== "red" && team !== "blue") {
      return res.status(400).json({ success: false, error: "Invalid team" });
    }
    const truck = engine.registry.list().find(d => d.nodeType === "truck" && d.team === team);
    if (!truck || !truck.isOnline) {
      return res.status(404).json({ success: false, error: `No online truck for team ${team}` });
    }
    engine.udp.sendWithRetry(truck.ip, encodeKickFire());
    if (engine.ws) {
      engine.ws.broadcast({ type: "audio_event", event: "kick_fired" });
    }
    res.json({ success: true, message: `Kick command sent to ${team} truck (${truck.mac})` });
  });

  /** Force test EMP on specific team's controller (bypasses game rules) */
  router.post("/emp/:attackerTeam", (req, res) => {
    const { attackerTeam } = req.params;
    if (attackerTeam !== "red" && attackerTeam !== "blue") {
      return res.status(400).json({ success: false, error: "Invalid team" });
    }
    const targetTeam = attackerTeam === "red" ? "blue" : "red";
    const targetController = engine.registry.list().find(d => d.nodeType === "controller" && d.team === targetTeam);
    if (!targetController || !targetController.isOnline) {
      return res.status(404).json({ success: false, error: `No online controller for target team ${targetTeam}` });
    }
    const empDurationMs = engine.settings.get().empCooldownSec * 1000;
    engine.registry.setMotorCutUntil(targetController.mac, Date.now() + empDurationMs);
    engine.udp.sendWithRetry(targetController.ip, encodeMotorCut(empDurationMs));
    res.json({ success: true, message: `EMP power cut (${empDurationMs}ms) sent to ${targetTeam} controller (${targetController.mac})` });
  });

  /** Simulate Controller sending KICK_REQ signal to server (tests Controller -> Server -> Truck full loop) */
  router.post("/sim-kick/:mac", (req, res) => {
    const { mac } = req.params;
    engine.handleKickRequest(mac);
    res.json({ success: true, message: `Simulated KICK_REQ from controller ${mac}` });
  });

  /** Simulate Controller sending EMP_REQ signal to server (tests Controller -> Server -> Target Controller full loop) */
  router.post("/sim-emp/:mac", (req, res) => {
    const { mac } = req.params;
    const controller = engine.registry.get(mac);
    if (!controller || !controller.team) {
      return res.status(400).json({ success: false, error: "Controller unknown or has no team" });
    }
    const targetTeam = controller.team === "red" ? "blue" : "red";
    engine.handleEmpRequest(mac, targetTeam);
    res.json({ success: true, message: `Simulated EMP_REQ from ${controller.team} controller ${mac}` });
  });

  return router;
}
