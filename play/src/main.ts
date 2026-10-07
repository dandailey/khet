import './style.css';
import PlayWorker from './ai-worker.ts?worker&inline';
import { RESERVED, SETUPS, SILVER, toKFEN } from '../../packages/khet-engine/src/index.ts';
import type { Color } from '../../packages/khet-engine/src/index.ts';
import { GameController, moveSquares, rotationMove, squareName } from './controller.ts';
import type { HumanSide } from './controller.ts';
import { PIECE_NAMES, pieceSVG } from './pieces.ts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
const board = element('board');
const laser = document.getElementById('laser')!;
const kfen = element<HTMLTextAreaElement>('kfen');
const cw = element<HTMLButtonElement>('cw'), ccw = element<HTMLButtonElement>('ccw');
const hintButton = element<HTMLButtonElement>('hint'), undoButton = element<HTMLButtonElement>('undo');
const setup = element<HTMLSelectElement>('setup');
setup.replaceChildren(...Object.keys(SETUPS).map(name => new Option(name[0].toUpperCase() + name.slice(1), name)));
element('legend').innerHTML = Object.entries(PIECE_NAMES).map(([type, name]) =>
  `<span class="legend-item">${pieceSVG({ type: Number(type), color: SILVER, o: 0 })}${name}</span>`).join('');

let game = new GameController();
let selected: number | null = null;
let hint: string | null = null;
let activeWorker: Worker | null = null;
let request: { mode: 'move' | 'hint'; started: number } | null = null;
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let aiTimer: ReturnType<typeof setTimeout> | undefined;
let debug = 'depth — · score — · nodes — · pv —';
let fallback = false;
let lastRenderedHistory = -1;
const colorName = (color: Color) => color === SILVER ? 'Silver' : 'Red';

function notice(message: string): void { element('notice').textContent = message; }
function stopSearch(): void {
  activeWorker?.terminate(); activeWorker = null; request = null;
}
function cancelPending(): void {
  stopSearch(); clearTimeout(animationTimer); clearTimeout(aiTimer);
  animationTimer = undefined; aiTimer = undefined;
}
function updateThinking(): void {
  element('thinking').textContent = request
    ? `${request.mode === 'hint' ? 'Finding hint' : 'AI thinking'} · ${((performance.now() - request.started) / 1000).toFixed(1)} s`
    : game.shot ? 'Laser firing…' : fallback ? 'Engine · random fallback' : 'Engine ready';
}
function render(): void {
  const canPlay = game.humanTurn && !request;
  const pieces = game.shot?.pieces ?? game.position.toPieces();
  const bySquare = new Map(pieces.map(piece => [piece.row * 10 + piece.col, piece]));
  const selectedMoves = selected === null ? [] : game.moves.filter(move => moveSquares(move).from === selected);
  const targets = new Map(selectedMoves.filter(move => move.length > 3).map(move => [moveSquares(move).to, move]));
  const hinted = hint ? moveSquares(hint) : null;
  board.replaceChildren(...Array.from({ length: 80 }, (_, sq) => {
    const piece = bySquare.get(sq), button = document.createElement('button');
    const classes = ['square'];
    if ((Math.floor(sq / 10) + sq % 10) % 2 === 0) classes.push('light');
    if (RESERVED[sq] >= 0) classes.push(RESERVED[sq] === SILVER ? 'reserved-silver' : 'reserved-red');
    if (sq === selected) classes.push('selected');
    if (targets.has(sq)) classes.push('target', ...(targets.get(sq)!.includes('x') ? ['swap'] : []));
    if (hinted?.from === sq) classes.push('hint-from');
    if (hinted?.to === sq) classes.push('hint-to');
    if (game.shot?.laser.hit === sq) classes.push('destroyed');
    button.className = classes.join(' '); button.dataset.square = String(sq);
    const description = `${squareName(sq)}${piece ? ` · ${colorName(piece.color)} ${PIECE_NAMES[piece.type]}` : ' · empty'}`;
    button.setAttribute('aria-label', description); button.title = description;
    button.setAttribute('aria-pressed', String(sq === selected));
    button.disabled = !canPlay;
    if (piece) button.innerHTML = pieceSVG(piece);
    return button;
  }));
  laser.replaceChildren();
  if (game.shot) {
    const path = game.shot.laser.path.map(sq => `${(sq % 10) * 100 + 50},${Math.floor(sq / 10) * 100 + 50}`).join(' ');
    for (const className of ['beam-glow', 'beam-core']) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', path); line.setAttribute('class', className);
      line.setAttribute('stroke', game.shot.color === SILVER ? '#89ffdb' : '#ff998b');
      laser.append(line);
    }
  }
  cw.disabled = !canPlay || selected === null || !rotationMove(game.position, selected, true);
  ccw.disabled = !canPlay || selected === null || !rotationMove(game.position, selected, false);
  hintButton.disabled = !canPlay;
  undoButton.disabled = game.undoCount === 0;
  const result = game.shot ? null : game.position.result;
  element('turn').textContent = result === 'draw' ? 'Draw · threefold repetition'
    : result !== null ? `${colorName(result)} wins`
    : `${colorName(game.shot?.color ?? game.position.side)}${game.shot ? ' fires' : ' to move'}`;
  element('turn-dot').classList.toggle('red', (result === 0 || result === 1 ? result : game.shot?.color ?? game.position.side) === 1);
  const last = game.history.at(-1);
  element('last-move').textContent = last ? `${colorName(last.color)} · ${last.move}` : 'Silver moves first';
  element('selection').textContent = hint ? `Hint: ${hint}` : selected !== null
    ? `${PIECE_NAMES[game.position.pieceAt(selected)!.type]} · ${squareName(selected)}`
    : game.shot ? 'Watch the laser' : game.humanTurn ? `Select a ${colorName(game.position.side)} piece` : game.human === 'watch' ? 'AI vs AI · watch mode' : 'Waiting for the engine';
  element('debug').textContent = debug;
  element('move-count').textContent = `${game.history.length} plies`;
  if (lastRenderedHistory !== game.history.length) {
    const moves = element('moves');
    moves.replaceChildren();
    if (!game.history.length) {
      const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No moves yet.'; moves.append(empty);
    }
    for (let i = 0; i < game.history.length; i += 2) {
      const row = document.createElement('div'); row.className = 'move-row';
      const number = document.createElement('span'); number.textContent = String(i / 2 + 1); row.append(number);
      for (const entry of game.history.slice(i, i + 2)) {
        const text = document.createElement('span'); text.textContent = entry.move; text.title = colorName(entry.color);
        text.className = entry === last ? 'latest' : entry.color === 1 ? 'red-move' : ''; row.append(text);
      }
      moves.append(row);
    }
    moves.scrollTop = moves.scrollHeight;
    lastRenderedHistory = game.history.length;
  }
  if (document.activeElement !== kfen) kfen.value = toKFEN(game.position);
  updateThinking();
}
function scheduleAI(): void {
  clearTimeout(aiTimer);
  if (game.aiTurn && !request) aiTimer = setTimeout(() => askAI(false), 60);
}
function play(move: string): void {
  try {
    game.play(move); selected = null; hint = null; render();
    animationTimer = setTimeout(() => { game.finishShot(); render(); scheduleAI(); }, 1200);
  } catch (error) { notice(error instanceof Error ? error.message : String(error)); render(); }
}
function askAI(isHint: boolean): void {
  if (request || (isHint ? !game.humanTurn : !game.aiTurn)) return;
  notice(''); hint = null; selected = null;
  const worker = new PlayWorker(); activeWorker = worker;
  request = { mode: isHint ? 'hint' : 'move', started: performance.now() }; render();
  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (activeWorker !== worker || typeof event.data !== 'string') return;
    const line = event.data;
    if (line.startsWith('info string')) {
      if (line.includes('random legal fallback')) { fallback = true; notice('Search is not implemented in this checkout. Using random legal moves that avoid self-kill when possible.'); }
      else if (line.startsWith('info string error')) notice(line.slice(18));
    } else if (line.startsWith('info ')) {
      debug = line.slice(5); element('debug').textContent = debug;
    } else if (line.startsWith('bestmove ')) {
      const move = line.slice(9).trim(); stopSearch();
      if (!game.moves.includes(move)) { notice(`Engine returned ${move}; no legal move was applied.`); render(); return; }
      if (isHint) { hint = move; selected = moveSquares(move).from; render(); }
      else play(move);
    }
  };
  worker.onerror = event => {
    if (activeWorker !== worker) return;
    stopSearch(); notice(`Engine worker error: ${event.message}`); render();
  };
  worker.postMessage(game.positionCommand());
  worker.postMessage(game.goCommand(isHint));
}

board.addEventListener('click', event => {
  if (!game.humanTurn || request) return;
  const target = (event.target as Element).closest<HTMLButtonElement>('button[data-square]');
  if (!target) return;
  const square = Number(target.dataset.square);
  const move = selected === null ? undefined : game.moves.find(candidate => candidate.length > 3 && moveSquares(candidate).from === selected && moveSquares(candidate).to === square);
  if (move) { notice(''); play(move); return; }
  const piece = game.position.pieceAt(square);
  selected = piece?.color === game.position.side && selected !== square ? square : null;
  hint = null; render();
});
function rotate(clockwise: boolean): void {
  if (!game.humanTurn || request || selected === null) return;
  const move = rotationMove(game.position, selected, clockwise);
  if (move) { notice(''); play(move); }
}
cw.addEventListener('click', () => rotate(true)); ccw.addEventListener('click', () => rotate(false));
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || (event.target as Element).closest('input,textarea,select,[contenteditable]')) return;
  if (event.key.toLowerCase() === 'q' || event.key.toLowerCase() === 'e') {
    event.preventDefault(); rotate(event.key.toLowerCase() === 'e');
  } else if (event.key === 'Escape') { selected = null; hint = null; render(); }
});
hintButton.addEventListener('click', () => askAI(true));
undoButton.addEventListener('click', () => {
  cancelPending(); game.undo(); selected = null; hint = null; notice(''); render(); scheduleAI();
});
element('new-game').addEventListener('submit', event => {
  event.preventDefault(); cancelPending();
  const side = element<HTMLSelectElement>('human').value;
  const human: HumanSide = side === 'watch' ? 'watch' : Number(side) as Color;
  game = new GameController(setup.value, human, Number(element<HTMLSelectElement>('level').value));
  selected = null; hint = null; debug = 'depth — · score — · nodes — · pv —';
  lastRenderedHistory = -1; notice(''); render(); scheduleAI();
});
element('current-kfen').addEventListener('click', () => { kfen.value = toKFEN(game.position); });
element('load-kfen').addEventListener('click', () => {
  try {
    game.load(kfen.value); cancelPending(); selected = null; hint = null; lastRenderedHistory = -1;
    debug = 'depth — · score — · nodes — · pv —'; notice('Position loaded.'); render(); scheduleAI();
  } catch (error) { notice(`Invalid KFEN: ${error instanceof Error ? error.message : String(error)}`); }
});
setInterval(updateThinking, 100);
render(); scheduleAI();
