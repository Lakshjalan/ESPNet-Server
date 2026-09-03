import type { DeviceNode } from "../types.js";

// --- Pure rule functions -----------------------------------------------
// Kept dependency-free (no socket, no registry) so they're trivially unit
// testable. The stateful wrapper below is the only part that touches I/O.

export type KickRejectReason = "unknown_controller" | "cooldown" | "no_truck" | "target_offline" | "disabled";
export type KickResult = { ok: true; truckMac: string } | { ok: false; reason: KickRejectReason };

export function evaluateKick(
  controller: DeviceNode | undefined,
  truck: DeviceNode | undefined,
  now: number,
  enabled = true,
): KickResult {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (!controller) return { ok: false, reason: "unknown_controller" };
  if (controller.kickerCooldownUntil !== null && now < controller.kickerCooldownUntil) {
    return { ok: false, reason: "cooldown" };
  }
  if (!truck) return { ok: false, reason: "no_truck" };
  if (!truck.isOnline) return { ok: false, reason: "target_offline" };
  return { ok: true, truckMac: truck.mac };
}

export type EmpRejectReason =
  | "unknown_controller"
  | "not_eligible"
  | "no_target_controller"
  | "target_already_frozen"
  | "target_offline"
  | "disabled";
export type EmpResult = { ok: true; targetControllerMac: string } | { ok: false; reason: EmpRejectReason };

/**
 * Evaluates whether an EMP can fire.
 * `controller`       — the device that pressed the EMP button
 * `targetController` — the opponent team's controller (relay/MOSFET target)
 *
 * The EMP is sent to the opponent's controller (CMD|POWER_CUT), which cuts
 * power via a relay or MOSFET. The controller must be online and not already cut.
 */
export function evaluateEmp(
  controller: DeviceNode | undefined,
  targetController: DeviceNode | undefined,
  now: number,
  enabled = true,
): EmpResult {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (!controller) return { ok: false, reason: "unknown_controller" };
  if (!controller.powerupEmpReady) return { ok: false, reason: "not_eligible" };
  if (!targetController) return { ok: false, reason: "no_target_controller" };
  if (!targetController.isOnline) return { ok: false, reason: "target_offline" };
  if (targetController.motorCutUntil !== null && now < targetController.motorCutUntil) {
    return { ok: false, reason: "target_already_frozen" };
  }
  return { ok: true, targetControllerMac: targetController.mac };
}
