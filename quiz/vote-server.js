"use strict";
/**
 * Team vote over WebSockets: wires one Vote engine to a WebSocketServer that
 * the main server hands upgrades on /vote/ws. Same shape as the quiz sockets:
 * voters say hello/join/cast, the host authenticates with the quiz PIN.
 */
const { Vote } = require("./vote");

function attachVote(vss, { hostPin, title = "", options = [] }) {
  const vote = new Vote();
  vote.setup({ title, options });
  const clients = new Set(); // { ws, role: 'host'|'voter'|null, id }

  vss.on("connection", (ws) => {
    const c = { ws, role: null, id: null };
    clients.add(c);
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      handle(c, msg);
    });
    ws.on("close", () => {
      clients.delete(c);
      if (c.role === "voter" && c.id) {
        const stillHere = [...clients].some((o) => o.role === "voter" && o.id === c.id);
        if (!stillHere) vote.setConnected(c.id, false);
        broadcast();
      }
    });
  });

  function reply(c, obj) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(obj));
  }

  function handle(c, msg) {
    const id = typeof msg.id === "string" ? msg.id.slice(0, 64) : null;
    switch (msg.type) {
      // -------- voters
      case "hello":
        if (!id) return;
        c.role = "voter";
        c.id = id;
        if (vote.voters.has(id)) vote.setConnected(id, true);
        broadcast();
        return;
      case "join": {
        if (!id) return;
        c.role = "voter";
        c.id = id;
        const r = vote.join(id, msg.name);
        if (r.error) return reply(c, { type: "error", error: r.error });
        broadcast();
        return;
      }
      case "cast": {
        if (c.role !== "voter") return;
        const r = vote.cast(c.id, String(msg.option ?? ""));
        if (r.error) reply(c, { type: "error", error: r.error });
        broadcast();
        return;
      }
      // -------- host
      case "host":
        if (String(msg.pin) !== hostPin) return reply(c, { type: "error", error: "Wrong PIN" });
        c.role = "host";
        broadcast();
        return;
      case "setup":
      case "open":
      case "close":
      case "clear":
      case "weight":
      case "kick":
      case "reset": {
        if (c.role !== "host") return;
        let r = { ok: true };
        if (msg.type === "setup") r = vote.setup({ title: msg.title, options: msg.options });
        if (msg.type === "open") r = vote.open();
        if (msg.type === "close") r = vote.close();
        if (msg.type === "clear") r = vote.clear();
        if (msg.type === "weight") r = vote.setWeight(String(msg.voter), Number(msg.weight));
        if (msg.type === "kick") {
          vote.kick(String(msg.voter));
          for (const o of clients) if (o.role === "voter" && o.id === msg.voter) reply(o, { type: "kicked" });
        }
        if (msg.type === "reset") vote.reset();
        if (r.error) reply(c, { type: "error", error: r.error });
        broadcast();
        return;
      }
    }
  }

  function broadcast() {
    const host = vote.hostView();
    for (const c of clients) {
      if (c.role === "host") reply(c, { type: "state", ...host });
      else if (c.role === "voter") reply(c, { type: "state", ...vote.voterView(c.id) });
    }
  }

  // Drop dead connections so "connected" stays accurate.
  setInterval(() => {
    for (const c of clients) {
      if (!c.ws.isAlive) {
        c.ws.terminate();
        continue;
      }
      c.ws.isAlive = false;
      c.ws.ping();
    }
  }, 15000).unref();

  return vote;
}

module.exports = { attachVote };
