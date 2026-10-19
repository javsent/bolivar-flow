import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

let clientInstance = null;

/**
 * Returns the current Venezuela date string (YYYY-MM-DD) in America/Caracas timezone.
 * Use this everywhere instead of `new Date()` to avoid UTC offset issues on Vercel.
 */
export function getVenezuelaDate() {
  const now = new Date();
  // America/Caracas is UTC-4 (no DST)
  const offsetMs = -4 * 60 * 60 * 1000;
  const vetTime = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + offsetMs);
  return vetTime;
}

export function getDbClient() {
  if (clientInstance) return clientInstance;

  // 1. URL Remota (Turso / libSQL) — REQUIRED for Vercel production
  if (process.env.DATABASE_URL) {
    console.log("🔗 Conectando a base de datos remota (Turso/libSQL)...");
    clientInstance = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
    return clientInstance;
  }

  // 2. Archivo SQLite Local (solo para desarrollo)
  const isVercel = Boolean(process.env.VERCEL);

  if (isVercel) {
    console.warn("⚠️ ADVERTENCIA: Usando SQLite efímero en /tmp. Las tasas NO se persistirán entre invocaciones. Configure DATABASE_URL para producción.");
  }

  let dbFilePath;
  if (isVercel) {
    dbFilePath = "/tmp/bolivar_flow.db";
  } else {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {
        console.warn("⚠️ No se pudo crear directorio data/, usando /tmp");
        dbFilePath = path.join(process.env.TMPDIR || "/tmp", "bolivar_flow.db");
      }
    }
    if (!dbFilePath) {
      dbFilePath = path.join(dataDir, "bolivar_flow.db").replace(/\\/g, "/");
    }
  }

  clientInstance = createClient({
    url: `file:${dbFilePath}`,
  });

  return clientInstance;
}

export default getDbClient();
