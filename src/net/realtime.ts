import { supabase } from '../supabaseClient';
import type { StartMsg } from '../game/types';

export function joinGameChannel(gameId: string, me: {id:string;name:string;color:string}) {
  const channel = supabase.channel(`snake:${gameId}`, { config: { presence: { key: me.id } } });
  let current = { ...me };

  const pushPresence = async (patch?: Partial<typeof me>) => {
    if (patch) current = { ...current, ...patch };
    await channel.track({ ...current, joined_at: new Date().toISOString() });
  };

  const presenceToArray = (pres:any)=> Object.entries(pres).flatMap(([key, items]: any) =>
    items.map((it:any) => ({ id: key as string, name: it.name as string, color: it.color as string, joined_at: it.joined_at as string }))
  );

  channel
    .on('presence', { event: 'sync' }, () => {
      const all = presenceToArray(channel.presenceState());
      all.sort((a,b) => (a.joined_at === b.joined_at) ? (a.id < b.id ? -1 : 1) : (a.joined_at < b.joined_at ? -1 : 1));
      window.dispatchEvent(new CustomEvent('PRESENCE', { detail: all }));
    })
    .on('broadcast', { event: 'START' }, ({ payload }) => window.dispatchEvent(new CustomEvent('NET_START', { detail: payload as StartMsg })))
    .on('broadcast', { event: 'INPUT' }, ({ payload }) => window.dispatchEvent(new CustomEvent('NET_INPUT', { detail: payload })))
    .on('broadcast', { event: 'STATE' }, ({ payload }) => window.dispatchEvent(new CustomEvent('NET_STATE', { detail: payload })))
    .on('broadcast', { event: 'END'   }, ({ payload }) => window.dispatchEvent(new CustomEvent('NET_END',   { detail: payload })))
    .subscribe(async status => { if (status === 'SUBSCRIBED') await pushPresence(); });

  return {
    channel,
    sendStart: (payload:any)=> channel.send({ type:'broadcast', event:'START', payload }),
    sendInput: (payload:any)=> channel.send({ type:'broadcast', event:'INPUT', payload }),
    sendState: (payload:any)=> channel.send({ type:'broadcast', event:'STATE', payload }),
    sendEnd:   (payload:any)=> channel.send({ type:'broadcast', event:'END',   payload }),
    updatePresence: (patch: Partial<typeof me>) => { void pushPresence(patch); },
    unsubscribe: () => { void channel.unsubscribe(); },
  };
}
