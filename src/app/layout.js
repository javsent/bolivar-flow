import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import LoginView from "@/components/LoginView";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Bolívar Flow",
  description: "Monitor de Tasas de Cambio - Rybak Software",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0",
};

// Componente interno para manejar el estado de autenticación
function AuthGuard({ children }) {
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

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark h-full">
      <body className={`${inter.className} h-full w-full bg-[#0f172a] flex flex-col`}>
        <AuthProvider>
          <AuthGuard>
            <main className="flex-1 overflow-y-auto custom-scrollbar">
              {children}
            </main>
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}