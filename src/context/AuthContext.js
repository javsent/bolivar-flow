"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import whitelist from '@/data/whitelist.json';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [isAuth, setIsAuth] = useState(false);
    const [user, setUser] = useState(null); // String username o perfil
    const [userData, setUserData] = useState(null); // { id, email, name, avatar }
    const [userSettings, setUserSettings] = useState(null); // { concepto_template, default_rate }
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const savedGoogle = localStorage.getItem('bolivarflow_google_user');
        const savedSettings = localStorage.getItem('bolivarflow_user_settings');
        const savedUser = localStorage.getItem('rybak_user');

        if (savedGoogle) {
            try {
                const parsedGoogle = JSON.parse(savedGoogle);
                setUserData(parsedGoogle);
                setUser(parsedGoogle.name || parsedGoogle.email);
                setIsAuth(true);

                if (savedSettings) {
                    try {
                        setUserSettings(JSON.parse(savedSettings));
                    } catch (e) {}
                }

                // Sincronizar en background los settings más recientes de la DB
                fetch(`/api/user/settings?userId=${encodeURIComponent(parsedGoogle.id)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data.settings) {
                            setUserSettings(data.settings);
                            localStorage.setItem('bolivarflow_user_settings', JSON.stringify(data.settings));
                        }
                    })
                    .catch(() => {});
            } catch (e) {}
        } else if (savedUser) {
            const found = whitelist.users.find(u => u.user === savedUser);
            if (found) {
                setIsAuth(true);
                setUser(found.user);
                setUserData({ id: `local_${found.user}`, name: found.user });
                if (savedSettings) {
                    try {
                        setUserSettings(JSON.parse(savedSettings));
                    } catch (e) {}
                }
            }
        }
        setLoading(false);
    }, []);

    // Login con credencial de Google
    const loginWithGoogle = async (credential) => {
        try {
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                return { success: false, message: data.error || 'Error al autenticar con Google' };
            }

            setUserData(data.user);
            setUser(data.user.name || data.user.email);
            setUserSettings(data.settings);
            setIsAuth(true);

            localStorage.setItem('bolivarflow_google_user', JSON.stringify(data.user));
            if (data.settings) {
                localStorage.setItem('bolivarflow_user_settings', JSON.stringify(data.settings));
            }
            localStorage.removeItem('rybak_user');

            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    };

    // Actualizar settings del usuario y persistir en DB + localStorage
    const saveSettings = useCallback(async (newSettings) => {
        setUserSettings(prev => {
            const updated = { ...prev, ...newSettings };
            localStorage.setItem('bolivarflow_user_settings', JSON.stringify(updated));
            return updated;
        });

        const activeUserId = userData?.id;
        if (activeUserId) {
            try {
                await fetch('/api/user/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: activeUserId,
                        ...newSettings,
                    }),
                });
            } catch (e) {
                console.warn('No se pudo guardar settings en DB:', e.message);
            }
        }
    }, [userData]);

    const login = (username, password) => {
        const found = whitelist.users.find(
            u => u.user.toLowerCase() === username.toLowerCase().trim() &&
                u.pass.toLowerCase() === password.toLowerCase().trim()
        );

        if (found) {
            localStorage.setItem('rybak_user', found.user);
            localStorage.removeItem('bolivarflow_google_user');
            setIsAuth(true);
            setUser(found.user);
            setUserData({ id: `local_${found.user}`, name: found.user });
            return { success: true };
        }
        return { success: false, message: 'Usuario o contraseña incorrectos' };
    };

    const logout = () => {
        localStorage.removeItem('rybak_user');
        localStorage.removeItem('bolivarflow_google_user');
        localStorage.removeItem('bolivarflow_user_settings');
        setIsAuth(false);
        setUser(null);
        setUserData(null);
        setUserSettings(null);
    };

    return (
        <AuthContext.Provider value={{ 
            isAuth, 
            user, 
            userData, 
            userSettings, 
            login, 
            loginWithGoogle, 
            saveSettings, 
            logout, 
            loading 
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
