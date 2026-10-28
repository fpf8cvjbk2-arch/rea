// Postflop play. Each decision runs a Monte Carlo against the ranges the bot
// assigns to its opponents and learns two things: its equity and how much of
// each opponent's range is air, weak or a draw (the part that folds). Bets
// and raises compare the EV of pressure against checking or calling, so the
// bots bluff where the story is credible: opponents who showed weakness,
// scare cards, busted draws, blockers, players who fold too much. Value
// sizing, traps, floats and hero calls follow personality and mood.
(() => {
  "use strict";
  const P = (globalThis.Poker ??= {});
  const { equityDetail, drawInfo, classify } = P.Ranges;

  const core = () => P.AICore;

  function boardWet(board) {
    const suits = [0, 0, 0, 0];
    for (const c of board) suits[c & 3]++;
    const ranks = board.map((c) => c >> 2).sort((a, b) => a - b);
    let connected = false;
    for (let i = 0; i + 2 < ranks.length; i++) {
      if (ranks[i + 2] - ranks[i] <= 4) connected = true;
    }
    return Math.max(...suits) >= 2 || connected;
  }

  function maxSuit(cards) {
    const suits = [0, 0, 0, 0];
    for (const c of cards) suits[c & 3]++;
    let best = 0;
    for (let s = 1; s < 4; s++) if (suits[s] > suits[best]) best = s;
    return { suit: best, count: suits[best] };
  }

  function fourToStraight(cards) {
    let mask = 0;
    for (const c of cards) mask |= 1 << (c >> 2);
    const m = (mask << 1) | ((mask >> 12) & 1); // ace also plays low
    for (let lo = 0; lo <= 9; lo++) {
      let n = 0;
      for (let k = 0; k < 5; k++) if (m & (1 << (lo + k))) n++;
      if (n >= 4) return true;
    }
    return false;
  }

  /** What the last card changed: flush or straight arriving, a big overcard. */
  function scareInfo(board) {
    const info = { scare: false, flushSuit: -1 };
    const flush = maxSuit(board);
    if (flush.count >= 3) info.flushSuit = flush.suit;
    if (board.length < 4) return info;
    const prev = board.slice(0, -1);
    const last = board[board.length - 1];
    const flushArrived = flush.count >= 3 && maxSuit(prev).count < 3;
    const straightArrived = fourToStraight(board) && !fourToStraight(prev);
    const topPrev = Math.max(...prev.map((c) => c >> 2));
    const overcard = last >> 2 > topPrev && last >> 2 >= 10;
    info.scare = flushArrived || straightArrived || overcard;
    return info;
  }

  function holdsBlocker(hole, board, flushSuit) {
    if (flushSuit >= 0) {
      for (const c of hole)
        if ((c & 3) === flushSuit && c >> 2 >= 10) return true;
    }
    const top = Math.max(...board.map((c) => c >> 2));
    return hole.some((c) => c >> 2 === 12 && top < 12);
  }

  function lastToAct(g, p) {
    return core()
      .opponents(g, p)
      .every((o) => g.positionIndex(o.seat) < g.positionIndex(p.seat));
  }

  function showedWeakness(g, o) {
    const prev = o.hi.streetActs[g.street - 1];
    const now = o.hi.streetActs[g.street];
    return now === "check" || (g.street > 1 && prev === "check");
  }

  function foldiness(o, style) {
    const f = core().profile(o).foldToBet / 0.45;
    return core().clamp(f ** style.adapt, 0.35, 1.7);
  }

  function buildContext(g, p, legal) {
    const C = core();
    const opps = C.opponents(g, p);
    const n = opps.length;
    const villain =
      g.players[g.streetAggressor ?? -1] ??
      opps.reduce((a, b) => (b.stack + b.bet > a.stack + a.bet ? b : a));
    const style = P.Mind.effective(g, p, villain);
    const det = equityDetail({
      hole: p.hole,
      board: g.board,
      opponents: opps.map((o) => ({
        range: o.hi.range,
        weights: C.weightsFor(o),
      })),
      trials: n === 1 ? 700 : 500,
      rng: g.rng,
    });
    const draw = drawInfo(p.hole[0], p.hole[1], g.board);
    if (draw.strong) p.hi.hadDraw = true;
    const scare = scareInfo(g.board);
    return {
      g,
      p,
      legal,
      opps,
      n,
      villain,
      style,
      eq: det.eq,
      weak: det.weak,
      draws: det.draws,
      street: g.street,
      draw,
      bucket: classify(p.hole[0], p.hole[1], g.board),
      wet: boardWet(g.board),
      scare: scare.scare,
      blocker: holdsBlocker(p.hole, g.board, scare.flushSuit),
      ip: lastToAct(g, p),
      premium: C.icmPremium(g, p, villain),
      pot: legal.pot,
    };
  }

  /** Probability that every opponent folds to pressure of size `frac` × pot. */
  function foldEquity(c, frac, raising) {
    let fe = 1;
    c.opps.forEach((o, i) => {
      let f = c.weak[i] + c.draws[i] * (c.street === 3 ? 0.9 : 0.3);
      f *= foldiness(o, c.style);
      f *= 0.58 + 0.3 * Math.min(frac, 1.5);
      if (raising) f *= 0.7;
      if (c.scare) f *= 1.2;
      if (c.blocker) f *= 1.12;
      if (showedWeakness(c.g, o)) f *= 1.15;
      fe *= core().clamp(f, 0, 0.92);
    });
    return fe;
  }

  function sizeFor(c, value) {
    const { street, wet, style, g } = c;
    let frac;
    if (street === 1) frac = wet ? 0.6 : 0.35;
    else if (street === 2) frac = 0.66;
    else frac = 0.72;
    const polar = street >= 2 && (value ? c.eq > 0.85 : c.blocker || c.scare);
    if (polar && g.rng() < style.overbet) frac = 1.25;
    if (style.tell) frac *= value ? 1.2 : 0.8;
    return frac * style.sizing * (0.9 + g.rng() * 0.2);
  }

  function bet(c, frac, meta) {
    const { g, p, legal } = c;
    return { ...core().raiseTo(g, p, legal, legal.pot * frac), meta };
  }

  function valueThreshold(c) {
    const { n, street, opps, style } = c;
    let thr =
      street === 3 && n === 1
        ? 0.56
        : [0.6, 0.5, 0.4, 0.34][Math.min(n, 4) - 1];
    // Thinner value against players who do not fold.
    const station = opps.reduce((a, o) => a + (1 - foldiness(o, style)), 0) / n;
    if (station > 0) thr -= 0.06 * Math.min(station, 0.6);
    return thr;
  }

  function chooseBet(c) {
    const { g, p, eq, street, bucket, style, ip, pot } = c;
    p.hi.bluffing = false;
    if (eq >= valueThreshold(c)) {
      const slow = street < 3 && eq > 0.85 && g.rng() < style.trap;
      if (slow) {
        p.hi.planCR = !ip;
        return { type: "check", meta: { strong: true } };
      }
      return bet(c, sizeFor(c, true), { strong: eq > 0.85 });
    }
    if (c.n > 2) return { type: "check" };
    // Pressure: compare betting with checking.
    const frac = sizeFor(c, false);
    const B = frac * pot;
    const fe = foldEquity(c, frac, false);
    const semi = c.draw.strong && street < 3;
    const eqCalled = semi ? eq * 0.9 : eq * 0.5;
    const evBet = fe * pot + (1 - fe) * (eqCalled * (pot + 2 * B) - B);
    const evCheck = eq * pot * (ip ? 1 : 0.85);
    let drive = evBet - evCheck + (style.bluff - 1) * 0.35 * pot;
    if (street === 3 && p.hi.hadDraw && bucket === 0) drive += 0.08 * pot;
    if (p.hi.float && street >= 2) drive += 0.1 * pot;
    drive += (g.rng() - 0.5) * 0.14 * pot;
    if (drive > 0 && g.rng() < 0.92) {
      p.hi.bluffing = bucket <= 1;
      return bet(c, frac, { close: Math.abs(drive) < 0.1 * pot });
    }
    return { type: "check" };
  }

  function raiseSize(c) {
    const { legal, p } = c;
    const mult = p.personaKey === "maniac" ? 3.4 : 2.6 + c.g.rng() * 0.6;
    return legal.currentBet * mult;
  }

  function tryBluffRaise(c, need) {
    const { g, p, legal, eq, street, style, n } = c;
    if (n !== 1 || !legal.canRaise) return null;
    if (street === 3 && !(c.blocker || c.scare) && style.bluff < 1.15)
      return null;
    const R = raiseSize(c);
    const cost = R - p.bet;
    if (cost > p.stack * 0.45) return null;
    const fe = foldEquity(c, R / legal.pot, true);
    const semi = c.draw.strong && street < 3;
    const eqCalled = semi ? eq * 0.85 : eq * 0.4;
    const finalPot = legal.pot + cost + (R - legal.currentBet);
    const evRaise = fe * legal.pot + (1 - fe) * (eqCalled * finalPot - cost);
    const evCall =
      eq >= need ? eq * (legal.pot + legal.callAmount) - legal.callAmount : 0;
    const drive =
      evRaise -
      Math.max(evCall, 0) +
      (style.bluff - 1) * 0.25 * legal.pot +
      (g.rng() - 0.5) * 0.12 * legal.pot;
    if (drive > 0 && g.rng() < 0.75) {
      p.hi.bluffing = c.bucket <= 1;
      return { ...core().raiseTo(g, p, legal, R), meta: { close: true } };
    }
    return null;
  }

  function chooseResponse(c) {
    const { g, p, legal, eq, n, street, draw, style, premium } = c;
    const potOdds = legal.callAmount / (legal.pot + legal.callAmount);
    const deep = p.stack - legal.callAmount > legal.pot * 3;
    const implied =
      draw.any && street < 3 && deep ? (draw.strong ? 0.07 : 0.03) : 0;
    let need = potOdds - implied + premium + (n > 1 ? 0.03 * (n - 1) : 0);
    need *= 1 - 0.25 * (style.sticky - 1);
    // Refuse to be bullied: defend wider against players who bet too often.
    const af = core().profile(c.villain).af;
    need *= 1 - 0.1 * core().clamp(af - 2, 0, 2) * Math.min(style.adapt, 1.2);
    let raiseThr = n === 1 ? (street === 3 ? 0.82 : 0.74) : 0.85;
    if (p.hi.planCR) raiseThr -= 0.1;
    const meta = { close: Math.abs(eq - need) < 0.06, strong: eq > 0.85 };
    if (eq >= raiseThr && legal.canRaise) {
      if (street === 1 && n === 1 && !p.hi.planCR && g.rng() < style.trap) {
        return { type: "call", meta };
      }
      p.hi.bluffing = false;
      return { ...core().raiseTo(g, p, legal, raiseSize(c)), meta };
    }
    const bluff = tryBluffRaise(c, need);
    if (bluff) return bluff;
    if (eq >= need) {
      return { type: "call", meta: { ...meta, snap: eq > 0.9 } };
    }
    // Float in position with something to work with, planning to take it away.
    const floatable =
      street < 3 &&
      n === 1 &&
      c.ip &&
      (c.bucket >= 1 || draw.any) &&
      legal.callAmount < p.stack * 0.15 &&
      eq >= need - 0.07 * style.bluff;
    if (floatable && g.rng() < 0.55 * style.bluff) {
      p.hi.float = true;
      return { type: "call", meta: { close: true } };
    }
    return { type: "fold", meta };
  }

  /** Chooses a postflop action. */
  function decide(g, p, legal) {
    const c = buildContext(g, p, legal);
    return legal.canCheck ? chooseBet(c) : chooseResponse(c);
  }

  P.Postflop = { decide, scareInfo, boardWet };
})();
