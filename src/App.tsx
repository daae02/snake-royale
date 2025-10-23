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

type BroadcastState = GameRenderState & { tick: number; mod: Mod };

type EndEventPayload = { winner: string | null; reason: string };

type InputEventPayload = { id: string; dir: Dir };

type PresencePayload = PlayerInfo & { joined_at: string };

export default function App() {
  const [name, setName] = useState(() => localStorage.getItem('name') ?? '');
  const [ready, setReady] = useState(() => Boolean(localStorage.getItem('name')));
  const [color] = useState(
    () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
  );

  const playerId = useMemo(() => crypto.randomUUID(), []);
  const me = useMemo<PlayerInfo>(
    () => ({ id: playerId, name: name || 'anon', color }),
    [playerId, name, color],
  );

  const gameId = useMemo(() => new URLSearchParams(location.search).get('g') || 'public', []);
  const seedBase = useMemo(() => (Date.now() % 2147483647) >>> 0, []);
  const [seedBump, setSeedBump] = useState(0);
  const [gameSeed, setGameSeed] = useState(seedBase);

  const realtime = useMemo(() => (ready ? joinGameChannel(gameId, me) : null), [ready, gameId, me]);
  const sendStart = realtime?.sendStart ?? null;
  const sendInput = realtime?.sendInput ?? null;
  const sendState = realtime?.sendState ?? null;
  const sendEnd = realtime?.sendEnd ?? null;

  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [started, setStarted] = useState(false);
  const [mod, setMod] = useState<Mod>('PORTALS');
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
      const { seed, w, h, mod: nextMod, players: startPlayers } = msg;
      simRef.current = makeGame(seed, w, h, startPlayers, nextMod, obstaclePct / 100, MIN_SPAWN_DISTANCE);
      setStarted(true);
      setMod(nextMod);
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

    const w = 64;
    const h = 64;
    const startMsg: StartMsg = {
      seed: (seedBase + seedBump) >>> 0,
      w,
      h,
      mod,
      players: ensureSelf.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };

    sendStart(startMsg);
    initFromStart(startMsg);
  }, [sendStart, players, me, seedBase, seedBump, mod, initFromStart]);

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
        sendState({ tick: tickRef.current, ...state, mod });
        sendEnd({ winner: winner?.name ?? null, reason: aliveSnakes.length === 1 ? 'último en pie' : 'todos muertos' });
        setStarted(false);

        if (winner) {
          const payload = {
            game_id: gameId,
            winner_id: winner.id,
            winner_name: winner.name,
            players: state.snakes.map(({ id, name, color }) => ({ id, name, color })),
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

      sendState({ tick: tickRef.current, ...state, mod });
      drawState(state);

      const rate = mod === 'FAST' ? 12 : DEFAULT_TPS;
      timeoutId = setTimeout(runLoop, 1000 / rate);
    };

    runLoop();
    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [started, isHost, mod, sendState, sendEnd, drawState, gameId]);

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
      <HUD seed={gameSeed} isHost={isHost} mod={mod} players={players.map(({ id, name }) => ({ id, name }))} />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 40 }}>
        {isHost ? (
          <>
            <button onClick={handleStartGame} disabled={started}>
              Start (Espacio)
            </button>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Modo
              <select value={mod} onChange={(e) => setMod(e.target.value as Mod)} disabled={started}>
                <option value="PORTALS">PORTALS (infinito)</option>
                <option value="FAST">FAST</option>
                <option value="DOUBLE">DOUBLE</option>
                <option value="TOXIC">TOXIC</option>
              </select>
            </label>

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

      <canvas ref={canvasRef} />
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
            await supabase.from('matches').delete().neq('id', '');
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
