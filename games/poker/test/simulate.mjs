// Headless check: plays full 9-bot tournaments and asserts chip
// conservation, legal stacks, a single winner and distinct finishing places.
// Usage: node games/poker/test/simulate.mjs [tournaments] [seed]
import assert from "node:assert/strict";
import { loadPoker } from "./load.mjs";

const Poker = loadPoker();
const runs = Number(process.argv[2] ?? 5);
const seed0 = Number(process.argv[3] ?? 1);
const STACK = 30000;

async function playOne(seed) {
  let hands = 0;
  let decisions = 0;
  let thinkMs = 0;
  const actions = { fold: 0, check: 0, call: 0, raise: 0 };
  const game = new Poker.Engine.Tournament({
    seed,
    startingStack: STACK,
    handsPerLevel: 9,
    players: Array.from({ length: 9 }, (_, i) => ({
      name: `Bot${i}`,
      style: { aggr: 0.9 + (i % 4) * 0.1, loose: 0.92 + (i % 3) * 0.08 },
    })),
    getAction(g, p, legal) {
      const t = performance.now();
      const a = Poker.AI.decide(g, p, legal);
      thinkMs += performance.now() - t;
      decisions++;
      actions[a.type]++;
      return a;
    },
    onEvent(type) {
      if (type !== "showdown" && type !== "handStart") return;
      const total = game.players.reduce((s, p) => s + p.stack + p.totalBet, 0);
      assert.equal(total, STACK * 9, `chips not conserved after ${type}`);
      for (const p of game.players) assert.ok(p.stack >= 0, "negative stack");
      if (type === "handStart") hands++;
    },
  });
  await game.run();
  const places = game.players.map((p) => p.place).sort((a, b) => a - b);
  assert.deepEqual(places, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const prizes = game.players.reduce((s, p) => s + p.prize, 0);
  assert.equal(prizes, game.prizePool);
  const stats = game.players.map((p) => {
    const pr = Poker.AI.profile(p);
    return `${p.name} vpip ${(pr.vpip * 100).toFixed(0)} pfr ${(pr.pfr * 100).toFixed(0)} af ${pr.af.toFixed(1)} place ${p.place}`;
  });
  return {
    hands,
    decisions,
    thinkMs,
    actions,
    level: game.level.number,
    stats,
  };
}

let totalHands = 0;
for (let i = 0; i < runs; i++) {
  const r = await playOne(seed0 + i);
  totalHands += r.hands;
  console.log(
    `seed ${seed0 + i}: ${r.hands} hands, ended at level ${r.level}, ` +
      `${(r.thinkMs / r.decisions).toFixed(2)} ms/decision, actions ${JSON.stringify(r.actions)}`,
  );
  if (i === 0) console.log("  " + r.stats.join("\n  "));
}
console.log(`ok: ${runs} tournaments, ${totalHands} hands`);
