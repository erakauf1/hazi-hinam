#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { main } from "./cli.js";
import { createContext } from "./context.js";

const io = {
  stdout: (text: string) => void process.stdout.write(text),
  stderr: (text: string) => void process.stderr.write(text),
  async readLine(prompt: string) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  },
};

const code = await main(process.argv.slice(2), io, createContext());
// `mcp` keeps running on stdio; every other command exits with its status.
if (process.argv[2] !== "mcp") process.exitCode = code;
