import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Session {
  accessToken: string;
  savedAt: string;
  expiresAt: string;
}

const SESSION_FILE = "session.json";

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class Store {
  constructor(readonly dir: string) {}

  async readJson<T>(name: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.dir, name), "utf8")) as T;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  // Created at 0600 and swapped in with rename, so a token file is never briefly world-readable or truncated.
  async writeJson(name: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, name);
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await unlink(join(this.dir, name));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async saveSession(accessToken: string, expiresInSeconds: number, now: Date): Promise<Session> {
    const session: Session = {
      accessToken,
      savedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    };
    await this.writeJson(SESSION_FILE, session);
    return session;
  }

  async loadSession(now: Date): Promise<Session | undefined> {
    const session = await this.readJson<Session>(SESSION_FILE);
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      await this.remove(SESSION_FILE);
      return undefined;
    }
    return session;
  }

  clearSession(): Promise<void> {
    return this.remove(SESSION_FILE);
  }
}
