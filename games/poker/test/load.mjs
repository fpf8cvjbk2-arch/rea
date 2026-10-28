// Loads the browser scripts into this Node process (they attach to globalThis.Poker).
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

const here = new URL("../src/", import.meta.url);

/** Loads the named game scripts in order and returns the Poker namespace. */
export function loadPoker(names = ["cards", "ranges", "ai", "engine"]) {
  for (const name of names) {
    const file = new URL(`${name}.js`, here);
    runInThisContext(readFileSync(file, "utf8"), { filename: file.pathname });
  }
  return globalThis.Poker;
}
