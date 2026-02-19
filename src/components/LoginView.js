"use client";
import React, { useState } from 'react';
import { BoltIcon } from '@heroicons/react/24/outline';
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
        <div className="fixed inset-0 z-[100] bg-[#0f172a] flex items-center justify-center p-4 font-sans">
            <div className="w-full max-w-md bg-[#1e293b] p-8 rounded-3xl border border-slate-700 shadow-2xl text-center animate-in zoom-in duration-300">
                <div className="mb-6">
                    <BoltIcon className="h-12 w-12 text-blue-500 mx-auto mb-2 animate-pulse" />
                    <h1 className="text-2xl font-black uppercase tracking-tighter text-emerald-400">
                        BOLÍVAR <span className="text-blue-500">FLOW</span>
                    </h1>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Calculadora Monetaria</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder="@usuario"
                            className={`w-full bg-slate-900 border ${error ? 'border-red-500 animate-pulse' : 'border-slate-700'} rounded-xl p-4 text-center text-white outline-none focus:border-emerald-500 transition-all font-mono`}
                            required
                        />
                        <input
                            type="password"
                            value={passInput}
                            onChange={(e) => setPassInput(e.target.value)}
                            placeholder="Contraseña"
                            className={`w-full bg-slate-900 border ${error ? 'border-red-500 animate-pulse' : 'border-slate-700'} rounded-xl p-4 text-center text-white outline-none focus:border-emerald-500 transition-all font-mono`}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-4 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20 disabled:opacity-50"
                        >
                            {loading ? 'Entrando...' : 'Acceder al Sistema'}
                        </button>

                        <button
                            type="button"
                            onClick={handleGuestLogin}
                            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-bold uppercase py-3 rounded-xl transition-all active:scale-95 border border-slate-700 text-[11px] tracking-widest"
                        >
                            Entrar como Invitado
                        </button>
                        <p className="text-[8px] text-slate-300 items-center align-middle uppercase tracking-widest pt-0"> Contacto: rybak.software@gmail.com</p>
                        <p className="text-[6px] text-slate-500 items-center align-middle uppercase tracking-widest pt-0"> Rybak.Software © 2026 - Todos los derechos reservados</p>
                    </div>
                </form>

                {error && (
                    <p className="text-red-400 text-[9px] font-bold uppercase mt-4 tracking-wider animate-in fade-in">
                        Acceso denegado: Credenciales incorrectas
                    </p>
                )}
            </div>
        </div>
    );
}
