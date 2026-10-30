"use client";
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Script from 'next/script';
import { useAuth } from '@/context/AuthContext';

export default function LoginView() {
    const { login, loginWithGoogle } = useAuth();
    const [userInput, setUserInput] = useState('');
    const [passInput, setPassInput] = useState('');
    const [error, setError] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [showLegacyLogin, setShowLegacyLogin] = useState(false);
    const googleBtnRef = useRef(null);

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "173592708065-1m316mss15guub2csg0f4jkhuoea0fct.apps.googleusercontent.com";

    const handleGoogleCallback = async (response) => {
        if (!response.credential) return;
        setLoading(true);
        const res = await loginWithGoogle(response.credential);
        if (!res.success) {
            setError(true);
            setErrorMessage(res.message || 'Error en autenticación con Google');
            setTimeout(() => setError(false), 3000);
        }
        setLoading(false);
    };

    const initGoogleBtn = () => {
        if (typeof window !== 'undefined' && window.google?.accounts?.id && clientId && googleBtnRef.current) {
            try {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: handleGoogleCallback,
                    auto_select: false,
                    cancel_on_tap_outside: true,
                });

                // Limpiar cualquier render previo antes de renderizar
                googleBtnRef.current.innerHTML = '';

                window.google.accounts.id.renderButton(googleBtnRef.current, {
                    theme: 'filled_black',
                    size: 'large',
                    text: 'signin_with',
                    shape: 'pill',
                    width: 280,
                    logo_alignment: 'left',
                });
            } catch (err) {
                console.error("Error al inicializar Google Sign-In:", err);
            }
        }
    };

    useEffect(() => {
        initGoogleBtn();
        // Reintentar mientras el script de Google no haya cargado o el botón no se haya renderizado
        // Usamos un intervalo más largo (10s) para conexiones lentas
        const timer = setInterval(() => {
            if (window.google?.accounts?.id && googleBtnRef.current && !googleBtnRef.current.hasChildNodes()) {
                initGoogleBtn();
            }
        }, 400);

        const timeout = setTimeout(() => clearInterval(timer), 10000);

        return () => {
            clearInterval(timer);
            clearTimeout(timeout);
        };
    }, [clientId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const res = await login(userInput, passInput);
        if (!res.success) {
            setError(true);
            setErrorMessage(res.message || 'Usuario o contraseña incorrectos');
            setTimeout(() => setError(false), 2500);
        }
        setLoading(false);
    };

    const handleGuestLogin = async () => {
        setLoading(true);
        const res = await login('@invitado', 'invitado');
        if (!res.success) {
            setError(true);
            setErrorMessage(res.message || 'Error al iniciar sesión de invitado');
            setTimeout(() => setError(false), 2500);
        }
        setLoading(false);
    };

    return (
        <>
            <Script
                src="https://accounts.google.com/gsi/client"
                strategy="afterInteractive"
                onLoad={initGoogleBtn}
            />

            <div className="fixed inset-0 z-[100] bg-[#070b14] flex items-center justify-center p-4 font-sans">
                <div className="w-full max-w-sm glass-card p-6 sm:p-7 rounded-3xl border border-white/10 text-center animate-slide-up shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#3ddc97]/10 rounded-full blur-2xl pointer-events-none"></div>
                    <div className="absolute bottom-0 left-0 w-32 h-32 bg-[#5ba8e5]/10 rounded-full blur-2xl pointer-events-none"></div>

                    <div className="mb-5 flex flex-col items-center">
                        <div className="relative w-14 h-14 mb-3 rounded-2xl overflow-hidden border border-[#3ddc97]/30 bg-[#0d1527] flex items-center justify-center shadow-lg shadow-[#3ddc97]/10">
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
                            <h1 className="text-2xl font-black uppercase tracking-tight leading-none">
                                <span className="brand-gradient-text">BOLÍVAR</span>{" "}
                                <span className="blue-gradient-text">FLOW</span>
                            </h1>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#3ddc97]/15 border border-[#3ddc97]/30 text-[#3ddc97]">
                                v2.1
                            </span>
                        </div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-[0.25em] font-semibold mt-1">
                            Acceso al Sistema
                        </p>
                    </div>

                    {/* BOTÓN OFICIAL DE GOOGLE */}
                    <div className="flex flex-col items-center justify-center my-3 min-h-[46px]">
                        <div ref={googleBtnRef} className="flex justify-center w-full"></div>
                    </div>

                    <div className="flex items-center my-3.5 gap-3">
                        <div className="flex-1 h-px bg-white/10"></div>
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">o</span>
                        <div className="flex-1 h-px bg-white/10"></div>
                    </div>

                    {/* LOGIN CON CONTRASEÑA O MODO INVITADO */}
                    {!showLegacyLogin ? (
                        <div className="space-y-2">
                            <button
                                type="button"
                                disabled={loading}
                                onClick={handleGuestLogin}
                                className="w-full bg-[#0d1527] hover:bg-slate-800 text-slate-200 hover:text-white font-bold uppercase py-3 rounded-xl transition-all active:scale-95 border border-white/10 text-xs tracking-wider disabled:opacity-50"
                            >
                                {loading ? 'Accediendo...' : 'Entrar como Invitado'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowLegacyLogin(true)}
                                className="text-[10px] text-slate-400 hover:text-[#3ddc97] underline decoration-dotted transition-colors font-mono"
                            >
                                Iniciar con usuario y clave
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <input
                                type="text"
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                placeholder="@usuario"
                                className={`w-full bg-slate-950/80 border ${error ? 'border-red-500 ring-1 ring-red-500/50' : 'border-white/10'} rounded-xl p-3 text-center text-white outline-none focus:border-[#3ddc97]/60 transition-all font-mono text-sm`}
                                required
                            />
                            <input
                                type="password"
                                value={passInput}
                                onChange={(e) => setPassInput(e.target.value)}
                                placeholder="Contraseña"
                                className={`w-full bg-slate-950/80 border ${error ? 'border-red-500 ring-1 ring-red-500/50' : 'border-white/10'} rounded-xl p-3 text-center text-white outline-none focus:border-[#3ddc97]/60 transition-all font-mono text-sm`}
                                required
                            />
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black uppercase tracking-wider py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/30 text-xs disabled:opacity-50"
                            >
                                {loading ? 'Accediendo...' : 'Ingresar'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowLegacyLogin(false)}
                                className="text-[10px] text-slate-400 hover:text-slate-200 font-mono block mx-auto"
                            >
                                Cancelar
                            </button>
                        </form>
                    )}

                    {error && (
                        <p className="text-red-400 text-[10px] font-bold uppercase mt-3 tracking-wider animate-slide-up">
                            {errorMessage || 'Acceso denegado'}
                        </p>
                    )}

                    <div className="pt-4 mt-4 border-t border-white/5 text-[10px] text-slate-500 space-y-0.5 font-mono">
                        <p>rybak.software@gmail.com</p>
                        <p className="text-[9px]">Rybak Software © 2026</p>
                    </div>
                </div>
            </div>
        </>
    );
}
