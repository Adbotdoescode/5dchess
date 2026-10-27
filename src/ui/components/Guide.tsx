// The Guide: a plain written explanation of the rules (headings and paragraphs only).

export function Guide() {
  return (
    <article className="panel guide">
      <h2>Guide</h2>
      <p className="lead">5D Chess is ordinary chess with two extra dimensions: time and parallel timelines.</p>
      <nav aria-label="Contents">
        <a href="#g-goal">Goal</a>
        <a href="#g-boards">Boards and turns</a>
        <a href="#g-moves">Moving and submitting</a>
        <a href="#g-present">The Present</a>
        <a href="#g-travel">Time travel</a>
        <a href="#g-active">Active timelines</a>
        <a href="#g-pieces">Pieces</a>
        <a href="#g-check">Check and checkmate</a>
        <a href="#g-special">Special moves</a>
        <a href="#g-controls">Controls</a>
      </nav>

      <h2 id="g-goal">The goal</h2>
      <p>
        As in ordinary chess, you win by checkmating your opponent. The difference is that the game is played across a whole multiverse of
        boards. A king can be attacked on any board, including a board from the past or a board in another timeline, and you lose when you can no
        longer finish a turn without leaving one of your kings attacked.
      </p>
      <p>Most of the rules of ordinary chess still apply. If you know how the pieces move on one board, you already know most of the game.</p>

      <h2 id="g-boards">Boards, turns and the time axis</h2>
      <p>
        Every board on the screen is a snapshot of one moment of the game. Time runs from left to right: each time someone moves on a board, the
        result appears as a new board to its right, and the old board stays where it was as part of history. The faint labels T1, T2, T3 along the
        bottom of the screen mark the turn numbers.
      </p>
      <p>
        A board's frame shows whose move it is on that board: a light frame means White is to move there, a dark frame means Black is to move.
        Boards alternate white, black, white along a timeline, so a whole turn (a white move and a black reply) takes two board widths.
      </p>
      <p>
        A row of boards joined by a purple bar is a timeline. The game starts with one timeline (some variants start with two). The last board of
        each timeline, the one with the big arrow pointing into the future, is that timeline's present position. Only these end boards can be
        played on.
      </p>

      <h2 id="g-moves">Making moves and Submit Moves</h2>
      <p>
        On your turn, click one of your pieces on a board where it is your move. Every square it can reach turns green, on its own board and on
        any other board it can travel to. Boards of your opponent's colour fade out while a piece is selected, because you can only ever land on
        a board where it is your move. Click a green square to make the move, click the piece again or press Esc to put it down, or click another
        of your pieces to select that one instead.
      </p>
      <p>
        Moves are tentative until you press Submit Moves. Each move creates a new board, framed in colour so you can see what you have changed
        this turn. Undo Move takes back your last tentative move. You can make several moves in one turn: one on each timeline that needs a
        move, and optionally on others too. Submit Moves only lights up once your turn is complete, and when you submit, your opponent's turn
        begins.
      </p>
      <p>
        The Undo Move button is yellow after an ordinary move, blue after a move through time or between timelines, and red if your tentative
        position leaves one of your kings in check. A red frame and a red arrow show where the attack comes from. You cannot submit a turn that
        leaves you in check, so undo and try something else.
      </p>

      <h2 id="g-present">The Present and which boards you must move on</h2>
      <p>
        The wide vertical band running through the boards is The Present. It sits at the earliest moment that still needs a move: the leftmost
        end board among the active timelines. Its colour tells you whose turn it is in the present: light for White, dark for Black.
      </p>
      <p>
        Your turn is complete once The Present has moved on to your opponent. In practice this means you must make a move on every active
        timeline whose end board lies on The Present. Timelines that are already ahead of The Present can be left alone, or you may move on
        them too if it is your move there. Each move on a board in The Present pushes that timeline forward; when no board on The Present is
        waiting for you any more, the band changes colour and Submit Moves becomes available.
      </p>
      <p>Boards that still need a move pulse gently. The round button at the bottom of the right-hand column (or Tab) jumps between the boards you can play on.</p>

      <h2 id="g-travel">Time travel and branching timelines</h2>
      <p>
        Pieces can move along the time axis just as they move along ranks and files. One step in time means one full turn back, so a piece
        always arrives on a board of its own colour. A rook can slide straight back several turns, a bishop can move one square diagonally and
        one turn back at the same time, a knight can jump two turns back and one square sideways, and so on.
      </p>
      <p>
        The past cannot be changed. When a piece lands on a board that already has a successor, a new timeline branches off from that board: a
        copy of the old position with the arriving piece added appears on a new row, and the piece disappears from the board it left. The old
        timeline carries on unchanged. Timelines created by White are numbered +1, +2 and so on and appear below the original one from White's
        point of view; Black's are numbered -1, -2 and appear on the other side. From each player's point of view, their own new timelines appear
        at the bottom of the screen.
      </p>
      <p>
        Travelling to the past usually pulls The Present back to the moment you travelled to, because the new timeline's board is the earliest
        one waiting for a move. Your opponent then has to answer on that new board, which is why a well-timed jump into the past can be a
        powerful attack or a desperate defence.
      </p>

      <h2>Jumps between timelines</h2>
      <p>
        Timelines are a dimension too. A piece can move "up" or "down" between neighbouring timelines exactly as it moves along a file. If it
        lands on the end board of another timeline, no new timeline is created: the piece simply leaves its own board and arrives on the other
        one, and both timelines advance by one board. Moving onto any board that is not a timeline's end board, whether in the past of your own
        timeline or of another one, creates a new branch.
      </p>

      <h2 id="g-active">Active and inactive timelines</h2>
      <p>
        A player may have at most one more active timeline than their opponent. If you branch again while you are already a timeline ahead, the
        extra timeline is inactive: its arrow is drawn in your colour instead of purple, and it does not count towards The Present, so nobody is
        forced to move on it. As soon as your opponent creates a timeline of their own, one of your inactive timelines becomes active again.
      </p>
      <p>
        The two circles on The Present show where each player's next timeline will appear. A purple arrow inside a circle means that player's next
        branch would be active; an empty circle means it would be inactive.
      </p>

      <h2 id="g-pieces">How the pieces move</h2>
      <p>
        There are four directions of movement, called axes: files (left and right on a board), ranks (up and down on a board), timelines (between
        rows of boards) and turns (back in time along a timeline; there is no moving into the future, because the future has not happened yet).
        Pieces that slide stop when they hit a piece, and they capture enemy pieces as usual, on any board they can reach.
      </p>
      <h3>Rook</h3>
      <p>Moves any distance along exactly one axis: along a rank or file, straight across timelines, or straight back in time.</p>
      <h3>Bishop</h3>
      <p>
        Moves any distance along exactly two axes at once, the same number of steps on each. On a single board that is the usual diagonal; it can
        also go, for example, one square along a file and one turn back, or one timeline over and one rank up, per step.
      </p>
      <h3>Queen</h3>
      <p>Moves any distance in a straight line using any number of axes, the same number of steps on each. It combines the rook, bishop, unicorn and dragon.</p>
      <h3>King</h3>
      <p>Moves one step in any combination of axes. Kings are royal: they can be checked, and losing every way to protect them is checkmate.</p>
      <h3>Knight</h3>
      <p>Jumps two steps along one axis and one step along another, on any pair of axes, leaping over anything in between. For example: two turns back and one square sideways.</p>
      <h3>Pawn</h3>
      <p>
        On its board a pawn moves as usual: one square forward, two from its starting square, capturing one square diagonally forward. It can also
        move one timeline forward (two if it has not moved yet) onto the same square of a neighbouring timeline's board, if that square is empty.
        For White, forward across timelines is towards Black's timelines, and for Black towards White's. A pawn also captures one timeline forward
        combined with one turn forward or back, on the same square. Pawns never move back in time on their own.
      </p>
      <h3>Unicorn</h3>
      <p>Moves any distance along exactly three axes at once, the same number of steps on each.</p>
      <h3>Dragon</h3>
      <p>Moves any distance along all four axes at once, the same number of steps on each.</p>
      <h3>Princess</h3>
      <p>Moves as a rook or a bishop: any distance along one axis, or along two axes equally.</p>
      <h3>Brawn</h3>
      <p>
        A sturdier pawn. It moves exactly like a pawn and has all of the pawn's captures. It can also capture one timeline forward combined with
        one step sideways or forward on the board, and one turn back combined with one step forward.
      </p>
      <h3>Common king</h3>
      <p>Moves exactly like a king but is not royal: it can be captured like any other piece, and it cannot be checked.</p>
      <h3>Royal queen</h3>
      <p>Moves like a queen but is royal, like a king: it can be checked and checkmated. A side may have more than one royal piece, and all of them must be kept safe.</p>

      <h2 id="g-check">Check from other boards</h2>
      <p>
        A king is in check when any enemy piece standing on a board where it is the enemy's move could capture it, whether by an ordinary move on
        the same board, by travelling back in time, or by jumping across timelines. This includes kings on past boards: if a piece could travel
        back to a square where your king stood in the past, that counts as check, because capturing a king anywhere in history would win the game.
      </p>
      <p>
        You may make tentative moves that leave you in check, but you cannot submit them. Red arrows show every attack on your kings. Since history
        cannot be altered, an attack on a past king cannot be blocked on the old board; usually the attacking piece must be captured, or the
        attack must be made harmless in some other way.
      </p>

      <h2>Checkmate and stalemate</h2>
      <p>
        If a player cannot complete a turn, that is, cannot make moves that shift The Present to the opponent without leaving one of their royal
        pieces attacked, the game ends. If one of their royal pieces is attacked at the start of that turn, it is checkmate and they lose. If not,
        it is stalemate and the game is a draw.
      </p>
      <p>The game can also end by resignation (Forfeit game in the * menu), by agreeing a draw in online games, or on time when a clock is used.</p>

      <h2 id="g-special">Castling, en passant and promotion</h2>
      <p>
        <b>Castling</b> works as usual on a single board: the king moves two squares towards an unmoved rook on the same rank, and the rook jumps
        over to the square the king passed. Neither piece may have moved, the squares between them must be empty, and the king may not castle out
        of, through or into check, where check counts attacks from every board of the multiverse.
      </p>
      <p>
        <b>En passant</b> is possible only on a single board: if an enemy pawn has just advanced two squares and landed beside your pawn, your pawn
        may capture it as if it had moved one square, on the very next board.
      </p>
      <p>
        <b>Promotion:</b> a pawn or brawn that reaches the last rank of its board becomes a queen.
      </p>

      <h2>Clocks</h2>
      <p>
        Timed games use the original's time controls: Short (10+3/L), Medium (20+5/L) and Long (40+8/L). The first number is your main time in
        minutes. At the start of each turn you also get a delay of the second number of seconds for every active timeline, shown as +N next to your
        clock. The delay runs down first, and only then does your main time start to tick. Unused delay is lost. If your main time runs out, you
        lose on time.
      </p>

      <h2 id="g-controls">Controls</h2>
      <h3>The screen</h3>
      <ul>
        <li>Top centre: Undo Move (or Deselect while a piece is selected) and Submit Moves. When the game is over, Submit Moves turns into Finish Game.</li>
        <li>Right edge, from the top: the * game menu, the round time-travel animation button, History View, Parallel View, Flip Persp. and the board cycle button.</li>
        <li>The round button shows a blue swirl when it is on: your next move through time then plays the full time-travel animation, and the button switches itself off. Click it (or press <kbd>I</kbd>) to turn it on again.</li>
        <li>History View and Parallel View turn the camera into a 3D view where the boards stand up like cards: History View looks back along time, so the boards of each timeline line up one behind the other; Parallel View looks across the timelines, so boards of the same turn line up. Click the green tab again to return to the flat view. The green buttons next to a selected piece's board do the same.</li>
        <li>Flip Persp. turns the view around. In local games the view flips to the player to move after each submit; you can turn this off in the settings.</li>
        <li>Bottom left: whose turn it is. Top left: the clocks, when the game is timed.</li>
        <li>Drag to pan, scroll or pinch to zoom.</li>
      </ul>
      <h3>Hotkeys</h3>
      <ul>
        <li>Select a piece or make a move: left click. Put the piece down: right click or <kbd>Esc</kbd>.</li>
        <li>Undo: <kbd>Backspace</kbd>, <kbd>Z</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd>.</li>
        <li>Submit: <kbd>Enter</kbd> or <kbd>F</kbd>.</li>
        <li>Cycle through the boards you can play on: <kbd>Tab</kbd>.</li>
        <li>Pan the camera: <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys. Zoom: <kbd>E</kbd> and <kbd>Q</kbd>, or scroll.</li>
        <li>History View: <kbd>T</kbd>. Parallel View: <kbd>Y</kbd>. Flip perspective: <kbd>U</kbd>. Time-travel animation on: <kbd>I</kbd>.</li>
      </ul>

      <h2>Playing online</h2>
      <p>
        Choose Online, pick a variant, your colour and a time control, and press Create Game. You get a six-character code and a link to send to
        your opponent; the game starts as soon as they join with the code or open the link. If you close the page or lose your connection, open the
        game again from the Rejoin list (or just reload the page) and you will be back in your seat. Draw offers, forfeits and rematches are in the
        * menu and on the end-of-game card.
      </p>
    </article>
  )
}
