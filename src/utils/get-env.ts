import NodeCache from "node-cache";
import { Server } from "../server";

export const EnvCache = new NodeCache();

export type EnvironmentVariables =
  | "NODE_ENV"
  | "GOOGLE_API_KEY";

export function getEnv(
  secret: EnvironmentVariables,
): string {
  let value = process.env[secret];
  if (!value) {
    Server.instance.error(
      `Environment variable not found: ${secret}. Crashing.`,
    );
    process.exit(1);
  }
  return value;
}
