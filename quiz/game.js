"use strict";
/**
 * Quiz game engine: pure state + rules, no networking. The server calls these
 * methods and broadcasts views; tests drive it with a fake clock.
 *
 * Phases: lobby → question → reveal → leaderboard → question … → final
 *
 * Question types
 *  - mc:     everyone picks one of the options. Correct = 500 + up to 500 for speed.
 *  - text:   everyone types an answer. Fuzzy-matched; correct = 1000. Host can override.
 *  - buzzer: first to buzz answers OUT LOUD; the host judges it from the phone
 *            controller (/control). Correct = 1000 and the question ends; wrong or
 *            timed out = -250 and they're locked out while the buzzers reopen.
 *
 * Scores are always recomputed from the stored results, so host overrides on any
 * earlier question simply change the totals.
 */

const TIMES = { mc: 20000, text: 30000, buzzer: 20000, buzzAnswer: 15000 };
const POINTS = { correct: 1000, mcBase: 500, buzzWrong: -250 };

// ---------------------------------------------------------------- matching

function normalise(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Forgiving match: ignores case, accents, punctuation, a leading "the", small typos. */
function isMatch(input, accept) {
  const got = normalise(input);
  if (!got) return false;
  const squash = (s) => s.replace(/ /g, "");
  return accept.some((raw) => {
    const want = normalise(raw);
    if (!want) return false;
    if (got === want || squash(got) === squash(want)) return true;
    if (/^\d+$/.test(want)) return false; // numbers must be exact
    const tolerance = want.length <= 4 ? 0 : want.length <= 8 ? 1 : 2;
    return levenshtein(squash(got), squash(want)) <= tolerance;
  });
}

// ---------------------------------------------------------------- game

class Game {
  constructor(questions, { now = () => Date.now() } = {}) {
    this.questions = questions;
    this.now = now;
    this.reset();
  }

  reset() {
    this.phase = "lobby";
    this.qIndex = -1;
    this.players = new Map(); // id -> { id, name, connected }
    this.results = []; // per question: { answers: Map pid -> record, attempts: [] }
    this.q = null; // live runtime for the current question
  }

  // ------------------------------------------------------------ players

  join(id, rawName) {
    const name = String(rawName ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
    if (!name) return { error: "Enter a name" };
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      return { player: existing };
    }
    const clash = [...this.players.values()].find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) return { error: "That name is taken" };
    const player = { id, name, connected: true };
    this.players.set(id, player);
    return { player };
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  kick(id) {
    this.players.delete(id);
    for (const r of this.results) r && r.answers.delete(id);
  }

  score(id) {
    let total = 0;
    for (const r of this.results) {
      if (!r) continue;
      const a = r.answers.get(id);
      if (a) total += a.points;
      for (const t of r.attempts) if (t.pid === id) total += t.points;
    }
    return total;
  }

  standings() {
    const rows = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: this.score(p.id),
      delta: this.deltaFor(p.id, this.qIndex),
    }));
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    let rank = 0;
    rows.forEach((r, i) => {
      if (i === 0 || r.score !== rows[i - 1].score) rank = i + 1;
      r.rank = rank;
    });
    return rows;
  }

  deltaFor(id, qi) {
    const r = this.results[qi];
    if (!r) return 0;
    let d = r.answers.get(id)?.points ?? 0;
    for (const t of r.attempts) if (t.pid === id) d += t.points;
    return d;
  }

  // ------------------------------------------------------------ flow

  get question() {
    return this.questions[this.qIndex] ?? null;
  }

  /** Host "next" button: advances whatever phase we're in. */
  next() {
    if (this.phase === "lobby" || this.phase === "leaderboard") {
      if (this.qIndex + 1 >= this.questions.length) {
        this.phase = "final";
        return;
      }
      this.startQuestion(this.qIndex + 1);
    } else if (this.phase === "question") {
      this.endQuestion();
    } else if (this.phase === "reveal") {
      this.phase = this.qIndex + 1 >= this.questions.length ? "final" : "leaderboard";
    }
  }

  startQuestion(i) {
    this.qIndex = i;
    this.phase = "question";
    this.results[i] = { answers: new Map(), attempts: [] };
    const q = this.question;
    const now = this.now();
    this.q = {
      startedAt: now,
      endsAt: now + TIMES[q.type],
      buzz: q.type === "buzzer" ? { holder: null, deadline: 0, lockedOut: new Set(), remaining: 0 } : null,
    };
  }

  /** Time left on the visible countdown (buzz window or answering window). */
  timeLeft() {
    if (this.phase !== "question" || !this.q) return 0;
    const b = this.q.buzz;
    if (b && b.holder) return Math.max(0, b.deadline - this.now());
    return Math.max(0, this.q.endsAt - this.now());
  }

  /** Called by the server's ticker. Returns true if something changed. */
  tick() {
    if (this.phase !== "question") return false;
    const b = this.q.buzz;
    if (b && b.holder) {
      if (this.now() >= b.deadline) {
        this.resolveBuzz(b.holder, false);
        return true;
      }
      return false;
    }
    if (this.now() >= this.q.endsAt) {
      this.endQuestion();
      return true;
    }
    return false;
  }

  endQuestion() {
    if (this.phase !== "question") return;
    const b = this.q.buzz;
    if (b && b.holder) this.resolveBuzz(b.holder, false, { reopen: false });
    this.phase = "reveal";
  }

  activePlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // ------------------------------------------------------------ answers

  answer(id, payload) {
    if (this.phase !== "question" || !this.players.has(id)) return { error: "Not now" };
    const q = this.question;
    const r = this.results[this.qIndex];

    if (q.type === "buzzer") return { error: "Say it out loud — the host judges buzzes" };
    if (r.answers.has(id)) return { error: "Already answered" };

    const elapsed = this.now() - this.q.startedAt;
    if (q.type === "mc") {
      const choice = Number(payload?.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return { error: "Bad choice" };
      const correct = choice === q.answer;
      const speed = Math.max(0, 1 - elapsed / TIMES.mc);
      const points = correct ? POINTS.mcBase + Math.round((POINTS.correct - POINTS.mcBase) * speed) : 0;
      r.answers.set(id, { choice, correct, points, ms: elapsed });
    } else {
      const text = String(payload?.text ?? "").trim().slice(0, 80);
      if (!text) return { error: "Type an answer" };
      const correct = isMatch(text, q.accept);
      r.answers.set(id, { text, correct, auto: correct, points: correct ? POINTS.correct : 0, ms: elapsed });
    }

    // Everyone who's here has answered: end early.
    if (this.activePlayers().every((p) => r.answers.has(p.id))) this.endQuestion();
    return { ok: true };
  }

  buzz(id) {
    if (this.phase !== "question" || this.question.type !== "buzzer" || !this.players.has(id)) {
      return { error: "Not now" };
    }
    const b = this.q.buzz;
    if (b.holder) return { error: "Too slow" };
    if (b.lockedOut.has(id)) return { error: "You're locked out" };
    b.holder = id;
    b.remaining = Math.max(0, this.q.endsAt - this.now()); // pause the buzz window
    b.deadline = this.now() + TIMES.buzzAnswer;
    return { ok: true };
  }

  /** Host verdict on the current buzz: the player answered out loud. */
  judge(correct) {
    if (this.phase !== "question" || this.question?.type !== "buzzer") return { error: "Not now" };
    const b = this.q.buzz;
    if (!b.holder) return { error: "Nobody has buzzed" };
    this.resolveBuzz(b.holder, Boolean(correct));
    return { ok: true };
  }

  resolveBuzz(id, correct, { reopen = true } = {}) {
    const b = this.q.buzz;
    const r = this.results[this.qIndex];
    r.attempts.push({
      pid: id,
      correct,
      points: correct ? POINTS.correct : POINTS.buzzWrong,
    });
    b.holder = null;
    b.lockedOut.add(id);
    if (correct) {
      this.endQuestion();
      return;
    }
    if (!reopen) return;
    this.q.endsAt = this.now() + b.remaining; // resume the buzz window
    const someoneLeft = this.activePlayers().some((p) => !b.lockedOut.has(p.id));
    if (!someoneLeft || b.remaining <= 0) this.endQuestion();
  }

  // ------------------------------------------------------------ host override

  /** Flip a text answer or buzzer attempt between right and wrong. */
  toggle(qi, ref) {
    const r = this.results[qi];
    const q = this.questions[qi];
    if (!r || !q || q.type === "mc") return { error: "Can't change that" };
    if (q.type === "text") {
      const a = r.answers.get(ref);
      if (!a) return { error: "No answer" };
      a.correct = !a.correct;
      a.points = a.correct ? POINTS.correct : 0;
    } else {
      const t = r.attempts[Number(ref)];
      if (!t) return { error: "No attempt" };
      t.correct = !t.correct;
      t.points = t.correct ? POINTS.correct : POINTS.buzzWrong;
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ views

  correctAnswerText(q) {
    if (!q) return "";
    return q.type === "mc" ? q.options[q.answer] : q.accept[0];
  }

  publicQuestion() {
    const q = this.question;
    if (!q) return null;
    return {
      index: this.qIndex,
      total: this.questions.length,
      type: q.type,
      category: q.category,
      text: q.text,
      options: q.type === "mc" ? q.options : undefined,
    };
  }

  buzzView() {
    if (!this.q?.buzz) return null;
    const b = this.q.buzz;
    return {
      holder: b.holder ? this.players.get(b.holder)?.name ?? "?" : null,
      holderId: b.holder,
      lockedOut: [...b.lockedOut],
    };
  }

  revealView() {
    const q = this.question;
    const r = this.results[this.qIndex];
    if (!q || !r) return null;
    const name = (id) => this.players.get(id)?.name ?? "?";
    const out = { correct: this.correctAnswerText(q), answer: q.type === "mc" ? q.answer : null };
    if (q.type === "mc") {
      out.counts = q.options.map((_, i) => [...r.answers.values()].filter((a) => a.choice === i).length);
    } else if (q.type === "text") {
      out.answers = [...r.answers.entries()]
        .map(([id, a]) => ({ id, name: name(id), text: a.text, correct: a.correct, auto: a.auto }))
        .sort((x, y) => Number(y.correct) - Number(x.correct) || x.name.localeCompare(y.name));
    } else {
      out.attempts = r.attempts.map((t, i) => ({ i, name: name(t.pid), correct: t.correct, points: t.points }));
    }
    return out;
  }

  hostView() {
    const r = this.results[this.qIndex];
    const q = this.question;
    const showKey = this.phase === "question" || this.phase === "reveal";
    return {
      role: "host",
      phase: this.phase,
      question: this.phase === "lobby" ? null : this.publicQuestion(),
      // The answer, for the host's phone controller. Only host-authed sockets see this.
      key: showKey && q ? { correct: this.correctAnswerText(q), accept: q.type === "mc" ? undefined : q.accept } : null,
      timeLeft: this.timeLeft(),
      buzz: this.phase === "question" ? this.buzzView() : null,
      answered: r ? r.answers.size : 0,
      reveal: this.phase === "reveal" ? this.revealView() : null,
      standings: this.standings(),
    };
  }

  playerView(id) {
    const p = this.players.get(id);
    if (!p) return { role: "player", phase: "join" };
    const r = this.results[this.qIndex];
    const standings = this.standings();
    const me = standings.find((s) => s.id === id);
    const mine = r?.answers.get(id);
    const myAttempts = r ? r.attempts.filter((t) => t.pid === id) : [];
    const view = {
      role: "player",
      phase: this.phase,
      name: p.name,
      score: me.score,
      rank: me.rank,
      players: standings.length,
      question: this.phase === "lobby" ? null : this.publicQuestion(),
      timeLeft: this.timeLeft(),
      answered: Boolean(mine),
      choice: mine?.choice ?? null,
      myText: mine?.text ?? null,
    };
    if (this.phase === "question" && this.q?.buzz) {
      const b = this.buzzView();
      view.buzz = {
        holder: b.holder,
        mine: b.holderId === id,
        lockedOut: this.q.buzz.lockedOut.has(id),
      };
    }
    if (this.phase === "reveal" || this.phase === "leaderboard") {
      const q = this.question;
      view.result = {
        correct: this.correctAnswerText(q),
        delta: this.deltaFor(id, this.qIndex),
        wasRight: q.type === "buzzer" ? myAttempts.some((t) => t.correct) : Boolean(mine?.correct),
        tried: q.type === "buzzer" ? myAttempts.length > 0 : Boolean(mine),
      };
    }
    if (this.phase === "final") view.podium = standings.slice(0, 3).map((s) => ({ name: s.name, score: s.score }));
    return view;
  }
}

module.exports = { Game, isMatch, normalise, TIMES, POINTS };
