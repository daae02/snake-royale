import React from 'react';

export function HUD({
  seed, isHost, mod, players
}:{
  seed: number;
  isHost: boolean;
  mod: string;
  players: {id:string; name:string}[];
}){
  return (
    <div
      style={{
        position:'fixed', top:8, left:8,
        fontSize:12, opacity:0.8, background:'#0002',
        padding:'6px 8px', borderRadius:8
      }}
    >
      <div>Snake Royale — {isHost ? 'HOST' : 'CLIENT'}</div>
      <div>Seed: {seed} · Mod: {mod}</div>
      <div>Players: {players.map(p=>p.name).join(', ') || '—'}</div>
    </div>
  );
}
