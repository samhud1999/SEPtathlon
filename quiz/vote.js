"use strict";
/**
 * Team vote engine: pure state + rules, no networking. Everyone registers with a
 * name, the host names the options, opens voting, and closes it to show the
 * result. Each voter picks one option and can change it until the vote closes.
 *
 * Phases: lobby → open → closed (→ open again, or → lobby via clear())
 *
 * Weights: every voter counts 1; a voter who registers as "Sam" counts 2, and the
 * host can set anyone to 1 or 2. Totals are always recomputed from the ballots.
 */

const MAX_OPTIONS = 12;
const DOUBLE_NAME = "sam";

class Vote {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = "lobby";
    this.title = "";
    this.options = []; // { id, name } in display order
    this.voters = new Map(); // id -> { id, name, connected, weight }
    this.ballots = new Map(); // voterId -> optionId
    this.nextOption = 1;
  }

  // ------------------------------------------------------------ voters

  join(id, rawName) {
    const name = String(rawName ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
    if (!name) return { error: "Enter a name" };
    const existing = this.voters.get(id);
    if (existing) {
      existing.connected = true;
      return { voter: existing };
    }
    const clash = [...this.voters.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (clash) return { error: "That name is taken" };
    const voter = { id, name, connected: true, weight: name.toLowerCase() === DOUBLE_NAME ? 2 : 1 };
    this.voters.set(id, voter);
    return { voter };
  }

  setConnected(id, connected) {
    const p = this.voters.get(id);
    if (p) p.connected = connected;
  }

  setWeight(id, weight) {
    const p = this.voters.get(id);
    if (!p) return { error: "No such voter" };
    if (weight !== 1 && weight !== 2) return { error: "Weight must be 1 or 2" };
    p.weight = weight;
    return { ok: true };
  }

  kick(id) {
    this.voters.delete(id);
    this.ballots.delete(id);
  }

  // ------------------------------------------------------------ setup + flow

  /** Replace the title and option names. Ids are kept by position so renames keep ballots. */
  setup({ title, options } = {}) {
    this.title = String(title ?? "").trim().slice(0, 60);
    const names = (Array.isArray(options) ? options : [])
      .map((o) => String(o ?? "").trim().replace(/\s+/g, " ").slice(0, 40))
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);
    const next = names.map((name, i) => ({ id: this.options[i]?.id ?? `o${this.nextOption++}`, name }));
    const keep = new Set(next.map((o) => o.id));
    for (const [vid, oid] of this.ballots) if (!keep.has(oid)) this.ballots.delete(vid);
    this.options = next;
    return { ok: true };
  }

  open() {
    if (this.options.length < 2) return { error: "Name at least two options first" };
    this.phase = "open";
    return { ok: true };
  }

  close() {
    this.phase = "closed";
    return { ok: true };
  }

  /** New vote: forget the ballots, keep the people and the options. */
  clear() {
    this.ballots.clear();
    this.phase = "lobby";
    return { ok: true };
  }

  cast(id, optionId) {
    if (!this.voters.has(id)) return { error: "Join first" };
    if (this.phase !== "open") return { error: "Voting is not open" };
    if (!this.options.some((o) => o.id === optionId)) return { error: "That option is gone" };
    this.ballots.set(id, optionId);
    return { ok: true };
  }

  // ------------------------------------------------------------ results

  tally() {
    const rows = this.options.map((o, i) => ({ id: o.id, name: o.name, total: 0, voters: [], i }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [vid, oid] of this.ballots) {
      const p = this.voters.get(vid);
      const r = byId.get(oid);
      if (!p || !r) continue;
      r.total += p.weight;
      r.voters.push(p.name);
    }
    rows.sort((a, b) => b.total - a.total || a.i - b.i);
    return rows.map(({ i, ...r }) => r);
  }

  winners() {
    const t = this.tally();
    const top = t[0]?.total ?? 0;
    if (top === 0) return [];
    return t.filter((r) => r.total === top).map((r) => r.id);
  }

  counts() {
    let weighted = 0;
    let ofWeighted = 0;
    for (const p of this.voters.values()) {
      ofWeighted += p.weight;
      if (this.ballots.has(p.id)) weighted += p.weight;
    }
    return { voters: this.ballots.size, of: this.voters.size, weighted, ofWeighted };
  }

  // ------------------------------------------------------------ views

  hostView() {
    return {
      role: "host",
      phase: this.phase,
      title: this.title,
      options: this.options.map((o) => ({ ...o })),
      voters: [...this.voters.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        weight: p.weight,
        choice: this.ballots.get(p.id) ?? null,
      })),
      tally: this.tally(),
      winners: this.winners(),
      counts: this.counts(),
    };
  }

  voterView(id) {
    const p = this.voters.get(id);
    if (!p) return { role: "voter", phase: "join" };
    return {
      role: "voter",
      phase: this.phase,
      name: p.name,
      weight: p.weight,
      title: this.title,
      options: this.options.map((o) => ({ ...o })),
      choice: this.ballots.get(id) ?? null,
      counts: this.counts(),
      results: this.phase === "closed" ? { tally: this.tally(), winners: this.winners() } : null,
    };
  }
}

module.exports = { Vote, MAX_OPTIONS };
