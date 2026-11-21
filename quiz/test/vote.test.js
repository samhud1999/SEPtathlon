"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Vote } = require("../vote");

function setup() {
  const v = new Vote();
  v.join("s", "Sam");
  v.join("a", "Olivia");
  v.join("b", "Davo");
  v.setup({ title: "Best dance", options: ["Davo & Gazza", "Spud & Wazza", "Olivia & Sol"] });
  return v;
}

test("join: names are trimmed and unique, Sam counts double, rejoin keeps the voter", () => {
  const v = new Vote();
  assert.equal(v.join("x", "   ").error, "Enter a name");
  assert.equal(v.join("s", "  sam ").voter.name, "sam");
  assert.equal(v.voters.get("s").weight, 2);
  assert.equal(v.join("a", "Olivia").voter.weight, 1);
  assert.equal(v.join("y", "SAM").error, "That name is taken");
  v.setConnected("a", false);
  assert.equal(v.join("a", "whatever").voter.name, "Olivia");
  assert.equal(v.voters.get("a").connected, true);
});

test("setup: options get stable ids by position, blanks are dropped, renames keep ballots", () => {
  const v = setup();
  const ids = v.options.map((o) => o.id);
  assert.equal(ids.length, 3);
  v.open();
  v.cast("a", ids[1]);
  v.setup({ title: "Best dance", options: ["Davo & Gazza", "Spud & Wazza (fixed)", "", "Olivia & Sol"] });
  assert.deepEqual(
    v.options.map((o) => [o.id, o.name]),
    [[ids[0], "Davo & Gazza"], [ids[1], "Spud & Wazza (fixed)"], [ids[2], "Olivia & Sol"]],
  );
  assert.equal(v.ballots.get("a"), ids[1]);
  v.setup({ title: "", options: ["Only one"] });
  assert.equal(v.ballots.has("a"), false, "removing an option discards its ballots");
  assert.equal(v.setup({ options: [] }).error, undefined);
});

test("flow: open needs two options, casting only while open, votes can change until close", () => {
  const v = new Vote();
  v.join("a", "Olivia");
  v.setup({ options: ["One"] });
  assert.equal(v.open().error, "Name at least two options first");
  v.setup({ options: ["One", "Two"] });
  const [o1, o2] = v.options.map((o) => o.id);
  assert.equal(v.cast("a", o1).error, "Voting is not open");
  assert.equal(v.open().ok, true);
  assert.equal(v.phase, "open");
  assert.equal(v.cast("zz", o1).error, "Join first");
  assert.equal(v.cast("a", "nope").error, "That option is gone");
  assert.equal(v.cast("a", o1).ok, true);
  assert.equal(v.cast("a", o2).ok, true);
  assert.equal(v.ballots.get("a"), o2);
  v.close();
  assert.equal(v.phase, "closed");
  assert.equal(v.cast("a", o1).error, "Voting is not open");
});

test("tally: weights add up, sorted high to low, winners flagged, counts reported", () => {
  const v = setup();
  const [o1, o2, o3] = v.options.map((o) => o.id);
  v.open();
  v.cast("s", o2);
  v.cast("a", o2);
  v.cast("b", o1);
  const t = v.tally();
  assert.deepEqual(
    t.map((r) => [r.id, r.total, r.voters]),
    [[o2, 3, ["Sam", "Olivia"]], [o1, 1, ["Davo"]], [o3, 0, []]],
  );
  assert.deepEqual(v.winners(), [o2]);
  assert.deepEqual(v.counts(), { voters: 3, of: 3, weighted: 4, ofWeighted: 4 });
  v.setWeight("s", 1);
  assert.equal(v.tally()[0].total, 2);
  v.setWeight("b", 2);
  assert.deepEqual(v.winners().sort(), [o1, o2].sort(), "a tie lists every leader");
  assert.equal(v.setWeight("s", 7).error, "Weight must be 1 or 2");
});

test("kick drops the ballot; new vote keeps voters and options; reset wipes everything", () => {
  const v = setup();
  const [o1] = v.options.map((o) => o.id);
  v.open();
  v.cast("b", o1);
  v.kick("b");
  assert.equal(v.voters.has("b"), false);
  assert.equal(v.ballots.has("b"), false);
  v.cast("a", o1);
  v.close();
  v.clear();
  assert.equal(v.phase, "lobby");
  assert.equal(v.ballots.size, 0);
  assert.equal(v.voters.size, 2);
  assert.equal(v.options.length, 3);
  assert.equal(v.title, "Best dance");
  v.reset();
  assert.equal(v.voters.size, 0);
  assert.equal(v.options.length, 0);
  assert.equal(v.title, "");
});

test("views: unknown voter is asked to join; results only once closed; host sees who voted what", () => {
  const v = setup();
  assert.deepEqual(v.voterView("nobody"), { role: "voter", phase: "join" });
  const [o1] = v.options.map((o) => o.id);
  v.open();
  v.cast("s", o1);
  let me = v.voterView("s");
  assert.equal(me.phase, "open");
  assert.equal(me.name, "Sam");
  assert.equal(me.weight, 2);
  assert.equal(me.choice, o1);
  assert.equal(me.results, null);
  assert.equal(me.options.length, 3);
  assert.deepEqual(me.counts, { voters: 1, of: 3, weighted: 2, ofWeighted: 4 });
  v.close();
  me = v.voterView("s");
  assert.equal(me.results.tally[0].id, o1);
  assert.deepEqual(me.results.winners, [o1]);
  const h = v.hostView();
  assert.equal(h.role, "host");
  assert.equal(h.phase, "closed");
  assert.equal(h.title, "Best dance");
  assert.deepEqual(h.voters.find((x) => x.id === "s"), { id: "s", name: "Sam", connected: true, weight: 2, choice: o1 });
  assert.equal(h.tally[0].total, 2);
  assert.deepEqual(h.winners, [o1]);
});
