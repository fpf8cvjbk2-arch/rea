// Browser UI: renders the table, drives bot pacing and collects the
// human player's actions. Depends on cards.js, ranges.js, ai.js, engine.js.
(() => {
  "use strict";
  const P = globalThis.Poker;
  const { RANK_NAMES, SUIT_SYMBOLS, evaluate, describe } = P.Cards;
  const { Tournament, LEVELS } = P.Engine;

  const BOTS = [
    { name: "Viktor Lindqvist", style: { aggr: 1.15, loose: 1.05 } },
    { name: "Mara Okafor", style: { aggr: 1.0, loose: 0.95 } },
    { name: "Kenji Arai", style: { aggr: 1.2, loose: 1.1 } },
    { name: "Lucía Ferrer", style: { aggr: 0.95, loose: 1.0 } },
    { name: "Tomasz Wilk", style: { aggr: 1.05, loose: 0.92 } },
    { name: "Amélie Roux", style: { aggr: 1.1, loose: 1.08 } },
    { name: "Dario Esposito", style: { aggr: 0.92, loose: 0.98 } },
    { name: "Hana Novák", style: { aggr: 1.0, loose: 1.04 } },
  ];
  const SPEED = { slow: 1.6, normal: 1, fast: 0.45 };
  const STORE_KEY = "final-table-holdem";

  const $ = (sel) => document.querySelector(sel);
  const fmt = (n) => Math.round(n).toLocaleString("it-IT");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const bbText = (chips, bb) =>
    `${(chips / bb).toLocaleString("it-IT", { maximumFractionDigits: 1 })} BB`;

  const ui = {
    game: null,
    prefs: {
      name: "Tu",
      handsPerLevel: 9,
      speed: "normal",
      hud: true,
      fourColor: true,
    },
    human: null,
    showdown: null,
    message: "",
    log: [],
    active: null,
    humanOut: false,
    watching: false,
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) Object.assign(ui.prefs, JSON.parse(raw));
    } catch {
      /* storage unavailable: keep defaults */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(ui.prefs));
    } catch {
      /* storage unavailable */
    }
  }

  function sleep(ms) {
    const g = ui.game;
    const me = g?.players[0];
    const fastForward = !me || me.folded || me.out;
    const factor = SPEED[ui.prefs.speed] * (fastForward ? 0.5 : 1);
    return new Promise((resolve) => setTimeout(resolve, ms * factor));
  }

  // ---------------------------------------------------------------- layout

  function seatPoint(seat, n, f, offsetDeg = 0) {
    const a = ((90 + (seat * 360) / n + offsetDeg) * Math.PI) / 180;
    return { x: 50 + 50 * f * Math.cos(a), y: 50 + 50 * f * Math.sin(a) };
  }

  function cardHTML(c, extra = "") {
    if (c === null || c === undefined)
      return `<div class="card back ${extra}"></div>`;
    const r = RANK_NAMES[c >> 2];
    const s = c & 3;
    return (
      `<div class="card suit-${s} ${extra}" aria-label="${r}${SUIT_SYMBOLS[s]}">` +
      `<span class="rank">${r}</span><span class="pip">${SUIT_SYMBOLS[s]}</span></div>`
    );
  }

  function seatCards(g, p) {
    if (p.out || p.hole.length === 0 || (p.folded && !p.isHuman)) return "";
    const show =
      p.isHuman || (ui.showdown && !p.folded && ui.showdown.showdown);
    const best = ui.showdown?.showdown ? new Set(p.best ?? []) : null;
    return p.hole
      .map((c) => {
        if (!show) return cardHTML(null, p.folded ? "mucked" : "");
        const cls = [
          p.folded ? "mucked" : "",
          best && best.has(c) ? "win" : "",
        ];
        return cardHTML(c, cls.join(" "));
      })
      .join("");
  }

  function hudHTML(p) {
    if (!ui.prefs.hud || p.isHuman || !p.stats) return "";
    const pr = P.AI.profile(p);
    const pct = (x) => Math.round(x * 100);
    return (
      `<div class="hud" title="Statistiche osservate su ${pr.hands} mani">` +
      `<span>VPIP ${pct(pr.vpip)}</span><span>PFR ${pct(pr.pfr)}</span>` +
      `<span>AF ${pr.af.toFixed(1)}</span></div>`
    );
  }

  function seatHTML(g, p) {
    const n = g.players.length;
    const pt = seatPoint(p.seat, n, 1);
    const cls = ["seat"];
    if (p.out) cls.push("out");
    if (p.folded && !p.out) cls.push("folded");
    if (ui.active === p.id) cls.push("active");
    if (p.isHuman) cls.push("hero");
    if (ui.showdown && p.won > 0) cls.push("winner");
    const tag = p.out
      ? `${p.place}°`
      : p.lastAction
        ? `${p.lastAction.label}${p.lastAction.type === "raise" || (p.lastAction.type === "call" && p.lastAction.amount) ? " " + fmt(p.lastAction.amount) : ""}`
        : "";
    const blind = p.seat === g.sbSeat ? "SB" : p.seat === g.bbSeat ? "BB" : "";
    const stack = p.out
      ? p.prize
        ? `+${fmt(p.prize)} €`
        : "Eliminato"
      : fmt(p.stack);
    return (
      `<div class="${cls.join(" ")}" style="left:${pt.x}%;top:${pt.y}%">` +
      `<div class="hole">${seatCards(g, p)}</div>` +
      `<div class="plate"><div class="who"><span class="name">${esc(p.name)}</span>` +
      (blind && !p.out ? `<span class="blind">${blind}</span>` : "") +
      `</div><div class="stack">${stack}</div>${hudHTML(p)}` +
      (tag
        ? `<div class="tag tag-${p.lastAction?.type ?? "out"}">${esc(tag)}</div>`
        : "") +
      `</div><div class="timer"></div></div>`
    );
  }

  function betHTML(g, p) {
    if (p.out || p.bet <= 0 || ui.showdown) return "";
    const pt = seatPoint(p.seat, g.players.length, 0.6);
    return `<div class="bet" style="left:${pt.x}%;top:${pt.y}%"><i class="chip"></i>${fmt(p.bet)}</div>`;
  }

  function dealerHTML(g) {
    const pt = seatPoint(g.button, g.players.length, 0.74, 16);
    return `<div class="dealer" style="left:${pt.x}%;top:${pt.y}%">D</div>`;
  }

  function centerHTML(g) {
    const board = [];
    const best = ui.showdown?.showdown ? new Set(ui.showdown.bestCards) : null;
    for (let i = 0; i < 5; i++) {
      const c = g.board[i];
      if (c === undefined) board.push(`<div class="card slot"></div>`);
      else
        board.push(cardHTML(c, best ? (best.has(c) ? "win" : "dim") : "deal"));
    }
    const pot = ui.showdown ? ui.showdown.total : g.potTotal();
    return (
      `<div class="center"><div class="pot">${pot > 0 ? `Piatto <b>${fmt(pot)}</b>` : "&nbsp;"}</div>` +
      `<div class="board">${board.join("")}</div>` +
      `<div class="message" aria-live="polite">${esc(ui.message)}</div></div>`
    );
  }

  function renderTable() {
    const g = ui.game;
    if (!g) return;
    $("#seats").innerHTML =
      g.players.map((p) => seatHTML(g, p) + betHTML(g, p)).join("") +
      (g.handNo > 0 ? dealerHTML(g) : "") +
      centerHTML(g);
    document.body.classList.toggle("four-color", ui.prefs.fourColor);
  }

  function renderClock() {
    const g = ui.game;
    if (!g) return;
    const lv = g.level;
    const next = LEVELS[Math.min(g.levelIndex + 1, LEVELS.length - 1)];
    const alive = g.alive();
    const avg =
      alive.reduce((s, p) => s + p.stack + p.totalBet, 0) / alive.length;
    const set = (id, v) => {
      $(id).textContent = v;
    };
    set("#lv-num", lv.number);
    set("#lv-blinds", `${fmt(lv.sb)} / ${fmt(lv.bb)}`);
    set("#lv-ante", lv.ante ? fmt(lv.ante) : "—");
    set(
      "#lv-next",
      g.handNo === 0 ? `${g.handsPerLevel} mani` : `${g.handsToNextLevel} mani`,
    );
    set("#lv-after", `poi ${fmt(next[0])}/${fmt(next[1])}`);
    set("#t-players", `${alive.length} / ${g.players.length}`);
    set("#t-avg", `${fmt(avg)} · ${bbText(avg, lv.bb)}`);
    set("#t-hand", g.handNo || "—");
  }

  function renderStandings() {
    const g = ui.game;
    if (!g) return;
    const rows = [...g.players].sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (a.out) return a.place - b.place;
      return b.stack + b.totalBet - (a.stack + a.totalBet);
    });
    let rank = 0;
    $("#standings").innerHTML = rows
      .map((p) => {
        rank++;
        const chips = p.stack + p.totalBet;
        const right = p.out
          ? `<span class="muted">${p.place}°${p.prize ? ` · ${fmt(p.prize)} €` : ""}</span>`
          : `${fmt(chips)} <span class="muted">${bbText(chips, g.bb)}</span>`;
        return (
          `<li class="${p.isHuman ? "me" : ""} ${p.out ? "gone" : ""}">` +
          `<span class="pos">${p.out ? "" : rank}</span><span class="nm">${esc(p.name)}</span>` +
          `<span class="ch">${right}</span></li>`
        );
      })
      .join("");
    $("#payouts").innerHTML = g.payouts
      .map((v, i) => `<span><b>${i + 1}°</b> ${fmt(v)} €</span>`)
      .join("");
  }

  function renderLog() {
    const el = $("#log");
    el.innerHTML = ui.log
      .map((l) => `<li class="${l.cls}">${l.html}</li>`)
      .join("");
    el.scrollTop = el.scrollHeight;
  }

  function render() {
    renderTable();
    renderClock();
    renderStandings();
  }

  function log(html, cls = "") {
    ui.log.push({ html, cls });
    if (ui.log.length > 160) ui.log.splice(0, ui.log.length - 160);
    renderLog();
  }

  const cardsText = (cards) =>
    cards
      .map(
        (c) =>
          `<span class="lc suit-${c & 3}">${RANK_NAMES[c >> 2]}${SUIT_SYMBOLS[c & 3]}</span>`,
      )
      .join(" ");

  // ---------------------------------------------------------------- events

  function onEvent(type, d) {
    const g = ui.game;
    if (!g) return;
    switch (type) {
      case "handStart":
        ui.showdown = null;
        ui.message = "";
        ui.log = [];
        log(
          `Mano #${g.handNo} · bui ${fmt(g.level.sb)}/${fmt(g.level.bb)}${g.level.ante ? ` · ante ${fmt(g.level.ante)}` : ""}`,
          "head",
        );
        if (!g.players[0].out)
          log(`Le tue carte: ${cardsText(g.players[0].hole)}`);
        break;
      case "level":
        log(
          `Nuovo livello ${d.level.number}: ${fmt(d.level.sb)}/${fmt(d.level.bb)}${d.level.ante ? `, ante ${fmt(d.level.ante)}` : ""}`,
          "level",
        );
        flash(
          `Livello ${d.level.number} · ${fmt(d.level.sb)}/${fmt(d.level.bb)}`,
        );
        break;
      case "street":
        log(`${d.name}: ${cardsText(d.board)}`, "street");
        break;
      case "action":
        ui.active = null;
        log(
          `<b>${d.player.isHuman ? "Tu" : esc(d.player.name)}</b> ${actionText(d)}`,
          d.player.isHuman ? "mine" : "",
        );
        break;
      case "refund":
        log(
          `${d.player.isHuman ? "Riprendi" : `${esc(d.player.name)} riprende`} ${fmt(d.amount)} non chiamati`,
          "muted",
        );
        break;
      case "showdown":
        onShowdown(g, d);
        break;
      case "bust":
        log(
          `${d.player.isHuman ? "Sei eliminato" : `${esc(d.player.name)} eliminato`} al ${d.place}° posto${d.prize ? ` (${fmt(d.prize)} €)` : ""}`,
          "bust",
        );
        if (d.player.isHuman) ui.humanOut = true;
        break;
      case "tournamentEnd":
        render();
        showEnd(d.winner);
        return;
      default:
        break;
    }
    render();
  }

  function actionText(d) {
    const { action, label, amount, player } = d;
    const you = player.isHuman;
    const v = (third, second) => (you ? second : third);
    if (action.type === "fold") return v("passa", "passi");
    if (action.type === "check") return v("fa check", "fai check");
    if (action.type === "call") {
      const all = label === "All-in" ? "all-in " : "";
      return `${v("chiama", "chiami")} ${all}${fmt(amount)}`;
    }
    if (label === "All-in") return `${v("va", "vai")} all-in a ${fmt(amount)}`;
    if (label === "Bet") return `${v("punta", "punti")} ${fmt(amount)}`;
    return `${v("rilancia", "rilanci")} a ${fmt(amount)}`;
  }

  function onShowdown(g, d) {
    const total = d.pots.reduce((s, p) => s + p.amount, 0);
    const best = new Set();
    if (d.showdown) {
      for (const p of d.contenders) {
        const who = p.isHuman ? "Mostri" : `${esc(p.name)} mostra`;
        log(`${who} ${cardsText(p.hole)} · ${p.handName}`);
      }
      for (const pot of d.pots)
        for (const w of pot.winners) for (const c of w.best) best.add(c);
    }
    ui.showdown = { showdown: d.showdown, total, bestCards: [...best] };
    const parts = [];
    d.pots.forEach((pot, i) => {
      const names = pot.winners.map((w) => w.name).join(" e ");
      const what = d.showdown ? ` con ${pot.winners[0].handName}` : "";
      const label =
        d.pots.length > 1
          ? i === 0
            ? "piatto principale"
            : `side pot ${i}`
          : "";
      const solo = pot.winners.length === 1 && pot.winners[0].isHuman;
      const verb = solo
        ? "Vinci"
        : `${names} ${pot.winners.length > 1 ? "dividono" : "vince"}`;
      parts.push(
        `${verb} ${fmt(pot.amount)}${label ? ` (${label})` : ""}${what}`,
      );
      log(esc(parts[parts.length - 1]), "win");
    });
    ui.message = parts[0] ?? "";
  }

  function flash(text) {
    const el = $("#flash");
    el.textContent = text;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  // ------------------------------------------------------------ bot pacing

  function thinkTime(g, decision, legal) {
    const r = g.rng();
    if (decision.type === "fold" && legal.toCall <= g.bb) return 300 + r * 350;
    let t = 550 + r * 800;
    if (decision.type === "raise") t += 350;
    if (legal.callAmount > g.potTotal() * 0.5) t += 500;
    return t;
  }

  async function getAction(g, p, legal) {
    if (g !== ui.game) return { type: "fold" };
    ui.active = p.id;
    render();
    if (p.isHuman) return humanAction(g, p, legal);
    const decision = P.AI.decide(g, p, legal);
    const ms = thinkTime(g, decision, legal);
    const timer = document.querySelector(".seat.active .timer");
    if (timer)
      timer.style.setProperty("--think", `${ms * SPEED[ui.prefs.speed]}ms`);
    await sleep(ms);
    return decision;
  }

  async function wait(moment) {
    if (moment === "street") return sleep(700);
    const shown = ui.showdown?.showdown;
    await sleep(shown ? 2900 : 1300);
    const g = ui.game;
    if (ui.humanOut && !ui.watching && g && g.alive().length > 1) {
      ui.humanOut = false;
      await showBust();
    }
  }

  // ---------------------------------------------------------- human input

  function presets(g, legal) {
    const bb = g.bb;
    const pot = legal.pot;
    const raiseTo = (frac) => legal.currentBet + frac * (pot + legal.toCall);
    if (g.street === 0 && legal.currentBet <= bb) {
      const limp = g.pf.limpers * bb;
      return [
        ["2,2 BB", 2.2 * bb + limp],
        ["2,5 BB", 2.5 * bb + limp],
        ["3 BB", 3 * bb + limp],
      ];
    }
    if (g.street === 0) {
      return [
        ["2,5×", legal.currentBet * 2.5],
        ["3×", legal.currentBet * 3],
        ["4×", legal.currentBet * 4],
      ];
    }
    return [
      ["33%", raiseTo(0.33)],
      ["50%", raiseTo(0.5)],
      ["75%", raiseTo(0.75)],
      ["Piatto", raiseTo(1)],
    ];
  }

  function clampRaise(legal, v) {
    return Math.min(
      legal.maxRaiseTo,
      Math.max(legal.minRaiseTo, Math.round(v)),
    );
  }

  function humanAction(g, p, legal) {
    return new Promise((resolve) => {
      const bar = $("#actions");
      const slider = $("#raise-slider");
      const input = $("#raise-input");
      const raiseBtn = $("#btn-raise");
      bar.classList.add("live");
      $("#btn-fold").disabled = legal.canCheck;
      $("#btn-call").textContent = legal.canCheck
        ? "Check"
        : legal.callAmount >= p.stack
          ? `All-in ${fmt(legal.callAmount)}`
          : `Chiama ${fmt(legal.callAmount)}`;
      const sizing = $("#sizing");
      sizing.hidden = !legal.canRaise;
      raiseBtn.disabled = !legal.canRaise;
      const unit = g.bb >= 2000 ? 100 : 25;
      const setRaise = (v) => {
        const to = clampRaise(legal, v);
        slider.value = String(to);
        input.value = String(to);
        const verb =
          to >= legal.maxRaiseTo
            ? "All-in"
            : legal.currentBet === 0
              ? "Punta"
              : "Rilancia a";
        raiseBtn.textContent = `${verb} ${fmt(to)}`;
        return to;
      };
      if (legal.canRaise) {
        slider.min = String(legal.minRaiseTo);
        slider.max = String(legal.maxRaiseTo);
        slider.step = String(unit);
        const options = presets(g, legal);
        $("#presets").innerHTML =
          options
            .map(
              ([label, v]) =>
                `<button type="button" class="preset" data-v="${clampRaise(legal, Math.round(v / unit) * unit)}">${label}</button>`,
            )
            .join("") +
          `<button type="button" class="preset" data-v="${legal.maxRaiseTo}">All-in</button>`;
        setRaise(Math.round(options[g.street === 0 ? 0 : 1][1] / unit) * unit);
      }
      $("#hero-hand").textContent = heroHandText(g, p);
      const finish = (action) => {
        bar.classList.remove("live");
        ui.pending = null;
        resolve(action);
      };
      ui.pending = {
        fold: () => !legal.canCheck && finish({ type: "fold" }),
        call: () =>
          finish(legal.canCheck ? { type: "check" } : { type: "call" }),
        raise: () =>
          legal.canRaise &&
          finish({ type: "raise", amount: setRaise(Number(input.value)) }),
        slide: (v) => setRaise(Number(v)),
        preset: (v) => setRaise(Number(v)),
        cancel: () => finish({ type: legal.canCheck ? "check" : "fold" }),
      };
    });
  }

  function heroHandText(g, p) {
    if (g.board.length < 3) {
      const label = P.Ranges.handLabel(p.hole[0], p.hole[1]);
      const pct = P.Ranges.percentile(p.hole[0], p.hole[1]);
      return `${label} · top ${Math.max(1, Math.round(pct * 100))}% delle mani`;
    }
    return describe(evaluate([...p.hole, ...g.board]));
  }

  function bindControls() {
    $("#btn-fold").addEventListener("click", () => ui.pending?.fold());
    $("#btn-call").addEventListener("click", () => ui.pending?.call());
    $("#btn-raise").addEventListener("click", () => ui.pending?.raise());
    $("#raise-slider").addEventListener("input", (e) =>
      ui.pending?.slide(e.target.value),
    );
    $("#raise-input").addEventListener("change", (e) =>
      ui.pending?.slide(e.target.value),
    );
    $("#presets").addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) ui.pending?.preset(b.dataset.v);
    });
    document.addEventListener("keydown", (e) => {
      if (
        !ui.pending ||
        e.target.matches("input[type=text], input[type=number]")
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "f") ui.pending.fold();
      else if (k === "c" || k === "k") ui.pending.call();
      else if (k === "r" || k === "b") ui.pending.raise();
    });
    for (const [id, key] of [
      ["#opt-hud", "hud"],
      ["#opt-4c", "fourColor"],
    ]) {
      const el = $(id);
      el.checked = ui.prefs[key];
      el.addEventListener("change", () => {
        ui.prefs[key] = el.checked;
        savePrefs();
        render();
      });
    }
    const speed = $("#opt-speed");
    speed.value = ui.prefs.speed;
    speed.addEventListener("change", () => {
      ui.prefs.speed = speed.value;
      savePrefs();
    });
    $("#btn-new").addEventListener("click", () => openStart());
    $("#btn-again").addEventListener("click", () => openStart());
    $("#btn-again-end").addEventListener("click", () => openStart());
    $("#btn-resume").addEventListener("click", () => {
      $("#overlay").hidden = true;
    });
    $("#start").addEventListener("submit", (e) => {
      e.preventDefault();
      ui.prefs.name = $("#hero-name").value.trim().slice(0, 18) || "Tu";
      ui.prefs.handsPerLevel = Number($("#hands-level").value) || 9;
      savePrefs();
      $("#overlay").hidden = true;
      startTournament();
    });
  }

  // ------------------------------------------------------------- overlays

  function openStart() {
    $("#hero-name").value = ui.prefs.name;
    $("#hands-level").value = String(ui.prefs.handsPerLevel);
    const running =
      ui.game &&
      ui.game.handNo > 0 &&
      !ui.game.finished &&
      !ui.game.players[0].out;
    $("#btn-resume").hidden = !running;
    $("#start-buttons").classList.toggle("single", !running);
    showPanel("start");
  }

  function showPanel(which) {
    for (const el of document.querySelectorAll(".dialog"))
      el.hidden = el.id !== which;
    $("#overlay").hidden = false;
  }

  function showBust() {
    const me = ui.game.players[0];
    $("#bust-title").textContent = `Eliminato al ${me.place}° posto`;
    $("#bust-text").textContent = me.prize
      ? `Sei a premio: ${fmt(me.prize)} €. Il torneo continua senza di te.`
      : `Fuori dai premi (pagati i primi ${ui.game.payouts.length}). Il torneo continua senza di te.`;
    showPanel("bust");
    return new Promise((resolve) => {
      $("#btn-watch").onclick = () => {
        ui.watching = true;
        $("#overlay").hidden = true;
        resolve();
      };
    });
  }

  function showEnd(winner) {
    const g = ui.game;
    const me = g.players[0];
    $("#end-title").textContent =
      me === winner ? "Hai vinto il torneo" : `${winner.name} vince il torneo`;
    $("#end-list").innerHTML = [...g.players]
      .sort((a, b) => a.place - b.place)
      .map(
        (p) =>
          `<li class="${p.isHuman ? "me" : ""}"><span>${p.place}°</span><span>${esc(p.name)}</span><span>${p.prize ? `${fmt(p.prize)} €` : "—"}</span></li>`,
      )
      .join("");
    showPanel("end");
  }

  // ------------------------------------------------------------ lifecycle

  function makeGame(running) {
    const bots = [...BOTS].sort(() => Math.random() - 0.5);
    const g = new Tournament({
      startingStack: 30000,
      handsPerLevel: ui.prefs.handsPerLevel,
      buyIn: 1000,
      players: [{ name: ui.prefs.name, isHuman: true }, ...bots],
      onEvent: (type, data) => {
        if (running && g === ui.game) onEvent(type, data);
      },
      getAction,
      wait,
    });
    return g;
  }

  function startTournament() {
    if (ui.game) ui.game.cancel();
    ui.pending?.cancel();
    ui.log = [];
    ui.showdown = null;
    ui.message = "";
    ui.humanOut = false;
    ui.watching = false;
    const g = makeGame(true);
    ui.game = g;
    renderLog();
    render();
    g.run().catch((err) => {
      console.error(err);
      ui.message = "Errore inatteso: ricarica la pagina per un nuovo torneo.";
      render();
    });
  }

  function boot() {
    loadPrefs();
    bindControls();
    ui.game = makeGame(false);
    ui.message = "30.000 fiches a testa · 9 giocatori";
    render();
    openStart();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
