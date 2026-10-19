import { getDbClient } from './db.js';

let isUserDbInitialized = false;
let userInitPromise = null;

export async function initUserDatabase() {
  if (isUserDbInitialized) return;
  if (userInitPromise) return userInitPromise;

  userInitPromise = (async () => {
    const db = getDbClient();

    // Tabla de usuarios
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        avatar TEXT,
        role TEXT DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Tabla de configuraciones por usuario
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        concepto_template TEXT,
        default_rate TEXT DEFAULT 'bcv',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    isUserDbInitialized = true;
  })();

  return userInitPromise;
}

export async function upsertGoogleUser({ id, email, name, avatar }) {
  await initUserDatabase();
  const db = getDbClient();

  const now = new Date().toISOString();
  const safeId = String(id || '');
  const safeEmail = email || null;
  const safeName = name || email || 'Usuario';
  const safeAvatar = avatar || null;

  // 1. Upsert usuario
  await db.execute({
    sql: `
      INSERT INTO users (id, email, name, avatar, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        avatar = excluded.avatar
    `,
    args: [safeId, safeEmail, safeName, safeAvatar, now],
  });

  // 2. Obtener o crear settings
  const settingsRes = await db.execute({
    sql: `SELECT * FROM user_settings WHERE user_id = ?`,
    args: [safeId],
  });

  let settings = settingsRes.rows[0];
  if (!settings) {
    const defaultTemplate = "Pago de $usd $divisa equivalente a Bs. $bs, según tasa $fuente $tasa del $fecha.";
    await db.execute({
      sql: `INSERT INTO user_settings (user_id, concepto_template, default_rate, updated_at) VALUES (?, ?, ?, ?)`,
      args: [safeId, defaultTemplate, 'bcv', now],
    });
    settings = {
      user_id: safeId,
      concepto_template: defaultTemplate,
      default_rate: 'bcv',
      updated_at: now,
    };
  }

  return {
    user: { id: safeId, email: safeEmail, name: safeName, avatar: safeAvatar },
    settings,
  };
}

export async function getUserSettings(userId) {
  if (!userId) return null;
  await initUserDatabase();
  const db = getDbClient();

  const res = await db.execute({
    sql: `SELECT * FROM user_settings WHERE user_id = ?`,
    args: [String(userId)],
  });

  return res.rows[0] || null;
}

export async function updateUserSettings(userId, { concepto_template, default_rate }) {
  if (!userId) return null;
  await initUserDatabase();
  const db = getDbClient();

  const now = new Date().toISOString();
  const safeUserId = String(userId);
  const safeTemplate = concepto_template !== undefined ? concepto_template : null;
  const safeRate = default_rate !== undefined ? default_rate : null;

  await db.execute({
    sql: `
      INSERT INTO user_settings (user_id, concepto_template, default_rate, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        concepto_template = COALESCE(excluded.concepto_template, user_settings.concepto_template),
        default_rate = COALESCE(excluded.default_rate, user_settings.default_rate),
        updated_at = excluded.updated_at
    `,
    args: [
      safeUserId,
      safeTemplate,
      safeRate,
      now,
    ],
  });

  return getUserSettings(safeUserId);
}
