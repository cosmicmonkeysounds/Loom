// Which server the bots may touch, and how carefully. Pure.

import { isLocal } from "./http.ts";

/** The server to run against: `--base`, else `LOOM_SERVER`. There is no
 *  default: a run must name its server. Null when neither is given. */
export function resolveBase(flag: string | undefined, env: string | undefined): string | null {
  const b = (flag ?? env ?? "").trim().replace(/\/+$/u, "");
  return b === "" ? null : b;
}

/** Port 7000 on this laptop is the user's own dev server (`pnpm dev`, the
 *  `loom_dev` database with their own events), never a scratch server. */
export function isDevServer(base: string): boolean {
  if (!isLocal(base)) return false;
  try {
    const u = new URL(base);
    return (u.port === "" ? (u.protocol === "https:" ? "443" : "80") : u.port) === "7000";
  } catch {
    return false;
  }
}

/** A scratch server: on this laptop and not the dev server. Only a scratch
 *  server skips the guard's y/N and may be reset. */
export const isScratch = (base: string): boolean => isLocal(base) && !isDevServer(base);
