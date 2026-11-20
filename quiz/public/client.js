"use strict";
/* Shared by host and player pages: socket with auto-reconnect, countdown, helpers. */

function connect({ onOpen, onMessage, onStatus }) {
  let ws;
  let retry = 0;
  const api = {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
  };
  function open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      onStatus && onStatus(true);
      onOpen && onOpen(api);
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = () => {
      onStatus && onStatus(false);
      setTimeout(open, Math.min(4000, 500 * 2 ** retry++));
    };
  }
  open();
  return api;
}

/** Countdown that renders locally between server syncs. */
const timer = {
  deadline: 0,
  set(ms) {
    this.deadline = performance.now() + ms;
  },
  left() {
    return Math.max(0, this.deadline - performance.now());
  },
};

function $(sel, root = document) {
  return root.querySelector(sel);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const SHAPES = ["▲", "◆", "●", "■"];
const TYPE_LABEL = { mc: "Multiple choice", text: "Type your answer", buzzer: "Buzzer round" };

function startTicker(render) {
  (function loop() {
    render(timer.left());
    requestAnimationFrame(loop);
  })();
}
