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
  mods: Mod[],
  obstacleRatio = 0.05,
  minSpawnDist = 6
) {
  const rnd = xorshift32(seed);
  const hasMod = (m: Mod) => mods.includes(m);

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
    hasMod('PORTALS') ? true : x >= 0 && y >= 0 && x < w && y < h;

  const manhattan = (a: Cell, b: Cell) => {
    // en wrap, la distancia mínima considerando toroidal
    const dx = Math.min(Math.abs(a.x - b.x), w - Math.abs(a.x - b.x));
    const dy = Math.min(Math.abs(a.y - b.y), h - Math.abs(a.y - b.y));
    return dx + dy;
  };

  const rayClear = (x: number, y: number, dir: Dir, steps: number, occ: Set<string>) => {
    let cx = x, cy = y;
    for (let i = 1; i <= steps; i++) {
      cx += DIRS[dir].x; cy += DIRS[dir].y;
      if (hasMod('PORTALS')) { cx = wrapX(cx); cy = wrapY(cy); }
      else if (!inside(cx, cy)) return false;
      if (occ.has(key(cx, cy))) return false;
    }
    return true;
  };

  const bodyClear = (head: Cell, dir: Dir, len: number, occ: Set<string>) => {
    const back = { x: -DIRS[dir].x, y: -DIRS[dir].y };
    let cx = head.x, cy = head.y;
    for (let i = 0; i < len; i++) {
      if (!inside(cx, cy)) return false;
      const k = key(hasMod('PORTALS') ? wrapX(cx) : cx, hasMod('PORTALS') ? wrapY(cy) : cy);
      if (occ.has(k)) return false;
      cx += back.x; cy += back.y;
      if (hasMod('PORTALS')) { cx = wrapX(cx); cy = wrapY(cy); }
    }
    return true;
  };

  const findSafeSpawn = (
    occ: Set<string>,
    lenReserve: number,
    forwardFree: number,
    others: Cell[]
  ): { head: Cell; dir: Dir } | null => {
    const dirs: Dir[] = ['UP','DOWN','LEFT','RIGHT'];
    const maxTries = 2500;
    for (let t = 0; t < maxTries; t++) {
      const dir = dirs[(rnd()*4)|0];
      const x = Math.floor(rnd()*w);
      const y = Math.floor(rnd()*h);
      const head = { x: hasMod('PORTALS')?wrapX(x):x, y: hasMod('PORTALS')?wrapY(y):y };

      // separación con otras serpientes ya colocadas
      if (others.some(o => manhattan(o, head) < minSpawnDist)) continue;

      if (!bodyClear(head, dir, lenReserve, occ)) continue;
      if (!rayClear(head.x, head.y, dir, forwardFree, occ)) continue;

      return { head, dir };
    }
    return null;
  };

  // --- obstáculos y comida ---
  const obstacles: Pt[] = [];
  const totalObs = Math.floor(w*h*Math.max(0, Math.min(1, obstacleRatio)));
  for (let i=0; i<totalObs; i++){
    obstacles.push({ x: Math.floor(rnd()*w), y: Math.floor(rnd()*h) });
  }
  const occ = new Set<string>(obstacles.map(o => key(o.x,o.y)));

  const food: Pt[] = [];
  const placeFood = ()=>{
    let p: Pt; let guard=0;
    do {
      p = { x: Math.floor(rnd()*w), y: Math.floor(rnd()*h) };
      if (hasMod('PORTALS')){ p.x = wrapX(p.x); p.y = wrapY(p.y); }
      guard++; if (guard>3000) break;
    } while (occ.has(key(p.x,p.y)) || food.some(f=>eq(f,p)));
    food.push(p);
  };
  for (let i=0;i<4;i++) placeFood();

  // --- spawns seguros ---
  const RESERVE_LEN = 3, FORWARD_FREE = 3;
  const snakes: Snake[] = [];
  const placedHeads: Cell[] = [];

  for (const p of players){
    const found = findSafeSpawn(occ, RESERVE_LEN, FORWARD_FREE, placedHeads);
    const dir: Dir = found ? found.dir : 'RIGHT';
    const head: Cell = found ? found.head : { x:(2+Math.floor(rnd()*(w-4)))|0, y:(2+Math.floor(rnd()*(h-4)))|0 };

    // reservar head + 2 hacia atrás, y recordar el head para distancia mínima
    const back = { x: -DIRS[dir].x, y: -DIRS[dir].y };
    let cx=head.x, cy=head.y;
    for (let i=0;i<RESERVE_LEN;i++){
      occ.add(key(hasMod('PORTALS')?wrapX(cx):cx, hasMod('PORTALS')?wrapY(cy):cy));
      cx += back.x; cy += back.y;
      if (hasMod('PORTALS')){ cx = wrapX(cx); cy = wrapY(cy); }
    }
    placedHeads.push(head);

    snakes.push({
      id:p.id, name:p.name, color:p.color,
      dir, alive:true, grow:2,
      body:[{x:head.x, y:head.y}]
    } as Snake);
  }

  // --- step ---
  const step = (inputs:Record<string,Dir>)=>{
    snakes.forEach(s=>{
      const want = inputs[s.id];
      if (want && want !== OPP[s.dir]) s.dir = want;
    });

    snakes.forEach(s=>{
      if(!s.alive) return;
      const head = s.body[0];
      let nx = head.x + DIRS[s.dir].x;
      let ny = head.y + DIRS[s.dir].y;
      if (hasMod('PORTALS')){ nx = wrapX(nx); ny = wrapY(ny); }
      const next = { x:nx, y:ny };

      s.body.unshift(next);

      const eatIdx = food.findIndex(f=>eq(f,next));
      if (eatIdx>=0){
        s.grow += (hasMod('TOXIC') ? -1 : 1);
        food.splice(eatIdx,1);
        placeFood();
        if (hasMod('DOUBLE')) placeFood();
      }

      if (s.grow>0) s.grow--;
      else s.body.pop();

      if (s.grow<0){ s.body.splice(-1,1); s.grow=0; }
    });

    const walls = (p:Pt)=> p.x<0 || p.x>=w || p.y<0 || p.y>=h;
    snakes.forEach(s=>{
      if(!s.alive) return;
      const head = s.body[0];
      if (walls(head) && !hasMod('PORTALS')) s.alive=false;
      if (obstacles.some(o=>eq(o,head))) s.alive=false;
      if (s.body.slice(1).some(b=>eq(b,head))) s.alive=false;
    });

    for (let i=0;i<snakes.length;i++){
      for (let j=i+1;j<snakes.length;j++){
        const a=snakes[i], b=snakes[j];
        if(!a.alive || !b.alive) continue;
        if (eq(a.body[0], b.body[0])) { a.alive=false; b.alive=false; }
        else if (b.body.some(pt=>eq(pt,a.body[0]))) a.alive=false;
        else if (a.body.some(pt=>eq(pt,b.body[0]))) b.alive=false;
      }
    }

    return { snakes: JSON.parse(JSON.stringify(snakes)), food:[...food], obstacles:[...obstacles], w, h };
  };

  return { step, snakes, food, obstacles, w, h, mods };
}
