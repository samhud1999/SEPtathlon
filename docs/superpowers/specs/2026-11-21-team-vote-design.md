# Team Vote design

**Date:** 2026-11-21 (written during the event; short form)

## Intent

Everyone at the Creek votes for one of six teams from their phone, Kahoot
style: open a link, type a name, tap a team. Sam runs it from a host screen,
types the six team names in once people have registered, opens voting, and
closes it to show the result. Sam's own vote counts double. 13 voters expected.

## Why here

Guests have no accounts. A claude.ai artifact only lets signed-in viewers
write, so it cannot take anonymous votes. The `quiz/` service already does
anonymous join-by-name over WebSockets with a host PIN, a QR code and phone
pages, and it is deployed on Railway. The vote is a second mode inside that
service: same host PIN, same look, new pages and a separate in-memory engine.

Alternatives dropped: a new Railway service (needs a dashboard setup step Sam
has no time for tonight); a CreekOS feature with Postgres tables (slower to
build and deploy, and real-time needs polling).

## Behaviour

- **Voters** open `/vote`, enter a name (unique, 20 chars), and wait. A
  `vote-id` in localStorage lets a refreshed phone keep its registration.
- **Weight.** Every voter has weight 1. A voter who registers as "Sam" (any
  case) gets weight 2 automatically. The host can set anyone's weight to 1 or 2
  from the roster, so a mistaken name is a one-tap fix.
- **Host** opens `/vote/host`, enters `QUIZ_HOST_PIN`, and sees: QR code and
  join URL, the roster (weight toggle, two-tap remove), a setup card with a
  title and six option fields (add or remove rows; blank rows are ignored), a
  live tally, and the phase controls.
- **Phases.** `lobby` (registering, host typing names) → `open` (voters tap
  one option; they can change it until close) → `closed` (results on every
  phone and on the host screen). Host buttons: Open voting (needs two named
  options), Close & show results, Reopen, New vote (clears ballots, keeps
  voters and options, back to lobby), Reset everything (two taps; wipes all).
- **Results.** Weighted totals per option, sorted high to low, winner(s)
  highlighted, plus "voted N of M (weighted W of X)". Voters see their own
  choice and the full result once closed; while open they see only the count.
- **Renaming options keeps votes.** Options have stable ids by position, so
  fixing a typo after voting opened does not lose ballots. Removing an option
  discards ballots cast for it.

## Non-goals

Ranked or multi-choice ballots, persistence across a server restart (same
in-memory rule as the quiz), a separate TV page (the host page scales to a TV).

## Builder notes

- Engine `quiz/vote.js` (`Vote` class, pure, tested with `node --test`).
- Sockets on a second WebSocket path `/vote/ws`; `server.js` routes the HTTP
  upgrade by path with `noServer` servers so the quiz socket is untouched.
- `client.js` `connect()` takes an optional `path`.
- Pages `quiz/public/vote.html` and `quiz/public/vote-host.html` reuse
  `style.css`; two extra option colours (`--c4`, `--c5`) for six options.
