import { supabase } from '../supabaseClient';
import type { StartMsg } from '../game/types';

export function joinGameChannel(gameId: string, me: {id:string;name:string;color:string}) {
  const channel = supabase.channel(`snake:${gameId}`, {
    config: { presence: { key: me.id } }
  });

  // Estado interno (no React)
  const state = {
    isHost: false,
    hostId: null as string | null
  };

  const presenceToArray = (pres:any)=> {
    // pres = { userId: [ { name,color,joined_at }, ... ], ... }
    return Object.entries(pres).flatMap(([key, items]: any) =>
      items.map((it:any) => ({
        id: key as string,
        name: it.name as string,
        color: it.color as string,
        joined_at: it.joined_at as string
      }))
    );
  };

  channel
    .on('presence', { event: 'sync' }, () => {
      const all = presenceToArray(channel.presenceState());
      // ordenar por joined_at y en empate por id (tiebreaker estable)
      all.sort((a,b) => {
        if (a.joined_at === b.joined_at) return a.id < b.id ? -1 : 1;
        return a.joined_at < b.joined_at ? -1 : 1;
      });
      state.hostId = all[0]?.id ?? null;
      state.isHost = state.hostId === me.id;

      // Notificar a React
      window.dispatchEvent(new CustomEvent('PRESENCE', { detail: all }));
    })
    .on('broadcast', { event: 'START' }, ({ payload }) => {
      window.dispatchEvent(new CustomEvent('NET_START', { detail: payload as StartMsg }));
    })
    .on('broadcast', { event: 'INPUT' }, ({ payload }) => {
      window.dispatchEvent(new CustomEvent('NET_INPUT', { detail: payload }));
    })
    .on('broadcast', { event: 'STATE' }, ({ payload }) => {
      window.dispatchEvent(new CustomEvent('NET_STATE', { detail: payload }));
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ ...me, joined_at: new Date().toISOString() });
      }
    });

  const sendStart = (payload:StartMsg)=> channel.send({ type:'broadcast', event:'START', payload });
  const sendInput = (payload:any)=> channel.send({ type:'broadcast', event:'INPUT', payload });
  const sendState = (payload:any)=> channel.send({ type:'broadcast', event:'STATE', payload });

  return { channel, state, sendStart, sendInput, sendState };
}
