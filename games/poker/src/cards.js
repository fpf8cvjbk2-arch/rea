// Cards, deterministic RNG and a fast 5-7 card hand evaluator.
// A card is an integer 0..51: rank = card >> 2 (0 = deuce .. 12 = ace),
// suit = card & 3 (0 spades, 1 hearts, 2 diamonds, 3 clubs).
(() => {
  "use strict";
  const P = (globalThis.Poker ??= {});

  const RANKS = "23456789TJQKA";
  const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];
  const CATEGORY_NAMES = [
    "Carta alta",
    "Coppia",
    "Doppia coppia",
    "Tris",
    "Scala",
    "Colore",
    "Full",
    "Poker",
    "Scala colore",
  ];
  const RANK_NAMES = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];

  /** Mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function freshDeck() {
    return Array.from({ length: 52 }, (_, i) => i);
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // Ranks are stored at bit (rank + 1); bit 0 duplicates the ace so the
  // wheel (A-2-3-4-5) is found by the same window scan.
  function straightHigh(mask) {
    const m = (mask << 1) | ((mask >> 12) & 1);
    for (let top = 13; top >= 4; top--) {
      if (((m >> (top - 4)) & 31) === 31) return top - 1;
    }
    return -1;
  }

  function topRanks(mask, n) {
    let out = 0;
    let k = 0;
    for (let r = 12; r >= 0 && k < n; r--) {
      if (mask & (1 << r)) {
        out = (out << 4) | r;
        k++;
      }
    }
    while (k < n) {
      out <<= 4;
      k++;
    }
    return out;
  }

  const counts = new Int8Array(13);
  const suitCount = new Int8Array(4);
  const suitMask = new Int32Array(4);

  /**
   * Scores 5 to 7 cards. Higher is better; equal scores tie.
   * score = category << 20 | kicker nibbles.
   */
  function evaluate(cards, len = cards.length) {
    counts.fill(0);
    suitCount.fill(0);
    suitMask.fill(0);
    let mask = 0;
    for (let i = 0; i < len; i++) {
      const c = cards[i];
      const r = c >> 2;
      const s = c & 3;
      counts[r]++;
      suitCount[s]++;
      suitMask[s] |= 1 << r;
      mask |= 1 << r;
    }
    for (let s = 0; s < 4; s++) {
      if (suitCount[s] >= 5) {
        const sh = straightHigh(suitMask[s]);
        if (sh >= 0) return (8 << 20) | (sh << 16);
        // With at most 7 cards a flush cannot coexist with quads or a full.
        return (5 << 20) | topRanks(suitMask[s], 5);
      }
    }
    let quad = -1;
    let trips = -1;
    let trips2 = -1;
    let pair1 = -1;
    let pair2 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = counts[r];
      if (n === 4) quad = r;
      else if (n === 3) {
        if (trips < 0) trips = r;
        else if (trips2 < 0) trips2 = r;
      } else if (n === 2) {
        if (pair1 < 0) pair1 = r;
        else if (pair2 < 0) pair2 = r;
      }
    }
    if (quad >= 0) {
      return (
        (7 << 20) | (quad << 16) | (topRanks(mask & ~(1 << quad), 1) << 12)
      );
    }
    if (trips >= 0 && (trips2 >= 0 || pair1 >= 0)) {
      return (6 << 20) | (trips << 16) | (Math.max(trips2, pair1) << 12);
    }
    const sh = straightHigh(mask);
    if (sh >= 0) return (4 << 20) | (sh << 16);
    if (trips >= 0) {
      return (
        (3 << 20) | (trips << 16) | (topRanks(mask & ~(1 << trips), 2) << 8)
      );
    }
    if (pair2 >= 0) {
      const rest = mask & ~(1 << pair1) & ~(1 << pair2);
      return (
        (2 << 20) | (pair1 << 16) | (pair2 << 12) | (topRanks(rest, 1) << 8)
      );
    }
    if (pair1 >= 0) {
      return (
        (1 << 20) | (pair1 << 16) | (topRanks(mask & ~(1 << pair1), 3) << 4)
      );
    }
    return topRanks(mask, 5);
  }

  /** Human-readable Italian description of a score from evaluate(). */
  function describe(score) {
    const cat = score >> 20;
    const a = RANK_NAMES[(score >> 16) & 15];
    const b = RANK_NAMES[(score >> 12) & 15];
    switch (cat) {
      case 0:
        return `Carta alta ${a}`;
      case 1:
        return `Coppia di ${a}`;
      case 2:
        return `Doppia coppia ${a} e ${b}`;
      case 3:
        return `Tris di ${a}`;
      case 4:
        return `Scala al ${a}`;
      case 5:
        return `Colore al ${a}`;
      case 6:
        return `Full di ${a} su ${b}`;
      case 7:
        return `Poker di ${a}`;
      default:
        return a === "A" ? "Scala reale" : `Scala colore al ${a}`;
    }
  }

  /** Returns the five cards (subset of `cards`) that make the best hand. */
  function bestFive(cards) {
    let best = -1;
    let bestSet = cards.slice(0, 5);
    const n = cards.length;
    const pick = [0, 0, 0, 0, 0];
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) {
              pick[0] = cards[a];
              pick[1] = cards[b];
              pick[2] = cards[c];
              pick[3] = cards[d];
              pick[4] = cards[e];
              const s = evaluate(pick, 5);
              if (s > best) {
                best = s;
                bestSet = pick.slice();
              }
            }
    return bestSet;
  }

  function cardRank(c) {
    return c >> 2;
  }

  function cardSuit(c) {
    return c & 3;
  }

  function cardText(c) {
    return RANK_NAMES[c >> 2] + SUIT_SYMBOLS[c & 3];
  }

  P.Cards = {
    RANKS,
    RANK_NAMES,
    SUIT_SYMBOLS,
    CATEGORY_NAMES,
    makeRng,
    freshDeck,
    shuffle,
    straightHigh,
    evaluate,
    describe,
    bestFive,
    cardRank,
    cardSuit,
    cardText,
  };
})();
