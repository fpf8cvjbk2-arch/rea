// Preflop hand ranking, weighted range sampling and Monte Carlo equity
// against the ranges the bots attribute to each opponent.
(() => {
  "use strict";
  const P = (globalThis.Poker ??= {});
  const { evaluate, straightHigh, RANKS } = P.Cards;

  // The 169 starting-hand classes from strongest to weakest. Computed offline
  // as an equal blend of all-in equity versus one and versus three random
  // hands (30k/15k trials each), with big aces nudged up for blocker value.
  const ORDER = (
    "AA KK QQ JJ AKs TT AKo AQs 99 AJs KQs AQo 88 ATs KJs 77 AJo KTs A9s KQo " +
    "QJs ATo A8s QTs KJo JTs 66 A7s A5s K9s KTo A9o QJo A6s A4s Q9s K8s A8o " +
    "QTo J9s A3s K7s JTo A2s 55 A7o K9o Q8s K6s T9s A6o A5o Q9o J8s K5s T8s " +
    "A4o K8o K4s A3o Q7s 44 J9o 98s K7o Q6s K3s T9o J7s A2o Q5s K2s K6o Q8o " +
    "T7s Q4s K5o J8o J6s 87s 97s T8o 33 J5s Q3s Q2s K4o Q7o T6s 96s Q6o K3o " +
    "98o 76s J4s 86s Q5o J7o Q4o 22 J3s K2o T7o T5s J2s 97o 75s 85s J6o T4s " +
    "95s 87o Q3o 65s T3s T6o J5o Q2o 96o 54s T2s 94s 86o J4o 74s 76o 84s 64s " +
    "93s J3o 92s 53s T5o T4o 95o J2o 63s 65o 75o 73s 83s 85o 82s T3o 43s T2o " +
    "74o 52s 54o 64o 72s 94o 84o 42s 62s 93o 32s 92o 73o 83o 53o 43o 82o 63o " +
    "52o 62o 42o 72o 32o"
  ).split(" ");

  // classKey = hi * 13 + lo for suited/pairs, lo * 13 + hi for offsuit.
  function classKey(c1, c2) {
    const r1 = c1 >> 2;
    const r2 = c2 >> 2;
    const hi = Math.max(r1, r2);
    const lo = Math.min(r1, r2);
    if (hi === lo || (c1 & 3) === (c2 & 3)) return hi * 13 + lo;
    return lo * 13 + hi;
  }

  function labelKey(label) {
    const hi = RANKS.indexOf(label[0]);
    const lo = RANKS.indexOf(label[1]);
    return label[2] === "o" ? lo * 13 + hi : hi * 13 + lo;
  }

  function combosOf(label) {
    const hi = RANKS.indexOf(label[0]);
    const lo = RANKS.indexOf(label[1]);
    const out = [];
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        const suited = s1 === s2;
        if (hi === lo) {
          if (s2 > s1) out.push([hi * 4 + s1, lo * 4 + s2]);
        } else if (suited === (label[2] === "s")) {
          out.push([hi * 4 + s1, lo * 4 + s2]);
        }
      }
    }
    return out;
  }

  const CLASS_COMBOS = ORDER.map(combosOf);
  const CUM = [];
  const PERCENTILE = new Float64Array(169);
  {
    let acc = 0;
    ORDER.forEach((label, i) => {
      acc += CLASS_COMBOS[i].length;
      CUM.push(acc / 1326);
      PERCENTILE[labelKey(label)] = acc / 1326;
    });
  }

  /** Fraction of all combos at least as strong as this hand (0..1, low = strong). */
  function percentile(c1, c2) {
    return PERCENTILE[classKey(c1, c2)];
  }

  function handLabel(c1, c2) {
    const key = classKey(c1, c2);
    const a = Math.floor(key / 13);
    const b = key % 13;
    if (a === b) return RANKS[a] + RANKS[a];
    return a > b ? RANKS[a] + RANKS[b] + "s" : RANKS[b] + RANKS[a] + "o";
  }

  function classAt(u) {
    let lo = 0;
    let hi = 168;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (CUM[mid] >= u) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /**
   * Samples hole cards from a range {lo, hi, trap}. A range is the band of
   * percentiles [lo, hi]; `trap` is the chance the hand comes from above lo
   * (slow-played premiums).
   */
  function sampleCombo(range, used, rng) {
    for (let attempt = 0; attempt < 40; attempt++) {
      let u;
      if (range.lo > 0 && rng() < (range.trap ?? 0)) u = rng() * range.lo;
      else u = range.lo + rng() * (range.hi - range.lo);
      const combos = CLASS_COMBOS[classAt(Math.max(u, 1e-9))];
      const pick = combos[Math.floor(rng() * combos.length)];
      if (!used[pick[0]] && !used[pick[1]]) return pick;
    }
    for (let a = 0; a < 52; a++) {
      if (used[a]) continue;
      for (let b = a + 1; b < 52; b++) if (!used[b]) return [a, b];
    }
    return [0, 1];
  }

  // Ranks x that would complete a straight together with `mask`.
  function straightOuts(mask) {
    if (straightHigh(mask) >= 0) return 0;
    let outs = 0;
    for (let x = 0; x < 13; x++) {
      if (!(mask & (1 << x)) && straightHigh(mask | (1 << x)) >= 0) outs++;
    }
    return outs;
  }

  /** Draw facts for hole cards on a board of 3-4 cards. */
  function drawInfo(h0, h1, board) {
    const info = { flushDraw: false, oesd: false, gutshot: false };
    if (board.length < 3 || board.length > 4) return info;
    const suits = [0, 0, 0, 0];
    let boardMask = 0;
    for (const c of board) {
      suits[c & 3]++;
      boardMask |= 1 << (c >> 2);
    }
    for (let s = 0; s < 4; s++) {
      const holeIn = ((h0 & 3) === s ? 1 : 0) + ((h1 & 3) === s ? 1 : 0);
      if (holeIn > 0 && suits[s] + holeIn === 4) info.flushDraw = true;
    }
    const allMask = boardMask | (1 << (h0 >> 2)) | (1 << (h1 >> 2));
    const outs = straightOuts(allMask);
    const boardOuts = straightOuts(boardMask);
    if (outs > boardOuts) {
      if (outs >= 2) info.oesd = true;
      else info.gutshot = true;
    }
    info.strong = info.flushDraw || info.oesd;
    info.any = info.strong || info.gutshot;
    return info;
  }

  const tmp = Array.from({ length: 7 }, () => 0);

  // Postflop strength buckets: 0 air, 1 weak, 2 draw, 3 medium, 4 strong, 5 monster.
  function classify(h0, h1, board) {
    const n = board.length;
    for (let i = 0; i < n; i++) tmp[i] = board[i];
    tmp[n] = h0;
    tmp[n + 1] = h1;
    const score = evaluate(tmp, n + 2);
    const cat = score >> 20;
    const boardScore = n === 5 ? evaluate(board, 5) : -1;
    if (boardScore === score) return 1; // playing the board
    const r0 = h0 >> 2;
    const r1 = h1 >> 2;
    const bc = new Int8Array(13);
    let top = -1;
    let second = -1;
    for (const c of board) bc[c >> 2]++;
    for (let r = 12; r >= 0; r--) {
      if (!bc[r]) continue;
      if (top < 0) top = r;
      else if (second < 0) second = r;
    }
    const boardPairs = bc.reduce((acc, v) => acc + (v >= 2 ? 1 : 0), 0);
    const boardTrips = bc.some((v) => v >= 3);
    if (cat >= 4) return 5;
    if (cat === 3) {
      if (boardTrips) return Math.max(r0, r1) >= 11 ? 3 : 1;
      if (r0 === r1) return 5;
      return Math.max(r0, r1) >= 9 ? 5 : 4;
    }
    if (cat === 2 && boardPairs === 0) return 5;
    // Find the pair the hole cards make, if any.
    let pr = -1;
    if (r0 === r1) pr = r0;
    else if (bc[r0] === 1) pr = r0;
    else if (bc[r1] === 1) pr = r1;
    if (pr >= 0) {
      if (r0 === r1) {
        if (pr > top) return 4;
        return pr > second ? 3 : 1;
      }
      const kicker = pr === r0 ? r1 : r0;
      if (pr === top) return kicker >= 9 || kicker > second ? 4 : 3;
      if (pr === second) return n >= 5 ? 1 : 3;
      return 1;
    }
    if (n < 5) {
      const d = drawInfo(h0, h1, board);
      if (d.strong) return 2;
      if (d.gutshot) return 1;
    }
    return r0 > top && r1 > top ? 1 : 0;
  }

  const usedBuf = new Uint8Array(52);

  /**
   * Monte Carlo equity of `hole` against opponents, each described by a
   * preflop range and optional postflop bucket weights (acceptance odds).
   */
  function equity({ hole, board, opponents, trials, rng }) {
    if (opponents.length === 0) return 1;
    const base = new Uint8Array(52);
    for (const c of hole) base[c] = 1;
    for (const c of board) base[c] = 1;
    const me = Array.from({ length: 7 }, () => 0);
    const op = Array.from({ length: 7 }, () => 0);
    const oppHands = opponents.map(() => [0, 0]);
    const full = board.slice();
    let total = 0;
    for (let t = 0; t < trials; t++) {
      usedBuf.set(base);
      for (let o = 0; o < opponents.length; o++) {
        const spec = opponents[o];
        let pick = null;
        for (let tries = 0; tries < 10; tries++) {
          pick = sampleCombo(spec.range, usedBuf, rng);
          if (!spec.weights || board.length < 3) break;
          const w = spec.weights[classify(pick[0], pick[1], board)];
          if (rng() < w) break;
        }
        usedBuf[pick[0]] = 1;
        usedBuf[pick[1]] = 1;
        oppHands[o] = pick;
      }
      full.length = board.length;
      while (full.length < 5) {
        const c = Math.floor(rng() * 52);
        if (usedBuf[c]) continue;
        usedBuf[c] = 1;
        full.push(c);
      }
      for (let i = 0; i < 5; i++) {
        me[i] = full[i];
        op[i] = full[i];
      }
      me[5] = hole[0];
      me[6] = hole[1];
      const mine = evaluate(me, 7);
      let ties = 0;
      let lost = false;
      for (const h of oppHands) {
        op[5] = h[0];
        op[6] = h[1];
        const s = evaluate(op, 7);
        if (s > mine) {
          lost = true;
          break;
        }
        if (s === mine) ties++;
      }
      if (!lost) total += 1 / (ties + 1);
    }
    return total / trials;
  }

  P.Ranges = {
    ORDER,
    percentile,
    handLabel,
    sampleCombo,
    drawInfo,
    classify,
    equity,
  };
})();
