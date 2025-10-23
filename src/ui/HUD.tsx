import React, { CSSProperties } from 'react';
import type { Mod } from '../game/types';

export function HUD({
  seed,
  isHost,
  mods,
  players,
  floating = true,
}: {
  seed: number;
  isHost: boolean;
  mods: Mod[];
  players: { id: string; name: string; color: string }[];
  floating?: boolean;
}) {
  const modLabel = mods.length ? mods.join(' + ') : '—';
  const containerStyle: CSSProperties = {
    fontSize: 12,
    color: '#e2e8f0',
    background: 'rgba(15, 23, 42, 0.78)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: 18,
    padding: '12px 16px',
    boxShadow: '0 18px 35px -18px rgba(15, 23, 42, 0.8)',
    backdropFilter: 'blur(14px)',
    minWidth: floating ? 220 : undefined,
    width: floating ? undefined : '100%',
    boxSizing: 'border-box',
  };

  if (floating) {
    containerStyle.position = 'fixed';
    containerStyle.top = 16;
    containerStyle.left = 16;
  } else {
    containerStyle.position = 'relative';
    containerStyle.margin = '0 auto';
    containerStyle.maxWidth = 'min(100%, 460px)';
  }

  return (
    <div style={containerStyle}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
        Snake Royale · {isHost ? 'HOST' : 'CLIENT'}
      </div>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>Seed: {seed}</div>
      <div style={{ marginBottom: 10 }}>
        <span style={{ opacity: 0.75 }}>Mods:</span>{' '}
        <span style={{ fontWeight: 600 }}>{modLabel}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {players.length === 0 ? (
          <span style={{ opacity: 0.6 }}>Sin jugadores conectados</span>
        ) : (
          players.map((p) => (
            <span
              key={p.id}
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${p.color}`,
                color: p.color,
                fontWeight: 600,
                fontSize: 11,
                background: 'rgba(15, 23, 42, 0.6)',
              }}
            >
              {p.name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
