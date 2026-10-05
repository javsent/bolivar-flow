import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

let clientInstance = null;

export function getDbClient() {
  if (clientInstance) return clientInstance;

  // 1. URL Remota opcional (Turso / libSQL / Supabase / Neon si está configurado)
  if (process.env.DATABASE_URL) {
    clientInstance = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
    return clientInstance;
  }

  // 2. Archivo SQLite Local
  // En Vercel Serverless, solo /tmp es escribible
  const isVercel = Boolean(process.env.VERCEL);
  let dbFilePath;

  if (isVercel) {
    dbFilePath = "/tmp/bolivar_flow.db";
  } else {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {
        // En caso de permisos restringidos, fallback a tmp
      }
    }
    dbFilePath = path.join(dataDir, "bolivar_flow.db").replace(/\\/g, "/");
  }

  clientInstance = createClient({
    url: `file:${dbFilePath}`,
  });

  return clientInstance;
}

export default getDbClient();
