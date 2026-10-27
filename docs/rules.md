# Rules

5D Chess is ordinary chess with two extra dimensions: time and parallel timelines. If you know how chess pieces move, you already know most of it.

## Goal
Checkmate your opponent. A king can be attacked on any board, including past boards and boards in other timelines. You lose when you can't finish a turn without leaving one of your kings attacked.

## Boards and turns
- Every board is a snapshot of one moment. Time runs left to right: each move creates a new board to the right of the old one, and the old board stays as history.
- A board's frame shows whose move it is there: light for White, dark for Black.
- A row of boards joined by a purple bar is a **timeline**. Only the last board of each timeline (the one with the big arrow) can be played on.

## Your turn
- Click a piece on a board where it's your move. Every square it can reach turns green, including squares on other boards.
- Moves are tentative until you press **Submit Moves**. **Undo Move** takes back the last one.
- You may move on several boards in one turn: you **must** move on every active timeline that sits on the Present, and you **may** move on others where it's your move.

## The Present
The wide vertical band is **the Present**: the earliest moment that still needs a move. It's light when White is to move there and dark for Black. Your turn is complete once the Present has moved on to your opponent; then Submit Moves lights up.

## Time travel
- Pieces can move back in time just as they move along ranks and files. One step in time is one full turn back, so a piece always lands on a board of its own colour. Nothing can move into the future.
- The past can't change. Landing on a board that already has a successor **creates a new timeline**: a copy of that board with your piece added, on a new row. White's timelines are numbered +1, +2… and Black's −1, −2…. Your own new timelines appear at the bottom of your screen.
- Travelling to the past usually pulls the Present back, so your opponent must answer there.
- Timelines are a direction too. Moving onto another timeline's last board doesn't create anything new: the piece just moves over, and both timelines advance.

## Active timelines
A player may have at most **one more active timeline** than the opponent. Extra ones are inactive: drawn in that player's colour instead of purple, and ignored by the Present until the opponent catches up. The circles on the Present show whether each player's next timeline would be active (purple arrow) or not (empty).

## How pieces move
There are four axes: file, rank, timeline and turn (back in time only). Sliding pieces stop at the first piece in their path and capture as usual.

| Piece | Moves |
|---|---|
| Rook | Any distance along one axis |
| Bishop | Any distance along two axes at once, equal steps on each |
| Unicorn | Any distance along three axes, equal steps |
| Dragon | Any distance along all four axes, equal steps |
| Queen | Any distance along any number of axes, equal steps (rook + bishop + unicorn + dragon) |
| Princess | Rook or bishop |
| King | One step in any combination of axes. Royal. |
| Royal queen | Moves like a queen. Royal. |
| Common king | Moves like a king. Not royal. |
| Knight | Two steps on one axis and one on another, jumping over anything |
| Pawn | Forward one square (two from the start), or forward one timeline (two if unmoved) onto an empty square. Captures diagonally forward on its board, or one timeline forward plus one turn back or forward. |
| Brawn | A pawn with extra captures: one timeline forward plus one step sideways or forward on the board, or one turn back plus one step forward. |

For a pawn, "forward across timelines" means towards the opponent's timelines.

## Check, checkmate and stalemate
- Your king is in check if any enemy piece could capture it by any legal move, including by travelling back to a past board where your king stands. Red arrows show every attack.
- You can make tentative moves that leave you in check, but you can't submit them.
- If you can't complete a turn without leaving a royal piece attacked, it's **checkmate** if one was attacked at the start of your turn, and **stalemate** (a draw) otherwise.
- Games also end by resignation, by agreeing a draw (online), or on time.

## Special moves
- **Castling:** as usual, on one board only. The king may not castle out of, through or into check, counting attacks from every board.
- **En passant:** on one board only, on the very next board.
- **Promotion:** a pawn or brawn reaching the last rank becomes a queen.
