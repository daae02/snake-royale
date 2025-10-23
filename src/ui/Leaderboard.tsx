import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

type Row = { winner_name: string; count: number };

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function refetch() {
    setLoading(true);
    const { data, error } = await supabase
      .from('matches')
      .select('winner_name, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (!error && data) {
      const map = new Map<string, number>();
      for (const r of data) map.set(r.winner_name, (map.get(r.winner_name) || 0) + 1);
      const top = Array.from(map.entries())
        .map(([winner_name, count]) => ({ winner_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      setRows(top);
    } else {
      setRows([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    refetch();
    const reload = () => refetch();
    window.addEventListener('LB_REFRESH', reload);
    return () => window.removeEventListener('LB_REFRESH', reload);
  }, []);

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, width: 260, background: '#fff' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🏆 Ranking (wins)</div>
      {loading ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>Aún sin partidas registradas.</div>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {rows.map((r, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{r.winner_name}</span>
              <span style={{ opacity: 0.8 }}>{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
