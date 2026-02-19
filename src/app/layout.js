import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Bolívar Flow",
  description: "Monitor de Tasas de Cambio - Rybak Software",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0",
};


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