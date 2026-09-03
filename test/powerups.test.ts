import { describe, it, expect } from "vitest";
import { evaluateKick, evaluateEmp } from "../src/game/powerups.js";
import type { DeviceNode } from "../src/types.js";

function makeDevice(overrides: Partial<DeviceNode> = {}): DeviceNode {
  return {
    mac: "AA:BB:CC:DD:EE:01",
    ip: "192.168.1.10",
    nodeType: "controller",
    team: "red",
    pairedMac: "AA:BB:CC:DD:EE:02",
    isOnline: true,
    lastSeen: Date.now(),
    firstSeen: Date.now(),
    batteryPct: 90,
    label: null,
    kickerCooldownUntil: null,
    powerupEmpReady: false,
    motorCutUntil: null,
    ...overrides,
  };
}

describe("evaluateKick", () => {
  const now = 1_000_000;

  it("rejects an unknown controller", () => {
    const result = evaluateKick(undefined, undefined, now);
    expect(result).toEqual({ ok: false, reason: "unknown_controller" });
  });

  it("rejects while on cooldown", () => {
    const controller = makeDevice({ kickerCooldownUntil: now + 5000 });
    const truck = makeDevice({ mac: "AA:BB:CC:DD:EE:02", nodeType: "truck" });
    expect(evaluateKick(controller, truck, now)).toEqual({ ok: false, reason: "cooldown" });
  });

  it("allows exactly at the cooldown boundary", () => {
    const controller = makeDevice({ kickerCooldownUntil: now });
    const truck = makeDevice({ mac: "AA:BB:CC:DD:EE:02", nodeType: "truck" });
    expect(evaluateKick(controller, truck, now)).toEqual({ ok: true, truckMac: truck.mac });
  });

  it("rejects when not paired to a truck", () => {
    const controller = makeDevice({ pairedMac: null });
    expect(evaluateKick(controller, undefined, now)).toEqual({ ok: false, reason: "not_paired" });
  });

  it("rejects when the paired truck is offline", () => {
    const controller = makeDevice();
    const truck = makeDevice({ mac: "AA:BB:CC:DD:EE:02", nodeType: "truck", isOnline: false });
    expect(evaluateKick(controller, truck, now)).toEqual({ ok: false, reason: "target_offline" });
  });

  it("allows a valid, off-cooldown, paired, online kick", () => {
    const controller = makeDevice();
    const truck = makeDevice({ mac: "AA:BB:CC:DD:EE:02", nodeType: "truck" });
    expect(evaluateKick(controller, truck, now)).toEqual({ ok: true, truckMac: truck.mac });
  });

  it("rejects kick when disabled in settings", () => {
    const controller = makeDevice();
    const truck = makeDevice({ mac: "AA:BB:CC:DD:EE:02", nodeType: "truck" });
    expect(evaluateKick(controller, truck, now, false)).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("evaluateEmp", () => {
  const now = 1_000_000;

  // EMP targets the opponent's controller (relay/MOSFET), cutting its power.
  // The target passed to evaluateEmp must be the opponent's controller node.

  it("rejects an unknown controller", () => {
    expect(evaluateEmp(undefined, undefined, now)).toEqual({ ok: false, reason: "unknown_controller" });
  });

  it("rejects when the power-up hasn't been earned", () => {
    const controller = makeDevice({ powerupEmpReady: false });
    const targetController = makeDevice({ mac: "AA:BB:CC:DD:EE:03", nodeType: "controller", team: "blue" });
    expect(evaluateEmp(controller, targetController, now)).toEqual({ ok: false, reason: "not_eligible" });
  });

  it("rejects when there is no opponent controller to target", () => {
    const controller = makeDevice({ powerupEmpReady: true });
    expect(evaluateEmp(controller, undefined, now)).toEqual({ ok: false, reason: "no_target_controller" });
  });

  it("rejects an offline target controller", () => {
    const controller = makeDevice({ powerupEmpReady: true });
    const targetController = makeDevice({ mac: "AA:BB:CC:DD:EE:03", nodeType: "controller", team: "blue", isOnline: false });
    expect(evaluateEmp(controller, targetController, now)).toEqual({ ok: false, reason: "target_offline" });
  });

  it("rejects a controller whose power is already cut", () => {
    const controller = makeDevice({ powerupEmpReady: true });
    const targetController = makeDevice({ mac: "AA:BB:CC:DD:EE:03", nodeType: "controller", team: "blue", motorCutUntil: now + 1000 });
    expect(evaluateEmp(controller, targetController, now)).toEqual({ ok: false, reason: "target_already_frozen" });
  });

  it("allows a valid EMP once the previous power-cut has expired", () => {
    const controller = makeDevice({ powerupEmpReady: true });
    const targetController = makeDevice({ mac: "AA:BB:CC:DD:EE:03", nodeType: "controller", team: "blue", motorCutUntil: now - 1 });
    expect(evaluateEmp(controller, targetController, now)).toEqual({ ok: true, targetControllerMac: targetController.mac });
  });

  it("allows a clean EMP on a controller with no prior power-cut", () => {
    const controller = makeDevice({ powerupEmpReady: true });
    const targetController = makeDevice({ mac: "AA:BB:CC:DD:EE:03", nodeType: "controller", team: "blue", motorCutUntil: null });
    expect(evaluateEmp(controller, targetController, now)).toEqual({ ok: true, targetControllerMac: targetController.mac });
  });

  it("rejects EMP when disabled in settings", () => {
    const controller = makeDevice({ powerupEmpReady: true });
    const targetController = makeDevice({ mac: "AA:BB:CC:DD:EE:03", nodeType: "controller", team: "blue", motorCutUntil: null });
    expect(evaluateEmp(controller, targetController, now, false)).toEqual({ ok: false, reason: "disabled" });
  });
});
