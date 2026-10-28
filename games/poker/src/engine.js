// No-limit Texas Hold'em tournament engine: blinds and big-blind ante,
// betting rounds with min-raise and short all-in rules, side pots,
// eliminations and payouts. UI and bots plug in through `getAction`.
(() => {
  "use strict";
  const P = (globalThis.Poker ??= {});
  const { freshDeck, shuffle, evaluate, describe, bestFive, makeRng } = P.Cards;

  // [small blind, big blind, big-blind ante]
  const LEVELS = [
    [100, 200, 0],
    [150, 300, 0],
    [200, 400, 400],
    [250, 500, 500],
    [300, 600, 600],
    [400, 800, 800],
    [500, 1000, 1000],
    [600, 1200, 1200],
    [800, 1600, 1600],
    [1000, 2000, 2000],
    [1250, 2500, 2500],
    [1500, 3000, 3000],
    [2000, 4000, 4000],
    [2500, 5000, 5000],
    [3000, 6000, 6000],
    [4000, 8000, 8000],
    [5000, 10000, 10000],
    [6000, 12000, 12000],
    [8000, 16000, 16000],
    [10000, 20000, 20000],
    [12500, 25000, 25000],
    [15000, 30000, 30000],
    [20000, 40000, 40000],
    [25000, 50000, 50000],
    [30000, 60000, 60000],
    [40000, 80000, 80000],
    [50000, 100000, 100000],
  ];
  const PAYOUT_SHARES = [0.5, 0.3, 0.2];
  const STREET_NAMES = ["Preflop", "Flop", "Turn", "River"];

  class Cancelled extends Error {}

  class Tournament {
    /**
     * @param {object} opts
     * @param {{name: string, isHuman?: boolean, style?: object}[]} opts.players
     * @param {number} [opts.startingStack]
     * @param {number} [opts.handsPerLevel]
     * @param {number} [opts.buyIn]
     * @param {number} [opts.seed]
     * @param {(type: string, data?: object) => void} [opts.onEvent]
     * @param {(game: Tournament, player: object, legal: object) => Promise<object>|object} opts.getAction
     * @param {(moment: string) => Promise<void>|void} [opts.wait] pacing hook for the UI
     */
    constructor(opts) {
      this.startingStack = opts.startingStack ?? 30000;
      this.handsPerLevel = opts.handsPerLevel ?? 9;
      this.buyIn = opts.buyIn ?? 1000;
      this.rng = makeRng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
      this.onEvent = opts.onEvent ?? (() => {});
      this.getAction = opts.getAction;
      this.wait = opts.wait ?? (() => {});
      this.players = opts.players.map((p, seat) => ({
        seat,
        id: seat,
        name: p.name,
        isHuman: Boolean(p.isHuman),
        style: p.style ?? {},
        stack: this.startingStack,
        hole: [],
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        out: false,
        acted: false,
        mayRaise: true,
        place: 0,
        prize: 0,
        lastAction: null,
        stats: null,
        hi: null,
      }));
      this.handNo = 0;
      this.levelIndex = 0;
      this.button = Math.floor(this.rng() * this.players.length);
      this.board = [];
      this.street = 0;
      this.currentBet = 0;
      this.lastRaiseSize = 0;
      this.cancelled = false;
      this.finished = false;
      this.history = [];
      this.pf = null;
      this.prizePool = this.buyIn * this.players.length;
      this.payouts = PAYOUT_SHARES.map((s) => Math.round(this.prizePool * s));
      P.AI?.initPlayers?.(this);
    }

    get level() {
      const [sb, bb, ante] =
        LEVELS[Math.min(this.levelIndex, LEVELS.length - 1)];
      return { number: this.levelIndex + 1, sb, bb, ante };
    }

    get bb() {
      return this.level.bb;
    }

    get handsToNextLevel() {
      return this.handsPerLevel - (this.handNo % this.handsPerLevel);
    }

    alive() {
      return this.players.filter((p) => !p.out);
    }

    inHand() {
      return this.players.filter((p) => !p.out && !p.folded);
    }

    potTotal() {
      return this.players.reduce((acc, p) => acc + p.totalBet, 0);
    }

    cancel() {
      this.cancelled = true;
    }

    emit(type, data = {}) {
      this.onEvent(type, data);
    }

    nextAlive(seat) {
      const n = this.players.length;
      for (let i = 1; i <= n; i++) {
        const p = this.players[(seat + i) % n];
        if (!p.out) return p;
      }
      return this.players[seat];
    }

    /** Postflop order index: 0 acts first, larger acts later; button last. */
    positionIndex(seat) {
      const n = this.players.length;
      return (seat - this.button - 1 + n) % n;
    }

    /** Plays the whole tournament until one player holds every chip. */
    async run() {
      this.emit("tournamentStart", { game: this });
      try {
        while (this.alive().length > 1) {
          if (this.cancelled) throw new Cancelled();
          await this.playHand();
        }
      } catch (err) {
        if (err instanceof Cancelled) return;
        throw err;
      }
      const winner = this.alive()[0];
      winner.place = 1;
      winner.prize = this.payouts[0];
      this.finished = true;
      this.emit("tournamentEnd", { game: this, winner });
    }

    setupHand() {
      this.handNo++;
      const newLevel = Math.floor((this.handNo - 1) / this.handsPerLevel);
      if (newLevel !== this.levelIndex) {
        this.levelIndex = newLevel;
        this.emit("level", { level: this.level });
      }
      if (this.handNo > 1) this.button = this.nextAlive(this.button).seat;
      else if (this.players[this.button].out) {
        this.button = this.nextAlive(this.button).seat;
      }
      for (const p of this.players) {
        p.hole = [];
        p.bet = 0;
        p.totalBet = 0;
        p.folded = p.out;
        p.allIn = false;
        p.acted = false;
        p.mayRaise = true;
        p.lastAction = null;
        p.startStack = p.stack;
        p.won = 0;
      }
      this.board = [];
      this.street = 0;
      this.history = [];
      this.deck = shuffle(freshDeck(), this.rng);
      const alive = this.alive();
      const headsUp = alive.length === 2;
      this.sbSeat = headsUp ? this.button : this.nextAlive(this.button).seat;
      this.bbSeat = this.nextAlive(this.sbSeat).seat;
      // Preflop order: first seat after the big blind, ending with the big blind.
      this.preflopOrder = [];
      let s = this.bbSeat;
      for (let i = 0; i < alive.length; i++) {
        s = this.nextAlive(s).seat;
        this.preflopOrder.push(s);
      }
      this.pf = {
        raises: 0,
        opener: null,
        lastRaiser: null,
        lastWidth: 1,
        limpers: 0,
        callers: 0,
      };
      this.pfAggressor = null;
      this.lastStreetAggressor = null;
      this.streetAggressor = null;
    }

    postBlinds() {
      const { sb, bb, ante } = this.level;
      const sbP = this.players[this.sbSeat];
      const bbP = this.players[this.bbSeat];
      this.commit(sbP, Math.min(sb, sbP.stack));
      this.commit(bbP, Math.min(bb, bbP.stack));
      if (ante > 0) {
        const a = Math.min(ante, bbP.stack);
        bbP.stack -= a;
        bbP.totalBet += a;
        if (bbP.stack === 0) bbP.allIn = true;
      }
      this.currentBet = bb;
      this.lastRaiseSize = bb;
      this.emit("blinds", { sb: sbP, bb: bbP, level: this.level });
    }

    commit(p, amount) {
      p.stack -= amount;
      p.bet += amount;
      p.totalBet += amount;
      if (p.stack === 0) p.allIn = true;
    }

    async playHand() {
      this.setupHand();
      P.AI?.newHand?.(this);
      this.postBlinds();
      for (const p of this.alive()) p.hole = [this.deck.pop(), this.deck.pop()];
      this.emit("handStart", { game: this });
      for (let street = 0; street < 4; street++) {
        if (street > 0) {
          this.dealStreet(street);
          await this.wait("street");
        }
        await this.bettingRound();
        if (this.inHand().length === 1) break;
      }
      this.finishHand();
      await this.wait("handEnd");
    }

    dealStreet(street) {
      this.street = street;
      const count = street === 1 ? 3 : 1;
      this.deck.pop(); // burn
      for (let i = 0; i < count; i++) this.board.push(this.deck.pop());
      for (const p of this.players) {
        p.bet = 0;
        p.acted = false;
        p.mayRaise = true;
        if (!p.folded) p.lastAction = null;
      }
      this.currentBet = 0;
      this.lastRaiseSize = this.bb;
      this.lastStreetAggressor = this.streetAggressor;
      this.streetAggressor = null;
      this.emit("street", {
        street,
        name: STREET_NAMES[street],
        board: this.board,
      });
    }

    canAct(p) {
      return !p.out && !p.folded && !p.allIn;
    }

    needsAction(p) {
      if (!this.canAct(p)) return false;
      const others = this.players.filter((o) => o !== p && this.canAct(o));
      if (others.length === 0 && p.bet >= this.currentBet) return false;
      return !p.acted || p.bet < this.currentBet;
    }

    async bettingRound() {
      const n = this.players.length;
      let seat =
        this.street === 0
          ? this.preflopOrder[0]
          : this.nextAlive(this.button).seat;
      let idle = 0;
      while (idle < n) {
        if (this.cancelled) throw new Cancelled();
        if (this.inHand().length === 1) return;
        const p = this.players[seat];
        seat = (seat + 1) % n;
        if (!this.needsAction(p)) {
          idle++;
          continue;
        }
        idle = 0;
        const legal = this.legalActions(p);
        this.emit("turn", { player: p, legal });
        const raw = await this.getAction(this, p, legal);
        if (this.cancelled) throw new Cancelled();
        const action = this.sanitize(raw, legal);
        P.AI?.observe?.(this, p, action, legal);
        this.apply(p, action, legal);
      }
    }

    legalActions(p) {
      const toCall = Math.max(0, this.currentBet - p.bet);
      const callAmount = Math.min(toCall, p.stack);
      const othersCanAct = this.players.some((o) => o !== p && this.canAct(o));
      const maxRaiseTo = p.bet + p.stack;
      const canRaise = p.stack > toCall && p.mayRaise && othersCanAct;
      const minRaiseTo = Math.min(
        this.currentBet + this.lastRaiseSize,
        maxRaiseTo,
      );
      return {
        toCall,
        callAmount,
        canCheck: toCall === 0,
        canRaise,
        minRaiseTo,
        maxRaiseTo,
        currentBet: this.currentBet,
        pot: this.potTotal(),
      };
    }

    sanitize(raw, legal) {
      const type = raw?.type;
      if (type === "raise" && legal.canRaise) {
        const amount = Math.round(Number(raw.amount) || 0);
        const to = Math.min(
          legal.maxRaiseTo,
          Math.max(legal.minRaiseTo, amount),
        );
        return { type: "raise", amount: to };
      }
      if (type === "fold" && !legal.canCheck) return { type: "fold" };
      if (legal.canCheck) return { type: "check" };
      return { type: "call", amount: legal.callAmount };
    }

    apply(p, action, legal) {
      const before = this.currentBet;
      let label;
      if (action.type === "fold") {
        p.folded = true;
        label = "Fold";
      } else if (action.type === "check") {
        label = "Check";
      } else if (action.type === "call") {
        this.commit(p, legal.callAmount);
        label = p.allIn ? "All-in" : "Call";
      } else {
        this.commit(p, action.amount - p.bet);
        const increment = p.bet - before;
        if (increment >= this.lastRaiseSize) {
          this.lastRaiseSize = increment;
          for (const o of this.players) {
            if (o !== p && this.canAct(o)) {
              o.acted = false;
              o.mayRaise = true;
            }
          }
        } else {
          // A short all-in does not reopen the betting for those who acted.
          for (const o of this.players)
            if (o !== p && o.acted) o.mayRaise = false;
        }
        this.currentBet = p.bet;
        if (this.street === 0) {
          this.pf.raises++;
          this.pf.lastRaiser = p.id;
          if (this.pf.opener === null) this.pf.opener = p.id;
          this.pf.callers = 0;
          this.pfAggressor = p.id;
        }
        this.streetAggressor = p.id;
        label = p.allIn ? "All-in" : before === 0 ? "Bet" : "Raise";
      }
      if (this.street === 0 && action.type === "call") {
        if (this.pf.raises === 0) this.pf.limpers++;
        else this.pf.callers++;
      }
      p.acted = true;
      p.lastAction = { type: action.type, label, amount: p.bet };
      this.history.push({
        id: p.id,
        street: this.street,
        type: action.type,
        to: p.bet,
        allIn: p.allIn,
      });
      this.emit("action", { player: p, action, label, amount: p.bet });
    }

    /** Builds main and side pots from every player's contribution. */
    buildPots() {
      const contenders = this.players.filter((p) => !p.folded && !p.out);
      const levels = [...new Set(contenders.map((p) => p.totalBet))].sort(
        (a, b) => a - b,
      );
      const pots = [];
      let prev = 0;
      for (const lvl of levels) {
        let amount = 0;
        for (const p of this.players) {
          amount += Math.max(0, Math.min(p.totalBet, lvl) - prev);
        }
        const eligible = contenders.filter((p) => p.totalBet >= lvl);
        if (amount > 0) pots.push({ amount, eligible });
        prev = lvl;
      }
      // Dead money above the last contender level (folded overbets).
      let rest = 0;
      for (const p of this.players) rest += Math.max(0, p.totalBet - prev);
      if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
      return pots;
    }

    refundUncalled() {
      const sorted = [...this.players].sort((a, b) => b.totalBet - a.totalBet);
      const [top, second] = sorted;
      const diff = top.totalBet - (second?.totalBet ?? 0);
      if (diff > 0) {
        top.totalBet -= diff;
        top.bet = Math.max(0, top.bet - diff);
        top.stack += diff;
        if (top.stack > 0) top.allIn = false;
        this.emit("refund", { player: top, amount: diff });
      }
    }

    finishHand() {
      this.refundUncalled();
      const contenders = this.inHand();
      const showdown = contenders.length > 1;
      if (showdown) {
        while (this.board.length < 5) {
          this.deck.pop();
          this.board.push(this.deck.pop());
        }
        this.street = 3;
        for (const p of contenders) {
          p.score = evaluate([...p.hole, ...this.board], 7);
          p.handName = describe(p.score);
          p.best = bestFive([...p.hole, ...this.board]);
        }
      }
      const pots = this.buildPots();
      const results = [];
      for (const [i, pot] of pots.entries()) {
        const winners = this.potWinners(pot.eligible, showdown);
        const share = Math.floor(pot.amount / winners.length);
        let odd = pot.amount - share * winners.length;
        for (const w of this.oddChipOrder(winners)) {
          const extra = odd > 0 ? 1 : 0;
          odd -= extra;
          w.stack += share + extra;
          w.won += share + extra;
        }
        results.push({ index: i, amount: pot.amount, winners });
      }
      for (const p of this.players) p.totalBet = 0;
      this.emit("showdown", {
        game: this,
        showdown,
        contenders,
        pots: results,
        board: this.board,
      });
      this.handleBusts();
      P.AI?.endHand?.(this, showdown);
    }

    potWinners(eligible, showdown) {
      if (!showdown || eligible.length === 1) return eligible;
      const best = Math.max(...eligible.map((p) => p.score));
      return eligible.filter((p) => p.score === best);
    }

    oddChipOrder(winners) {
      return [...winners].sort(
        (a, b) => this.positionIndex(a.seat) - this.positionIndex(b.seat),
      );
    }

    handleBusts() {
      const busted = this.players
        .filter((p) => !p.out && p.stack === 0)
        .sort((a, b) => b.startStack - a.startStack);
      if (busted.length === 0) return;
      let place = this.alive().length - busted.length + 1;
      for (const p of busted) {
        p.out = true;
        p.folded = true;
        p.place = Math.max(place, 2);
        p.prize = this.payouts[p.place - 1] ?? 0;
        place++;
        this.emit("bust", { player: p, place: p.place, prize: p.prize });
      }
    }
  }

  P.Engine = { Tournament, LEVELS, PAYOUT_SHARES, STREET_NAMES };
})();
