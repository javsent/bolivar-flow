import crypto from 'crypto';
import { getDbClient } from './db.js';

let isUserDbInitialized = false;
let userInitPromise = null;

const AUTH_SECRET = process.env.CRON_SECRET || process.env.DATABASE_AUTH_TOKEN || 'bolivar-flow-auth-secret-key-2026';

/**
 * Genera un hash criptográfico PBKDF2 (SHA-512) para una contraseña.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Compara una contraseña con el hash almacenado de forma segura contra timing attacks.
 */
export function comparePassword(password, storedHash) {
  if (!password || !storedHash || !storedHash.includes(':')) return false;
  try {
    const [salt, originalHash] = storedHash.split(':');
    const computedHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch (err) {
    return false;
  }
}

/**
 * Crea un token de sesión firmado para verificar requests del usuario sin exponer secretos.
 */
export function createSessionToken(userId) {
  const data = `${userId}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('hex');
  return Buffer.from(`${data}:${hmac}`).toString('base64');
}

/**
 * Valida un token de sesión firmado y retorna el userId si es válido.
 */
export function verifySessionToken(authHeaderOrToken) {
  if (!authHeaderOrToken) return null;
  const token = authHeaderOrToken.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const parts = raw.split(':');
    if (parts.length < 3) return null;
    const [userId, timestamp, signature] = parts;

    const data = `${userId}:${timestamp}`;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      return userId;
    }
  } catch (err) {
    return null;
  }
  return null;
}

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
        password_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Asegurar columna password_hash si fue creada antes
    try {
      await db.execute(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
    } catch (e) {
      // Ignorar si ya existe
    }

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

    // Sembrar usuarios locales iniciales si la tabla de usuarios está vacía
    const userCount = await db.execute(`SELECT count(*) as count FROM users`);
    if (Number(userCount.rows[0]?.count || 0) === 0) {
      const defaultUsers = [
        { id: 'local_@blancaRybak', name: '@blancaRybak', pass: 'blanca', role: 'user' },
        { id: 'local_@diegoDelgado', name: '@diegoDelgado', pass: 'diego', role: 'user' },
        { id: 'local_@javierRybak', name: '@javierRybak', pass: 'javier', role: 'admin' },
        { id: 'local_@davidPina', name: '@davidPina', pass: 'david', role: 'user' },
        { id: 'local_Rybakasa', name: 'Rybakasa', pass: 'rybak', role: 'user' },
        { id: 'local_@invitado', name: '@invitado', pass: 'invitado', role: 'guest' },
        { id: 'local_@admin', name: '@admin', pass: 'admin123', role: 'admin' },
      ];
      for (const u of defaultUsers) {
        const hash = hashPassword(u.pass);
        await db.execute({
          sql: `INSERT INTO users (id, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash`,
          args: [u.id, u.name, hash, u.role],
        });
      }
    }

    isUserDbInitialized = true;
  })();

  return userInitPromise;
}

/**
 * Autentica un usuario local verificando credenciales en la base de datos Turso.
 */
export async function authenticateLocalUser(username, password) {
  if (!username || !password) return null;
  await initUserDatabase();
  const db = getDbClient();

  const cleanUser = username.trim();

  // Buscar coincidencia por nombre o id
  const res = await db.execute({
    sql: `SELECT id, name, email, avatar, role, password_hash FROM users WHERE LOWER(name) = LOWER(?) OR id = ? LIMIT 1`,
    args: [cleanUser, `local_${cleanUser}`],
  });

  if (res.rows.length === 0) return null;
  const userRow = res.rows[0];

  if (!userRow.password_hash) return null;

  const isValid = comparePassword(password, userRow.password_hash);
  if (!isValid) return null;

  // Obtener o crear settings
  let settings = await getUserSettings(userRow.id);
  if (!settings) {
    const defaultTemplate = "Pago de $usd $divisa equivalente a Bs. $bs, según tasa $fuente $tasa del $fecha.";
    await db.execute({
      sql: `INSERT OR IGNORE INTO user_settings (user_id, concepto_template, default_rate, updated_at) VALUES (?, ?, 'bcv', datetime('now'))`,
      args: [userRow.id, defaultTemplate],
    });
    settings = await getUserSettings(userRow.id);
  }

  const token = createSessionToken(userRow.id);

  return {
    user: {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      avatar: userRow.avatar,
      role: userRow.role,
    },
    settings,
    token,
  };
}

export async function upsertGoogleUser({ id, email, name, avatar }) {
  await initUserDatabase();
  const db = getDbClient();

  const now = new Date().toISOString();
  const safeId = String(id || '');
  const safeEmail = email ? email.toLowerCase().trim() : null;
  const safeName = name || email || 'Usuario';
  const safeAvatar = avatar || null;

  // 1. Buscar si ya existe por ID o por Email para evitar conflictos de clave única
  let targetId = safeId;
  const existing = await db.execute({
    sql: `SELECT id FROM users WHERE id = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?)) LIMIT 1`,
    args: [safeId, safeEmail || ''],
  });

  if (existing.rows.length > 0) {
    targetId = String(existing.rows[0].id);
    await db.execute({
      sql: `UPDATE users SET email = COALESCE(?, email), name = ?, avatar = ? WHERE id = ?`,
      args: [safeEmail, safeName, safeAvatar, targetId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO users (id, email, name, avatar, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
      args: [safeId, safeEmail, safeName, safeAvatar, now],
    });
  }

  // 2. Obtener o crear settings
  let settings = await getUserSettings(targetId);
  if (!settings) {
    const defaultTemplate = "Pago de $usd $divisa equivalente a Bs. $bs, según tasa $fuente $tasa del $fecha.";
    await db.execute({
      sql: `INSERT INTO user_settings (user_id, concepto_template, default_rate, updated_at) VALUES (?, ?, ?, ?)`,
      args: [targetId, defaultTemplate, 'bcv', now],
    });
    settings = {
      user_id: targetId,
      concepto_template: defaultTemplate,
      default_rate: 'bcv',
      updated_at: now,
    };
  }

  const token = createSessionToken(targetId);

  return {
    user: { id: targetId, email: safeEmail, name: safeName, avatar: safeAvatar },
    settings,
    token,
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
