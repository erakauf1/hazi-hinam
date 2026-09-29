import { HaziHinamClient } from "./client.js";
import { configDir } from "./config.js";
import { AuthRequired } from "./errors.js";
import { Store } from "./store.js";

export interface Context {
  store: Store;
  now(): Date;
  clientFor(token: string): HaziHinamClient;
  client(): Promise<HaziHinamClient>;
}

export function createContext(options: { store?: Store; fetch?: typeof fetch; now?: () => Date } = {}): Context {
  const store = options.store ?? new Store(configDir());
  const now = options.now ?? (() => new Date());
  const clientFor = (token: string) => new HaziHinamClient(token, { fetch: options.fetch });
  return {
    store,
    now,
    clientFor,
    async client() {
      const session = await store.loadSession(now());
      if (!session) throw new AuthRequired();
      return clientFor(session.accessToken);
    },
  };
}
