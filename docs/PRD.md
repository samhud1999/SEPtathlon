# PRD: CreekOS — The SEPtathlon Cloud Tracker & TV Broadcast System

> Verbatim product requirements as supplied by the Commissioner (Sam), 2026-11-11.
> Implementation decisions that this PRD leaves open are resolved in
> `docs/superpowers/specs/2026-11-11-creekos-design.md`.

This end-to-end **Product Requirements Document (PRD)** is architected specifically for a cloud deployment on **Railway** using a single unified deployment (or two lightweight services) backed by a **Railway Managed PostgreSQL** database.

It guarantees zero data loss if a phone dies or the beach house Wi-Fi drops, provides real-time WebSocket/polling sync to an **Always-On TV Dashboard**, and gives you a **Mobile Commissioner Admin Portal** where every single score, rank, Joker, and Dumbledore Decree can be entered, recalculated, amended, or rolled back at any time.

---

## 1. System Architecture & Railway Cloud Stack

To keep deployment fast, reliable, and dirt-cheap on Railway while supporting real-time TV updates and persistent database storage, the system uses the following stack:

* **Hosting & Infrastructure:** **Railway.app** (1 Project containing 2 linked services: the **Web Application Service** and a **Railway PostgreSQL Database**).
* **Database:** **PostgreSQL 16 (Railway Managed Plugin)** — persistent cloud volume ensuring zero state loss across restarts or redeployments.
* **Backend / API Layer:** **FastAPI (Python)** or **Next.js App Router (Node/TypeScript)** with Prisma/SQLAlchemy ORM.
* **Real-Time Sync Engine:** **Server-Sent Events (SSE)** or **3-second Lightweight Polling** on the `/api/state` endpoint + **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) so the laptop/smart TV browser connected at the beach house never goes to sleep.
* **Two Distinct Client Routes:**
1. **`/tv` (Public Always-On TV Broadcast Dashboard):** Read-only, 16:9 widescreen dark-mode UI designed for a living room TV. Automatically animates rank changes and flashes full-screen banners when a Dumbledore Decree or Event score is committed.
2. **`/admin` (Protected Mobile Commissioner Portal):** PIN-protected (`?pin=XXXX` or cookie auth) mobile-first interface for entering raw scores, overriding positions, firing Dumbledore Decrees, and amending historical records.

---

## 2. PostgreSQL Database Schema (Persistent & Auditable)

Every score is stored at the **raw input level**, the **calculated rank level**, and the **manual override level** so you can amend any number at any point in the weekend and have the entire tournament leaderboard recalculate automatically.

```sql
-- 1. PLAYERS TABLE
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    epithet VARCHAR(100) DEFAULT 'Tribute of the Creek',
    is_active BOOLEAN DEFAULT TRUE,
    joker_event_id INT DEFAULT NULL, -- 1 to 6, NULL if unused
    rock_curse_level INT DEFAULT 0,  -- 0=Clean, 1=Off-Hand, 2=Knees, 3=Blind Backwards
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. EVENTS METADATA TABLE (Seeded with Events 1-7)
CREATE TABLE events (
    id INT PRIMARY KEY, -- 1 through 7
    slug VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    sin VARCHAR(30) NOT NULL,
    scoring_type VARCHAR(30) NOT NULL, -- 'ELIMINATION', 'RAW_HIGH', 'FRUIT_SPLIT', 'BLOOD_MATRIX'
    status VARCHAR(20) DEFAULT 'UPCOMING', -- 'UPCOMING', 'LIVE', 'COMPLETED'
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. EVENT RESULTS TABLE (Supports Raw Input, Auto-Rank, AND Manual Amendments)
CREATE TABLE event_results (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    player_id INT REFERENCES players(id) ON DELETE CASCADE,

    -- Raw Inputs (nullable depending on event type)
    raw_score NUMERIC(10, 2) DEFAULT NULL,       -- Krillion pts, Quiz pts, Grape count
    elimination_order INT DEFAULT NULL,          -- 1 = First out (15th), 15 = Last alive (1st)
    weight_a_grams NUMERIC(8, 2) DEFAULT NULL,   -- Event 5 Fruit Half A
    weight_b_grams NUMERIC(8, 2) DEFAULT NULL,   -- Event 5 Fruit Half B
    calculated_error_pct NUMERIC(6, 3) DEFAULT NULL, -- Event 5 Auto-calculated % off 50.0%

    -- Position & Points (Auto-computed, but editable via Admin Override)
    calculated_rank INT DEFAULT NULL,            -- 1 to 15
    manual_rank_override INT DEFAULT NULL,       -- If set, overrides calculated_rank
    base_points NUMERIC(5, 1) DEFAULT 0,         -- From Master Table (20, 16, 14... or split tie)
    joker_applied BOOLEAN DEFAULT FALSE,         -- 2x multiplier flag
    manual_points_override NUMERIC(6, 1) DEFAULT NULL, -- Hard override if Commissioner amends score
    final_event_points NUMERIC(6, 1) DEFAULT 0,  -- Actual points contributed to leaderboard

    notes TEXT DEFAULT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, player_id)
);

-- 4. BLOOD ON THE CREEK (EVENT 7) MATCHUPS & STANDOFF LEDGER
CREATE TABLE blood_matchups (
    id SERIAL PRIMARY KEY,
    round_number INT NOT NULL, -- 1, 2, or 3 (Round 3 = 2x stakes)
    matchup_type VARCHAR(10) DEFAULT '1V1', -- '1V1' or '3WAY'
    player_a_id INT REFERENCES players(id),
    player_b_id INT REFERENCES players(id),
    player_c_id INT REFERENCES players(id) NULL, -- Only used if odd player count
    card_a VARCHAR(10) DEFAULT NULL, -- 'PURE' or 'BLOOD'
    card_b VARCHAR(10) DEFAULT NULL,
    card_c VARCHAR(10) DEFAULT NULL,
    delta_a NUMERIC(5, 1) DEFAULT 0,
    delta_b NUMERIC(5, 1) DEFAULT 0,
    delta_c NUMERIC(5, 1) DEFAULT 0,
    is_revealed BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. DUMBLEDORE DECREE LEDGER (Full Audit Trail, Editable & Deletable)
CREATE TABLE dumbledore_decrees (
    id SERIAL PRIMARY KEY,
    player_id INT REFERENCES players(id) ON DELETE CASCADE,
    points_delta NUMERIC(5, 1) NOT NULL, -- e.g., +3, -5, +10
    sin_tag VARCHAR(30) NOT NULL,        -- 'Sloth', 'Pride', 'Heroism', 'Dishonor', etc.
    reason TEXT NOT NULL,                -- Displayed on TV Ticker & Toast Banner
    is_voided BOOLEAN DEFAULT FALSE,     -- Soft-delete toggle to undo a decree without losing history
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Core Backend Scoring & Recalculation Engine

Whenever the Commissioner inputs, edits, or amends **any** record in `/admin`, the backend runs a single atomic transaction (`recalculate_tournament_state()`) before committing to PostgreSQL:

1. **Master Points Lookup Array:**
```python
MASTER_POINTS = {
    1: 20, 2: 16, 3: 14, 4: 12, 5: 11,
    6: 10, 7: 9,  8: 8,  9: 7,  10: 6,
    11: 5, 12: 4, 13: 3, 14: 2, 15: 1
}
```

2. **Auto-Rank & Tie-Splitting Logic (Events 1–6):**
* **If `manual_rank_override` is set:** The engine locks that player into that exact rank.
* **Otherwise:** The engine sorts all participants in the event by the event's metric (`elimination_order DESC`, `raw_score DESC`, or `calculated_error_pct ASC`).
* **Tie-Splitting:** If N players share the exact same raw score/metric (and have no manual rank override), they occupy ranks R through R + N - 1. Their `base_points` is calculated as:

  Base Points = ceil_to_half( sum(MASTER_POINTS[i] for i in R..R+N-1) / N )

3. **Joker Multiplier & Point Override:**
* If `players.joker_event_id == event_id`, `joker_applied = True` and `final_event_points = base_points * 2`.
* If the Commissioner typed a value into `manual_points_override`, that value overrides everything for `final_event_points`.

4. **Grand Total Aggregation:**

   Grand Total = sum(final_event_points for events 1..6)
               + sum(blood_matchups deltas for the player)
               + sum(points_delta of active dumbledore_decrees)

---

## 4. Module 1: The Mobile Commissioner Admin Portal (`/admin`)

Designed for one-handed operation on your phone with a bottom navigation bar containing **4 Tabs**:

### Tab 1: ⚡ Quick Decree ("The Dumbledore Wand")

* **1-Tap Player Grid:** Tap one or multiple player avatars (e.g., reward 3 people for cooking breakfast, or dock 2 people for spilling a beer).
* **Point Stepper:** Quick buttons for `-10`, `-5`, `-3`, `-2`, `-1`, `+1`, `+2`, `+3`, `+5`, `+10`, plus a custom numeric field.
* **Sin / Lore Category Selector:** `Sloth`, `Greed`, `Pride`, `Wrath`, `Envy`, `Gluttony`, `Lust`, `Blessing of the Creek`.
* **Reason Input:** Text box (e.g., *"Dropped a stubby on the deck"*).
* **"CAST DECREE" Button:** Saves to Postgres and immediately triggers a dramatic overlay alert on the TV Dashboard.
* **Decree History & Amendment List (Below the form):**
* Shows every decree issued all weekend.
* Each row has an **[Edit]** button (change points, player, or text) and a **[Void / Undo]** button that immediately reverses the points from the leaderboard.

### Tab 2: 🏆 Event Score Input & Amendment Matrix

Select any of the 7 Events from a top dropdown. Every event screen has **Two Modes** you can toggle between at any time:

#### Mode A: Guided Live Event Helper (Used while refereeing the game)

* **Event 1 (Stubby Fan) & Event 4 (Rock Hurl):**
* Displays all players as "ALIVE (3 Lives)".
* Tapping `[-1 Life]` or `[ELIMINATE NOW]` automatically logs their elimination order (1st out = 15th place, 2nd out = 14th place, etc.) and saves each tap to PostgreSQL immediately so you don't lose progress mid-game.
* *Event 4 Specific:* Includes a `[+1 Curse Level]` and `[-1 Curse Level]` button next to each surviving player so the TV screen shows who has to throw off-hand, kneeling, or backwards in the next round.

* **Event 2 (Krillion), Event 3 (Weekly 50), Event 6 (Grape Bobbing):**
* Displays a clean list of players with a large numeric input box for their raw score (`Krillion Score`, `Quiz Points`, or `Grapes Counted`) and a `[🃏 Joker Active]` checkbox.
* As you type numbers, a live preview badge shows their projected Rank (`1st`, `2nd`, `T-3rd`) and Points (`20 pts`, `16 pts`, `13 pts`).

* **Event 5 (50/50 Fruit Split):**
* Two input boxes per player: `Half A (g)` and `Half B (g)`.
* Automatically computes and saves `Off-Target %` and ranks everyone from lowest error % to highest.

* **Event 7 (Blood on the Creek):**
* **[Generate Round 1 / 2 / 3 Matchups]** button.
* For each pair, tap Player A's choice (`PURE` / `BLOOD`) and Player B's choice (`PURE` / `BLOOD`), then hit **`[REVEAL ON TV & COMMIT]`**.

#### Mode B: "God-Mode Amendment Table" (Spreadsheet Override View)

* If there is a recount, a refereeing dispute, or a typo in *any* past or current event, toggle **"Edit / Amend Raw Table"**.
* Displays a full editable grid for that event:
`Player` | `Raw Input` | `Auto Rank` | **`Override Rank`** | `Joker?` | `Auto Pts` | **`Override Final Pts`**
* Changing any cell and hitting **`[Save Amendments]`** updates PostgreSQL and recalculates the entire weekend leaderboard in <100ms.

### Tab 3: 👥 Roster & Jokers Management

* Add/edit player names (handle late arrivals or dropouts dynamically—if 13 people show up instead of 15, the system scales cleanly).
* Manually assign, move, or revoke a player's **Mortal Sin Joker (`2x`)** or adjust their **Rock Hurl Curse Level**.

### Tab 4: 💾 System & Backups

* **"Set Active TV View" Remote Control:** Force the TV screen to switch between the **Main Leaderboard**, the **Current Live Event Spotlight**, or the **Event 7 Standoff Stage** right from your phone.
* **1-Click JSON Snapshot Export / Restore:** Download a timestamped `.json` dump of the entire PostgreSQL database to your phone as a secondary backup.

---

## 5. Module 2: The Always-On TV Dashboard (`/tv`)

Designed to run full-screen (`F11`) on a laptop HDMI'd to the beach house TV or a Smart TV browser.

* **Aesthetic:** Dark coastal-gothic theme (*"The Sanctum of Separation Creek"*). Deep slate/obsidian background (`#0B0F17`), crimson blood accents (`#DC2626`), gold podium highlights (`#F59E0B`), and high-readability tabular monospace numerals so everyone can read their score from across the living room with a beer in hand.
* **Layout Structure (3 Zones):**
1. **Left / Center (70% Width) — The Master SEPtathlon Leaderboard:**
* Shows every player ranked 1st to 15th.
* Columns: `Rank` | `Trend (▲2 / ▼1)` | `Player Name + Active Badges (🃏 Joker Used / 🪨 Curse Level)` | `E1 (Sloth)` | `E2 (Greed)` | `E3 (Pride)` | `E4 (Wrath)` | `E5 (Envy)` | `E6 (Gluttony)` | `E7 (Blood)` | `⚡ Decrees` | **`TOTAL PTS`**.
* **Visual Dividers:** A gold line under 1st Place (*"The Purified Sovereign"*) and a jagged red line above Last Place (*"The Vessel of Sins"*).

2. **Right Sidebar (30% Width Top) — Live Event Spotlight:**
* Dynamically shows the currently active event (e.g., during Event 4 Rock Hurl, it shows who is still alive and what Curse Level each person is throwing under; during Event 5 Fruit Split, it shows the current "Leader in the Clubhouse" Error % to beat; during Event 7, it renders the face-to-face **Blood vs. Pure Standoff Stage** with a 90-second countdown timer).

3. **Right Sidebar (30% Width Bottom) — The Scroll of Judgment (Dumbledore Feed):**
* Live vertical feed of the latest discretionary point awards and deductions with timestamps and reasons.

* **Full-Screen "Dumbledore Decree" Toast Overlay:**
* Whenever you hit **"Cast Decree"** on your phone, the TV interrupts the dashboard for 5 seconds with a massive animated banner:
> ⚡ **JUDGMENT FROM THE CREEK** ⚡
> **-3 POINTS TO [PLAYER NAME]**
> *Sin of Sloth: Left an empty tinny on the balcony rail.*

---

## 6. API Endpoints Specification (For Fast Vibe-Coding)

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/state` | Returns full tournament state (leaderboard, event matrix, last 20 decrees, active TV view mode). Polled by `/tv` every 2.5 seconds. |
| `POST` | `/api/players` | Create, rename, or toggle active status of a player. |
| `POST` | `/api/events/{id}/score` | Upserts raw inputs, rank overrides, or point overrides for an event and triggers `recalculate_tournament_state()`. |
| `POST` | `/api/events/{id}/joker` | Toggles a player's 2x Joker on Event `{id}` (validates they haven't used it on another event). |
| `POST` | `/api/decrees` | Logs a new Dumbledore Decree for 1+ players and triggers TV toast notification flag. |
| `PATCH` | `/api/decrees/{id}` | Amends the points/reason or toggles `is_voided` on an existing decree and recalculates totals. |
| `POST` | `/api/blood/matchup` | Creates or reveals a Round 1, 2, or 3 matchup in *Blood on the Creek* and applies the exact matrix delta. |
| `POST` | `/api/tv-mode` | Lets the Admin phone remotely switch the TV view between `LEADERBOARD`, `LIVE_EVENT`, and `BLOOD_STAGE`. |

---

## 7. Railway Deployment Checklist (5-Minute Setup)

1. **Create Railway Project:** In Railway, click **New Project** → **Provision PostgreSQL**.
2. **Deploy App Service:** Connect your GitHub repo (or deploy via `railway up` CLI from your Mac mini).
3. **Link Variables:** In your Web Service settings, add a Reference Variable linking `DATABASE_URL=${{Postgres.DATABASE_URL}}` and set `ADMIN_PIN=2026` (or whatever PIN you want).
4. **Auto-Migration on Boot:** Include an `init_db()` startup hook in your app that automatically creates the 5 tables above and seeds the 7 Deadly Sins events if the database is empty.
