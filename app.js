// Solitaire (Pip-Boy holotape)
// Classic Klondike Solitaire, single player.
(function() {
  const C = {
    CARD_W: 42,
    CARD_H: 60,
    STOCK_X: 18,
    WASTE_X: 84,
    FOUND_X: 228,
    ROW1_Y: 34,
    FOUND_SPACING: 60,
    TAB_X: 18,
    TAB_Y: 145,
    TAB_SPACING: 66,
    FD_OFF: 8,
    FU_OFF: 18,
  };
  const STATES = { TITLE: 0, PLAY: 1, WIN: 2 };
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  // Screen slot (0-3, left to right among the four Foundation piles) -> suit
  // index (0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades). Matches the reference
  // layout: Hearts, Clubs, Diamonds, Spades.
  const FOUND_SLOT_SUIT = [2, 0, 1, 3];

  // Pile index scheme used for cursorPile / held.from throughout:
  // 0 = Stock, 1 = Waste, 2-5 = Foundations (screen slots 0-3),
  // 6-12 = Tableau columns 0-6.

  let tableau, tabDown, stock, waste, foundations, held, cursorPile, grabDepth;
  let gameState, redrawInterval, winInterval, winQueue, winIdx, bouncer;

  // --- Deck & cards ---
  // Cards are ints 0-51: rank = c % 13 (0=A..12=K), suit = (c/13)|0.

  function buildDeck() {
    let d = [];
    for (let i = 0; i < 52; i++) d.push(i);
    for (let i = d.length - 1; i > 0; i--) {
      let j = Math.randInt(i + 1);
      let t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  function rankIdx(c) { return c % 13; }
  function suitIdx(c) { return (c / 13) | 0; }
  function rank1(c) { return rankIdx(c) + 1; } // Ace=1 .. King=13 (low Ace, for Foundations/Tableau order)
  function isRed(c) { let s = suitIdx(c); return s === 1 || s === 2; }

  // --- Solitaire game logic ---

  function initGame() {
    tableau = [[], [], [], [], [], [], []];
    tabDown = [0, 0, 0, 0, 0, 0, 0];
    stock = [];
    waste = [];
    foundations = [0, 0, 0, 0];
    held = null;
    cursorPile = 0;
    grabDepth = 1;
    gameState = STATES.TITLE;
  }

  // Deals a fresh game: seven Tableau columns of 1-7 cards (last card of
  // each face up, the rest face down), remaining 24 cards form the Stock.
  function dealGame() {
    let d = buildDeck();
    tableau = [[], [], [], [], [], [], []];
    tabDown = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j <= i; j++) tableau[i].push(d.pop());
      tabDown[i] = i;
    }
    stock = d;
    waste = [];
    foundations = [0, 0, 0, 0];
    held = null;
    cursorPile = 0;
    grabDepth = 1;
    gameState = STATES.PLAY;
  }

  function restartGame() {
    if (winInterval) { clearInterval(winInterval); winInterval = undefined; }
    dealGame();
  }

  // Draw one card at a time from the Stock to the Waste; once the Stock is
  // exhausted, reshuffle the Waste back into a new Stock.
  function drawFromStock() {
    if (stock.length) waste.push(stock.pop());
    else if (waste.length) { stock = waste.reverse(); waste = []; }
  }

  function pickUp(p) {
    if (p === 1) {
      if (waste.length) held = { from: 1, count: 1 };
    } else if (p >= 2 && p < 6) {
      let suit = FOUND_SLOT_SUIT[p - 2];
      if (foundations[suit] > 0) held = { from: p, count: 1 };
    } else if (p >= 6) {
      let i = p - 6, up = tableau[i].length - tabDown[i];
      if (up > 0) held = { from: p, count: Math.min(grabDepth, up) };
    }
  }

  function sourceCards(from, count) {
    if (from === 1) return [waste[waste.length - 1]];
    if (from >= 2 && from < 6) {
      let suit = FOUND_SLOT_SUIT[from - 2];
      return [suit * 13 + (foundations[suit] - 1)];
    }
    let i = from - 6, n = tableau[i].length;
    return tableau[i].slice(n - count);
  }

  function removeHeld() {
    let from = held.from, count = held.count;
    if (from === 1) { waste.pop(); }
    else if (from >= 2 && from < 6) {
      let suit = FOUND_SLOT_SUIT[from - 2];
      foundations[suit] -= count;
    } else {
      let i = from - 6, n = tableau[i].length;
      tableau[i].splice(n - count, count);
      if (tableau[i].length === tabDown[i] && tabDown[i] > 0) tabDown[i] -= 1;
    }
  }

  function placeCards(p, cards) {
    if (p >= 2 && p < 6) {
      let suit = FOUND_SLOT_SUIT[p - 2];
      foundations[suit] += cards.length;
    } else {
      let i = p - 6;
      for (let k = 0; k < cards.length; k++) tableau[i].push(cards[k]);
    }
  }

  // Foundation rule: next rank up, same suit. Tableau rule: one rank down,
  // opposite color; only a King (or a run starting with one) onto a space.
  function tryPlace(p) {
    let cards = sourceCards(held.from, held.count);
    let ok = false;
    if (p >= 2 && p < 6) {
      let suit = FOUND_SLOT_SUIT[p - 2];
      if (held.count === 1 && suitIdx(cards[0]) === suit && rank1(cards[0]) === foundations[suit] + 1) ok = true;
    } else if (p >= 6) {
      let i = p - 6, n = tableau[i].length;
      if (n === 0) { if (rank1(cards[0]) === 13) ok = true; }
      else {
        let top = tableau[i][n - 1];
        if (rank1(top) === rank1(cards[0]) + 1 && isRed(top) !== isRed(cards[0])) ok = true;
      }
    }
    if (ok) { removeHeld(); placeCards(p, cards); checkWin(); }
    held = null;
  }

  function checkWin() {
    if (foundations[0] === 13 && foundations[1] === 13 && foundations[2] === 13 && foundations[3] === 13) enterWin();
  }

  function moveCursor(dir) {
    cursorPile = (cursorPile + dir + 13) % 13;
    grabDepth = 1;
  }

  function adjustDepth(dir) {
    let i = cursorPile - 6, up = tableau[i].length - tabDown[i];
    if (up < 1) up = 1;
    grabDepth = E.clip(grabDepth + dir, 1, up);
  }

  function pressAction() {
    if (gameState === STATES.TITLE) { dealGame(); Pip.playSound('TAB'); drawAll(); return; }
    if (gameState === STATES.WIN) { restartGame(); Pip.playSound('TAB'); drawAll(); return; }
    if (cursorPile === 0) {
      if (held) held = null; else drawFromStock();
    } else if (held === null) {
      pickUp(cursorPile);
    } else if (held.from === cursorPile) {
      held = null;
    } else {
      tryPlace(cursorPile);
    }
    Pip.playSound('TAB');
    if (gameState !== STATES.WIN) drawAll();
  }

  // --- Win animation ---
  // Once every Foundation is complete, cards pop off the Foundations one at
  // a time and bounce around the screen like the classic Windows Solitaire
  // victory animation. Nothing is ever cleared while this plays, so each
  // card's bounce path stays on screen and the next card bounces over it.

  function buildWinQueue() {
    let f = [foundations[0], foundations[1], foundations[2], foundations[3]];
    let q = [], more = true;
    while (more) {
      more = false;
      for (let s = 0; s < 4; s++) {
        if (f[s] > 0) { q.push(s * 13 + (f[s] - 1)); f[s]--; more = true; }
      }
    }
    return q;
  }

  function slotForSuit(s) {
    for (let j = 0; j < 4; j++) if (FOUND_SLOT_SUIT[j] === s) return j;
    return 0;
  }

  function enterWin() {
    gameState = STATES.WIN;
    winQueue = buildWinQueue();
    winIdx = 0;
    bouncer = null;
    drawAll();
    winInterval = setInterval(winTick, 40);
  }

  function winTick() { "ram";
    if (!bouncer) {
      if (winIdx >= winQueue.length) { clearInterval(winInterval); winInterval = undefined; return; }
      let card = winQueue[winIdx++], slot = slotForSuit(suitIdx(card));
      bouncer = {
        card: card,
        x: C.FOUND_X + slot * C.FOUND_SPACING + C.CARD_W / 2,
        y: C.ROW1_Y + C.CARD_H / 2,
        vx: (Math.randInt(7) - 3) || 2,
        vy: -2 - Math.randInt(3),
        b: 0,
      };
    }
    bouncer.vy += 0.6;
    bouncer.x += bouncer.vx;
    bouncer.y += bouncer.vy;
    if (bouncer.y + C.CARD_H / 2 > 320) { bouncer.y = 320 - C.CARD_H / 2; bouncer.vy = -bouncer.vy * 0.7; bouncer.b++; }
    if (bouncer.x - C.CARD_W / 2 < 0) { bouncer.x = C.CARD_W / 2; bouncer.vx = -bouncer.vx * 0.8; }
    if (bouncer.x + C.CARD_W / 2 > 480) { bouncer.x = 480 - C.CARD_W / 2; bouncer.vx = -bouncer.vx * 0.8; }
    drawCardFace(bouncer.card, bouncer.x - C.CARD_W / 2, bouncer.y - C.CARD_H / 2, true);
    drawWinBox();
    h.flip();
    Pip.lastFlip = getTime();
    if (bouncer.b >= 5) bouncer = null;
  }

  // --- Drawing ---

  // Suit vector art - each built from filled circles + a polygon point/stem.
  function drawHeart(cx, cy, r) {
    h.fillCircle(cx - r * 0.5, cy - r * 0.3, r * 0.5);
    h.fillCircle(cx + r * 0.5, cy - r * 0.3, r * 0.5);
    h.fillPoly([cx - r, cy - r * 0.1, cx + r, cy - r * 0.1, cx, cy + r]);
  }

  function drawSpade(cx, cy, r) {
    h.fillCircle(cx - r * 0.5, cy + r * 0.3, r * 0.5);
    h.fillCircle(cx + r * 0.5, cy + r * 0.3, r * 0.5);
    h.fillPoly([cx - r, cy + r * 0.1, cx + r, cy + r * 0.1, cx, cy - r]);
    h.fillPoly([cx - r * 0.3, cy + r * 0.3, cx + r * 0.3, cy + r * 0.3, cx, cy + r * 1.15]);
  }

  function drawDiamond(cx, cy, r) {
    h.fillPoly([cx, cy - r, cx + r * 0.65, cy, cx, cy + r, cx - r * 0.65, cy]);
  }

  function drawClub(cx, cy, r) {
    h.fillCircle(cx, cy - r * 0.45, r * 0.5);
    h.fillCircle(cx - r * 0.45, cy + r * 0.15, r * 0.5);
    h.fillCircle(cx + r * 0.45, cy + r * 0.15, r * 0.5);
    h.fillPoly([cx - r * 0.3, cy + r * 0.15, cx + r * 0.3, cy + r * 0.15, cx, cy + r * 1.1]);
  }

  // Dispatches to the vector art above by suit index (0=C,1=D,2=H,3=S).
  // Deliberately an if/else chain rather than an array of functions.
  function drawSuitIcon(s, cx, cy, r) {
    if (s === 0) drawClub(cx, cy, r);
    else if (s === 1) drawDiamond(cx, cy, r);
    else if (s === 2) drawHeart(cx, cy, r);
    else drawSpade(cx, cy, r);
  }

  // Card back: setColor(1) fill stands in for the example art's red, and
  // setColor(2) squares stand in for the example art's white lattice.
  function drawCardBack(x, y) {
    h.setColor(1).fillRect(x, y, x + C.CARD_W, y + C.CARD_H);
    h.setColor(0).drawRect(x, y, x + C.CARD_W, y + C.CARD_H);
    h.setColor(2);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        let px = x + 6 + c * 11, py = y + 6 + r * 13;
        h.fillRect(px, py, px + 5, py + 5);
      }
    }
  }

  // Card front: rank + small suit icon in the corner are always drawn so a
  // cascaded card is still identifiable; the big center suit icon is only
  // drawn when `big` is true (the frontmost/topmost card of a stack).
  function drawCardFace(card, x, y, big) {
    let s = suitIdx(card), col = (s === 1 || s === 2) ? 1 : 0;
    h.setColor(2).fillRect(x, y, x + C.CARD_W, y + C.CARD_H);
    h.setColor(0).drawRect(x, y, x + C.CARD_W, y + C.CARD_H);
    h.setColor(col).setFontMonofonto14().setFontAlign(-1, -1);
    let rt = RANKS[rankIdx(card)];
    h.drawString(rt, x + 3, y + 3);
    drawSuitIcon(s, x + 5 + h.stringWidth(rt) + 6, y + 10, 6);
    if (big) drawSuitIcon(s, x + C.CARD_W / 2, y + C.CARD_H / 2 + 4, 13);
  }

  function drawEmptySlot(x, y, suitHint) {
    h.setColor(2).drawRect(x, y, x + C.CARD_W, y + C.CARD_H);
    if (suitHint >= 0) { h.setColor(2); drawSuitIcon(suitHint, x + C.CARD_W / 2, y + C.CARD_H / 2 + 4, 13); }
  }

  // Adaptive vertical layout for a Tableau column: face-down cards peek by
  // FD_OFF, face-up cards peek by FU_OFF, scaled down together if the
  // column would otherwise run off the bottom of the screen.
  function layoutColumn(i) {
    let n = tableau[i].length, ys = [C.TAB_Y];
    let avail = 320 - 16 - C.TAB_Y - C.CARD_H;
    let total = 0;
    for (let k = 1; k < n; k++) total += (k < tabDown[i]) ? C.FD_OFF : C.FU_OFF;
    let scale = (total > avail && total > 0) ? avail / total : 1;
    let y = C.TAB_Y;
    for (let k = 1; k < n; k++) {
      y += ((k < tabDown[i]) ? C.FD_OFF : C.FU_OFF) * scale;
      ys.push(y);
    }
    return ys;
  }

  // Bounding box for pile p, considering `depth` cards grabbed together as
  // a unit (only meaningful for Tableau piles; ignored elsewhere).
  function topBox(p, depth) {
    if (p === 0) return [C.STOCK_X, C.ROW1_Y, C.STOCK_X + C.CARD_W, C.ROW1_Y + C.CARD_H];
    if (p === 1) return [C.WASTE_X, C.ROW1_Y, C.WASTE_X + C.CARD_W, C.ROW1_Y + C.CARD_H];
    if (p < 6) {
      let x = C.FOUND_X + (p - 2) * C.FOUND_SPACING;
      return [x, C.ROW1_Y, x + C.CARD_W, C.ROW1_Y + C.CARD_H];
    }
    let i = p - 6, x = C.TAB_X + i * C.TAB_SPACING, n = tableau[i].length;
    if (n === 0) return [x, C.TAB_Y, x + C.CARD_W, C.TAB_Y + C.CARD_H];
    let ys = layoutColumn(i);
    let up = n - tabDown[i];
    let d = depth < 1 ? 1 : depth;
    let cap = up > 0 ? up : 1;
    if (d > cap) d = cap;
    let startIdx = n - d;
    if (startIdx < 0) startIdx = 0;
    return [x, ys[startIdx], x + C.CARD_W, ys[n - 1] + C.CARD_H];
  }

  function drawCursor() {
    let depth = (cursorPile >= 6 && held === null) ? grabDepth : 1;
    let box = topBox(cursorPile, depth);
    h.setColor(3).drawRect(box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2);
  }

  function drawHeld() {
    if (!held) return;
    let box = topBox(held.from, held.count);
    Pip.shadeBox(box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2);
  }

  function hintText() {
    if (gameState === STATES.WIN) return 'PRESS TO PLAY AGAIN';
    if (held) return (held.from === cursorPile) ? 'PRESS: CANCEL' : 'PRESS: PLACE HERE';
    if (cursorPile === 0) return stock.length ? 'PRESS: DRAW CARD' : (waste.length ? 'PRESS: RESHUFFLE' : 'STOCK EMPTY');
    if (cursorPile >= 6 && grabDepth > 1) return 'PRESS: PICK UP ' + grabDepth;
    return 'PRESS: PICK UP';
  }

  function drawTitleScreen() {
    h.setColor(2);
    drawSpade(65, 85, 25);
    drawHeart(415, 85, 25);
    drawDiamond(65, 235, 25);
    drawClub(415, 235, 25);
    h.setColor(3).setFontMonofonto36().setFontAlign(0, 0).drawString('SOLITAIRE', 240, 120);
    h.setColor(2).setFontMonofonto18().setFontAlign(0, 0).drawString('Press the left wheel to play!', 240, 185);
  }

  function drawStock() {
    if (stock.length) drawCardBack(C.STOCK_X, C.ROW1_Y);
    else drawEmptySlot(C.STOCK_X, C.ROW1_Y, -1);
  }

  function drawWaste() {
    if (waste.length) drawCardFace(waste[waste.length - 1], C.WASTE_X, C.ROW1_Y, true);
    else drawEmptySlot(C.WASTE_X, C.ROW1_Y, -1);
  }

  function drawFoundations() {
    for (let j = 0; j < 4; j++) {
      let x = C.FOUND_X + j * C.FOUND_SPACING, suit = FOUND_SLOT_SUIT[j];
      if (foundations[suit] > 0) drawCardFace(suit * 13 + (foundations[suit] - 1), x, C.ROW1_Y, true);
      else drawEmptySlot(x, C.ROW1_Y, suit);
    }
  }

  function drawTableau() {
    for (let i = 0; i < 7; i++) {
      let col = tableau[i], n = col.length, x = C.TAB_X + i * C.TAB_SPACING;
      if (n === 0) { drawEmptySlot(x, C.TAB_Y, -1); continue; }
      let ys = layoutColumn(i);
      for (let k = 0; k < n; k++) {
        if (k < tabDown[i]) drawCardBack(x, ys[k]);
        else drawCardFace(col[k], x, ys[k], k === n - 1);
      }
    }
  }

  function drawPlayScreen() {
    h.setColor(2).setFontMonofonto14().setFontAlign(-1, -1).drawString('DECK: ' + stock.length, C.STOCK_X, C.ROW1_Y - 16);
    drawStock();
    drawWaste();
    drawFoundations();
    drawTableau();
    if (gameState === STATES.PLAY) { drawCursor(); drawHeld(); }
    h.setColor(2).setFontMonofonto14().setFontAlign(0, 0).drawString(hintText(), 240, 308);
  }

  // 3px outline (three nested rects) in color3, color0 fill, color3 text -
  // drawn fresh on top of every animation frame so it always stays visible.
  function drawWinBox() {
    h.setFontMonofonto36();
    let tw = h.stringWidth('YOU WIN!!!');
    let x1 = 240 - tw / 2 - 20, x2 = 240 + tw / 2 + 20, y1 = 120, y2 = 200;
    h.setColor(0).fillRect(x1, y1, x2, y2);
    h.setColor(3);
    h.drawRect(x1, y1, x2, y2);
    h.drawRect(x1 + 1, y1 + 1, x2 - 1, y2 - 1);
    h.drawRect(x1 + 2, y1 + 2, x2 - 2, y2 - 2);
    h.setFontAlign(0, 0).drawString('YOU WIN!!!', 240, 160);
  }

  function drawAll() { "ram";
    h.clear(1);
    if (gameState === STATES.TITLE) drawTitleScreen();
    else drawPlayScreen();
    if (gameState === STATES.WIN) drawWinBox();
    h.flip();
    Pip.lastFlip = getTime();
  }

  // Slow safety-net redraw, skipped during the win animation so it never
  // clears the bounce trail the animation is deliberately leaving behind.
  function periodicRedraw() { if (gameState !== STATES.WIN) drawAll(); }

  // --- Input ---
  // Title screen: press either wheel to deal a new game.
  // Play: knob1 rotation moves the cursor through the Stock, Waste, the
  // four Foundations, and the seven Tableau columns (wraps around). Knob2
  // rotation adjusts how many face-up Tableau cards are grabbed together as
  // a group when the cursor rests on a Tableau column with nothing picked
  // up yet; otherwise knob2 rotation moves the cursor exactly like knob1.
  // Either knob's press: on the Stock, draws a card to the Waste (or
  // reshuffles the Waste back into the Stock once the Stock is empty);
  // with nothing picked up, picks up the selected card(s) from the Waste,
  // a Foundation, or a Tableau column; pressing again on that same pile
  // cancels the pick-up; pressing on a different pile attempts to place
  // the held card(s) there, following normal Foundation/Tableau rules.
  // Win: press either wheel to deal a fresh game.

  function onKnob1(dir) { "ram";
    if (dir) {
      if (gameState === STATES.PLAY) {
        moveCursor(dir);
        Pip.playSound('SCROLL');
        drawAll();
      }
      return;
    }
    pressAction();
  }

  function onKnob2(dir) { "ram";
    if (dir) {
      if (gameState === STATES.PLAY) {
        if (cursorPile >= 6 && held === null) adjustDepth(dir); else moveCursor(dir);
        Pip.playSound('SCROLL');
        drawAll();
      }
      return;
    }
    pressAction();
  }

  // --- Lifecycle ---

  function start() {
    h.clear();
    Pip.audioStop();
    initGame();

    Pip.onExclusive('knob1', onKnob1);
    Pip.onExclusive('knob2', onKnob2);

    redrawInterval = setInterval(periodicRedraw, 1000);
    drawAll();
  }

  function remove() {
    if (redrawInterval) clearInterval(redrawInterval);
    if (winInterval) clearInterval(winInterval);
    Pip.removeListener('knob1', onKnob1);
    Pip.removeListener('knob2', onKnob2);
    Pip.audioStop();
    h.clear();
    h.flip();
  }

  start();

  return {
    id: 'SOLITAIRE',
    notDefault: true,
    fullscreen: true,
    remove: remove,
  };
});