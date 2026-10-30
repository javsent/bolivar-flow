import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

let clientInstance = null;

/**
 * Retorna un objeto Date con la hora y fecha de Venezuela (America/Caracas - UTC-4 sin DST).
 * Utiliza Intl.DateTimeFormat para máxima precisión y robustez en entornos serverless.
 */
export function getVenezuelaDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  return new Date(`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`);
}

/**
 * Retorna la URL base canónica de la aplicación para llamadas internas de servidor.
 * Evita llamar a URLs de previews o puertos erróneos.
 */
export function getAppBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export function getDbClient() {
  if (clientInstance) return clientInstance;

  // 1. URL Remota (Turso / libSQL) — REQUERIDO para producción en Vercel
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
    console.warn("⚠️ ADVERTENCIA: Usando SQLite efímero en /tmp. Configure DATABASE_URL para producción.");
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
