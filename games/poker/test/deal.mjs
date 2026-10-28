// Checks that the cryptographic shuffle deals fair hands: pocket pairs,
// premiums (JJ+ and AK) and flops that pair a hole card all match their
// exact probabilities. Usage: node games/poker/test/deal.mjs [deals]
import assert from "node:assert/strict";
import { loadPoker } from "./load.mjs";

const { Cards } = loadPoker(["cards"]);
const deals = Number(process.argv[2] ?? 300000);
const rng = Cards.cryptoRng();
let pairs = 0;
let premium = 0;
let unpaired = 0;
let hits = 0;
for (let i = 0; i < deals; i++) {
  const deck = Cards.shuffle(Cards.freshDeck(), rng);
  const a = deck.pop() >> 2;
  const b = deck.pop() >> 2;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (a === b) pairs++;
  if ((a === b && a >= 9) || (hi === 12 && lo === 11)) premium++;
  if (a === b) continue;
  unpaired++;
  deck.pop(); // burn
  const flop = [deck.pop(), deck.pop(), deck.pop()].map((c) => c >> 2);
  if (flop.includes(a) || flop.includes(b)) hits++;
}

// Exact probabilities and a 5-sigma tolerance for each binomial rate.
function check(label, count, n, p) {
  const rate = count / n;
  const tol = 5 * Math.sqrt((p * (1 - p)) / n);
  console.log(
    `${label}: ${(rate * 100).toFixed(2)}% (exact ${(p * 100).toFixed(2)}%)`,
  );
  assert.ok(Math.abs(rate - p) < tol, `${label} outside tolerance`);
}
check("pocket pairs", pairs, deals, 78 / 1326);
check("JJ+ and AK", premium, deals, 40 / 1326);
check(
  "flop pairs a hole card",
  hits,
  unpaired,
  1 - (44 * 43 * 42) / (50 * 49 * 48),
);
console.log(`ok: ${deals} deals`);
