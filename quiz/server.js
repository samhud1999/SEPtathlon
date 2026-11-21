"use strict";
/**
 * Quiz server: serves the host (TV) and player (phone) pages and runs one game
 * over WebSockets. All state is in memory — restarting the server resets the quiz.
 *
 *   PORT            port to listen on (Railway sets this)
 *   QUIZ_HOST_PIN   PIN for the host screen (default "1234")
 *   QUIZ_QUESTIONS  path to a questions JSON file (default ./questions.json)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const QRCode = require("qrcode");
const { Game } = require("./game");
const { attachVote } = require("./vote-server");

const PORT = Number(process.env.PORT) || 8080;
const HOST_PIN = process.env.QUIZ_HOST_PIN || "1234";
const questions = JSON.parse(
  fs.readFileSync(process.env.QUIZ_QUESTIONS || path.join(__dirname, "questions.json"), "utf8"),
);
validate(questions);

const game = new Game(questions);
const PUBLIC = path.join(__dirname, "public");
const FILES = {
  "/": ["play.html", "text/html"],
  "/host": ["host.html", "text/html"],
  "/control": ["control.html", "text/html"],
  "/vote": ["vote.html", "text/html"],
  "/vote/host": ["vote-host.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/client.js": ["client.js", "text/javascript"],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") return send(res, 200, "application/json", '{"ok":true}');
  if (url.pathname === "/qr.svg") {
    const target = url.searchParams.get("u") || "";
    if (!/^https?:\/\//.test(target) || target.length > 200) return send(res, 400, "text/plain", "bad url");
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, color: { dark: "#000", light: "#fff" } });
    return send(res, 200, "image/svg+xml", svg);
  }
  const file = FILES[url.pathname];
  if (!file) return send(res, 404, "text/plain", "Not found");
  fs.readFile(path.join(PUBLIC, file[0]), (err, body) =>
    err ? send(res, 500, "text/plain", "error") : send(res, 200, file[1] + "; charset=utf-8", body),
  );
});

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

// ---------------------------------------------------------------- sockets

// Two socket endpoints on one port: the quiz on /ws, the team vote on /vote/ws.
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const vss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
attachVote(vss, {
  hostPin: HOST_PIN,
  // Pre-loaded for tonight; the host screen can change them.
  title: "Dance on the Creek",
  options: ["Sarah & Sol", "Olivia & Dan", "Matilda & Kajsa", "Cass & Mackenzie", "Hugo & Chris", "Nineh & Jake"],
});
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  const target = pathname === "/ws" ? wss : pathname === "/vote/ws" ? vss : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});
const clients = new Set(); // { ws, role: 'host'|'player'|null, id }

wss.on("connection", (ws) => {
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
    if (c.role === "player" && c.id) {
      const stillHere = [...clients].some((o) => o.role === "player" && o.id === c.id);
      if (!stillHere) game.setConnected(c.id, false);
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
    // -------- players
    case "hello": // reconnect with a stored id
      if (!id) return;
      c.role = "player";
      c.id = id;
      if (game.players.has(id)) game.setConnected(id, true);
      broadcast();
      return;
    case "join": {
      if (!id) return;
      c.role = "player";
      c.id = id;
      const r = game.join(id, msg.name);
      if (r.error) return reply(c, { type: "error", error: r.error });
      broadcast();
      return;
    }
    case "answer":
    case "buzz": {
      if (c.role !== "player") return;
      const r = msg.type === "buzz" ? game.buzz(c.id) : game.answer(c.id, msg);
      if (r.error) reply(c, { type: "error", error: r.error, quiet: true });
      broadcast();
      return;
    }
    // -------- host
    case "host":
      if (String(msg.pin) !== HOST_PIN) return reply(c, { type: "error", error: "Wrong PIN" });
      c.role = "host";
      broadcast();
      return;
    case "next":
    case "judge":
    case "toggle":
    case "kick":
    case "reset": {
      if (c.role !== "host") return;
      if (msg.type === "next") game.next();
      if (msg.type === "judge") game.judge(Boolean(msg.correct));
      if (msg.type === "toggle") game.toggle(Number(msg.q), msg.ref);
      if (msg.type === "kick") {
        game.kick(String(msg.player));
        for (const o of clients) if (o.role === "player" && o.id === msg.player) reply(o, { type: "kicked" });
      }
      if (msg.type === "reset") game.reset();
      broadcast();
      return;
    }
  }
}

function broadcast() {
  const host = game.hostView();
  for (const c of clients) {
    if (c.role === "host") reply(c, { type: "state", ...host });
    else if (c.role === "player") reply(c, { type: "state", ...game.playerView(c.id) });
  }
}

// Timer + a once-a-second resync of the countdown while a question is open.
let lastSync = 0;
setInterval(() => {
  const changed = game.tick();
  const now = Date.now();
  if (changed || (game.phase === "question" && now - lastSync > 1000)) {
    lastSync = now;
    broadcast();
  }
}, 100);

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
}, 15000);

function validate(qs) {
  if (!Array.isArray(qs) || qs.length === 0) throw new Error("questions.json must be a non-empty array");
  qs.forEach((q, i) => {
    const where = `question ${i + 1}`;
    if (!["mc", "text", "buzzer"].includes(q.type)) throw new Error(`${where}: type must be mc, text or buzzer`);
    if (!q.text) throw new Error(`${where}: missing text`);
    if (q.type === "mc") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4)
        throw new Error(`${where}: mc needs 2–4 options`);
      if (!(q.answer >= 0 && q.answer < q.options.length)) throw new Error(`${where}: answer must be an option index`);
    } else if (!Array.isArray(q.accept) || q.accept.length === 0) {
      throw new Error(`${where}: needs an accept list`);
    }
  });
}

server.listen(PORT, () => {
  console.log(`Quiz on :${PORT} — ${questions.length} questions. Host screen: /host, vote: /vote/host (PIN ${HOST_PIN === "1234" ? "1234 — set QUIZ_HOST_PIN" : "set"})`);
});
