import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Bolívar Flow",
  description: "Monitor de Tasas de Cambio - Rybak Software",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark h-full">
      <body className={`${inter.className} h-full w-full bg-[#0f172a] overflow-hidden flex items-center justify-center`}>
        <div className="h-full w-full md:h-auto md:w-full md:max-w-[480px] md:aspect-[9/18] md:max-h-[92vh] md:p-[2px] bg-gradient-to-br from-emerald-400 via-blue-500 to-purple-600 md:rounded-[28px] overflow-hidden md:shadow-2xl flex flex-col transition-all duration-300">
            <div className="flex-1 w-full bg-[#0f172a] rounded-none md:rounded-[26px] overflow-hidden flex flex-col">
                <main className="flex-1 overflow-y-auto custom-scrollbar pt-2 md:pt-6">
                    {children}
                </main>
            </div>
        </div>
      </body>
    </html>
  );
}