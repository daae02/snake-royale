export type Dir = 'UP'|'RIGHT'|'DOWN'|'LEFT';
export interface Pt { x:number; y:number; }
export interface Snake { id:string; name:string; color:string; dir:Dir; alive:boolean; body:Pt[]; grow:number; }
export type Mod = 'FAST'|'PORTALS'|'DOUBLE'|'TOXIC';

export interface StartMsg {
  seed: number;
  w: number;
  h: number;
  mods: Mod[];
  players: { id:string; name:string; color:string }[];
}
