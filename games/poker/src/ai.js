// Tournament bots. Preflop: position-based opening ranges, polarized
// 3-bets/4-bets and EV-driven push/fold for short stacks. Postflop: Monte
// Carlo equity against each opponent's range, narrowed by what they did this
// hand and weighted by the tendencies observed so far (VPIP, PFR, AF, fold to
// bet), plus an ICM risk premium near the money.
(() => {
  "use strict";
  const P = (globalThis.Poker ??= {});
  const { percentile, equity, drawInfo, classify } = P.Ranges;

  // Raise-first-in width by number of players still to act (incl. blinds).
  const RFI = [1, 0.44, 0.46, 0.3, 0.24, 0.2, 0.17, 0.15, 0.13];
  // Nash-like shove width scale by players behind (at 5.5 bb = 100%).
  const PUSH = [1, 1.05, 0.73, 0.55, 0.45, 0.37, 0.31, 0.26, 0.22];
  const PRIOR = {
    hands: 10,
    vpip: 2.4,
    pfr: 1.8,
    aggr: 6,
    passive: 4,
    facedBet: 6,
    foldedToBet: 2.7,
  };
  // Acceptance odds per strength bucket (air, weak, draw, medium, strong, monster).
  const W_CHECK = [1, 1, 1, 0.9, 0.65, 0.4];
  const W_CALL = [0.2, 0.6, 1, 1, 0.85, 0.55];
  const W_AGG = [
    [0.4, 0.55, 0.9, 0.75, 1, 1],
    [0.16, 0.25, 0.6, 0.4, 0.9, 1],
    [0.07, 0.1, 0.35, 0.18, 0.6, 1],
  ];

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function rate(p, key, denom) {
    const s = p.stats;
    return (s[key] + PRIOR[key]) / (s[denom] + PRIOR[denom]);
  }

  /** Observed tendencies with priors, as shown on the HUD. */
  function profile(p) {
    const s = p.stats;
    return {
      hands: s.hands,
      vpip: rate(p, "vpip", "hands"),
      pfr: rate(p, "pfr", "hands"),
      af: (s.aggr + PRIOR.aggr) / (s.passive + PRIOR.passive),
      foldToBet: rate(p, "foldedToBet", "facedBet"),
    };
  }

  function initPlayers(g) {
    for (const p of g.players) {
      p.stats = {
        hands: 0,
        vpip: 0,
        pfr: 0,
        aggr: 0,
        passive: 0,
        facedBet: 0,
        foldedToBet: 0,
      };
      p.style = { aggr: 1, loose: 1, ...p.style };
    }
  }

  function newHand(g) {
    for (const p of g.alive()) {
      p.stats.hands++;
      p.hi = {
        range: { lo: 0, hi: 1, trap: 0 },
        postAggr: 0,
        postCalls: 0,
        vpip: false,
        pfr: false,
        lastBetFrac: 0,
      };
    }
  }

  function behindCount(g, p) {
    const idx = g.preflopOrder.indexOf(p.seat);
    return idx < 0 ? 0 : g.preflopOrder.length - 1 - idx;
  }

  function rfiWidth(g, behind) {
    if (g.alive().length === 2) return 0.8;
    const w = RFI[clamp(behind, 0, 8)];
    return g.level.ante > 0 ? Math.min(1, w * 1.15) : w;
  }

  function pushWidth(g, bbStack, behind) {
    const w = (5.5 / Math.max(bbStack, 1)) * PUSH[clamp(behind, 1, 8)];
    return clamp(g.level.ante > 0 ? w * 1.15 : w, 0.02, 1);
  }

  function chipsBB(g, p) {
    return (p.stack + p.bet) / g.bb;
  }

  function effBB(g, p) {
    let most = 0;
    for (const o of g.inHand())
      if (o !== p) most = Math.max(most, o.stack + o.bet);
    return Math.min(p.stack + p.bet, most) / g.bb;
  }

  function opponents(g, p) {
    return g.inHand().filter((o) => o !== p);
  }

  /** Risk premium (extra equity required) from the payout structure. */
  function icmPremium(g, p, villain) {
    const left = g.alive().length;
    const paid = g.payouts.length;
    let base = 0.01;
    if (left <= 2) base = 0;
    else if (left <= paid) base = 0.025;
    else if (left === paid + 1) base = 0.07;
    else if (left <= paid + 3) base = 0.035;
    if (villain)
      base *= villain.stack + villain.bet >= p.stack + p.bet ? 1.25 : 0.55;
    if (chipsBB(g, p) < 8) base *= 0.4;
    return base;
  }

  function roundChips(g, x) {
    const unit = g.bb >= 2000 ? 100 : 25;
    return Math.round(x / unit) * unit;
  }

  function raiseTo(g, p, legal, to) {
    if (!legal.canRaise)
      return legal.canCheck ? { type: "check" } : { type: "call" };
    let amount = Math.max(legal.minRaiseTo, roundChips(g, to));
    if (amount >= legal.maxRaiseTo * 0.6) amount = legal.maxRaiseTo;
    return { type: "raise", amount: Math.min(amount, legal.maxRaiseTo) };
  }

  const jam = (legal) =>
    legal.canRaise
      ? { type: "raise", amount: legal.maxRaiseTo }
      : { type: "call" };
  const passive = (legal) =>
    legal.canCheck ? { type: "check" } : { type: "fold" };

  function weightsFor(o) {
    const pf = profile(o);
    const bluff = clamp(pf.af / 1.5, 0.5, 2);
    const press = o.hi.postAggr + (o.hi.lastBetFrac > 1 ? 1 : 0);
    let base;
    if (press === 0) base = o.hi.postCalls > 0 ? W_CALL : W_CHECK;
    else base = W_AGG[Math.min(press, 3) - 1];
    const w = base.slice();
    w[0] = Math.min(1, w[0] * bluff);
    w[1] = Math.min(1, w[1] * bluff);
    return w;
  }

  function equityVs(g, p, opps, trials, postflop) {
    return equity({
      hole: p.hole,
      board: g.board,
      opponents: opps.map((o) => ({
        range: o.hi.range,
        weights: postflop ? weightsFor(o) : null,
      })),
      trials,
      rng: g.rng,
    });
  }

  // ---------------------------------------------------------------- preflop

  function callWidthVsShove(shoveBB) {
    return Math.min(0.6, 0.04 + 2 / Math.max(shoveBB, 1));
  }

  /** Chip EV (in chips) of moving all-in now versus folding. */
  function shoveEV(g, p, legal) {
    const myTotal = p.stack + p.bet;
    const others = g.alive().filter((o) => o !== p && !o.folded);
    let pFold = 1;
    let caller = null;
    let callerW = 0;
    for (const o of others) {
      if (o.allIn) continue;
      const faced = Math.min(myTotal, o.stack + o.bet) / g.bb;
      let w = callWidthVsShove(faced);
      if (o.id === g.pf.lastRaiser) {
        const committed = o.bet / (o.stack + o.bet) > 0.3;
        w = committed ? o.hi.range.hi * 0.9 : Math.max(w, o.hi.range.hi * 0.5);
      }
      w *= clamp(profile(o).vpip / 0.24, 0.7, 1.5);
      w = clamp(w, 0.02, 1);
      pFold *= 1 - w;
      if (w > callerW) {
        callerW = w;
        caller = o;
      }
    }
    if (!caller) return { ev: legal.pot, caller: null };
    const eq = equity({
      hole: p.hole,
      board: [],
      opponents: [{ range: { lo: 0, hi: callerW, trap: 0 } }],
      trials: 450,
      rng: g.rng,
    });
    const seff = Math.min(myTotal, caller.stack + caller.bet);
    const finalPot = legal.pot + (seff - p.bet) + (seff - caller.bet);
    const called = eq * finalPot - (seff - p.bet);
    return { ev: pFold * legal.pot + (1 - pFold) * called, caller, seff };
  }

  function shoveOrNot(g, p, legal, fallback) {
    const { ev, caller, seff } = shoveEV(g, p, legal);
    const premium = caller ? icmPremium(g, p, caller) * seff : 0;
    if (ev > premium) return jam(legal);
    return fallback;
  }

  /** Call/jam decision when the price commits most of the stack. */
  function allInDecision(g, p, legal, width) {
    const aggressor = g.players[g.pf.lastRaiser] ?? null;
    const opps = opponents(g, p);
    const specs = opps.map((o) => ({
      range: o === aggressor ? { lo: 0, hi: width, trap: 0 } : o.hi.range,
    }));
    const eq = equity({
      hole: p.hole,
      board: [],
      opponents: specs,
      trials: 500,
      rng: g.rng,
    });
    const need = legal.callAmount / (legal.pot + legal.callAmount);
    if (eq >= need + icmPremium(g, p, aggressor)) {
      return eq > 0.55 || p.stack - legal.callAmount < g.bb * 3
        ? jam(legal)
        : { type: "call" };
    }
    return passive(legal);
  }

  function openSize(g, p, eff, limpers) {
    let bbs = 2.2;
    if (eff < 25) bbs = 2;
    else if (p.seat === g.sbSeat) bbs = 3;
    else if (behindCount(g, p) >= 6) bbs = 2.4;
    return (bbs + limpers) * g.bb;
  }

  function unopened(g, p, legal, ctx) {
    const { pct, eff, behind, style } = ctx;
    if (legal.canCheck) {
      // Big blind in a limped pot.
      if (pct <= 0.1 * style.aggr) {
        return raiseTo(g, p, legal, (3 + g.pf.limpers) * g.bb);
      }
      return { type: "check" };
    }
    const short = eff <= (g.level.ante > 0 ? 14 : 12);
    if (short) return shoveOrNot(g, p, legal, passive(legal));
    const open = rfiWidth(g, behind) * style.loose;
    if (g.pf.limpers > 0) {
      if (pct <= open * 0.6) {
        return raiseTo(g, p, legal, openSize(g, p, eff, g.pf.limpers + 1));
      }
      if (pct <= open * 0.9 && legal.callAmount <= g.bb)
        return { type: "call" };
      return passive(legal);
    }
    if (pct <= open) return raiseTo(g, p, legal, openSize(g, p, eff, 0));
    if (p.seat === g.sbSeat && behind === 1 && pct <= 0.7 && g.rng() < 0.35) {
      return { type: "call" };
    }
    return passive(legal);
  }

  function isBlockerHand(hole) {
    const r0 = hole[0] >> 2;
    const r1 = hole[1] >> 2;
    const suited = (hole[0] & 3) === (hole[1] & 3);
    return (
      (Math.max(r0, r1) === 12 && suited) ||
      (suited && Math.abs(r0 - r1) === 1 && Math.min(r0, r1) >= 3)
    );
  }

  function facingOpen(g, p, legal, ctx) {
    const { pct, eff, style } = ctx;
    const raiser = g.players[g.pf.lastRaiser];
    const R = raiser.hi.range.hi;
    const callers = g.pf.callers;
    const isBB = p.seat === g.bbSeat;
    const isSB = p.seat === g.sbSeat;
    if (legal.callAmount >= p.stack * 0.45 || raiser.allIn) {
      return allInDecision(g, p, legal, R);
    }
    const price = legal.callAmount / (legal.pot + legal.callAmount);
    if (eff <= 22) {
      const jamW = Math.max(0.04, R * 0.45) * (callers ? 0.7 : 1) * style.aggr;
      if (pct <= jamW)
        return shoveOrNot(
          g,
          p,
          legal,
          pct <= jamW * 0.5 ? jam(legal) : passive(legal),
        );
      if (isBB && pct <= Math.min(0.45, R * (1 + (0.33 - price) * 3)))
        return { type: "call" };
      return passive(legal);
    }
    const ip =
      !isBB && !isSB && g.positionIndex(p.seat) > g.positionIndex(raiser.seat);
    const v3 = Math.max(0.025, R * 0.22) * (callers ? 0.75 : 1) * style.aggr;
    let callW;
    if (isBB) callW = Math.min(0.6, R * (1.25 + (0.3 - price) * 3));
    else if (ip) callW = R * 0.7;
    else callW = R * (isSB ? 0.35 : 0.45);
    if (callers) callW *= 0.85;
    const bluff3 =
      callers === 0 &&
      pct > callW &&
      pct <= callW + R * 0.25 &&
      isBlockerHand(p.hole) &&
      g.rng() < 0.5 * style.aggr;
    if (pct <= v3 || bluff3) {
      const mult = ip ? 3 : 3.8;
      return raiseTo(
        g,
        p,
        legal,
        legal.currentBet * mult + callers * legal.currentBet,
      );
    }
    if (pct <= callW) return { type: "call" };
    return passive(legal);
  }

  function facingThreeBet(g, p, legal, ctx) {
    const { pct, style } = ctx;
    const three = g.players[g.pf.lastRaiser];
    const W3 = three.hi.range.hi;
    if (legal.callAmount >= p.stack * 0.4 || three.allIn) {
      return allInDecision(g, p, legal, W3);
    }
    const invested = p.bet > 0 && p.hi.pfr;
    const ip =
      g.positionIndex(p.seat) > g.positionIndex(three.seat) &&
      p.seat !== g.bbSeat;
    const v4 = Math.max(0.02, W3 * 0.33);
    const callW = invested ? W3 * (ip ? 0.85 : 0.65) : W3 * 0.3;
    const bluff4 =
      invested &&
      pct > callW &&
      pct <= callW + 0.05 &&
      (p.hole[0] >> 2 === 12 || p.hole[1] >> 2 === 12) &&
      g.rng() < 0.3 * style.aggr;
    if (pct <= v4 || bluff4)
      return raiseTo(g, p, legal, legal.currentBet * 2.25);
    if (pct <= callW) {
      return legal.callAmount <= p.stack * 0.25 ? { type: "call" } : jam(legal);
    }
    return passive(legal);
  }

  function facingFourBetPlus(g, p, legal, ctx) {
    const last = g.players[g.pf.lastRaiser];
    const W = Math.max(0.02, last.hi.range.hi);
    if (ctx.pct <= Math.max(0.015, W * 0.45)) return jam(legal);
    return allInDecision(g, p, legal, W);
  }

  function preflop(g, p, legal) {
    const ctx = {
      pct: percentile(p.hole[0], p.hole[1]),
      eff: effBB(g, p),
      behind: behindCount(g, p),
      style: p.style,
    };
    const raises = g.pf.raises;
    if (raises === 0) return unopened(g, p, legal, ctx);
    if (raises === 1) return facingOpen(g, p, legal, ctx);
    if (raises === 2) return facingThreeBet(g, p, legal, ctx);
    return facingFourBetPlus(g, p, legal, ctx);
  }

  // --------------------------------------------------------------- postflop

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

  function lastToAct(g, p) {
    return opponents(g, p).every(
      (o) => g.positionIndex(o.seat) < g.positionIndex(p.seat),
    );
  }

  function betFrac(g, p, legal, frac) {
    return raiseTo(g, p, legal, legal.pot * frac);
  }

  function chooseBet(g, p, legal, c) {
    const { eq, n, street, draw, bucket, style, fold, wet } = c;
    const valueThr =
      street === 3 && n === 1
        ? 0.56
        : [0.6, 0.5, 0.4, 0.34][Math.min(n, 4) - 1];
    const aggressor =
      g.lastStreetAggressor === p.id ||
      (street === 1 && g.pfAggressor === p.id);
    const r = g.rng();
    if (eq >= valueThr) {
      if (street < 3 && eq > 0.88 && r < 0.2 && !lastToAct(g, p))
        return { type: "check" };
      if (street === 3 && eq > 0.82 && r < 0.3)
        return betFrac(g, p, legal, 1.25);
      if (street === 1) return betFrac(g, p, legal, wet ? 0.66 : 0.4);
      return betFrac(g, p, legal, 0.7);
    }
    if (draw.strong && street < 3 && n <= 2 && r < 0.6 * style.aggr) {
      return betFrac(g, p, legal, 0.6);
    }
    if (n === 1 && aggressor) {
      if (
        street === 1 &&
        r < (wet ? 0.45 : 0.72) * style.aggr * clamp(fold / 0.45, 0.6, 1.3)
      ) {
        return betFrac(g, p, legal, wet ? 0.5 : 0.33);
      }
      if (street === 2 && eq < 0.4 && r < (0.38 * style.aggr * fold) / 0.45) {
        return betFrac(g, p, legal, 0.66);
      }
      if (
        street === 3 &&
        bucket === 0 &&
        r < (0.33 * style.aggr * fold) / 0.45
      ) {
        return betFrac(g, p, legal, 0.7);
      }
    }
    if (
      n === 1 &&
      lastToAct(g, p) &&
      bucket <= 1 &&
      r < (0.3 * style.aggr * fold) / 0.45
    ) {
      return betFrac(g, p, legal, 0.5);
    }
    return { type: "check" };
  }

  function chooseResponse(g, p, legal, c) {
    const { eq, n, street, draw, style, premium } = c;
    const potOdds = legal.callAmount / (legal.pot + legal.callAmount);
    const deep = p.stack - legal.callAmount > legal.pot * 3;
    const implied =
      draw.any && street < 3 && deep ? (draw.strong ? 0.07 : 0.03) : 0;
    const need = potOdds - implied + premium + (n > 1 ? 0.03 * (n - 1) : 0);
    const raiseThr = n === 1 ? (street === 3 ? 0.82 : 0.74) : 0.85;
    const r = g.rng();
    if (eq >= raiseThr && legal.canRaise) {
      if (street === 1 && n === 1 && r < 0.25) return { type: "call" };
      return raiseTo(g, p, legal, legal.currentBet * 3);
    }
    if (
      draw.strong &&
      street === 1 &&
      n === 1 &&
      legal.canRaise &&
      eq >= need * 0.7 &&
      r < 0.2 * style.aggr
    ) {
      return raiseTo(g, p, legal, legal.currentBet * 3);
    }
    if (eq >= need) return { type: "call" };
    return { type: "fold" };
  }

  function postflop(g, p, legal) {
    const opps = opponents(g, p);
    const n = opps.length;
    const eq = equityVs(g, p, opps, n === 1 ? 700 : 500, true);
    const mainVillain = opps.reduce((a, b) =>
      b.stack + b.bet > a.stack + a.bet ? b : a,
    );
    const fold =
      opps.reduce((acc, o) => acc + profile(o).foldToBet, 0) / Math.max(1, n);
    const ctx = {
      eq,
      n,
      street: g.street,
      draw: drawInfo(p.hole[0], p.hole[1], g.board),
      bucket: classify(p.hole[0], p.hole[1], g.board),
      style: p.style,
      fold,
      wet: boardWet(g.board),
      premium: icmPremium(g, p, mainVillain),
    };
    if (legal.canCheck) return chooseBet(g, p, legal, ctx);
    return chooseResponse(g, p, legal, ctx);
  }

  /** Chooses an action for a bot. */
  function decide(g, p, legal) {
    return g.street === 0 ? preflop(g, p, legal) : postflop(g, p, legal);
  }

  // ------------------------------------------------------ opponent modeling

  function estimateRaise(g, p, action) {
    const pf = g.pf;
    const prof = profile(p);
    const aggr = clamp(prof.pfr / 0.18, 0.6, 2.5);
    const stackBB = chipsBB(g, p);
    const allIn = action.amount >= p.stack + p.bet;
    let w;
    if (pf.raises === 0) {
      const behind = behindCount(g, p);
      w =
        allIn && stackBB <= 16
          ? pushWidth(g, stackBB, behind)
          : rfiWidth(g, behind) * aggr;
    } else if (pf.raises === 1) {
      w = Math.max(0.03, pf.lastWidth * 0.25 * aggr);
      if (allIn && stackBB <= 25) w = Math.max(w, pf.lastWidth * 0.5);
    } else {
      w = Math.max(0.02, pf.lastWidth * 0.4);
    }
    return clamp(w, 0.015, 1);
  }

  function observePreflop(g, p, action, legal) {
    const pf = g.pf;
    const hi = p.hi;
    if (action.type === "raise") {
      const w = estimateRaise(g, p, action);
      hi.range = { lo: 0, hi: w, trap: 0 };
      pf.lastWidth = w;
      if (!hi.pfr) p.stats.pfr++;
      hi.pfr = true;
    } else if (action.type === "call") {
      const vpip = profile(p).vpip;
      if (pf.raises === 0) {
        hi.range = { lo: 0.08, hi: clamp(vpip * 1.6, 0.25, 0.8), trap: 0.2 };
      } else {
        const isBB = p.seat === g.bbSeat;
        const wide =
          pf.lastWidth * (isBB ? 2 : 1.3) * clamp(vpip / 0.24, 0.7, 1.8);
        hi.range = {
          lo: pf.lastWidth * 0.2,
          hi: clamp(wide, 0.04, 0.65),
          trap: 0.25,
        };
      }
    } else if (action.type === "check" && legal.canCheck) {
      hi.range = { lo: 0.07, hi: 1, trap: 0.3 };
    }
    if ((action.type === "call" || action.type === "raise") && !hi.vpip) {
      hi.vpip = true;
      p.stats.vpip++;
    }
  }

  /** Records an action before the engine applies it. */
  function observe(g, p, action, legal) {
    if (!p.hi) return;
    if (g.street === 0) {
      observePreflop(g, p, action, legal);
      return;
    }
    if (legal.toCall > 0) {
      p.stats.facedBet++;
      if (action.type === "fold") p.stats.foldedToBet++;
    }
    if (action.type === "raise") {
      p.hi.postAggr++;
      p.hi.lastBetFrac =
        (action.amount - legal.currentBet) / Math.max(1, legal.pot);
      p.stats.aggr++;
    } else if (action.type === "call") {
      p.hi.postCalls++;
      p.stats.passive++;
    }
  }

  P.AI = { decide, observe, initPlayers, newHand, profile };
})();
