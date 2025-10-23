import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { joinGameChannel } from './net/realtime';
import { makeGame } from './game/Game';
import type { Dir, StartMsg, Mod, Snake, Pt } from './game/types';
import { HUD } from './ui/HUD';
import Leaderboard from './ui/Leaderboard';
import { supabase } from './supabaseClient';

const DEFAULT_TPS = 8;
const CELL_SIZE = 20;
const MIN_SPAWN_DISTANCE = 6;
const COLOR_OPTIONS = [
  '#e6194b',
  '#3cb44b',
  '#ffe119',
  '#0082c8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#d2f53c',
  '#fabebe',
  '#008080',
  '#e6beff',
  '#aa6e28',
  '#fffac8',
  '#800000',
  '#aaffc3',
  '#808000',
  '#ffd8b1',
  '#000080',
  '#808080',
  '#ffffff',
  '#000000',
  '#bcf60c',
  '#9a6324',
];

const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: 'UP',
  ArrowRight: 'RIGHT',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  w: 'UP',
  a: 'LEFT',
  s: 'DOWN',
  d: 'RIGHT',
};

interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

type GameRenderState = {
  snakes: Snake[];
  food: Pt[];
  obstacles: Pt[];
  w: number;
  h: number;
};

type BroadcastState = GameRenderState & { tick: number; mods: Mod[] };

type EndEventPayload = { winner: string | null; reason: string };

type InputEventPayload = { id: string; dir: Dir };

type PresencePayload = PlayerInfo & { joined_at: string };

export default function App() {
  const [name, setName] = useState(() => localStorage.getItem('name') ?? '');
  const [ready, setReady] = useState(() => Boolean(localStorage.getItem('name')));
  const [color, setColor] = useState(() => {
    const stored = localStorage.getItem('color');
    if (stored && COLOR_OPTIONS.includes(stored)) {
      return stored;
    }
    return COLOR_OPTIONS[0];
  });

  const playerId = useMemo(() => crypto.randomUUID(), []);
  const displayName = useMemo(() => name.trim() || 'anon', [name]);
  const me = useMemo<PlayerInfo>(
    () => ({ id: playerId, name: displayName, color }),
    [playerId, displayName, color],
  );

  const gameId = useMemo(() => new URLSearchParams(location.search).get('g') || 'public', []);
  const seedBase = useMemo(() => (Date.now() % 2147483647) >>> 0, []);
  const [seedBump, setSeedBump] = useState(0);
  const [gameSeed, setGameSeed] = useState(seedBase);

  const [realtime, setRealtime] = useState<ReturnType<typeof joinGameChannel> | null>(null);
  useEffect(() => {
    if (!ready) return;

    const connection = joinGameChannel(gameId, me);
    setRealtime(connection);

    return () => {
      connection.unsubscribe();
      setRealtime(null);
    };
  }, [ready, gameId, playerId]);

  useEffect(() => {
    if (!ready || !realtime) return;
    realtime.updatePresence({ name: displayName, color });
  }, [ready, realtime, displayName, color]);
  const sendStart = realtime?.sendStart ?? null;
  const sendInput = realtime?.sendInput ?? null;
  const sendState = realtime?.sendState ?? null;
  const sendEnd = realtime?.sendEnd ?? null;

  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [started, setStarted] = useState(false);
  const [mods, setMods] = useState<Mod[]>(['PORTALS']);
  const [obstaclePct, setObstaclePct] = useState(5);
  const [gameOverMsg, setGameOverMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<ReturnType<typeof makeGame> | null>(null);
  const inputsRef = useRef<Record<string, Dir>>({});
  const tickRef = useRef(0);

  const drawState = useCallback((state: GameRenderState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = state.w * CELL_SIZE;
    canvas.height = state.h * CELL_SIZE;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000';
    for (let x = 0; x < state.w; x += 1) {
      for (let y = 0; y < state.h; y += 1) {
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    ctx.restore();

    ctx.fillStyle = '#444';
    state.obstacles.forEach((obstacle) => {
      ctx.fillRect(obstacle.x * CELL_SIZE, obstacle.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    state.food.forEach((food) => {
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(
        food.x * CELL_SIZE + 3,
        food.y * CELL_SIZE + 3,
        CELL_SIZE - 6,
        CELL_SIZE - 6,
      );
    });

    state.snakes.forEach((snake) => {
      ctx.fillStyle = snake.color || '#3498db';
      snake.body.forEach((segment, index) => {
        const padding = index === 0 ? 1 : 3;
        ctx.fillRect(
          segment.x * CELL_SIZE + padding,
          segment.y * CELL_SIZE + padding,
          CELL_SIZE - padding * 2,
          CELL_SIZE - padding * 2,
        );
      });
    });
  }, []);

  const initFromStart = useCallback(
    (msg: StartMsg) => {
      const { seed, w, h, mods: nextMods, players: startPlayers } = msg;
      simRef.current = makeGame(seed, w, h, startPlayers, nextMods, obstaclePct / 100, MIN_SPAWN_DISTANCE);
      setStarted(true);
      setMods(nextMods);
      setGameSeed(seed);
      setGameOverMsg(null);

      if (simRef.current) {
        drawState({
          snakes: simRef.current.snakes,
          food: simRef.current.food,
          obstacles: simRef.current.obstacles,
          w,
          h,
        });
      }
      tickRef.current = 0;
      inputsRef.current = {};
    },
    [drawState, obstaclePct],
  );

  const handleStartGame = useCallback(() => {
    if (!sendStart) return;
    if (mods.length === 0) return;

    const presentPlayers = players.length ? players : [me];
    const ensureSelf = presentPlayers.some((p) => p.id === me.id)
      ? presentPlayers
      : [...presentPlayers, me];

    const w = 90;
    const h = 30;
    const startMsg: StartMsg = {
      seed: (seedBase + seedBump) >>> 0,
      w,
      h,
      mods,
      players: ensureSelf.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };

    sendStart(startMsg);
    initFromStart(startMsg);
  }, [sendStart, players, me, seedBase, seedBump, mods, initFromStart]);

  useEffect(() => {
    if (!realtime) return;

    const handlePresence = (event: Event) => {
      const detail = (event as CustomEvent<PresencePayload[]>).detail;
      setPlayers(detail.map(({ id, name, color }) => ({ id, name, color })));
      setIsHost(detail.length > 0 && detail[0].id === me.id);
    };

    window.addEventListener('PRESENCE', handlePresence);
    return () => {
      window.removeEventListener('PRESENCE', handlePresence);
    };
  }, [realtime, me.id]);

  useEffect(() => {
    const handleStart = (event: Event) => initFromStart((event as CustomEvent<StartMsg>).detail);

    const handleEnd = (event: Event) => {
      const { winner, reason } = (event as CustomEvent<EndEventPayload>).detail;
      setStarted(false);
      setGameOverMsg(winner ? `🏁 Ganó ${winner} (${reason})` : `Fin de partida (${reason})`);
    };

    const handleInput = (event: Event) => {
      const { id, dir } = (event as CustomEvent<InputEventPayload>).detail;
      inputsRef.current[id] = dir;
    };

    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<BroadcastState>).detail;
      tickRef.current = detail.tick;
      drawState(detail);
      setMods(detail.mods);
    };

    window.addEventListener('NET_START', handleStart);
    window.addEventListener('NET_END', handleEnd);
    window.addEventListener('NET_INPUT', handleInput);
    window.addEventListener('NET_STATE', handleState);

    return () => {
      window.removeEventListener('NET_START', handleStart);
      window.removeEventListener('NET_END', handleEnd);
      window.removeEventListener('NET_INPUT', handleInput);
      window.removeEventListener('NET_STATE', handleState);
    };
  }, [drawState, initFromStart]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !started && isHost && ready) {
        event.preventDefault();
        handleStartGame();
        return;
      }

      const dir = KEY_TO_DIR[event.key];
      if (!dir || !sendInput) return;

      sendInput({ id: me.id, dir, tick: tickRef.current });
      if (isHost) {
        inputsRef.current[me.id] = dir;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleStartGame, isHost, me.id, ready, sendInput, started]);

  useEffect(() => {
    if (!started || !isHost) return;
    if (!simRef.current) return;
    if (!sendState || !sendEnd) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const runLoop = () => {
      if (!simRef.current) return;

      tickRef.current += 1;
      const state = simRef.current.step(inputsRef.current);
      inputsRef.current = {};

      const aliveSnakes = state.snakes.filter((snake) => snake.alive);
      if (aliveSnakes.length <= 1) {
        const winner = aliveSnakes[0];
        sendState({ tick: tickRef.current, ...state, mods });
        sendEnd({ winner: winner?.name ?? null, reason: aliveSnakes.length === 1 ? 'último en pie' : 'todos muertos' });
        setStarted(false);

        if (winner) {
          const payload = {
            game_id: gameId,
            winner_id: winner.id,
            winner_name: winner.name,
            players: state.snakes.map(({ id, name, color }) => ({ id, name, color })),
            mod: mods.join('+'),
          };

          void supabase
            .from('matches')
            .insert(payload)
            .then(() => {
              window.dispatchEvent(new CustomEvent('LB_REFRESH'));
            })
            .catch(() => undefined);
        }
        return;
      }

      sendState({ tick: tickRef.current, ...state, mods });
      drawState(state);

      const rate = mods.includes('FAST') ? 12 : DEFAULT_TPS;
      timeoutId = setTimeout(runLoop, 1000 / rate);
    };

    runLoop();
    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [started, isHost, mods, sendState, sendEnd, drawState, gameId]);

  useEffect(() => {
    if (!ready) return;
    const takenByOthers = players.some((p) => p.id !== me.id && p.color === color);
    if (!takenByOthers) return;

    const fallback = COLOR_OPTIONS.find((option) => !players.some((p) => p.id !== me.id && p.color === option));
    if (fallback && fallback !== color) {
      setColor(fallback);
    }
  }, [players, ready, me.id, color]);

  useEffect(() => {
    localStorage.setItem('color', color);
  }, [color]);

  if (!ready) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 700 }}>Elige tu nombre</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre…"
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, width: 260 }}
        />
        <div style={{ marginTop: 12, width: 260 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Elige tu color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {COLOR_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setColor(option)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  border: option === color ? '3px solid #000' : '1px solid #999',
                  background: option,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            if (!name.trim()) return;
            localStorage.setItem('name', name.trim());
            setReady(true);
          }}
          disabled={!name.trim()}
          style={{ padding: '6px 12px' }}
        >
          Continuar
        </button>
        <div style={{ marginTop: 16 }}>
          <Leaderboard />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <HUD
        seed={gameSeed}
        isHost={isHost}
        mods={mods}
        players={players.map(({ id, name, color }) => ({ id, name, color }))}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 40 }}>
        {isHost ? (
          <>
            <button onClick={handleStartGame} disabled={started || mods.length === 0}>
              Start (Espacio)
            </button>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['PORTALS', 'FAST', 'DOUBLE', 'TOXIC'] as Mod[]).map((option) => {
                const checked = mods.includes(option);
                const label =
                  option === 'PORTALS'
                    ? 'PORTALS (infinito)'
                    : option === 'FAST'
                    ? 'FAST'
                    : option === 'DOUBLE'
                    ? 'DOUBLE'
                    : 'TOXIC';
                return (
                  <label key={option} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setMods((prev) => {
                          const next = checked ? prev.filter((m) => m !== option) : [...prev, option];
                          return next;
                        });
                      }}
                      disabled={started}
                    />
                    {label}
                  </label>
                );
              })}
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Obstáculos (%)
              <input
                type="number"
                min={0}
                max={25}
                value={obstaclePct}
                onChange={(e) => setObstaclePct(Math.max(0, Math.min(25, Number(e.target.value) || 0)))}
                disabled={started}
                style={{ width: 60 }}
              />
            </label>

            <button onClick={() => setSeedBump((value) => value + 1)} disabled={started}>
              Re-generar mapa
            </button>
          </>
        ) : (
          <span>Esperando START del host…</span>
        )}

        {gameOverMsg && <span style={{ marginLeft: 12, opacity: 0.75 }}>{gameOverMsg}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Tu color</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
          {COLOR_OPTIONS.map((option) => {
            const takenByOther = players.some((p) => p.id !== me.id && p.color === option);
            const isSelected = option === color;
            return (
              <button
                key={option}
                onClick={() => {
                  if (takenByOther) return;
                  setColor(option);
                }}
                disabled={takenByOther}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: isSelected ? '3px solid #000' : '1px solid #999',
                  background: option,
                  cursor: takenByOther ? 'not-allowed' : 'pointer',
                  opacity: takenByOther ? 0.4 : 1,
                }}
                title={takenByOther ? 'Ocupado por otro jugador' : 'Disponible'}
              />
            );
          })}
        </div>
      </div>

      <canvas ref={canvasRef} style={{ maxHeight: '75vh', width: 'auto' }} />
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Controles: WASD / Flechas · Reiniciar: Espacio (host) · gameId: {gameId}
      </div>

      <div
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'end',
        }}
      >
        <Leaderboard />
        <button
          onClick={async () => {
            if (!confirm('¿Borrar todas las partidas del ranking?')) return;
            await supabase.from('matches').delete().gt('created_at', '1970-01-01T00:00:00Z');
            window.dispatchEvent(new CustomEvent('LB_REFRESH'));
          }}
          style={{ fontSize: 12 }}
        >
          Reset ranking
        </button>
      </div>
    </div>
  );
}
