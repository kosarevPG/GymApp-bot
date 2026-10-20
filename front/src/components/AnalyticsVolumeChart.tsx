import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export default function AnalyticsVolumeChart({ data }: { data: { name: string; volume: number }[] }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
      <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} />
      <Tooltip contentStyle={{ backgroundColor: '#27272a', border: '1px solid #3f3f46' }} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString('ru') + ' кг', 'Тоннаж']} />
      <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>;
}
