// The office floor plan: a tile grid with rooms, doors, furniture, seats and
// break spots, plus path finding over it. 1 tile = 16 base pixels.

export const T = 16;
export const COLS = 56;
export const ROWS = 34;
export const W = COLS * T;
export const H = ROWS * T;

export const FLOOR = 0;
export const WALL = 1;
export const BLOCK = 2;

export const ROOMS = [
  { id: "research", name: "Research", x0: 1, y0: 1, x1: 17, y1: 10, floor: "wood" },
  { id: "meeting", name: "Meeting room", x0: 19, y0: 1, x1: 36, y1: 10, floor: "carpetBlue" },
  { id: "review", name: "Review & QA", x0: 38, y0: 1, x1: 54, y1: 10, floor: "tile" },
  { id: "corridor", name: "", x0: 1, y0: 12, x1: 54, y1: 14, floor: "corridor" },
  { id: "open", name: "Leads & dev floor", x0: 1, y0: 16, x1: 33, y1: 32, floor: "carpetGray" },
  { id: "cafe", name: "Cafe", x0: 35, y0: 16, x1: 54, y1: 23, floor: "checker" },
  { id: "lounge", name: "Lounge", x0: 35, y0: 25, x1: 54, y1: 32, floor: "carpetPurple" },
];

const DOORS = [
  [8, 11], [9, 11], [27, 11], [28, 11], [45, 11], [46, 11],
  [6, 15], [7, 15], [25, 15], [26, 15], [48, 15], [49, 15],
  [34, 19], [34, 20], [43, 24], [44, 24],
  [0, 12], [0, 13], [0, 14],
];

export const ENTRANCE = { x: 0, y: 13 };
export const OUTSIDE = { x: -1, y: 13 };

export const grid = [];
export const floorType = [];
for (let y = 0; y < ROWS; y++) {
  grid.push(new Array(COLS).fill(WALL));
  floorType.push(new Array(COLS).fill(null));
}
for (const r of ROOMS) {
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      grid[y][x] = FLOOR;
      floorType[y][x] = r.floor;
    }
  }
}
for (const [x, y] of DOORS) {
  grid[y][x] = FLOOR;
  floorType[y][x] = "door";
}

// ---------- furniture ----------
// Each item has a kind, a tile rect it blocks (bx0..bx1, by0..by1) and a sort
// baseline (bottom edge in tiles) so characters are drawn in front or behind.
export const furniture = [];
function put(kind, x0, y0, x1 = x0, y1 = y0, extra = {}, block = true) {
  furniture.push({ kind, x0, y0, x1, y1, base: y1 + 1, ...extra });
  if (!block) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = BLOCK;
}

// seats: where an agent sits to work. facing "down" = towards the viewer.
export const seats = [];
function desk(x, y, zone, i) {
  // seat at (x, y), the desk right below it
  seats.push({ id: `${zone}-${seats.length}`, zone, x, y, facing: "down" });
  put("desk", x - 1, y + 1, x + 1, y + 1, { seatX: x, variant: i });
}

let n = 0;
// research: shelves on the back wall, two rows of desks
put("shelf", 1, 1, 17, 1);
for (const y of [4, 8]) for (const x of [3, 7, 11, 15]) desk(x, y, "research", n++);
put("plant", 17, 10);

// meeting room: whiteboard, one long table
put("whiteboard", 23, 1, 27, 1);
put("table", 23, 5, 32, 6);
for (const x of [24, 26, 28, 30]) seats.push({ id: `meeting-${seats.length}`, zone: "meeting", x, y: 4, facing: "down" });
for (const x of [24, 26, 28, 30]) seats.push({ id: `meeting-${seats.length}`, zone: "meeting", x, y: 7, facing: "up" });
put("plant", 19, 1);
put("plant", 36, 1);
put("plant", 36, 10);

// review and QA lab: racks and two rows of desks
put("rack", 38, 1, 41, 1);
put("rack", 51, 1, 54, 1);
for (const y of [4, 8]) for (const x of [40, 44, 48, 52]) desk(x, y, "review", n++);

// open workspace: leads up front, the dev floor behind
for (const y of [17, 21]) for (const x of [3, 7, 11, 15, 19, 23, 27, 31]) desk(x, y, "lead", n++);
for (const y of [25, 29]) for (const x of [3, 7, 11, 15, 19, 23, 27, 31]) desk(x, y, "dev", n++);
put("plant", 33, 16);
put("plant", 1, 32);
put("plant", 33, 32);

// corridor
put("plant", 12, 12);
put("plant", 31, 12);
put("plant", 52, 12);
put("mat", 1, 12, 2, 14, { base: -1 }, false);
put("runner", 4, 13, 51, 13, { base: -1 }, false);
// wall decor on the outer walls (the inner walls are glass)
put("art", 21, 0, 22, 0, { seed: 1, wall: "north" }, false);
put("art", 33, 0, 34, 0, { seed: 2, wall: "north" }, false);
put("art", 45, 0, 47, 0, { seed: 3, wall: "north" }, false);
put("art", 0, 4, 0, 6, { seed: 4, wall: "west" }, false);
put("art", 0, 19, 0, 20, { seed: 5, wall: "west" }, false);
put("art", 0, 27, 0, 28, { seed: 6, wall: "west" }, false);
put("clock", 28, 0, 28, 0, { wall: "north" }, false);

// cafe
put("counter", 36, 16, 44, 16);
put("cooler", 53, 16);
for (const x of [40, 46, 52]) put("cafeTable", x, 20);
put("plant", 35, 23);

// lounge
put("rug", 36, 26, 42, 28, { base: -1 }, false);
put("rug", 36, 30, 41, 32, { base: -1, round: true }, false);
put("sofa", 36, 25, 41, 25, { base: 25.3 }, false);
put("lamp", 35, 25);
put("tv", 46, 25, 50, 25);
put("coffeeTable", 37, 27, 40, 27);
put("pingpong", 46, 29, 49, 30);
put("arcade", 52, 25, 53, 25);
put("beanbag", 37, 31, 37, 31, { color: "#e07a5f", base: 31.3 }, false);
put("beanbag", 40, 31, 40, 31, { color: "#3d85c6", base: 31.3 }, false);
put("plant", 54, 32);
put("plant", 35, 32);

// break spots: where idle agents go. pose sit or stand, and what they do there.
export const spots = [
  ...[37, 39, 41, 43].map((x) => ({ x, y: 17, facing: "up", pose: "stand", act: "coffee" })),
  { x: 53, y: 17, facing: "up", pose: "stand", act: "coffee" },
  ...[40, 46, 52].flatMap((x) => [
    { x: x - 1, y: 20, facing: "right", pose: "sit", act: "chat" },
    { x: x + 1, y: 20, facing: "left", pose: "sit", act: "chat" },
  ]),
  { x: 37, y: 25, facing: "down", pose: "sit", act: "sofa" },
  { x: 39, y: 25, facing: "down", pose: "sit", act: "sofa" },
  { x: 41, y: 25, facing: "down", pose: "sit", act: "sofa" },
  { x: 45, y: 29, facing: "right", pose: "stand", act: "pingpong", pair: "pp" },
  { x: 50, y: 30, facing: "left", pose: "stand", act: "pingpong", pair: "pp" },
  { x: 52, y: 26, facing: "up", pose: "stand", act: "arcade" },
  { x: 53, y: 26, facing: "up", pose: "stand", act: "arcade" },
  { x: 37, y: 31, facing: "down", pose: "sit", act: "beanbag" },
  { x: 40, y: 31, facing: "down", pose: "sit", act: "beanbag" },
].map((s, i) => ({ ...s, id: `spot-${i}` }));

// chairs: behind a sitter who faces the viewer, in front of one who faces away
for (const s of seats) {
  put("chair", s.x, s.y, s.x, s.y, { facing: s.facing, style: "office", base: s.facing === "up" ? s.y + 1.05 : s.y + 0.6 }, false);
}
for (const s of spots) {
  if (s.act === "chat") put("chair", s.x, s.y, s.x, s.y, { facing: s.facing, style: "bistro", base: s.y + 0.6 }, false);
}

// when every seat is taken, people work standing in the corridor with a laptop
export const overflow = [];
for (const y of [12, 14]) {
  for (let x = 4; x <= 52; x += 2) {
    const door = floorType[y === 12 ? 11 : 15][x] === "door";
    if (grid[y][x] === FLOOR && !door) overflow.push({ id: `overflow-${overflow.length}`, zone: "overflow", x, y, facing: y === 12 ? "down" : "up", stand: true });
  }
}

export function walkable(x, y) {
  if (x === OUTSIDE.x && y === OUTSIDE.y) return true;
  return x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y][x] === FLOOR;
}

// Shortest path over 8 neighbours (no cutting past a wall corner), then
// straightened wherever there is a clear line, so people walk like people,
// not like rooks. Returns the points after `from` up to `to`.
const SQ2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];
export function findPath(from, to) {
  const key = (x, y) => (y + 1) * (COLS + 2) + (x + 1);
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  if (start.x === to.x && start.y === to.y) return [];
  if (!walkable(start.x, start.y)) {
    // stuck on a blocked tile (a layout change): step to the nearest free one first
    const near = nearestFree(start);
    if (!near) return [{ x: to.x, y: to.y }];
    const rest = findPath(near, to);
    return rest ? [near, ...rest] : [near];
  }
  const dist = new Map([[key(start.x, start.y), 0]]);
  const prev = new Map();
  const heap = [[0, start.x, start.y]];
  const push = (n) => {
    heap.push(n);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  let found = false;
  while (heap.length) {
    const [d, x, y] = pop();
    if (d > (dist.get(key(x, y)) ?? Infinity)) continue;
    if (x === to.x && y === to.y) {
      found = true;
      break;
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(nx, ny)) continue;
      if (dx && dy && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue;
      const nd = d + cost;
      const k = key(nx, ny);
      if (nd >= (dist.get(k) ?? Infinity)) continue;
      dist.set(k, nd);
      prev.set(k, [x, y]);
      push([nd, nx, ny]);
    }
  }
  if (!found) return null;
  const tiles = [];
  for (let c = [to.x, to.y]; c && !(c[0] === start.x && c[1] === start.y); c = prev.get(key(c[0], c[1]))) tiles.push({ x: c[0], y: c[1] });
  tiles.reverse();
  return straighten(start, tiles);
}

// is the straight walk from a to b clear, with a little room on both sides
export function clearLine(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / 0.2);
  const nx = len ? -dy / len : 0;
  const ny = len ? dx / len : 0;
  for (let i = 0; i <= steps; i++) {
    const x = a.x + (dx * i) / steps;
    const y = a.y + (dy * i) / steps;
    for (const s of [-0.32, 0, 0.32]) if (!walkable(Math.round(x + nx * s), Math.round(y + ny * s))) return false;
  }
  return true;
}

function straighten(start, tiles) {
  const out = [];
  let from = start;
  let i = 0;
  while (i < tiles.length) {
    // the furthest point still in a clear line
    let j = tiles.length - 1;
    while (j > i && !clearLine(from, tiles[j])) j--;
    out.push(tiles[j]);
    from = tiles[j];
    i = j + 1;
  }
  return out;
}

function nearestFree(p) {
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (walkable(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
      }
    }
  }
  return null;
}

// which zone a subagent type works in
export function zoneFor(type) {
  const t = String(type || "").toLowerCase();
  if (/explore|research|analyst|fetch|search|guide|docs/.test(t)) return "research";
  if (/plan|architect|orchestr|lead|keeper|opener|manager/.test(t)) return "meeting";
  if (/review|test|qa|security|audit|lint|verif/.test(t)) return "review";
  return "dev";
}
