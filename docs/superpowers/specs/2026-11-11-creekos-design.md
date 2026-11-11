# CreekOS — SEPtathlon Tracker: Design Decisions

**Primary spec:** `docs/PRD.md` (verbatim, authoritative for product behaviour).
This document records the decisions the PRD leaves open. Sam opted to skip the
question round ("here is my prd, use best practice skills to build what i need",
"use the matt pocock library"), so every item below is the builder's call unless
marked **(Sam)**. All are overridable later; the blood matrix in particular is a
single constant.

## Intent

A weekend-long party tournament tracker for ~13–15 mates at Separation Creek:
one always-on TV leaderboard, one phone-based commissioner portal, zero data
loss across phone deaths / Wi-Fi drops / redeploys. Same crowd and venue as the
existing Krillion project; deploys to Railway the same way Krillion does.

## Goals / Non-goals / Anti-goals

- **Goals:** everything in PRD §§2–7; survives flaky beach Wi-Fi; every number
  amendable after the fact; TV looks broadcast-quality from the couch.
- **Non-goals:** player-facing phones (TV + one commissioner phone only),
  accounts/multi-tenancy, WebSockets (polling is the PRD-sanctioned fallback and
  is more robust here), offline-first admin.
- **Anti-goals:** anything that can silently lose a committed score; browser
  `alert()/confirm()` dialogs; a build so clever it can't be hot-fixed from a
  beach house.

## Stack (Sam: "use the matt pocock library" → TypeScript path)

| Choice | Value | Why |
| --- | --- | --- |
| Framework | **Next.js 15 (App Router), React 19, single service** | PRD-named option; one Railway service serves `/tv`, `/admin`, `/api/*` |
| Language | **TypeScript, strict** per the Total TypeScript tsconfig cheat sheet (`noUncheckedIndexedAccess` etc.) + **`@total-typescript/ts-reset`** | "The Matt Pocock library" — ts-reset + his tsconfig conventions; Zod at every boundary is his recommended pattern too |
| Validation | **Zod v4** on every API input | Runtime safety for vibe-entered scores |
| ORM / DB | **Drizzle ORM (pg-core)** + committed SQL migrations run on boot | Postgres-16 dialect everywhere; satisfies PRD §7.4 auto-migration |
| DB drivers | `postgres` (postgres-js) when `DATABASE_URL` set; **PGlite** (WASM Postgres, file-backed `./data/`) otherwise | Real Postgres semantics locally with zero install; prod **requires** `DATABASE_URL` and fails fast without it |
| Animation | `motion` (Framer Motion v12) on the TV only | Layout-animated rank changes are the PRD's marquee effect |
| Fonts | `next/font/google`: Cinzel (display), Inter (UI), JetBrains Mono (numerals) | Self-hosted at build → works with no internet at the beach |
| Tests | Vitest (engine + repo via in-memory PGlite), `tsx` e2e sim script | |
| Package manager | npm | Krillion precedent |
| Deploy | Dockerfile build pinned via `railway.json` + `/api/healthz` check, numReplicas 1 | Exact Krillion pattern, known-good on this account |

## Decisions the PRD left open (builder's calls)

1. **Blood on the Creek payoff matrix** — the PRD never specifies deltas. Default
   (constant `BLOOD_MATRIX` in `src/lib/constants.ts`, round 3 doubles, and every
   delta is editable per-matchup in admin after reveal):
   - 1v1: PURE/PURE **+3/+3** · BLOOD/PURE **+5/−3** · BLOOD/BLOOD **−2/−2**
   - 3-way: all PURE **+3 each** · one BLOOD **+6, pures −2** · two BLOOD **+1 each, pure −4** · all BLOOD **−3 each**
2. **Tie-splitting** uses `ceil_to_half` exactly: `ceil(x*2)/2` (ranks 3–4 tie →
   13.0 each; ranks 1–3 tie → 17.0 each). Ranks beyond 15 score 1 point.
3. **Elimination ranking** is positional, not arithmetic: alive players (no
   elimination order) rank above all eliminated players and tie among themselves;
   eliminated players sort by elimination order descending; equal orders tie.
   Gaps in order numbers (from un-eliminations) are harmless.
4. **Manual rank override** locks that player to that exact rank; auto players
   fill the remaining ranks in metric order; two players locked to the same rank
   tie-split from that rank.
5. **Fruit split error** = `|weightA/(weightA+weightB)·100 − 50|`, 3 dp, lower is
   better.
6. **Trend arrows** compare against the ranking before the most recent
   order-changing write (prev/current rank maps stored in `app_state`).
7. **Auth**: cookie `creekos_admin` = SHA-256 of the PIN + fixed salt, set by
   `POST /api/login` (or `/admin?pin=XXXX` auto-submit); `x-admin-pin` header
   accepted for scripts. Default PIN **2026** (PRD §7.3), override via
   `ADMIN_PIN`. Party-grade, not bank-grade — by design.
8. **Realtime** = 2.5 s polling of `/api/state` with ETag/304; admin polls 5 s.
   SSE rejected: polling recovers from Wi-Fi drops with zero reconnect logic.
9. **Unrevealed blood cards never appear in the public `/api/state`** (TV is in
   the living room); the admin reads them from an authed endpoint.
10. **Backups**: on any write, if >10 min since last snapshot → JSON snapshot row
    (keep 48) + manual snapshot/export/restore endpoints. Restore requires typed
    `RESTORE` confirmation and snapshots itself first.
11. **Roster** seeds empty (events 1–7 seed automatically); any player count ≥2
    works, 13–15 expected. Inactive players keep history but leave the board.
12. **XSS**: mates will absolutely enter `<script>` as a name — React text
    rendering only, `dangerouslySetInnerHTML` banned.
13. **Lives** (3 per player, PRD §4 Tab 2) persist in `event_results.lives_remaining`
    so a phone refresh mid-event loses nothing.
14. **Writes are last-write-wins** (single commissioner expected); every write is
    one transaction and bumps `state_version`.

## What's left to the builder

File-level structure, component breakdown, CSS detail (within the PRD §5 theme
tokens), copy/lore flavour beyond PRD-quoted strings, and test internals — all
within `docs/CONTRACT.md` and the plan.
