# Integer Duel

Bago National High School ADM game — a 1-vs-1 **tug-of-war** with integer questions. Two students on **different phones** answer the same 10 questions; every correct answer pulls the rope toward them. Any grade level (7–12) can duel any other grade level.

Teacher Raymart Valbarez · Roxas City, Philippines.

**Live:** https://raymartvalbarez.github.io/integer-duel/
**Practice vs computer (no scores saved):** https://raymartvalbarez.github.io/integer-duel/?demo=1
**Leaderboard:** https://raymartvalbarez.github.io/integer-duel/leaderboard.html

## How a duel works
1. Player 1 enters name, grade level and section and taps **Create Duel**. A 5-character code and a link appear.
2. Player 2 opens the link (or types the code), enters their own name, grade and section, and taps **Join Duel**.
3. Both phones get the **same 10 integer questions** (same order), 10 seconds each, 4 choices. Correct = **10 pull + up to 5 speed bonus**. Wrong or time-up = no pull.
4. The rope moves by the difference in pull. Pull it **50 points past the center** and you win at once; otherwise the player with the most pull after round 10 wins (equal pull = draw).
5. Only the tapped answer is marked Correct/Wrong; the right choice is never shown, and the end screen shows scores only.

Questions (`questions.js`): add, subtract, multiply and divide signed integers, order of operations, absolute value, comparing/ordering integers, number line, missing numbers, and word problems (temperature, elevation, money, floors, debts, game points), plus a large curated bank of worded items. Each 10-question duel is 5 easy, 3 average and 2 difficult (50-30-20). Both phones build the same items from a shared seed; `node tools/test_questions.js` re-verifies 10,000 duels (100,000 items).

## Networking (no paid backend)
MantleDB namespace `bnhs-integerduel-nov2026` (`?ns=bnhs-integerduel-…` switches namespace for testing). Each player writes only their own small document (`a-CODE`, `b-CODE`: profile, heartbeat, answers) and polls the opponent about once per second, so there is no WebRTC and it works on mobile data. The host's `m-CODE` holds the question seed. Finished duels are written once to `r-CODE`, which the leaderboard reads.

* Opponent silent for 40 s or taps **Leave**: after 3 completed rounds the remaining player **wins by forfeit**; earlier, the duel is **cancelled** and not counted.
* Answers recorded after 20.8 s are ignored; speed is measured on each player's own phone.
* Refreshing the page offers **Rejoin duel**.

## Leaderboard
`leaderboard.html` ranks every student by wins, then win rate, then total pull points, with Grade filters (All / 7–12), a period filter, and a recent-duels list. The home screen shows the top 5.
