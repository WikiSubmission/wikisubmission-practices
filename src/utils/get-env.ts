import NodeCache from "node-cache";
import { Server } from "../server";
import { getSupabaseClient } from "./get-supabase-client";

export const EnvCache = new NodeCache();

export type EnvironmentVariables =
  | "NODE_ENV"
  | "GOOGLE_API_KEY";

export async function getEnv(
  secret: EnvironmentVariables,
  critical: boolean = true,
): Promise<string> {
  const cached = EnvCache.get(secret);
  if (cached) {
    return cached as string;
  }
  const client = getSupabaseClient();
  const request = await client
    .from("Secrets")
    .select("*")
    .eq("key", secret)
    .single();

  if (request.status === 200 && request.data?.value) {
    EnvCache.set(secret, request.data.value);
    return request.data.value;
  } else {
    if (process.env[secret]) {
      Server.instance.warn(
        `Failed to remotely fetch environment variable: ${secret} (${request.error?.message || "--"}). Returning from local .env file.`,
      );
      return process.env[secret];
    } else if (critical) {
      Server.instance.error(
        `Failed to remotely fetch environment variable: ${secret} (${request.error?.message || "--"}). Crashing.`,
      );
      process.exit(1);
    } else {
      Server.instance.warn(
        `Failed to remotely fetch environment variable: ${secret} (${request.error?.message || "--"}). Ensure available or store in .env file.`,
      );
      return "";
    }
  }
}
