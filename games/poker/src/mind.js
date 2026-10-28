// The human side of the bots: personalities, mood (tilt, heaters, being
// caught bluffing), table image, memory of the bluffs other players showed,
// table talk and thinking time. Strategy modules read `effective()` instead
// of a fixed style, so the same bot plays differently as the night goes on.
(() => {
  "use strict";
  const P = (globalThis.Poker ??= {});

  /**
   * aggr/loose/bluff/sticky scale the strategy; trap = slow-play rate;
   * sizing = bet size multiplier; overbet = polar overbet rate; tilt =
   * how hard bad beats hit; adapt = how much reads on others matter;
   * show = chance to show a winning bluff; chat = how talkative;
   * tell = sizes value bets up and bluffs down (a readable habit).
   */
  const PERSONAS = {
    shark: {
      label: "Squalo TAG",
      aggr: 1.05,
      loose: 1,
      bluff: 1,
      sticky: 1,
      trap: 0.15,
      sizing: 1,
      overbet: 0.15,
      tilt: 0.2,
      adapt: 1,
      show: 0.08,
      chat: 0.3,
    },
    lag: {
      label: "LAG",
      aggr: 1.22,
      loose: 1.16,
      bluff: 1.35,
      sticky: 0.95,
      trap: 0.1,
      sizing: 1.1,
      overbet: 0.3,
      tilt: 0.4,
      adapt: 0.8,
      show: 0.3,
      chat: 0.5,
    },
    maniac: {
      label: "Maniaco controllato",
      aggr: 1.32,
      loose: 1.24,
      bluff: 1.55,
      sticky: 1.1,
      trap: 0.08,
      sizing: 1.2,
      overbet: 0.35,
      tilt: 0.6,
      adapt: 0.5,
      show: 0.4,
      chat: 0.65,
    },
    tricky: {
      label: "Trappolone",
      aggr: 1.08,
      loose: 1.05,
      bluff: 1.2,
      sticky: 1.05,
      trap: 0.38,
      sizing: 0.95,
      overbet: 0.22,
      tilt: 0.3,
      adapt: 0.85,
      show: 0.25,
      chat: 0.35,
    },
    rock: {
      label: "Roccia",
      aggr: 0.95,
      loose: 0.88,
      bluff: 0.7,
      sticky: 0.9,
      trap: 0.2,
      sizing: 1,
      overbet: 0.1,
      tilt: 0.15,
      adapt: 0.6,
      show: 0.05,
      chat: 0.15,
    },
    caller: {
      label: "Hero caller",
      aggr: 0.98,
      loose: 1.06,
      bluff: 0.75,
      sticky: 1.3,
      trap: 0.15,
      sizing: 0.95,
      overbet: 0.1,
      tilt: 0.45,
      adapt: 0.6,
      show: 0.1,
      chat: 0.5,
      tell: true,
    },
    solver: {
      label: "Teorico GTO",
      aggr: 1.05,
      loose: 1.02,
      bluff: 1.05,
      sticky: 1,
      trap: 0.2,
      sizing: 1,
      overbet: 0.2,
      tilt: 0.05,
      adapt: 0.4,
      show: 0.04,
      chat: 0.1,
    },
    exploiter: {
      label: "Sfruttatore",
      aggr: 1.1,
      loose: 1.05,
      bluff: 1.1,
      sticky: 1,
      trap: 0.2,
      sizing: 1,
      overbet: 0.2,
      tilt: 0.2,
      adapt: 1.4,
      show: 0.12,
      chat: 0.3,
    },
  };

  const LINES = {
    win: [
      "Grazie del passaggio.",
      "Questa la porto a casa.",
      "Fiches benvenute.",
      "Bel piatto, almeno per me.",
    ],
    badBeat: [
      "Al river. Ovviamente.",
      "Ogni volta così...",
      "Non ci credo.",
      "Ok. Respiro.",
      "Ma come fai a chiamare lì?",
    ],
    loss: ["Nh.", "Ben giocata.", "Ci stava.", "Bella mano."],
    showBluff: [
      "Non avevo niente.",
      "Tutta aria.",
      "Avevi la mano migliore, vero?",
      "Ogni tanto ci provo.",
      "Due carte a caso, giuro.",
    ],
    caught: ["Ok, mi hai beccato.", "Pagato. Bravo.", "Ci ho provato."],
    heroCall: [
      "Lo sapevo che bluffavi.",
      "Ti ho letto.",
      "Non me la racconti.",
    ],
    bust: ["gg, buon proseguimento.", "Ci vediamo al prossimo.", "Ahia. gg."],
    gg: ["gg", "gg wp", "Peccato, gg."],
    tilt: ["Stavolta non mollo.", "Vediamo se ce l'hai.", "Adesso basta."],
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const pick = (g, list) => list[Math.floor(g.rng() * list.length)];

  function init(p) {
    const key = p.style?.persona;
    p.persona = PERSONAS[key] ?? PERSONAS.shark;
    p.personaKey = PERSONAS[key] ? key : "shark";
    p.mind = { tilt: 0, caught: 0, heater: 0, grudge: {} };
  }

  /** Strategy multipliers for this decision, after mood and table image. */
  function effective(g, p, villain = null) {
    const base = p.persona ?? PERSONAS.shark;
    const m = p.mind ?? { tilt: 0, caught: 0, heater: 0, grudge: {} };
    const t = m.tilt;
    const grudge = villain ? (m.grudge[villain.id] ?? 0) : 0;
    let bully = 1;
    const alive = g.alive();
    if (alive.length <= g.payouts.length + 2 && alive.length > 2) {
      const avg = alive.reduce((s, o) => s + o.stack + o.bet, 0) / alive.length;
      if (p.stack + p.bet > avg * 1.5) bully = 1.2;
    }
    return {
      aggr: base.aggr * (1 + 0.3 * t) * bully,
      loose: base.loose * (1 + 0.3 * t) * (bully > 1 ? 1.15 : 1),
      bluff:
        base.bluff *
        (1 + 0.5 * t) *
        (1 + 0.15 * m.heater) *
        (1 - 0.22 * Math.min(m.caught, 2)) *
        bully,
      sticky: base.sticky * (1 + 0.25 * t + 0.08 * Math.min(grudge, 3)),
      trap: base.trap * (1 - 0.5 * t),
      sizing: base.sizing,
      overbet: base.overbet * (1 + t),
      adapt: base.adapt * (1 - 0.5 * t),
      tell: Boolean(base.tell),
      tilt: t,
    };
  }

  /** Whether a bot that won without showdown shows its cards. */
  function wantsToShow(g, p) {
    if (!p || p.isHuman || !p.hi?.bluffing) return false;
    return g.rng() < p.persona.show * (1 + p.mind.tilt);
  }

  function say(g, out, p, kind, odds = 1) {
    if (!p || p.isHuman || out.some((l) => l.id === p.id)) return;
    if (g.rng() >= p.persona.chat * odds) return;
    out.push({ id: p.id, name: p.name, text: pick(g, LINES[kind]) });
  }

  function bluffedRiver(p) {
    const river = p.hi?.streetActs?.[3];
    return river === "bet" || river === "raise";
  }

  function heroCalled(p) {
    return p.hi?.streetActs?.[3] === "call" && (p.finalBucket ?? 5) <= 3;
  }

  /** Updates moods and reads after a hand; returns lines of table talk. */
  function endHand(g, showdown, shown) {
    const out = [];
    const bigPot = (p) => p.startStack * 0.3;
    for (const p of g.players) {
      if (!p.mind) continue;
      const m = p.mind;
      m.tilt *= 0.88;
      m.caught *= 0.85;
      m.heater *= 0.8;
      if (!p.hi || p.hole.length === 0) continue;
      const delta = p.stack - p.startStack;
      if (showdown && p.score !== undefined && !p.folded) {
        p.finalBucket = P.Ranges.classify(p.hole[0], p.hole[1], g.board);
        // Everyone remembers a river bet that turned out to be air.
        if (bluffedRiver(p) && p.finalBucket <= 1) p.stats.bluffsShown++;
      }
      if (delta < -bigPot(p)) {
        const beat = showdown && !p.folded && (p.finalBucket ?? 0) >= 4;
        m.tilt = clamp(m.tilt + p.persona.tilt * (beat ? 0.7 : 0.35), 0, 1);
        const winner = g.players.find((o) => o.won > 0 && o !== p);
        if (winner) m.grudge[winner.id] = (m.grudge[winner.id] ?? 0) + 1;
        if (p.hi.bluffing && showdown) {
          m.caught += 1;
          say(g, out, p, "caught", 1.5);
        } else say(g, out, p, beat ? "badBeat" : "loss", beat ? 1.6 : 0.6);
      } else if (delta > bigPot(p)) {
        m.tilt = Math.max(0, m.tilt - 0.25);
        if (showdown && heroCalled(p)) say(g, out, p, "heroCall", 1.4);
        else say(g, out, p, "win", 0.5);
      }
      if (p.hi.bluffing && !showdown && delta > 0) m.heater += 1;
    }
    if (shown) {
      shown.stats.bluffsShown++;
      say(g, out, shown, "showBluff", 2.5);
    }
    for (const p of g.players) {
      if (!p.out || p.startStack === 0) continue; // busted on this hand
      say(g, out, p, "bust", 2);
      const other = g.alive().find((o) => !o.isHuman && g.rng() < 0.3);
      say(g, out, other, "gg", 2);
    }
    return out.slice(0, 2);
  }

  /** A line a tilted bot mutters when it puts pressure on. */
  function tiltLine(g, p) {
    if (p.isHuman || p.mind.tilt < 0.5 || g.rng() > 0.25 * p.persona.chat) {
      return null;
    }
    return pick(g, LINES.tilt);
  }

  /**
   * Milliseconds a bot takes: quick routine folds, longer on close or big
   * decisions, sometimes a long tank. Tricky players also tank with monsters.
   */
  function thinkTime(g, p, decision, legal) {
    const r = g.rng();
    const meta = decision.meta ?? {};
    const stackShare = legal.callAmount / Math.max(1, p.stack + p.bet);
    if (decision.type === "fold" && legal.toCall <= g.bb && g.street === 0) {
      return 280 + r * 420;
    }
    if (meta.snap && g.rng() < 0.4) return 350 + r * 300;
    let t = 650 + r * 900;
    if (decision.type === "raise") t += 300 + g.rng() * 500;
    if (meta.close) t += 1200 + g.rng() * 2200;
    if (stackShare > 0.35 || decision.amount >= p.stack + p.bet) {
      t += 900 + g.rng() * 1500;
    }
    if (meta.strong && p.persona.trap > 0.3 && g.rng() < 0.5) {
      t += 1500 + g.rng() * 1500; // reverse tell
    }
    return Math.min(t, 6000);
  }

  P.Mind = {
    PERSONAS,
    init,
    effective,
    wantsToShow,
    endHand,
    tiltLine,
    thinkTime,
  };
})();
