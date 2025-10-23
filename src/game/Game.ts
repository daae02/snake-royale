import { xorshift32 } from './prng';
import type { Dir, Pt, Snake, Mod } from './types';

const OPP:Record<Dir,Dir> = {UP:'DOWN',DOWN:'UP',LEFT:'RIGHT',RIGHT:'LEFT'};
const eq = (a:Pt,b:Pt)=> a.x===b.x && a.y===b.y;


type Cell = { x: number; y: number };
type Grid = { w: number; h: number };

const DIRS: Record<Dir, Cell> = {
  UP:    { x: 0,  y: -1 },
  DOWN:  { x: 0,  y: 1  },
  LEFT:  { x: -1, y: 0  },
  RIGHT: { x: 1,  y: 0  },
};

function inside({ w, h }: Grid, x: number, y: number) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function occupied(x: number, y: number, allBodies: Set<string>, obstacles: Set<string>) {
  const key = `${x},${y}`;
  return allBodies.has(key) || obstacles.has(key);
}

function rayClear(grid: Grid, x: number, y: number, dir: Dir, steps: number, allBodies: Set<string>, obstacles: Set<string>) {
  let cx = x, cy = y;
  for (let i = 1; i <= steps; i++) {
    cx += DIRS[dir].x;
    cy += DIRS[dir].y;
    if (!inside(grid, cx, cy)) return false;
    if (occupied(cx, cy, allBodies, obstacles)) return false;
  }
  return true;
}

function bodyClear(grid: Grid, head: Cell, dir: Dir, length: number, allBodies: Set<string>, obstacles: Set<string>) {
  // Cuerpo hacia atrás (opuesto a la dirección de avance)
  const back = { x: -DIRS[dir].x, y: -DIRS[dir].y };
  let cx = head.x, cy = head.y;
  for (let i = 0; i < length; i++) {
    if (!inside(grid, cx, cy)) return false;
    if (occupied(cx, cy, allBodies, obstacles)) return false;
    cx += back.x;
    cy += back.y;
  }
  return true;
}

export function makeGame(
  seed: number,
  w: number,
  h: number,
  players: { id: string; name: string; color: string }[],
  mod: Mod
) {
  const rnd = xorshift32(seed);

  // ---------- helpers ----------
  type Cell = { x: number; y: number };
  const DIRS: Record<Dir, Cell> = {
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  };

  const wrapX = (x: number) => ((x % w) + w) % w;
  const wrapY = (y: number) => ((y % h) + h) % h;
  const key = (x: number, y: number) => `${x},${y}`;

  const inside = (x: number, y: number) =>
    mod === 'PORTALS' ? true : x >= 0 && y >= 0 && x < w && y < h;

  const rayClear = (
    x: number,
    y: number,
    dir: Dir,
    steps: number,
    occ: Set<string>
  ) => {
    let cx = x, cy = y;
    for (let i = 1; i <= steps; i++) {
      cx += DIRS[dir].x;
      cy += DIRS[dir].y;
      if (mod === 'PORTALS') {
        cx = wrapX(cx);
        cy = wrapY(cy);
      } else if (!inside(cx, cy)) {
        return false;
      }
      if (occ.has(key(cx, cy))) return false;
    }
    return true;
  };

  const bodyClear = (
    head: Cell,
    dir: Dir,
    len: number,
    occ: Set<string>
  ) => {
    // head + (len-1) hacia atrás (opuesto a la dirección de avance)
    const back = { x: -DIRS[dir].x, y: -DIRS[dir].y };
    let cx = head.x, cy = head.y;
    for (let i = 0; i < len; i++) {
      if (!inside(cx, cy)) return false;
      const k = key(mod === 'PORTALS' ? wrapX(cx) : cx, mod === 'PORTALS' ? wrapY(cy) : cy);
      if (occ.has(k)) return false;
      cx += back.x;
      cy += back.y;
      if (mod === 'PORTALS') {
        cx = wrapX(cx);
        cy = wrapY(cy);
      }
    }
    return true;
  };

  const findSafeSpawn = (
    occ: Set<string>,
    lenReserve: number,
    forwardFree: number
  ): { head: Cell; dir: Dir } | null => {
    const dirs: Dir[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
    const margin = mod === 'PORTALS' ? 0 : Math.max(2, forwardFree + 1);
    const maxTries = 2000;

    for (let t = 0; t < maxTries; t++) {
      const dir = dirs[(rnd() * 4) | 0];
      const x = margin + Math.floor(rnd() * Math.max(1, w - margin * 2));
      const y = margin + Math.floor(rnd() * Math.max(1, h - margin * 2));
      const head: Cell = mod === 'PORTALS' ? { x: wrapX(x), y: wrapY(y) } : { x, y };

      if (!bodyClear(head, dir, lenReserve, occ)) continue;
      if (!rayClear(head.x, head.y, dir, forwardFree, occ)) continue;

      return { head, dir };
    }
    return null;
  };

  // ---------- obstáculos / comida ----------
  const food: Pt[] = [];
  const obstacles: Pt[] = [];
  for (let i = 0; i < Math.floor(w * h * 0.05); i++) {
    obstacles.push({ x: Math.floor(rnd() * w), y: Math.floor(rnd() * h) });
  }
  const occ = new Set<string>(obstacles.map((o) => key(o.x, o.y)));

  const placeFood = () => {
    let p: Pt;
    let guard = 0;
    do {
      p = { x: Math.floor(rnd() * w), y: Math.floor(rnd() * h) };
      if (mod === 'PORTALS') {
        p.x = wrapX(p.x); p.y = wrapY(p.y);
      }
      guard++;
      if (guard > 5000) break;
    } while (occ.has(key(p.x, p.y)) || food.some((f) => eq(f, p)));
    food.push(p);
  };
  for (let i = 0; i < 4; i++) placeFood();

  // ---------- spawns seguros (con soporte PORTALS) ----------
  const RESERVE_LEN = 3;   // cuerpo inicial reservado
  const FORWARD_FREE = 3;  // casillas libres al frente requeridas

  const snakes: Snake[] = players.map((p) => {
    const found = findSafeSpawn(occ, RESERVE_LEN, FORWARD_FREE);
    const dir: Dir = found ? found.dir : 'RIGHT';
    const head: Cell = found
      ? found.head
      : {
          x: mod === 'PORTALS' ? wrapX(2 + Math.floor(rnd() * (w - 4))) : (2 + Math.floor(rnd() * (w - 4))),
          y: mod === 'PORTALS' ? wrapY(2 + Math.floor(rnd() * (h - 4))) : (2 + Math.floor(rnd() * (h - 4))),
        };

    // reservar las 3 celdas iniciales (head + 2 hacia atrás)
    const back = { x: -DIRS[dir].x, y: -DIRS[dir].y };
    let cx = head.x, cy = head.y;
    for (let i = 0; i < RESERVE_LEN; i++) {
      const k = key(mod === 'PORTALS' ? wrapX(cx) : cx, mod === 'PORTALS' ? wrapY(cy) : cy);
      occ.add(k);
      cx += back.x; cy += back.y;
      if (mod === 'PORTALS') { cx = wrapX(cx); cy = wrapY(cy); }
    }

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      dir,
      alive: true,
      grow: 2,            // crecerá hasta 3 segmentos rápidamente
      body: [{ x: head.x, y: head.y }],
    } as Snake;
  });

  // ---------- step (igual con wrap activo) ----------
  const step = (inputs: Record<string, Dir>) => {
    snakes.forEach((s) => {
      const want = inputs[s.id];
      if (want && want !== OPP[s.dir]) s.dir = want;
    });

    snakes.forEach((s) => {
      if (!s.alive) return;
      const head = s.body[0];
      let nx = head.x + DIRS[s.dir].x;
      let ny = head.y + DIRS[s.dir].y;

      if (mod === 'PORTALS') {
        nx = wrapX(nx);
        ny = wrapY(ny);
      }

      const next = { x: nx, y: ny };
      s.body.unshift(next);

      const eatIdx = food.findIndex((f) => eq(f, next));
      if (eatIdx >= 0) {
        s.grow += mod === 'TOXIC' ? -1 : 1;
        food.splice(eatIdx, 1);
        placeFood();
        if (mod === 'DOUBLE') placeFood();
      }

      if (s.grow > 0) s.grow--;
      else s.body.pop();

      if (s.grow < 0) { s.body.splice(-1, 1); s.grow = 0; }
    });

    const walls = (p: Pt) => p.x < 0 || p.x >= w || p.y < 0 || p.y >= h;

    snakes.forEach((s) => {
      if (!s.alive) return;
      const head = s.body[0];
      if (walls(head) && mod !== 'PORTALS') s.alive = false;
      if (obstacles.some((o) => eq(o, head))) s.alive = false;
      if (s.body.slice(1).some((b) => eq(b, head))) s.alive = false;
    });

    for (let i = 0; i < snakes.length; i++) {
      for (let j = i + 1; j < snakes.length; j++) {
        const a = snakes[i], b = snakes[j];
        if (!a.alive || !b.alive) continue;
        if (eq(a.body[0], b.body[0])) { a.alive = false; b.alive = false; }
        else if (b.body.some((pt) => eq(pt, a.body[0]))) a.alive = false;
        else if (a.body.some((pt) => eq(pt, b.body[0]))) b.alive = false;
      }
    }

    return {
      snakes: JSON.parse(JSON.stringify(snakes)),
      food: [...food],
      obstacles: [...obstacles],
      w, h,
    };
  };

  return { step, snakes, food, obstacles, w, h, mod };
}
