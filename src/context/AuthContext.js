"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import whitelist from '@/data/whitelist.json';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [isAuth, setIsAuth] = useState(false);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const savedUser = localStorage.getItem('rybak_user');
        if (savedUser) {
            const found = whitelist.users.find(u => u.user === savedUser);
            if (found) {
                setIsAuth(true);
                setUser(found.user);
            }
        }
        setLoading(false);
    }, []);

    const login = (username, password) => {
        const found = whitelist.users.find(
            u => u.user.toLowerCase() === username.toLowerCase().trim() &&
                u.pass.toLowerCase() === password.toLowerCase().trim()
        );

        if (found) {
            localStorage.setItem('rybak_user', found.user);
            setIsAuth(true);
            setUser(found.user);
            return { success: true };
        }
        return { success: false, message: 'Usuario o contraseña incorrectos' };
    };

    const logout = () => {
        localStorage.removeItem('rybak_user');
        setIsAuth(false);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ isAuth, user, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
