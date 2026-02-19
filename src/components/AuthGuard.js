"use client";

import { useAuth } from "@/context/AuthContext";
import LoginView from "@/components/LoginView";

export default function AuthGuard({ children }) {
    const { isAuth, loading } = useAuth();

    if (loading) {
        return (
            <div className="h-full w-full bg-[#0f172a] flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!isAuth) {
        return <LoginView />;
    }

    return children;
}
