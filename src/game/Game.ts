import { xorshift32 } from './prng';
import type { Dir, Pt, Snake, Mod } from './types';

const OPP:Record<Dir,Dir> = {UP:'DOWN',DOWN:'UP',LEFT:'RIGHT',RIGHT:'LEFT'};
const eq = (a:Pt,b:Pt)=> a.x===b.x && a.y===b.y;

export function makeGame(seed:number, w:number, h:number, players:{id:string;name:string;color:string}[], mod:Mod){
  const rnd = xorshift32(seed);
  const snakes: Snake[] = players.map((p,i)=>({
    id:p.id, name:p.name, color:p.color,
    dir:'RIGHT', alive:true, grow:2,
    body:[{x:2+i*2, y:2+i}]
  }));
  const food: Pt[] = [];
  const obstacles: Pt[] = [];

  // obstaculos
  for (let i=0;i<Math.floor((w*h)*0.05);i++){
    obstacles.push({ x:Math.floor(rnd()*w), y:Math.floor(rnd()*h) });
  }

  const placeFood = ()=>{
    let p:Pt;
    do { p = { x:Math.floor(rnd()*w), y:Math.floor(rnd()*h) }; }
    while (snakes.some(s=>s.body.some(b=>eq(b,p))) || obstacles.some(o=>eq(o,p)) || food.some(f=>eq(f,p)));
    food.push(p);
  };
  for (let i=0;i<4;i++) placeFood();

  const step = (inputs:Record<string,Dir>)=>{
    // aplicar inputs válidos
    snakes.forEach(s=>{
      const want = inputs[s.id];
      if (want && want !== OPP[s.dir]) s.dir = want;
    });

    // mover serpientes
    snakes.forEach(s=>{
      if(!s.alive) return;
      const head = s.body[0];
      const next = {x:head.x, y:head.y};
      if (s.dir==='UP') next.y--; else if(s.dir==='DOWN') next.y++;
      else if (s.dir==='LEFT') next.x--; else next.x++;

      // portales (wrap)
      if (mod==='PORTALS'){
        if (next.x<0) next.x = w-1;
        if (next.x>=w) next.x = 0;
        if (next.y<0) next.y = h-1;
        if (next.y>=h) next.y = 0;
      }

      s.body.unshift(next);

      const eatIdx = food.findIndex(f=>eq(f,next));
      if (eatIdx>=0){
        s.grow += (mod==='TOXIC' ? -1 : 1);
        food.splice(eatIdx,1);
        placeFood();
        if (mod==='DOUBLE') placeFood();
      }

      if (s.grow>0) s.grow--;
      else s.body.pop();

      if (s.grow<0){ s.body.splice(-1,1); s.grow=0; } // tóxica
    });

    // colisiones
    const walls = (p:Pt)=> p.x<0 || p.x>=w || p.y<0 || p.y>=h;
    snakes.forEach(s=>{
      if(!s.alive) return;
      const head = s.body[0];
      if (walls(head) && mod!=='PORTALS') s.alive=false;
      if (obstacles.some(o=>eq(o,head))) s.alive=false;
      if (s.body.slice(1).some(b=>eq(b,head))) s.alive=false;
    });

    // entre serpientes
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

  return { step, snakes, food, obstacles, w, h, mod };
}
