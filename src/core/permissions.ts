import { cfg } from "../config";
import { printWarning } from "../ui/console";

const PERMISSION_TYPES = ["read", "write", "execute", "web"];

export function getPermission(permType: string) {
  const perms = (cfg.config.permissions || {}) as Record<string, string>;
  return perms[permType] || "ask";
}

export function setPermission(permType: string, level: string) {
  if (!cfg.config.permissions) cfg.config.permissions = {};
  (cfg.config.permissions as Record<string, string>)[permType] = level;
  cfg.save();
}

export function checkPermission(permType: string, description = "") {
  const level = getPermission(permType);
  if (level === "allow") return true;
  if (level === "deny") {
    printWarning(`Permission denied: ${permType} (${description})`);
    return false;
  }
  if (permType === "read") return true;
  if (permType === "web") return cfg.isWebBrowsingAllowed();
  return true;
}

export function isFullAccess() {
  const candidates = [
    cfg.config.permission_mode,
    cfg.config.permissions_mode,
    (cfg.config.permissions as Record<string, unknown> | undefined)?.mode,
  ];
  for (const mode of candidates) {
    if (typeof mode === "string" && ["full", "full_access", "allow_all"].includes(mode.toLowerCase())) {
      return true;
    }
  }

  const perms = cfg.config.permissions;
  if (!perms || typeof perms !== "object") return false;
  return PERMISSION_TYPES.every((key) => String((perms as Record<string, unknown>)[key] || "ask").toLowerCase() === "allow");
}
