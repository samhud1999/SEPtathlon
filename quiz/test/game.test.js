"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Game, isMatch } = require("../game");
const questions = require("../questions.json");

const Q = {
  mc: { type: "mc", category: "T", text: "2+2?", options: ["3", "4", "5", "6"], answer: 1 },
  text: { type: "text", category: "T", text: "Capital of NZ?", accept: ["Wellington"] },
  buzz: { type: "buzzer", category: "T", text: "Longest river in SA?", accept: ["Amazon"] },
};

function setup(qs) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const g = new Game(qs, { now: clock.now });
  for (const [id, name] of [["a", "Sol"], ["b", "Kajsa"], ["c", "Jake"]]) g.join(id, name);
  return { g, clock };
}

test("question bank is valid and has the planned mix", () => {
  assert.equal(questions.length, 30);
  const count = (t) => questions.filter((q) => q.type === t).length;
  assert.deepEqual([count("mc"), count("buzzer"), count("text")], [13, 9, 8]);
  for (const q of questions) {
    if (q.type === "mc") assert.ok(q.answer >= 0 && q.answer < q.options.length, q.text);
    else assert.ok(q.accept.length > 0, q.text);
  }
  const cats = new Set(questions.map((q) => q.category));
  assert.deepEqual([...cats].sort(), ["Geography", "History", "Music", "News", "TV", "Words"]);
});

test("fuzzy matching", () => {
  assert.ok(isMatch("wellington", ["Wellington"]));
  assert.ok(isMatch("  Welington ", ["Wellington"])); // one typo
  assert.ok(isMatch("the amazon", ["Amazon"]));
  assert.ok(isMatch("acdc", ["AC/DC"]));
  assert.ok(isMatch("AC-DC", ["AC/DC"]));
  assert.ok(isMatch("Moes", ["Moe's"]));
  assert.ok(isMatch("heisenburg", ["Heisenberg"]));
  assert.ok(isMatch("España", ["Espana"]));
  assert.ok(isMatch("ben caroll", ["Ben Carroll"]));
  assert.ok(!isMatch("Auckland", ["Wellington"]));
  assert.ok(!isMatch("7", ["6", "Six"]));
  assert.ok(!isMatch("", ["Six"]));
  assert.ok(!isMatch("Dalas", ["Dallas"]) === false); // 1 typo on a 6-letter word is allowed
  assert.ok(!isMatch("Sahra", ["Sahara"]) === false);
});

test("names must be unique and rejoin keeps the player", () => {
  const { g } = setup([Q.mc]);
  assert.equal(g.join("x", "sol").error, "That name is taken");
  assert.equal(g.join("x", "   ").error, "Enter a name");
  g.setConnected("a", false);
  assert.equal(g.join("a", "whatever").player.name, "Sol");
  assert.equal(g.players.get("a").connected, true);
});

test("multiple choice: speed bonus, wrong answers, early end when all answer", () => {
  const { g, clock } = setup([Q.mc]);
  g.next();
  assert.equal(g.phase, "question");
  assert.equal(g.playerView("a").question.options.length, 4);
  assert.equal(g.playerView("a").question.answer, undefined, "answer not leaked");
  g.answer("a", { choice: 1 }); // instant: 1000
  clock.advance(10000);
  g.answer("b", { choice: 1 }); // halfway: 750
  assert.equal(g.answer("b", { choice: 1 }).error, "Already answered");
  g.answer("c", { choice: 0 }); // wrong
  assert.equal(g.phase, "reveal", "ends once everyone answered");
  assert.deepEqual(g.revealView().counts, [1, 2, 0, 0]);
  assert.equal(g.score("a"), 1000);
  assert.equal(g.score("b"), 750);
  assert.equal(g.score("c"), 0);
  assert.equal(g.playerView("c").result.correct, "4");
});

test("timer ends a question; disconnected players don't hold it up", () => {
  const { g, clock } = setup([Q.mc]);
  g.setConnected("c", false);
  g.next();
  g.answer("a", { choice: 1 });
  assert.equal(g.phase, "question");
  g.answer("b", { choice: 2 });
  assert.equal(g.phase, "reveal", "only connected players counted");

  const s2 = setup([Q.text]);
  s2.g.next();
  s2.clock.advance(29999);
  assert.equal(s2.g.tick(), false);
  s2.clock.advance(2);
  assert.equal(s2.g.tick(), true);
  assert.equal(s2.g.phase, "reveal");
});

test("free text: auto marking and host override", () => {
  const { g } = setup([Q.text]);
  g.next();
  g.answer("a", { text: "wellington" });
  g.answer("b", { text: "Auckland" });
  g.answer("c", { text: "Welly" });
  assert.equal(g.phase, "reveal");
  assert.equal(g.score("a"), 1000);
  assert.equal(g.score("c"), 0);
  g.toggle(0, "c"); // host accepts "Welly"
  assert.equal(g.score("c"), 1000);
  g.toggle(0, "c");
  assert.equal(g.score("c"), 0);
  assert.equal(g.revealView().answers[0].name, "Sol");
});

test("buzzer: first buzz wins, wrong answer locks out and reopens, right answer ends", () => {
  const { g, clock } = setup([Q.buzz]);
  g.next();
  clock.advance(5000);
  assert.ok(g.buzz("b").ok);
  assert.equal(g.buzz("a").error, "Too slow");
  assert.equal(g.playerView("a").buzz.holder, "Kajsa");
  assert.equal(g.playerView("b").buzz.mine, true);
  assert.equal(g.answer("a", { text: "Amazon" }).error, "Not your buzz");
  g.answer("b", { text: "Nile" });
  assert.equal(g.phase, "question", "reopened");
  assert.equal(g.score("b"), -250);
  assert.equal(g.buzz("b").error, "You're locked out");
  assert.equal(g.timeLeft(), 15000, "buzz window resumes where it paused");
  assert.ok(g.buzz("c").ok);
  g.answer("c", { text: "the amazon" });
  assert.equal(g.phase, "reveal");
  assert.equal(g.score("c"), 1000);
  assert.deepEqual(g.revealView().attempts.map((x) => x.correct), [false, true]);
  assert.equal(g.playerView("b").result.tried, true);
  assert.equal(g.playerView("a").result.tried, false);
});

test("buzzer: answer timeout counts as wrong; everyone locked out ends it; nobody buzzing times out", () => {
  const { g, clock } = setup([Q.buzz, Q.buzz]);
  g.next();
  g.buzz("a");
  clock.advance(15001);
  g.tick();
  assert.equal(g.score("a"), -250);
  g.buzz("b");
  g.answer("b", { text: "x" });
  g.buzz("c");
  g.answer("c", { text: "y" });
  assert.equal(g.phase, "reveal", "all locked out");
  g.toggle(0, 2); // host decides "y" was fine
  assert.equal(g.score("c"), 1000);

  g.next(); // leaderboard
  g.next(); // q2
  clock.advance(20001);
  g.tick();
  assert.equal(g.phase, "reveal");
  assert.deepEqual(g.revealView().attempts, []);
});

test("full flow to final with standings and ties", () => {
  const { g } = setup([Q.mc, Q.text]);
  assert.equal(g.phase, "lobby");
  g.next();
  g.answer("a", { choice: 1 });
  g.answer("b", { choice: 1 });
  g.answer("c", { choice: 3 });
  g.next();
  assert.equal(g.phase, "leaderboard");
  const st = g.standings();
  assert.equal(st[0].rank, 1);
  assert.equal(st[1].rank, 1, "tied scores share a rank");
  assert.equal(st[2].rank, 3);
  g.next();
  assert.equal(g.question.type, "text");
  g.next(); // host ends early
  assert.equal(g.phase, "reveal");
  g.next();
  assert.equal(g.phase, "final");
  assert.equal(g.playerView("a").podium.length, 3);
});

test("kick removes player and their points; reset clears everything", () => {
  const { g } = setup([Q.mc]);
  g.next();
  g.answer("a", { choice: 1 });
  g.kick("a");
  assert.equal(g.players.has("a"), false);
  assert.equal(g.standings().length, 2);
  assert.equal(g.playerView("a").phase, "join");
  g.reset();
  assert.equal(g.phase, "lobby");
  assert.equal(g.players.size, 0);
});
