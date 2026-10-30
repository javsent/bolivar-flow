"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [isAuth, setIsAuth] = useState(false);
    const [user, setUser] = useState(null); // String username o perfil
    const [userData, setUserData] = useState(null); // { id, email, name, avatar }
    const [userSettings, setUserSettings] = useState(null); // { concepto_template, default_rate }
    const [authToken, setAuthToken] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const savedUser = localStorage.getItem('bolivarflow_user');
        const savedSettings = localStorage.getItem('bolivarflow_user_settings');
        const savedToken = localStorage.getItem('bolivarflow_auth_token');

        if (savedToken) {
            setAuthToken(savedToken);
        }

        if (savedUser) {
            try {
                const parsedUser = JSON.parse(savedUser);
                setUserData(parsedUser);
                setUser(parsedUser.name || parsedUser.email);
                setIsAuth(true);

                if (savedSettings) {
                    try {
                        setUserSettings(JSON.parse(savedSettings));
                    } catch (e) {}
                }

                // Sincronizar en background los settings más recientes de la DB
                if (parsedUser.id) {
                    fetch(`/api/user/settings?userId=${encodeURIComponent(parsedUser.id)}`, {
                        headers: savedToken ? { 'Authorization': `Bearer ${savedToken}` } : {},
                    })
                        .then(r => r.json())
                        .then(data => {
                            if (data.settings) {
                                setUserSettings(data.settings);
                                localStorage.setItem('bolivarflow_user_settings', JSON.stringify(data.settings));
                            }
                        })
                        .catch(() => {});
                }
            } catch (e) {}
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
            if (data.token) {
                setAuthToken(data.token);
                localStorage.setItem('bolivarflow_auth_token', data.token);
            }
            setIsAuth(true);

            localStorage.setItem('bolivarflow_user', JSON.stringify(data.user));
            if (data.settings) {
                localStorage.setItem('bolivarflow_user_settings', JSON.stringify(data.settings));
            }

            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    };

    // Login seguro contra Turso DB (Local/Whitelist)
    const login = async (username, password) => {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                return { success: false, message: data.error || 'Usuario o contraseña incorrectos' };
            }

            setUserData(data.user);
            setUser(data.user.name || data.user.email);
            setUserSettings(data.settings);
            if (data.token) {
                setAuthToken(data.token);
                localStorage.setItem('bolivarflow_auth_token', data.token);
            }
            setIsAuth(true);

            localStorage.setItem('bolivarflow_user', JSON.stringify(data.user));
            if (data.settings) {
                localStorage.setItem('bolivarflow_user_settings', JSON.stringify(data.settings));
            }

            return { success: true };
        } catch (error) {
            return { success: false, message: error.message || 'Error al conectar con el servidor' };
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
        const currentToken = authToken || localStorage.getItem('bolivarflow_auth_token');

        if (activeUserId) {
            try {
                await fetch('/api/user/settings', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
                    },
                    body: JSON.stringify({
                        userId: activeUserId,
                        ...newSettings,
                    }),
                });
            } catch (e) {
                console.warn('No se pudo guardar settings en DB:', e.message);
            }
        }
    }, [userData, authToken]);

    const logout = () => {
        localStorage.removeItem('bolivarflow_user');
        localStorage.removeItem('bolivarflow_auth_token');
        localStorage.removeItem('bolivarflow_user_settings');
        localStorage.removeItem('rybak_user');
        localStorage.removeItem('bolivarflow_google_user');
        setIsAuth(false);
        setUser(null);
        setUserData(null);
        setUserSettings(null);
        setAuthToken(null);
    };

    return (
        <AuthContext.Provider value={{ 
            isAuth, 
            user, 
            userData, 
            userSettings, 
            authToken,
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
