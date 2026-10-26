# Puzzles and tutorial content: "5D Chess With Multiverse Time Travel" reference

Evidence tags are the same as in `docs/ui-spec.md`:
- **[C] confirmed**: seen in footage, stated in official material, or stated by well-established community references.
- **[I] inferred**.
- **[B] unconfirmed (blog only)**: rests only on `docs/reference-blog.md`, a secondary fan source.

`research_imgs/` means `/private/tmp/claude-501/-Users-adam-Developer-5dchess/ae27d991-25b5-4a79-a803-8118136ecf9f/scratchpad/research_imgs/`.

## Sources

| Tag | Source |
|---|---|
| AE | Aeracs, "UPDATED FULL PUZZLE GUIDE for 5D Chess with Multiverse Time Travel", https://www.youtube.com/watch?v=vCYnrQdcaTU (2021-02-02, final 49-puzzle build, every puzzle solved on screen). Chapters: Rook 0:20, Knight 2:23, Bishop 4:41, Pawn 6:27, Combination 7:31, Backrank 10:37, Queen 12:09, King 14:20, Unicorn 17:01, Dragon 18:39, Opening Traps 19:42, Tricky 22:52, Advanced Branching 25:50. The full puzzle list was read from its "Puzzles" screen. |
| PAT | Patashu, Steam guide "Solutions to all 49 Puzzles (with explanations and spoiler tags)", id 2177978276. It is now removed from Steam. I recovered it from the Wayback Machine snapshot `web.archive.org/web/20211026064956/https://steamcommunity.com/sharedfiles/filedetails/?id=2177978276`. Local text: `.../scratchpad/web/patashu_49_puzzles.txt`. The official NEWS of 2020-07-27 linked it. |
| NEWS | Official Steam announcements, `.../scratchpad/web/news.txt` |
| ADRI | adri326, `5dchess-notation` README (the de-facto 5DPGN/5DFEN spec), https://github.com/adri326/5dchess-notation |
| SLAV | Slavrick/5dChessGUI `res/Puzzles/*.txt` (community transcriptions), https://github.com/Slavrick/5dChessGUI/tree/master/res/Puzzles |
| NKID | NKID00/5d-chess-js test `src/tests/fen.test.js` (the engine-ref in the scratchpad) |
| SG | Steam guide 2176513845, screenshot `steam_imgs/41.png` (Rook Tactics I) |
| BLOG | `docs/reference-blog.md` |

---

## 1. Puzzle mode UI [C]

References: AE 0:11, `research_imgs/puzzles_select_list_360p.png`, `research_imgs/puzzle_rook_tactics_I_start_360p.png`, `research_imgs/puzzle_complete_finish_puzzle_360p.png`.

**List screen**
- The title "Puzzles" sits on the blue vortex menu background, with an **X** close button.
- Inside the panel: "Select puzzle:" on the left and "**Completed: N/49**" on the right. The launch build said "/34".
- The list is scrolling, with alternating rows. The selected row is green.
- A **Play** button sits at the bottom.
- Each row's label is `<Category> <Roman numeral> ~ Mate-in-<one|two|three>`.

**In a puzzle**
- The background is the green-tinted checker (`#B6C1B2`/`#BDC8B9`).
- The puzzle opens with its **preset history already played**: several past boards are visible, so pieces can travel back.
- The status text (bottom-left) is the puzzle name.
- Pills: Undo Move/Deselect, Submit Moves, **Reset Puzzle** (hotkey R).
- The opponent replies automatically. The puzzle AI is not deterministic: PAT gives alternate solutions that depend on the AI's replies.

**On success**
- "Puzzle complete!" appears above the name.
- A red "!" badge marks the mated board, and the background darkens.
- The centre pill becomes **Finish Puzzle**.

**Completion and reset**
- Completion is saved per puzzle and can be reset in Settings ("Reset completion: Puzzles").
- NEWS 2020-07-24: "Puzzle draws are no longer counted as wins."
- **Mate-in-N** counts *the solver's* turns: N = the number of actions the current player must make (ADRI 5DFEN spec: `Puzzle = "mate-in-N"`).

**Ordering and unlocking** [I]. All puzzles appear unlocked: AE picks them freely and NL's list has no locks. Keep the fixed order below.

---

## 2. The complete puzzle list (final build, 49 puzzles) [C]

This list was read directly from the in-game list in AE (cross-checked against PAT's section index).

| # | Name (exact in-game label) | AE timestamp (start position) |
|---|---|---|
| 1 | Rook Tactics I ~ Mate-in-one | 0:25 |
| 2 | Rook Tactics II ~ Mate-in-two | 0:41 |
| 3 | Rook Tactics III ~ Mate-in-one | 0:53 |
| 4 | Rook Tactics IV ~ Mate-in-one | 1:06 |
| 5 | Rook Tactics V ~ Mate-in-two | 2:08 |
| 6 | Knight Tactics I ~ Mate-in-one | 2:26 (solved frame) |
| 7 | Knight Tactics II ~ Mate-in-one | ch. 2:23–3:10 |
| 8 | Knight Tactics III ~ Mate-in-one | ch. 2:23–3:10 |
| 9 | Knight Tactics IV ~ Mate-in-one | 3:10 |
| 10 | Knight Tactics V ~ Mate-in-one | 3:26 |
| 11 | Knight Tactics VI ~ Mate-in-three | 3:44 |
| 12 | Knight Tactics VII ~ Mate-in-one | ch. ~4:00–4:41 |
| 13 | Bishop Tactics I ~ Mate-in-one | ch. 4:41–5:02 |
| 14 | Bishop Tactics II ~ Mate-in-one | 5:02 (solved frame) |
| 15 | Bishop Tactics III ~ Mate-in-one | 5:13 |
| 16 | Bishop Tactics IV ~ Mate-in-one | 5:23 |
| 17 | Bishop Tactics V ~ Mate-in-one | ch. ~5:40–6:27 |
| 18 | Pawn Tactics I ~ Mate-in-one | 6:31 |
| 19 | Pawn Tactics II ~ Mate-in-one | 6:39 |
| 20 | Pawn Tactics III ~ Mate-in-one | 6:59 |
| 21 | Combination Attacks I ~ Mate-in-two | 7:35 |
| 22 | Combination Attacks II ~ Mate-in-one | 8:01 |
| 23 | Combination Attacks III ~ Mate-in-one | 8:41 |
| 24 | Combination Attacks IV ~ Mate-in-two | 9:16 |
| 25 | Combination Attacks V ~ Mate-in-two | 10:00 |
| 26 | Backrank Basics I ~ Mate-in-one | 10:40 |
| 27 | Backrank Basics II ~ Mate-in-two | 10:47 |
| 28 | Backrank Basics III ~ Mate-in-two | 10:55 |
| 29 | Backrank Basics IV ~ Mate-in-three | 11:08 |
| 30 | Queen Tactics I ~ Mate-in-one | 12:11 |
| 31 | Queen Tactics II ~ Mate-in-two | ch. 12:09–13:00 |
| 32 | Queen Tactics III ~ Mate-in-three | 13:00 |
| 33 | Queen Tactics IV ~ Mate-in-two | 13:41 |
| 34 | King Tactics I ~ Mate-in-one | 14:23 |
| 35 | King Tactics II ~ Mate-in-one | 14:56 |
| 36 | King Tactics III ~ Mate-in-one | 15:47 |
| 37 | Unicorn Tactics I ~ Mate-in-one | 17:06 |
| 38 | Unicorn Tactics II ~ Mate-in-one | ch. 17:06–18:39 |
| 39 | Dragon Tactics I ~ Mate-in-one | 18:43 |
| 40 | Opening Traps I ~ Mate-in-one | 19:45 |
| 41 | Opening Traps II ~ Mate-in-one | 20:07 |
| 42 | Opening Traps III ~ Mate-in-one | 20:48 |
| 43 | Opening Traps IV ~ Mate-in-two | 21:11 |
| 44 | Opening Traps V ~ Mate-in-one | 22:07 |
| 45 | Tricky Checkmates I ~ Mate-in-one | 22:55 |
| 46 | Tricky Checkmates II ~ Mate-in-one | 23:28 |
| 47 | Tricky Checkmates III ~ Mate-in-one | 24:37 |
| 48 | Advanced Branching I ~ Mate-in-one | 25:54 |
| 49 | Advanced Branching II ~ Mate-in-one | 27:58 |

AE is only 360p, but boards are legible when zoomed (`.../scratchpad/pz/a/a_NNNN.png` are 1-fps frames: frame `a_NNNN` = second NNNN−1). Use these timestamps to transcribe the positions this doc doesn't have yet.

### History of the list [C, NEWS 2020-10-07]

- **Launch**: 34 puzzles (NL shows "Completed: 0/34"). Some third-party guides still describe this old list, e.g. Rook Tactics III/IV as mate-in-two.
- **The Oct 2020 update** added 14 and modified others:
  - New Rook Tactics IV; the old IV became V.
  - New Bishop Tactics IV and V; Bishop Tactics I and II were modified.
  - New Pawn Tactics I–III, King Tactics III, Unicorn Tactics I–II, Dragon Tactics I, Tricky Checkmates III and Advanced Branching II.
  - New Opening Traps II and V; the old II and III became III and IV.
- The new piece types (Unicorn, Dragon, Princess, Brawn) arrived in the same update.
- **Pieces needed by the puzzle set**: King, Queen, Rook, Bishop, Knight, Pawn, **Unicorn** (Unicorn Tactics I–II), **Dragon** (Dragon Tactics I). Princess and Brawn appear only in variants.

---

## 3. Exact positions available

Exact position data is scarce. Only Rook Tactics I is fully documented by multiple independent sources. Everything else must be transcribed from AE frames (timestamps above). That is a known task for whoever builds puzzle data.

### 3.1 Rook Tactics I ~ Mate-in-one [C: ADRI, NKID, AE 0:25, SG 41.png, PAT]

5×5 board, files a–e, ranks 1–5. Notation follows 5DFEN/5DPGN (ADRI):

```
[Size "5x5"]
[Board "custom"]
[Puzzle "mate-in-1"]
[4k/5/5/5/K1R2:0:1:w]

1. Kb2 / Ke4
2. Re1 / Kd3
```

- **Start**: black K e5, white K a1, white R c1.
- **Preset history**: 1. Kb2 / Ke4, 2. Re1 / Kd3. The puzzle starts at **(0T3), white to move**, with five boards visible: T1w, T1b, T2w, T2b, T3w (AE 0:25 matches exactly: white K b2, R e1, black K d3 on the playable board).
- **Solution**: `3. (0T3)Re5` (ADRI: `(0T3)Re5# {attacks (0T1)Ke5}`).
  - The rook on e5 now attacks e5 *on the T1 board*, where the black king stood: a check against a king in the past (rook moving along the time axis).
  - Black cannot answer it. Moving the king doesn't change history. Branching is no help because it advances the checked timeline, and there is no other timeline to branch from (PAT).
  - PAT phrases it as "Just move your rook to the northeast corner. It checks the king in the past."
- **BLOG cross-check**:
  - The blog's description "Re5-5-0 checks the king on the past board e5-2-0" is **confirmed in substance**: rook to e5, check against the past king on e5.
  - The blog's coordinate numbering is its own and inconsistent with standard notation. "5" and "2" look like board/ply indices. A white piece can only travel to white-to-move boards, so the attacked board is (0T1) white = the initial board.
  - Treat the blog's numbers as **unconfirmed (blog only)**. Use ADRI notation.

### 3.2 Rook Tactics IV ~ Mate-in-one (new Oct-2020 version) [community transcription, unverified]

SLAV `RookTactics4.PGN5.txt`:

```
[board "custom"]
[size "4x4"]
[r2k/4/4/P2K:0:1:w]

1.a2  / Rc4
2.(0T2)Kd1>>(0T1)c2  / (1T1)Ra2
3.(1T2)Kb3  /
```

- The puzzle is played as **black**: after the preset, black to move on two timelines. This agrees visually with AE 1:06: 4×4 boards, two timelines, black rooks, played from black's side.
- **Solution** (PAT, describing the same puzzle):
  - Move the **top-board black rook** onto the square where a white king used to stand. It now threatens the past king by travelling back.
  - **At the same time**, move the **bottom-board black rook onto the same rank and file** on its own board, so the top rook is defended across timelines and the white king can't capture it.
  - Steam thread "New Rook tactics IV": "move both rooks on the same space (each on their own board)".
- [I] Verify against AE 1:06–2:08 before use. The SLAV header ordering of the pawn ("P" on a1 with `[r2k/4/4/P2K…]`) should be double-checked.

### 3.3 Knight Tactics III ~ Mate-in-one [C for moves (ADRI); start position not given]

```
[Size "5x5"]
[Mode "5D"]
1. (0T1)Nd2 / (0T1)c3
2. (0T2)Nb3 / (0T2)c2
3. (0T3)Nb3>>(0T1)a3 / (1T1)Ke4
4. (1T2)Nb5# {attacks (0T3)Kd5}
```

- ADRI's example doesn't include the custom starting board, so the start position must be transcribed from AE (ch. 2:23–3:10).
- The pattern: the knight branches back, then leaps two squares spatially plus one timeline to hit the king on the original timeline's past board.

### 3.4 Everything else

No public 5DFEN found. Searched: GitHub code search for every puzzle category name, the adri326/5dchess-variants repo (variants only), FW, and Steam guides. The speedrun autosplitter `mauer01/5d-chess-autosplitter` only lists names.

Positions must be transcribed from AE frames. Category board sizes as seen [C from AE frames]:
- Rook Tactics: 5×5 and 4×4.
- Knight Tactics: 4×4.
- Bishop/Pawn: 4×4–5×5.
- Combination Attacks: 5×5 and 8×8 with multiple timelines (e.g. CA II has 3 parallel timelines at start).
- Backrank Basics and Opening Traps: 8×8 standard-like positions with long preset histories.

---

## 4. Solutions (summaries from PAT, which plays the final build; paraphrased)

- **Rook Tactics**
  - I: see §3.1.
  - II: Give the ordinary chess mate. The king escapes by branching; repeat the same mate on the new branch.
  - III: Move a rook straight "north" across timelines to check a king on another timeline. Make that single move and **don't** move on the optional future timeline.
  - IV: see §3.2.
  - V: Ordinary mate, the king branches away, then put the rook on the same square on the new branch. It is protected by the parallel rook (cross-timeline defence).
- **Knight Tactics**
  - I–III: The knight checks a past or parallel king (1 square spatially plus 2 in time/timeline, or 2 plus 1).
  - IV–V: Branch so the new timeline's knight attacks the original timeline's past king.
  - VI (mate in 3): check, check, then 2E + 1 turn into the past. A defended knight in the new branch checks the original past king. Several alternates exist.
  - VII: Move the knight 2 turns back + 1 timeline into the second branch (advancing it instead of creating a new one). It then threatens 2N + 1 past.
- **Bishop Tactics**
  - I: Bishop 2N 2W. It then threatens 2 past 2E onto the past king.
  - II: Bishop 1N 1W, protected by the king.
  - III: The bishop already aims at the past king, so just protect it with the king.
  - IV: Bishop 2 past 2E. From the new timeline it threatens 1 timeline-north + 1 north.
  - V: Bottom bishop 1 past 1N. This rewinds the present (escaping the check on the top board) and threatens a 2 timeline + 2N check.
- **Pawn Tactics** (pawn rules recap from PAT: pawns also move 1 timeline "forward" and capture "1 timeline forward + 1 turn past/future"; en passant is spatial only; there are no mixed spatial/temporal pawn captures)
  - I: A plain 2D pawn capture.
  - II: Move the pawn one *timeline* forward. It forks two kings.
  - III: Pawn two squares forward. It then checks a king 1 timeline-north + 1 past (purely temporal diagonal capture).
- **Combination Attacks**
  - I: Rook check, then knight past-check (2N + 1 past).
  - II: The same knight past-check on the **top** board, and block the enemy rook's line with a pawn on the middle board.
  - III: Send the rook as far back as possible. The new branch lets a pawn capture the king 1 future + 1 timeline.
  - IV: A bishop check-chase until the rook can attack the past king (alternate: a waiting king move).
  - V: Branch the knight back as far as possible, then capture the black knight on the top timeline, which also checks the past king.
- **Backrank Basics**
  - I: Back-rank mate.
  - II: The king's only past escape is still on the rook's line.
  - III: Repeat the mate on the new branch.
  - IV (mate in 3): take the rook into the past, then mate both kings (two solution lines).
- **Queen Tactics**
  - I: Queen check on a spatial diagonal plus back in time, protected by the king.
  - II: Get the queen to any of 5 squares (2W/2SW/2S/2SE/2E) to check the past king; almost every safe queen move works.
  - III: Promote the third pawn; it already attacks the oldest king.
  - IV: Check in the present (to stop the knight counter-branch), then mate the past king. "Queen 3 SE, king 1 E" or "queen 1 SE, king 1 E".
- **King Tactics**
  - I: Move the black king 1 NE. Triple check on past kings.
  - II: The present white king goes back to the W square of the first board, creating a non-adjacent timeline that checks the past king.
  - III: The top white king goes 1N + 1 past + 1 timeline-south, then checks 1 timeline-north + 1N + 1E.
- **Unicorn Tactics**
  - I: Any king move. The unicorn already checks 2N 2E 2 past.
  - II: Unicorn 1N 1W 1 timeline-north. It checks 2N 2E 2 past.
- **Dragon Tactics I**: Bottom dragon 1 timeline-north + 1 past + 1N + 1E, defended by a pawn.
- **Opening Traps**
  - I: Queen 3W (capturing a pawn) lines up through the pawn hole onto the oldest king.
  - II: Bishop 1N 1E threatens 3N 3 past.
  - III: The same idea diagonally; the knight blocking in the present doesn't matter in the past.
  - IV: The queen attacks the pawn next to the king *in the past* (defended by your own queen). Then mate on the far-back branch the opponent creates.
  - V: Send the black queen as far into the past as possible. This rewinds the present and mates several kings.
- **Tricky Checkmates**
  - I: Give check on the top board **and** block the only movable pawn on the bottom board. A player in check who cannot make enough moves to move the present loses.
  - II: Check the present and past kings at once: (+0L) Bb2–d4 and (−0L) Nb1–d2.
  - III: Queen 2E, then pawn 1 timeline-north (third branch), so the cloned queen defends itself.
- **Advanced Branching**
  - I: Check with the knight in the present **and** use the queen to create an inactive timeline that would mate if the king escaped by branching.
  - II: On the future timeline make any legal move 1 turn into the past (to create a gap row). Then knight 2N + 1 timeline-south on the top timeline, which checks a past king "across the void" 2 timelines away.

These summaries are also the best behavioural spec for the **puzzle reply AI**. The original's scripted defender branches to escape when it can, captures checking pieces, and otherwise makes a legal move. [I] For our app, implement puzzle replies as "any legal reply that escapes immediate mate, else any legal move", or ship each puzzle with a fixed reply tree.

---

## 5. Tutorial / Guide content structure [C]

The original has no interactive tutorial (see `docs/ui-spec.md` §2.6). The launch build had a text **Rules** screen; the Oct-2020 build has a multi-page **Guide**. The press kit: "There is also a very comprehensive written ruleset." The puzzles act as the hands-on tutorial; PAT and the Save or Quit review both say so.

**Rules (launch)**
- Quick Rules (5 numbered rules).
- Pointer to play the trainer CPU and the Discord (Copy-link button).
- Strategy Tips.
- "Complete Rules and Justification" with Subjects: 1) What is checkmate? 2) How are a piece's available moves determined? 3) What happens when a piece travels to the past? 4) Who's turn is it, and on which timelines must they move?
- Verbatim fragments are in `docs/ui-spec.md` §2.6.

**Guide (final)**
- Titled pages, e.g. "Guide - Timelines", with sections ("Turns and Timelines": 1) Who's turn is it? 2) Which timelines must be played? 3) How are timelines created?).
- Inline icons; completion tracking (resettable in Settings).
- It also documents the new pieces Unicorn, Dragon, Princess and Brawn (NEWS).

**Recommended structure for our Guide** [I], mirroring the original's subjects plus the pages the update added:
1. Basics (the Quick Rules).
2. Pieces: one page per piece incl. Unicorn, Dragon, Princess, Brawn, with movement diagrams.
3. Timelines: Turns and Timelines.
4. The Present: band, markers, active/inactive timelines.
5. Check and Checkmate: past-king checks; "can't move the present ⇒ loss".
6. Strategy Tips.

Each page should end with a "Try it" link to the matching puzzle category.

Community tutorials the original promoted in-game or in announcements: MariAurum's video tutorial (https://www.youtube.com/watch?v=eqMEiBu4M1c, linked in NEWS 2020-07-24) and SG 2176513845.
