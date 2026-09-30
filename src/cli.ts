import { z } from "zod";
import { getUserInfo } from "./api/account.js";
import type { Context } from "./context.js";
import { AuthRequired, formatError, HaziHinamError } from "./errors.js";
import { operations } from "./operations/index.js";
import type { Session } from "./store.js";

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readLine(prompt: string): Promise<string>;
}

const LOGIN_LIFETIME_SECONDS = 172800;
const commandName = (operationName: string) => operationName.replaceAll("_", "-");

function helpText(): string {
  const width = Math.max(...operations.map(o => commandName(o.name).length), 16);
  const lines = operations.map(o => `  ${commandName(o.name).padEnd(width)}  ${o.description}`);
  return [
    "Usage: hazi-hinam <command> [--flag value ...]",
    "",
    "Session:",
    `  ${"login".padEnd(width)}  Paste the access token from your own browser login (or --browser to capture it)`,
    `  ${"logout".padEnd(width)}  End the session on the server and forget the saved login`,
    `  ${"mcp".padEnd(width)}  Run the MCP server on stdio`,
    `  ${"mcp --http".padEnd(width)}  Serve MCP over HTTP for claude.ai and the Claude mobile app [--tunnel] [--port N] [--new-secret]`,
    "",
    "Commands:",
    ...lines,
    "",
    "Output is JSON. Exit codes: 0 ok, 1 error, 2 usage, 3 sign-in required.",
    "",
  ].join("\n");
}

function parseFlags(args: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new HaziHinamError("BAD_ARGS", `Unexpected argument "${arg}"`);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return flags;
}

export async function verifyAndSaveToken(ctx: Context, token: string): Promise<Session> {
  const info = await getUserInfo(ctx.clientFor(token));
  if (info.UserInfo === null) throw new AuthRequired("The site did not accept that token. Log in again on the website and copy a fresh one.");
  return ctx.store.saveSession(token, LOGIN_LIFETIME_SECONDS, ctx.now());
}

async function login(flags: Record<string, string | true>, io: Io, ctx: Context): Promise<number> {
  let token: string;
  if (flags.browser) {
    const { captureTokenFromBrowser } = await import("./browser-login.js");
    token = await captureTokenFromBrowser(io);
  } else {
    io.stderr(
      "Log in at https://shop.hazi-hinam.co.il in your browser. Then open DevTools → Network,\n" +
        "select the request named \"Login\", open Response, and copy the access_token value.\n",
    );
    token = (await io.readLine("access_token: ")).trim();
  }
  if (!token) throw new HaziHinamError("BAD_ARGS", "No token entered.");
  const session = await verifyAndSaveToken(ctx, token);
  io.stdout(`Signed in. The login is valid until ${session.expiresAt}.\n`);
  return 0;
}

const HTTP_FLAGS = new Set(["http", "port", "tunnel", "new-secret"]);

async function serveHttp(flags: Record<string, string | true>, io: Io, ctx: Context): Promise<number> {
  const unknown = Object.keys(flags).filter(flag => !HTTP_FLAGS.has(flag));
  if (unknown.length > 0) throw new HaziHinamError("BAD_ARGS", `Unknown flag --${unknown[0]}`);
  const { DEFAULT_PORT, connectorSecret, startHttpServer } = await import("./http-server.js");
  const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HaziHinamError("BAD_ARGS", "--port must be a whole number from 1 to 65535.");

  const secret = await connectorSecret(ctx.store, { rotate: flags["new-secret"] === true });
  const server = await startHttpServer(ctx, { secret, port });
  const localUrl = `http://127.0.0.1:${server.port}`;
  let tunnel: import("./tunnel.js").Tunnel | undefined;
  if (flags.tunnel) {
    const { openCloudflareTunnel } = await import("./tunnel.js");
    try {
      tunnel = await openCloudflareTunnel(localUrl);
    } catch (error) {
      await server.close();
      throw error;
    }
  }

  const signedIn = (await ctx.store.loadSession(ctx.now())) !== undefined;
  const lines = [`MCP server running on this computer at ${localUrl}${server.path}`, ""];
  if (tunnel) {
    lines.push(
      "Connector URL for claude.ai and the Claude mobile app:",
      `  ${tunnel.url}${server.path}`,
      "",
      "Add it once in claude.ai → Settings → Connectors → Add custom connector. It then works in the Claude app on your phone.",
      "This address changes every time you restart with --tunnel, so update the connector after a restart.",
    );
  } else {
    lines.push(
      "To use it from your phone, it needs a public https address. Run again with --tunnel,",
      `or point your own tunnel at port ${server.port} (for example \`tailscale funnel ${server.port}\`) and add ${server.path} to its address.`,
    );
  }
  lines.push(
    "",
    "Keep the URL private: anyone who has it can read and change your cart (not pay). `--new-secret` replaces it.",
    "Keep this terminal open and the computer awake. Ctrl+C stops the server.",
  );
  if (!signedIn) lines.push("", "Not signed in yet: run `hazi-hinam login` in another terminal before using the tools.");
  io.stdout(lines.join("\n") + "\n");

  const stop = () => {
    tunnel?.close();
    void server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  void tunnel?.exited.then(() => io.stderr("The tunnel stopped. Restart `hazi-hinam mcp --http --tunnel` and update the connector URL.\n"));
  return 0;
}

export async function main(argv: string[], io: Io, ctx: Context): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!command || command === "help" || command === "--help") {
      io.stdout(helpText());
      return 0;
    }
    if (command === "login") return await login(parseFlags(rest), io, ctx);
    if (command === "logout") {
      const session = await ctx.store.loadSession(ctx.now());
      if (session) {
        // Best effort: the user asked to be signed out, so a dead/expired token or a flaky
        // server shouldn't leave them stuck logged-in locally.
        await ctx.clientFor(session.accessToken).logout().catch(() => {});
      }
      await ctx.store.clearSession();
      io.stdout("Signed out.\n");
      return 0;
    }
    if (command === "mcp") {
      const flags = parseFlags(rest);
      if (flags.http) return await serveHttp(flags, io, ctx);
      if (Object.keys(flags).length > 0) throw new HaziHinamError("BAD_ARGS", "--port, --tunnel and --new-secret need --http.");
      const { runMcpServer } = await import("./mcp.js");
      await runMcpServer(ctx);
      return 0;
    }
    const operation = operations.find(o => commandName(o.name) === command);
    if (!operation) {
      io.stderr(`Unknown command "${command}". Run \`hazi-hinam help\`.\n`);
      return 2;
    }
    const args = z.object(operation.input).parse(parseFlags(rest));
    const result = await operation.run(ctx, args);
    io.stdout(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (error) {
    io.stderr(formatError(error) + "\n");
    return error instanceof AuthRequired ? 3 : 1;
  }
}
