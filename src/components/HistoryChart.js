"use client";

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/solid';

const HistoryChart = ({ data }) => {
  const chartData = [...data].reverse().map(item => ({
    dia: item.fecha.split('/')[0], 
    usd: item.usd,
    euro: item.euro,
    fullDate: item.fecha
  }));

  if (chartData.length < 2) return null;

  const lastDay = chartData[chartData.length - 1];
  const firstDay = chartData[0];

  const calcDiff = (curr) => {
    const diff = lastDay[curr] - firstDay[curr];
    const percentage = (diff / firstDay[curr]) * 100;
    return { monto: diff, pct: percentage, isUp: diff >= 0 };
  };

  const diffUsd = calcDiff('usd');
  const diffEur = calcDiff('euro');

  const handleCopy = (valor, moneda) => {
    const texto = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 4 }).format(valor);
    navigator.clipboard.writeText(texto).then(() => {
      alert(`${moneda}: ${texto} copiado!`);
    });
  };

  return (
    <div className="relative w-full bg-[#1e293b] rounded-xl p-4 border border-[#334155] mb-6 select-none shadow-inner">
      <div className="w-full h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id="colorUsd" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorEur" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="dia" stroke="#94a3b8" tick={{fontSize: 10}} axisLine={false} tickLine={false} />
            <YAxis stroke="#94a3b8" tick={{fontSize: 10}} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip />} />
            <Area isAnimationActive={false} type="monotone" dataKey="euro" stroke="#3b82f6" strokeWidth={2} fill="url(#colorEur)" activeDot={{ r: 7, style: { cursor: 'pointer' }, onClick: (_, e) => handleCopy(e.payload.euro, 'EUR€') }} />
            <Area isAnimationActive={false} type="monotone" dataKey="usd" stroke="#10b981" strokeWidth={2} fill="url(#colorUsd)" activeDot={{ r: 7, style: { cursor: 'pointer' }, onClick: (_, e) => handleCopy(e.payload.usd, 'USD$') }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-[#334155] flex gap-4">
        <div className="flex-1 bg-[#0f172a] p-3 rounded-lg border border-[#10b981]/20">
            <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-[#10b981] uppercase">Variación USD$</span>
                {diffUsd.isUp ? <ArrowTrendingUpIcon className="h-3 w-3 text-[#10b981]" /> : <ArrowTrendingDownIcon className="h-3 w-3 text-red-500" />}
            </div>
            <div className="flex items-baseline gap-1">
                <span className={`text-sm font-mono font-bold ${diffUsd.isUp ? 'text-white' : 'text-red-400'}`}>
                    {diffUsd.isUp ? '+' : ''}{new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(diffUsd.monto)}
                </span>
                <span className={`text-[9px] font-bold ${diffUsd.isUp ? 'text-[#10b981]' : 'text-red-500'}`}>
                    ({diffUsd.pct.toFixed(2)}%)
                </span>
            </div>
        </div>

        <div className="flex-1 bg-[#0f172a] p-3 rounded-lg border border-[#3b82f6]/20">
            <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-[#3b82f6] uppercase">Variación EUR€</span>
                {diffEur.isUp ? <ArrowTrendingUpIcon className="h-3 w-3 text-[#3b82f6]" /> : <ArrowTrendingDownIcon className="h-3 w-3 text-red-500" />}
            </div>
            <div className="flex items-baseline gap-1">
                <span className={`text-sm font-mono font-bold ${diffEur.isUp ? 'text-white' : 'text-red-400'}`}>
                    {diffEur.isUp ? '+' : ''}{new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(diffEur.monto)}
                </span>
                <span className={`text-[9px] font-bold ${diffEur.isUp ? 'text-[#3b82f6]' : 'text-red-500'}`}>
                    ({diffEur.pct.toFixed(2)}%)
                </span>
            </div>
        </div>
      </div>
    </div>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const { fullDate } = payload[0].payload;
    return (
      <div className="bg-[#0f172a] border border-[#334155] p-3 rounded-lg shadow-2xl text-xs">
        <p className="text-slate-400 mb-2 font-mono border-b border-[#334155] pb-1 font-bold">{fullDate}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.stroke }} className="font-bold font-mono mb-1">
            {entry.name === 'usd' ? 'USD$: ' : 'EUR€: '}
            <span className="text-slate-200">{new Intl.NumberFormat('de-DE', { minimumFractionDigits: 4 }).format(entry.value)}</span>
          </p>
        ))}
        <p className="text-[9px] text-slate-500 mt-2 italic pt-1 border-t border-[#334155]/50 text-center">Click en el punto para copiar</p>
      </div>
    );
  }
  return null;
};

export default HistoryChart;