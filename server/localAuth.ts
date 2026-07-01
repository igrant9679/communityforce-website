import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";

const BCRYPT_ROUNDS = 12;

/** Local accounts are keyed by "local:<username>" in the openId column. */
export const localOpenId = (username: string) => `local:${username}`;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

/**
 * Seed (or re-sync) the admin account from ADMIN_USERNAME / ADMIN_PASSWORD.
 * Runs on boot; the password hash is updated to match the env var, so
 * changing the variable and redeploying rotates the admin password.
 */
export async function ensureAdminUser(): Promise<void> {
  const username = ENV.adminUsername.trim().toLowerCase();
  const password = ENV.adminPassword;
  if (!username || !password) {
    console.warn("[Auth] ADMIN_USERNAME/ADMIN_PASSWORD not set; no admin account seeded");
    return;
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Auth] Cannot seed admin user: database not available");
    return;
  }

  const passwordHash = await hashPassword(password);
  const existing = await getUserByUsername(username);

  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, role: "admin" })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      openId: localOpenId(username),
      username,
      passwordHash,
      name: username,
      loginMethod: "password",
      role: "admin",
    });
  }
  console.log(`[Auth] Admin account "${username}" ready`);
}

// Minimal in-memory login throttle: 5 failures per username per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const failures = new Map<string, { count: number; windowStart: number }>();

export function isThrottled(username: string): boolean {
  const entry = failures.get(username);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    failures.delete(username);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailure(username: string): void {
  const now = Date.now();
  const entry = failures.get(username);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failures.set(username, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

export function clearFailures(username: string): void {
  failures.delete(username);
}
