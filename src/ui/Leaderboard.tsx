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
    <div
      style={{
        width: '100%',
        borderRadius: 18,
        border: '1px solid rgba(148, 163, 184, 0.2)',
        background: 'linear-gradient(150deg, rgba(30, 41, 59, 0.78), rgba(15, 23, 42, 0.88))',
        padding: '18px 20px',
        color: '#e2e8f0',
        boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>🏆</span>
        <span style={{ fontSize: 15 }}>Ranking (wins)</span>
      </div>
      {loading ? (
        <div style={{ fontSize: 13, opacity: 0.65 }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.65 }}>Aún sin partidas registradas.</div>
      ) : (
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {rows.map((r, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ fontWeight: i === 0 ? 700 : 500 }}>{r.winner_name}</span>
              <span style={{ opacity: 0.7 }}>{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
