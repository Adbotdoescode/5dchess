# Reference: blog post on 5D chess movement, board, move order and checkmate

**Not a source of truth.** This is a fan-written guide supplied by the project owner as helpful background only; it may
contain mistakes. The original game's actual behaviour is the only authority (established from the Steam guide,
footage/screenshots of the real game, community rule references, and the reference engine). Treat every claim below
as a hypothesis to verify. Kept verbatim; see "Coordinator notes" at the end.

---

## I. How chess pieces move in additional dimensions

I will try to explain the movement of pieces pretending there are only three regular dimensions we are all familiar with. For simplicity, let's imagine that the game is played on 8x8x8 solid cube.

The rook moves an arbitrary number of spaces provided no space in the way is occupied. In two dimensions, the rook has 4 ways to move: left, right, up, and down. In three dimensions, the rook has 6 ways to move: left, right, up, down, forwards and backwards. In four dimensions, the rook has 8 ways to move and so on.

The bishop moves in arbitrary number of spaces diagonally in a two-dimensional coordinate plane provided no space in the way is occupied. In three dimensions, the bishop has 12 ways to move: up+left, up+right, down+left, down+right, forward+up, forward+down, backward+up, backward+down, forward+left, forward-right, backward-left, backward-right. In four dimensions, bishop has 24 ways to move, making him extremely powerful. Look at https://www.chessvariants.com/3d.dir/3d5.html for visual illustration of three-dimensional bishop's moves.

The queen moves in arbitrary number of spaces along any line provided no space in the way is occupied. In three dimensions, the queen has 26 ways to move. Of these 26 ways, 6 are the moves of the rook, 12 are the moves of the bishop, and 8 are true spatial diagonals: forward+up+right, forward+up+left, forward+down+right, forward+down+left, backward+up+right, backward+up+left, backward+down+right, backward+down+left. In four dimensions, the queen has 80 ways to move. Look at https://www.chessvariants.com/3d.dir/3d5.html for visual illustration of three-dimensional queen's moves.

The king moves like a queen but only one space per turn. The king therefore has 26 possible moves in three dimensions and 80 possible moves in four dimensions.

The knight moves two spaces in one coordinate direction and one space in another coordinate direction. In two dimensions, knight has 8 moves. In three dimensions, knight has 24 moves. In the notation of https://www.chessvariants.com/3d.dir/3d5.html, these moves from Cc3 are: Ac4, Ab3, Ad3, Ac2, Bc5, Ba3, Be3, Bc1, Cb5, Cd5, Ca4, Ce4, Ca2, Cb2, Cb1, Cd1, Dc5, Da3, De3, Dc1, Ec4, Eb3, Ed3, Ec2. In four dimensions, knight has 48 moves.

The pawn is the only piece in chess whose moves make a distinction between directions. Here I will just say what are the pawn's moves in 5D Chess with multiverse time travel assuming you know how the board works (see section II for details). A regular pawn move consists of a single step forward either vertically or through timelines. A pawn capture consists of a single forward bishop step with no backwards direction. That is, a pawn on c3-4-1 can capture on b4-4-1, d4-4-1, c3-3-0, c3-5-0, c4-3-1, c4-5-1, b3-4-0 and d3-4-0 (hopefully, please try checking all these possibilities and tell me if something's not right).

## II. Board and dimensions in 5D Chess with multiverse time travel

5D Chess with multiverse time travel is played on a four-dimensional board, 8 spaces wide in two of the dimensions and potentially infinite in another two dimensions, as new spaces are created during gameplay.

A space in 5D Chess with multiverse time travel has four coordinates. Two spatial coordinates works as they do in regular chess and will be denoted in the same way: horizontal by letters a through h, vertical by digits 1 through 8. The third coordinate is time, which is measured in turns. The fourth coordinate is the timeline number. Therefore d4-11-3 denotes a d4 space on the 11th turn in the timeline number 3. Note that whenever you create the next timeline, it appears at the lowermost part of the screen while whenever your opponent creates the next timeline, to you it will appear at the uppermost part of the screen. For this reason we give the central timeline the number 0, the timelines to the the bottom (assuming you are playing white) the numbers 1,2,3 and so on, the timelines to the top (assuming you are playing white) the numbers -1,-2,-3 and so on.

Let me explain how this four-dimensional picture is displayed on your two-dimensional screen. Originally the game displays a single chessboard, whose spaces are denoted a1-1-0 through h8-1-0. After you make your first move, the resulting position is displayed on a separate chessboard to the right. Be aware that this chessboard is not part of the game's active space yet because the turn is incomplete. After your opponent replies, the resulting position is displayed on the third chessboard to the right. Now the first turn on the first timeline is complete, and this third chessboard is the plane corresponding to the second move on the first timeline, hence its spaces are a1-2-0 through h8-2-0. In the Northernlion's video https://www.youtube.com/watch?v=tWj3VBgf3b4#t=13m7s , he, playing as white, decided to move a queen on d1-7-0 through time four turns into the past, clicking on the h5-3-0. This is when a second timeline is created, so after the black had replied, the queen actually arrives at h5-4-1.

Now you can see all four dimensions represented visually. Let us call these little chessboards planes. Every plane in itself is two-dimensional 8 by 8 square, but each plane can also have planes adjacent to it. Dimensions inside a given plane are spatial dimensions, and dimensions displayed on a larger scale are two temporal dimensions. Planes to the left are located in the past, planes to the right are located in the future, planes in the upper part of the screen belong to an earlier timeline and planes in the lower part of the screen belong to a later timeline.

As I said before, the knight and bishop in multidimensional chess move only in two dimensions at a time. The choice of this two dimensions can be arbitrary, so the knight and bishop can move in four different ways: a) normally; b) in one spatial direction and in time; c) in one spatial direction and travelling through timelines staying in the same point in time; d) moving in time and to a different timeline.

For example, at 14:02 of Northernlion's video you can see that Bf1-4-0 is a valid move. That is because bishop is using mode d), moving from f1-3-1 one step to the right in time (i.e. to the future) and one step up in time (i.e. to the earlier timeline). At 14:39 you can see that the white queen has valid moves in all four possible combinations.

## III. The order of moves in 5D Chess with multiverse time travel

A valid move in 5D Chess with multiverse time travel typically consists of a multiple chess moves across different timelines. Each timeline respects the order of moves borrowed from regular chess. In the original timeline, white move first, black second. In the timeline triggered by white's time travel move, black move first and vice versa.

A present turn (indicate by the large white/black arrow through the center of the screen) is the earliest turn among all the end turns from timelines in play. For example, if the first time travel move happens to be from turn 7 to turn 3, then the present turn shifts from turn 7 to turn 3. But a time travel move from turn 14 to turn 12 will not affect what the present turn is if there is a timeline in play which only lasts up to turn 9. Similarly, the present is unaffected by time travels to the future.

In order to complete your turn, you have to make a move on each active plane of your color located in the present. You can make moves on the planes that are located in the future, but it is optional. You can use up a turn on an active plane by either moving a piece in it or moving a piece onto it, so if you have two adjacent active planes, for example, and you move a piece from one to the other, your move is completely done.

A time travel move is what looks like putting your piece on an inactive plane. In reality, the position on inactive planes can never be changed, so instead a time travel moves trigger a new timeline, with the position on that timeline copying the position on an incative board you appear to move into with the addition of the piece that appears to have moved into it (and, if it looks like a capture, without the piece that is apparently captured).

In the Northernlion's video, clicking at h5-3-0 triggers a new timeline. As it was triggered by white, it receives the number 1. As the queen is arriving at the space located on the third turn, the new timeline starts its existence on the fourth turn after the black reply to the white queen's arrival. We can the therefore denote the resulting move by Qh5-3-1.

Note that if you created a new timeline, then to you it appears to be created at the very back, and if your opponent created a timeline, then it appears to you to be created at the forwardmost line. This distinction matters, because pawns can perform interdimensional moves only one timeline forward.

## IV. Checkmate

An important consequence of branching timelines is that you can apparently create an infinite array of fresh kings, queens, rooks, bishops, knights and pawns for yourself, at the cost of your opponent receiving a handful of them also. If you have three timelines in play, you have three kings, and you are not allowed for any of them to be captured (checkmated). However, you can reply to an apparent checkmate in one of the timelines by sending your king to another one (or to the past, branching yet another timeline). The fact that there is no more king in one of the timelines has no consequences for gameplay, because all the timelines are inseparable parts of an integral four-dimensional chessboard.

How does the checking king in the past thing works? Let me use an example of Rook Tactics I. Re5-5-0 is a check because a rook on e5-5-0 has an apparently valid e5-2-0 move, where the past version of the black king resides. No matter what the black do, after a single turn, white rook on what is now e5-6-0 still would have the freedom to travel 4 turns in the past, branching the timeline where the black king is immediately captured. We would then have two active timeline with only one black king survived, meaning that the black failed to protect one of their kings.

---

## Coordinator notes (how this maps onto our codebase)

- The blog's notation `d4-11-3` = square d4, turn T=11, timeline l=3. Ours: `{x:3, y:3, t: 2*11 + (black?1:0), l: 3}`.
- Timeline numbering matches ours: main = 0, timelines created by white are +1, +2, ... and are drawn BELOW the main line when viewing as white; black's are -1, -2, ... drawn ABOVE. Flipping perspective (playing black) mirrors this, so each player sees their own new timelines at the bottom.
- "Forward" for a pawn through timelines means towards the opponent's side of the timeline stack (white: towards negative l; black: towards positive l).
- Pawn captures: the blog author was unsure. The Steam guide states pawns capture diagonally through timelines landing on the same square, which means a forward-timeline step combined with a ±1 time step (plus the normal spatial diagonal captures). The extra combinations the blog lists (forward-rank with a time step; forward-timeline with a file step) are NOT confirmed. The engine follows the original game, cross-checked against the reference engine and community sources.
- Direction counts in 4D (open board, all neighbouring boards existing) are useful test invariants: rook 8 directions, bishop 24, queen 80, king 80 one-step targets, knight 48 targets, unicorn (3-axis triagonals) 32, dragon (4-axis quadragonals) 16.
- Checks include attacks on royal pieces sitting on PAST (non-playable) boards: a piece that could time-travel onto a past board's king square gives check (blog's Rook Tactics I example: Re5-5-0 checks the king on e5-2-0).
- Move order: a new timeline created by white's travel starts with a black-to-move board (and vice versa).
- Tentative boards: after a move, the resulting board appears to the right before Submit, but it is not part of the committed position until the action is submitted.
