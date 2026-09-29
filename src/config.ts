import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HAZI_HINAM_CONFIG_DIR) return env.HAZI_HINAM_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "hazi-hinam");
  return join(homedir(), ".config", "hazi-hinam");
}
