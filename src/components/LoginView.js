"use client";
import React, { useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';

export default function LoginView() {
    const { login } = useAuth();
    const [userInput, setUserInput] = useState('');
    const [passInput, setPassInput] = useState('');
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        setLoading(true);
        const res = login(userInput, passInput);
        if (!res.success) {
            setError(true);
            setTimeout(() => setError(false), 2000);
        }
        setLoading(false);
    };

    const handleGuestLogin = () => {
        login('@invitado', 'invitado');
    };

    return (
        <div className="fixed inset-0 z-[100] bg-[#070b14] flex items-center justify-center p-4 font-sans">
            <div className="w-full max-w-sm glass-card p-7 sm:p-8 rounded-3xl border border-slate-800 text-center animate-slide-up shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"></div>

                <div className="mb-6 flex flex-col items-center">
                    <div className="relative w-14 h-14 mb-3 rounded-2xl overflow-hidden border border-emerald-500/30 bg-[#070b14] flex items-center justify-center shadow-lg shadow-emerald-500/10">
                        <Image
                            src="/logo.png"
                            alt="Bolívar Flow"
                            width={56}
                            height={56}
                            priority
                            className="object-contain"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-black uppercase tracking-tight">
                            <span className="emerald-gradient-text">BOLÍVAR</span> <span className="blue-gradient-text">FLOW</span>
                        </h1>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                            v2.0
                        </span>
                    </div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-[0.25em] font-semibold mt-1">
                        Acceso al Sistema
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3.5">
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder="@usuario"
                            className={`w-full bg-slate-950/80 border ${error ? 'border-red-500 ring-1 ring-red-500/50' : 'border-slate-800'} rounded-xl p-3.5 text-center text-white outline-none focus:border-emerald-500/60 transition-all font-mono text-sm`}
                            required
                        />
                        <input
                            type="password"
                            value={passInput}
                            onChange={(e) => setPassInput(e.target.value)}
                            placeholder="Contraseña"
                            className={`w-full bg-slate-950/80 border ${error ? 'border-red-500 ring-1 ring-red-500/50' : 'border-slate-800'} rounded-xl p-3.5 text-center text-white outline-none focus:border-emerald-500/60 transition-all font-mono text-sm`}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2.5 pt-1">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black uppercase tracking-wider py-3.5 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/30 text-xs disabled:opacity-50"
                        >
                            {loading ? 'Accediendo...' : 'Iniciar Sesión'}
                        </button>

                        <button
                            type="button"
                            onClick={handleGuestLogin}
                            className="w-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white font-bold uppercase py-3 rounded-xl transition-all active:scale-95 border border-slate-800 text-[11px] tracking-wider"
                        >
                            Entrar como Invitado
                        </button>
                        
                        <div className="pt-3 border-t border-slate-800/80 text-[10px] text-slate-500 space-y-0.5 font-mono">
                            <p>rybak.software@gmail.com</p>
                            <p className="text-[9px]">Rybak Software © 2026</p>
                        </div>
                    </div>
                </form>

                {error && (
                    <p className="text-red-400 text-[10px] font-bold uppercase mt-3 tracking-wider animate-slide-up">
                        Acceso denegado: Credenciales incorrectas
                    </p>
                )}
            </div>
        </div>
    );
}
