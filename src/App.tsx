import { useEffect, useMemo, useRef, useState } from 'react';
import { joinGameChannel } from './net/realtime';
import { makeGame } from './game/Game';
import type { Dir, StartMsg, Mod } from './game/types';
import { HUD } from './ui/HUD';
import Leaderboard from './ui/Leaderboard';
import { supabase } from './supabaseClient';

const DEFAULT_TPS = 8;

export default function App() {
  // Nombre editable y persistente (antes de crear el canal)
  const [name, setName] = useState(() => localStorage.getItem('name') || '');
  const [color] = useState(() => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'));
  const gameId = useMemo(() => new URLSearchParams(location.search).get('g') || 'public', []);
  const [ready, setReady] = useState(() => Boolean(localStorage.getItem('name')));

  // hasta que el usuario confirme el nombre, no abrimos canal
  const me = useMemo(() => ({ id: crypto.randomUUID(), name: name || 'anon', color }), [name, color]);

  // seed base (actualizada en START real)
  const seedBase = useMemo(() => Date.now() % 2147483647, []);
  const [gameSeed, setGameSeed] = useState<number>(seedBase);

  // canal realtime (crearlo cuando esté listo el nombre)
  const realtime = useMemo(() => ready ? joinGameChannel(gameId, me) : null, [ready, gameId, me]);
  const sendStart = realtime?.sendStart!;
  const sendInput = realtime?.sendInput!;
  const sendState = realtime?.sendState!;
  const sendEnd   = realtime?.sendEnd!;

  // estado de UI / sim
  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<{ id: string; name: string; color: string }[]>([]);
  const [started, setStarted] = useState(false);
  const [mod, setMod] = useState<Mod>('DOUBLE');
  const [gameOverMsg, setGameOverMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<ReturnType<typeof makeGame> | null>(null);
  const inputsRef = useRef<Record<string, Dir>>({});
  const tickRef = useRef(0);

  // PRESENCE → host y jugadores
  useEffect(() => {
    if (!realtime) return;
    const onPresence = (e: any) => {
      const arr = e.detail as { id: string; name: string; color: string; joined_at: string }[];
      setPlayers(arr);
      setIsHost(arr.length > 0 && arr[0].id === me.id);
    };
    window.addEventListener('PRESENCE', onPresence as any);
    return () => window.removeEventListener('PRESENCE', onPresence as any);
  }, [realtime, me.id]);

  // Inicializa desde START
  function initFromStart(msg: StartMsg) {
    const { seed, w, h, mod, players } = msg;
    simRef.current = makeGame(seed, w, h, players, mod);
    setStarted(true);
    setMod(mod);
    setGameSeed(seed);
    setGameOverMsg(null);
    draw({
      snakes: simRef.current!.snakes,
      food: simRef.current!.food,
      obstacles: simRef.current!.obstacles,
      w, h,
    });
    tickRef.current = 0;
  }

  // Recibir START
  useEffect(() => {
    const onStart = (e: any) => initFromStart(e.detail as StartMsg);
    window.addEventListener('NET_START', onStart as any);
    return () => window.removeEventListener('NET_START', onStart as any);
  }, []);

  // Recibir END
  useEffect(() => {
    const onEnd = (e: any) => {
      const { winner, reason } = e.detail as { winner: string | null; reason: string };
      setStarted(false);
      setGameOverMsg(winner ? `🏁 Ganó ${winner} (${reason})` : `Fin de partida (${reason})`);
    };
    window.addEventListener('NET_END', onEnd as any);
    return () => window.removeEventListener('NET_END', onEnd as any);
  }, []);

  // Host: START + init local
  const handleStart = () => {
    if (!realtime) return;
    const list = players.length ? players : [{ id: me.id, name: me.name, color: me.color }];
    const ensureSelf = list.some((p) => p.id === me.id) ? list : [...list, { id: me.id, name: me.name, color: me.color }];

    const mods: Mod[] = ['FAST', 'PORTALS', 'DOUBLE', 'TOXIC'];
    const chosen = mods[seedBase % mods.length];
    const w = 32, h = 22;

    const startMsg: StartMsg = {
      seed: seedBase,
      w, h, mod: chosen,
      players: ensureSelf.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };

    sendStart(startMsg);
    initFromStart(startMsg); // el host no recibe eco
  };

  // Teclado: juego o reinicio con ESPACIO (host)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !started && isHost && ready) {
        e.preventDefault();
        handleStart();
        return;
      }
      const map: any = { ArrowUp:'UP', ArrowRight:'RIGHT', ArrowDown:'DOWN', ArrowLeft:'LEFT', w:'UP', d:'RIGHT', s:'DOWN', a:'LEFT' };
      const dir = map[e.key];
      if (!dir || !realtime) return;
      sendInput({ id: me.id, dir, tick: tickRef.current });
      if (isHost) inputsRef.current[me.id] = dir; // eco local del host
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, isHost, ready, realtime, sendInput, me.id]);

  // Red → INPUT / STATE
  useEffect(() => {
    const onNetInput = (e: any) => {
      const { id, dir } = e.detail;
      inputsRef.current[id] = dir;
    };
    const onNetState = (e: any) => {
      const st = e.detail;
      tickRef.current = st.tick;
      draw(st);
    };
    window.addEventListener('NET_INPUT', onNetInput as any);
    window.addEventListener('NET_STATE', onNetState as any);
    return () => {
      window.removeEventListener('NET_INPUT', onNetInput as any);
      window.removeEventListener('NET_STATE', onNetState as any);
    };
  }, []);

  // Bucle del host (simula, emite estado y FIN)
  useEffect(() => {
    if (!started) return;
    let handle: any;
    const loop = () => {
      if (isHost && simRef.current) {
        tickRef.current++;
        const st = simRef.current.step(inputsRef.current);
        inputsRef.current = {};
        // Fin: 0 o 1 vivos => END + persistencia
        const alive = st.snakes.filter((s: any) => s.alive).length;
        if (alive <= 1) {
          const winnerSnake = st.snakes.find((s: any) => s.alive);
          const winnerName = winnerSnake?.name ?? null;

          sendState({ tick: tickRef.current, ...st, mod });
          sendEnd({ winner: winnerName, reason: alive === 1 ? 'último en pie' : 'todos muertos' });
          setStarted(false);

          // Guardar en Supabase (no esperamos la promesa para no frenar la UI)
          if (winnerName) {
            const payload = {
              game_id: gameId,
              winner_id: winnerSnake.id,
              winner_name: winnerName,
              players: st.snakes.map((s: any) => ({ id: s.id, name: s.name, color: s.color })),
            };
            supabase.from('matches').insert(payload).then(() => {}).catch(() => {});
          }
          return;
        }
        sendState({ tick: tickRef.current, ...st, mod });
        draw({ tick: tickRef.current, ...st, mod });
      }
      const rate = mod === 'FAST' ? 12 : DEFAULT_TPS;
      handle = setTimeout(loop, 1000 / rate);
    };
    loop();
    return () => clearTimeout(handle);
  }, [started, isHost, mod, gameId]);

  // Render
  if (!ready) {
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
        <div style={{ fontWeight:700 }}>Elige tu nombre</div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Tu nombre…"
          style={{ padding:'8px 10px', border:'1px solid #ccc', borderRadius:8, width:260 }}
        />
        <button
          onClick={() => { if (!name.trim()) return; localStorage.setItem('name', name.trim()); setReady(true); }}
          disabled={!name.trim()}
          style={{ padding:'6px 12px' }}
        >
          Continuar
        </button>
        <div style={{ marginTop:16 }}><Leaderboard/></div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 8,
      }}
    >
      <HUD seed={gameSeed} isHost={isHost} mod={mod} players={players.map((p) => ({ id: p.id, name: p.name }))} />

      {!started && (
        <div style={{ display:'flex', gap:10, alignItems:'center', minHeight:40 }}>
          {isHost ? <button onClick={handleStart}>Start (Espacio)</button> : <span>Esperando START del host…</span>}
          {gameOverMsg && <span style={{ marginLeft: 12, opacity: 0.75 }}>{gameOverMsg}</span>}
        </div>
      )}

      <canvas ref={canvasRef} />
      <div style={{ fontSize: 12, opacity: 0.7 }}>Controles: WASD / Flechas · Reiniciar: Espacio (host) · gameId: {gameId}</div>

      {/* Ranking al pie */}
      <div style={{ position:'fixed', right:16, bottom:16 }}>
        <Leaderboard />
      </div>
    </div>
  );
}

// --------- Draw ----------
function draw(st: any) {
  const canvas = (document.querySelector('canvas') as HTMLCanvasElement)!;
  const ctx = canvas.getContext('2d')!;
  const cell = 20;

  canvas.width = st.w * cell;
  canvas.height = st.h * cell;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = '#000';
  for (let x = 0; x < st.w; x++) for (let y = 0; y < st.h; y++) ctx.fillRect(x * cell, y * cell, cell, cell);
  ctx.restore();

  ctx.fillStyle = '#444';
  st.obstacles.forEach((o: any) => ctx.fillRect(o.x * cell, o.y * cell, cell, cell));

  st.food.forEach((f: any) => { ctx.fillStyle = '#2ecc71'; ctx.fillRect(f.x * cell + 3, f.y * cell + 3, cell - 6, cell - 6); });

  st.snakes.forEach((s: any) => {
    ctx.fillStyle = s.color || '#3498db';
    s.body.forEach((b: any, i: number) => {
      const pad = i === 0 ? 1 : 3;
      ctx.fillRect(b.x * cell + pad, b.y * cell + pad, cell - pad * 2, cell - pad * 2);
    });
  });
}
