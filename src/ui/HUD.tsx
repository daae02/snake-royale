import React from 'react';
import type { Mod } from '../game/types';

export function HUD({
  seed,
  isHost,
  mods,
  players,
}:{
  seed: number;
  isHost: boolean;
  mods: Mod[];
  players: {id:string; name:string; color:string}[];
}){
  const modLabel = mods.length ? mods.join(' + ') : '—';
  return (
    <div
      style={{
        position:'fixed', top:8, left:8,
        fontSize:12, opacity:0.8, background:'#0002',
        padding:'6px 8px', borderRadius:8
      }}
    >
      <div>Snake Royale — {isHost ? 'HOST' : 'CLIENT'}</div>
      <div>Seed: {seed} · Mod(s): {modLabel}</div>
      <div>
        Players:{' '}
        {players.length === 0
          ? '—'
          : players.map((p, i) => (
              <span key={p.id} style={{ color: p.color, fontWeight: p.id === players[0].id ? 600 : 500 }}>
                {i > 0 ? ', ' : ''}
                {p.name}
              </span>
            ))}
      </div>
    </div>
  );
}
