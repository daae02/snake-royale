import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  const pageBackground = 'radial-gradient(125deg, #020617 10%, #0f172a 45%, #1e293b 100%)';
  const cardBase: CSSProperties = {
    background: 'rgba(15, 23, 42, 0.82)',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    borderRadius: 24,
    padding: 24,
    boxShadow: '0 30px 60px -25px rgba(15, 23, 42, 0.7)',
    backdropFilter: 'blur(18px)',
  };
  const primaryButtonStyle: CSSProperties = {
    padding: '10px 20px',
    borderRadius: 999,
    border: 'none',
    background: 'linear-gradient(135deg, #38bdf8, #22d3ee)',
    color: '#0f172a',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    boxShadow: '0 14px 30px rgba(56, 189, 248, 0.3)',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };
  const subtleButtonStyle: CSSProperties = {
    padding: '8px 16px',
    borderRadius: 999,
    border: '1px solid rgba(148, 163, 184, 0.4)',
    background: 'rgba(148, 163, 184, 0.12)',
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };
  const modLabels: Record<Mod, string> = {
    PORTALS: 'Portales infinitos',
    FAST: 'Velocidad x1.5',
    DOUBLE: 'Doble comida',
    TOXIC: 'Comida tóxica',
  };

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
    const scale = Math.min(
      (window.innerWidth * 0.85) / canvas.width,
      (window.innerHeight * 0.7) / canvas.height,
      1,
    );
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#111827');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#fff';
    for (let x = 0; x < state.w; x += 1) {
      for (let y = 0; y < state.h; y += 1) {
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    ctx.restore();

    ctx.fillStyle = '#1f2937';
    state.obstacles.forEach((obstacle) => {
      ctx.fillRect(obstacle.x * CELL_SIZE, obstacle.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    state.food.forEach((food) => {
      const foodGradient = ctx.createRadialGradient(
        food.x * CELL_SIZE + CELL_SIZE / 2,
        food.y * CELL_SIZE + CELL_SIZE / 2,
        2,
        food.x * CELL_SIZE + CELL_SIZE / 2,
        food.y * CELL_SIZE + CELL_SIZE / 2,
        CELL_SIZE / 2,
      );
      foodGradient.addColorStop(0, '#facc15');
      foodGradient.addColorStop(1, '#ca8a04');
      ctx.fillStyle = foodGradient;
      ctx.fillRect(
        food.x * CELL_SIZE + 3,
        food.y * CELL_SIZE + 3,
        CELL_SIZE - 6,
        CELL_SIZE - 6,
      );
    });

    state.snakes.forEach((snake) => {
      ctx.fillStyle = snake.color || '#38bdf8';
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
      setGameOverMsg(winner ? `🏁 ${winner} gana (${reason})` : `Fin de partida (${reason})`);
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
        const reason = aliveSnakes.length === 1 ? 'último en pie' : 'todos muertos';
        sendState({ tick: tickRef.current, ...state, mods });
        sendEnd({ winner: winner?.name ?? null, reason });
        setGameOverMsg(winner ? `🏁 ${winner.name} gana (${reason})` : `Fin de partida (${reason})`);
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
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: pageBackground,
          padding: '32px 16px',
          color: '#e2e8f0',
          fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <div style={{ ...cardBase, width: 'min(420px, 100%)', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Snake Royale</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
              Ingresa tu nombre y personaliza tu color antes de unirte a la partida.
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.2 }}>Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre…"
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(148, 163, 184, 0.4)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#e2e8f0',
                fontSize: 14,
              }}
            />
          </label>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, letterSpacing: 0.2 }}>Color</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {COLOR_OPTIONS.map((option) => {
                const isSelected = option === color;
                return (
                  <button
                    key={option}
                    onClick={() => setColor(option)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      border: isSelected ? '3px solid #f8fafc' : '2px solid rgba(148,163,184,0.45)',
                      background: option,
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 0 0 6px rgba(56, 189, 248, 0.25)' : 'none',
                    }}
                    aria-label={`Seleccionar color ${option}`}
                  />
                );
              })}
            </div>
          </div>
          <button
            onClick={() => {
              if (!name.trim()) return;
              localStorage.setItem('name', name.trim());
              setReady(true);
            }}
            disabled={!name.trim()}
            style={{
              ...primaryButtonStyle,
              opacity: name.trim() ? 1 : 0.5,
              cursor: name.trim() ? 'pointer' : 'not-allowed',
              transform: name.trim() ? 'translateY(0)' : 'none',
            }}
          >
            Entrar al lobby
          </button>
          <div style={{ marginTop: 8 }}>
            <Leaderboard />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: pageBackground,
        color: '#e2e8f0',
        fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px 48px',
        boxSizing: 'border-box',
        gap: 24,
      }}
    >
      <HUD
        seed={gameSeed}
        isHost={isHost}
        mods={mods}
        players={players.map(({ id, name, color }) => ({ id, name, color }))}
      />

      <div
        style={{
          width: 'min(1180px, 100%)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 24,
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            ...cardBase,
            flex: '1 1 680px',
            maxWidth: '820px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>Lobby público</div>
                <div style={{ fontSize: 13, opacity: 0.65 }}>gameId: {gameId}</div>
              </div>
              {isHost ? (
                <button
                  onClick={handleStartGame}
                  disabled={started}
                  style={{
                    ...primaryButtonStyle,
                    opacity: started ? 0.5 : 1,
                    cursor: started ? 'not-allowed' : 'pointer',
                    transform: started ? 'none' : 'translateY(0)',
                  }}
                >
                  Iniciar partida · Espacio
                </button>
              ) : (
                <span style={{ fontSize: 13, opacity: 0.75 }}>Esperando al host…</span>
              )}
            </div>

            {isHost && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(['PORTALS', 'FAST', 'DOUBLE', 'TOXIC'] as Mod[]).map((option) => {
                    const checked = mods.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (started) return;
                          setMods((prev) => {
                            const has = prev.includes(option);
                            return has ? prev.filter((m) => m !== option) : [...prev, option];
                          });
                        }}
                        disabled={started}
                        style={{
                          padding: '10px 16px',
                          borderRadius: 999,
                          border: `1px solid ${checked ? 'rgba(56, 189, 248, 0.7)' : 'rgba(148, 163, 184, 0.35)'}`,
                          background: checked ? 'rgba(14, 165, 233, 0.22)' : 'rgba(148, 163, 184, 0.12)',
                          color: '#e2e8f0',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: started ? 'not-allowed' : 'pointer',
                          boxShadow: checked ? '0 18px 30px -12px rgba(14, 165, 233, 0.6)' : 'none',
                          opacity: started ? 0.6 : 1,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {modLabels[option]}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Obstáculos (%)
                    <input
                      type="number"
                      min={0}
                      max={25}
                      value={obstaclePct}
                      onChange={(e) =>
                        setObstaclePct(Math.max(0, Math.min(25, Number(e.target.value) || 0)))
                      }
                      disabled={started}
                      style={{
                        width: 72,
                        padding: '6px 10px',
                        borderRadius: 12,
                        border: '1px solid rgba(148, 163, 184, 0.4)',
                        background: 'rgba(15, 23, 42, 0.6)',
                        color: '#e2e8f0',
                      }}
                    />
                  </label>

                  <button
                    onClick={() => setSeedBump((value) => value + 1)}
                    disabled={started}
                    style={{
                      ...subtleButtonStyle,
                      opacity: started ? 0.6 : 1,
                      cursor: started ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Re-generar mapa
                  </button>
                </div>
              </div>
            )}

            {gameOverMsg && (
              <div
                style={{
                  borderRadius: 18,
                  padding: '12px 16px',
                  background: 'rgba(34, 197, 94, 0.16)',
                  border: '1px solid rgba(34, 197, 94, 0.4)',
                  color: '#bbf7d0',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {gameOverMsg}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Tu color dentro de la partida</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 10 }}>
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
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 12,
                      border: isSelected ? '3px solid #f8fafc' : '2px solid rgba(148,163,184,0.45)',
                      background: option,
                      cursor: takenByOther ? 'not-allowed' : 'pointer',
                      opacity: takenByOther ? 0.35 : 1,
                      position: 'relative',
                      boxShadow: isSelected ? '0 0 0 6px rgba(56, 189, 248, 0.25)' : 'none',
                      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                    }}
                    title={takenByOther ? 'Ocupado por otro jugador' : 'Disponible'}
                  >
                    {takenByOther && (
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#0f172a',
                          background: 'rgba(148, 163, 184, 0.45)',
                          borderRadius: 10,
                        }}
                      >
                        ✕
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <canvas
            ref={canvasRef}
            style={{
              alignSelf: 'center',
              borderRadius: 24,
              border: '1px solid rgba(148, 163, 184, 0.25)',
              background: 'rgba(2, 6, 23, 0.9)',
              boxShadow: '0 28px 45px -20px rgba(15, 23, 42, 0.9)',
              maxWidth: '100%',
            }}
          />

          <div style={{ fontSize: 13, opacity: 0.75, textAlign: 'center' }}>
            Controles: WASD / Flechas · Reinicio: Espacio (solo host)
          </div>
        </div>

        <div
          style={{
            ...cardBase,
            flex: '1 1 260px',
            maxWidth: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <Leaderboard />
          <button
            onClick={async () => {
              if (!confirm('¿Borrar todas las partidas del ranking?')) return;
              await supabase.from('matches').delete().gt('created_at', '1970-01-01T00:00:00Z');
              window.dispatchEvent(new CustomEvent('LB_REFRESH'));
            }}
            style={{
              ...subtleButtonStyle,
              alignSelf: 'flex-end',
              fontSize: 12,
            }}
          >
            Reset ranking
          </button>
        </div>
      </div>
    </div>
  );
}
