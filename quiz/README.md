# SEPtathlon Quiz

A Kahoot-style party quiz. The TV shows the host screen, and everyone plays on their phones.

- **TV / host:** `https://<your-quiz-domain>/host` (enter the host PIN)
- **Host's phone:** `https://<your-quiz-domain>/control` (same PIN) — runs the game and shows you every answer
- **Players:** `https://<your-quiz-domain>/`, or scan the QR code on the TV

## Question types

| Type | How it plays | Points |
|---|---|---|
| Multiple choice | Everyone picks from 4 options within 20 s | 500–1000, faster answers score more |
| Type your answer | Everyone types an answer within 30 s. Small typos, capitals and "the" are forgiven | 1000 |
| Buzzer | First to buzz answers **out loud** and has 15 s before it counts as a miss. You mark it ✓/✗ on `/control`, where the answer is in front of you. Wrong or timed out costs 250 and locks that player out, then the buzzers reopen for everyone else | 1000 |

After each question the answer is revealed. For typed and buzzer answers, **tap any answer on `/control` (or the TV) to flip it right or wrong**, and the scores update — even for earlier questions.

## Running the quiz

- Run it from your phone at `/control`: it shows the current question **with the correct answer**, who buzzed, big ✓/✗ verdict buttons, and the same next/kick/reset controls as the TV.
- **Space**, **→** or the purple button (on the TV or `/control`) moves things on: start → end question early → leaderboard → next question.
- A question also ends by itself when the timer runs out or everyone has answered.
- Players who refresh or lose signal rejoin automatically with their score.
- In the lobby, tap a name twice to remove that player.
- **Reset quiz** (tap twice) wipes players and scores.

The game lives in memory, so **restarting or redeploying the server resets the quiz**. Don't deploy mid-game.

## Editing questions

Edit `questions.json`. Each entry looks like one of these:

```json
{ "type": "mc", "category": "Geography", "text": "Capital of Canada?", "options": ["Toronto", "Ottawa", "Vancouver", "Montreal"], "answer": 1 }
{ "type": "text", "category": "TV", "text": "Walter White's alias?", "accept": ["Heisenberg"] }
{ "type": "buzzer", "category": "Music", "text": "Who sang Highway to Hell?", "accept": ["AC/DC", "ACDC"] }
```

- `answer` is the position of the correct option, counting from 0.
- `accept` lists the answers to count as correct. The first one is the answer shown on the TV.

## Run locally

```
npm install
QUIZ_HOST_PIN=4321 npm start      # http://localhost:8080
npm test
```

## Deploy on Railway (as a second service)

1. Open the Railway project and click **Add**, then **GitHub Repo**, and pick `SEPtathlon`.
2. In the new service, go to **Settings → Source → Add Root Directory** and set it to `/quiz`.
3. In **Variables**, add `QUIZ_HOST_PIN` = a PIN of your choice.
4. In **Settings → Networking**, click **Generate Domain** and use port `8080`.
5. Optional: set the **Healthcheck Path** to `/healthz`.

It needs no database.
