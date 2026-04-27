import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "picnic-cli");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");

export type AuthState = {
  authKey: string;
  countryCode: "NL" | "DE";
  userId?: string;
};

export async function loadAuth(): Promise<AuthState | null> {
  const file = Bun.file(AUTH_FILE);
  if (!(await file.exists())) return null;
  return (await file.json()) as AuthState;
}

export async function saveAuth(state: AuthState): Promise<void> {
  await Bun.write(AUTH_FILE, JSON.stringify(state, null, 2));
}

export async function clearAuth(): Promise<void> {
  const file = Bun.file(AUTH_FILE);
  if (await file.exists()) {
    await Bun.write(AUTH_FILE, "");
  }
}

export async function requireAuth(): Promise<AuthState> {
  const auth = await loadAuth();
  if (!auth?.authKey) {
    console.error("Not logged in. Run: picnic login");
    process.exit(1);
  }
  return auth;
}
