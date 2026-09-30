import { spawn } from "node:child_process";
import { HaziHinamError } from "./errors.js";

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 30_000;

export interface Tunnel {
  url: string;
  /** Resolves if cloudflared stops on its own after the tunnel was up. */
  exited: Promise<void>;
  close(): void;
}

// A Cloudflare quick tunnel: no account needed, but the address changes every time it starts.
export function openCloudflareTunnel(localUrl: string, command = "cloudflared"): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["tunnel", "--no-autoupdate", "--url", localUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let started = false;
    let closing = false;
    let output = "";
    let markExited: () => void = () => {};
    const exited = new Promise<void>(done => (markExited = done));

    const fail = (error: Error) => {
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new HaziHinamError("TUNNEL_FAILED", "cloudflared did not report a public URL within 30 seconds.")),
      START_TIMEOUT_MS,
    );

    const onData = (chunk: Buffer) => {
      if (started) return;
      output += chunk.toString();
      const match = TUNNEL_URL.exec(output);
      if (!match) return;
      started = true;
      clearTimeout(timer);
      resolve({
        url: match[0],
        exited,
        close: () => {
          closing = true;
          child.kill();
        },
      });
    };
    // Always attached, so cloudflared's log output is drained and a full pipe never stalls it.
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.once("error", error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        fail(
          new HaziHinamError(
            "TUNNEL_UNAVAILABLE",
            "--tunnel needs cloudflared. Install it (macOS: `brew install cloudflared`), or leave out --tunnel and expose the port yourself.",
          ),
        );
      } else fail(error);
    });
    child.once("exit", code => {
      if (!started) fail(new HaziHinamError("TUNNEL_FAILED", `cloudflared exited before the tunnel was up (code ${code}).`));
      else if (!closing) markExited();
    });
  });
}
