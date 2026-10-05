import { getDbClient } from './db.js';
import fs from 'fs';
import path from 'path';

let isInitialized = false;
let initPromise = null;

export function toIsoDate(dStr) {
  if (!dStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
  const parts = dStr.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return null;
}

export function toDisplayDate(isoStr) {
  if (!isoStr) return null;
  const parts = isoStr.split('-');
  if (parts.length === 3) {
    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
  }
  return isoStr;
}

export async function initRatesDatabase() {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = getDbClient();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS rates (
        fecha TEXT PRIMARY KEY,
        display_fecha TEXT NOT NULL,
        usd REAL NOT NULL,
        euro REAL NOT NULL,
        is_weekend INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_rates_display ON rates(display_fecha)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_rates_working ON rates(fecha, is_weekend)`);

    // Comprobar si la base de datos ya tiene datos
    const countRes = await db.execute(`SELECT count(*) as total FROM rates`);
    const total = Number(countRes.rows[0]?.total || 0);

    if (total === 0) {
      console.log("🌱 Base de datos vacía. Sembrando datos históricos desde archivos JSON...");
      await seedFromLegacyJsonFiles(db);
    }

    isInitialized = true;
  })();

  return initPromise;
}

async function seedFromLegacyJsonFiles(db) {
  const bcvDir = path.join(process.cwd(), 'src', 'data', 'bcv');
  if (!fs.existsSync(bcvDir)) return;

  const files = fs.readdirSync(bcvDir).filter(f => f.endsWith('.json'));
  let allEntries = [];

  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(bcvDir, file), 'utf8'));
      for (const monthKey of Object.keys(content)) {
        const monthList = content[monthKey];
        if (Array.isArray(monthList)) {
          for (const item of monthList) {
            const iso = toIsoDate(item.fecha);
            if (iso && item.usd > 0) {
              allEntries.push({
                fecha: iso,
                display_fecha: item.fecha,
                usd: Number(item.usd),
                euro: Number(item.euro || 0),
                is_weekend: item.isWeekend ? 1 : 0,
                source: item.source || (item.isWeekend ? 'Legacy-Fill' : 'Legacy'),
                updated_at: new Date().toISOString()
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ Error leyendo archivo JSON para seed: ${file}`, e.message);
    }
  }

  // Insertar en chunks usando batch
  const chunkSize = 50;
  for (let i = 0; i < allEntries.length; i += chunkSize) {
    const chunk = allEntries.slice(i, i + chunkSize);
    const statements = chunk.map(entry => ({
      sql: `INSERT OR REPLACE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.fecha,
        entry.display_fecha,
        entry.usd,
        entry.euro,
        entry.is_weekend,
        entry.source,
        entry.updated_at
      ]
    }));

    try {
      await db.batch(statements, 'write');
    } catch (e) {
      console.error("❌ Error en batch insert seed:", e.message);
    }
  }

  console.log(`✅ Seed completado: ${allEntries.length} tasas históricas indexadas.`);
}

export async function saveRate({ fecha, displayFecha, usd, euro, isWeekend = false, source = 'Official' }) {
  await initRatesDatabase();
  const db = getDbClient();

  const iso = toIsoDate(fecha || displayFecha);
  const display = displayFecha || toDisplayDate(iso);
  if (!iso || !usd) return false;

  await db.execute({
    sql: `INSERT OR REPLACE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      iso,
      display,
      Number(usd),
      Number(euro || 0),
      isWeekend ? 1 : 0,
      source,
      new Date().toISOString()
    ]
  });

  return true;
}

export async function saveRatesBatch(ratesArray) {
  if (!Array.isArray(ratesArray) || ratesArray.length === 0) return 0;
  await initRatesDatabase();
  const db = getDbClient();

  const statements = [];
  const now = new Date().toISOString();

  for (const item of ratesArray) {
    const iso = toIsoDate(item.fecha || item.displayFecha);
    const display = item.displayFecha || toDisplayDate(iso);
    if (iso && item.usd > 0) {
      statements.push({
        sql: `INSERT OR REPLACE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          iso,
          display,
          Number(item.usd),
          Number(item.euro || 0),
          item.isWeekend ? 1 : 0,
          item.source || 'Batch',
          now
        ]
      });
    }
  }

  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    await db.batch(chunk, 'write');
  }

  return statements.length;
}

export async function getRateByDate(dateStr) {
  await initRatesDatabase();
  const db = getDbClient();
  const iso = toIsoDate(dateStr);
  if (!iso) return null;

  const res = await db.execute({
    sql: `SELECT fecha, display_fecha, usd, euro, is_weekend, source FROM rates WHERE fecha = ? LIMIT 1`,
    args: [iso]
  });

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    fecha: row.display_fecha,
    usd: Number(row.usd),
    euro: Number(row.euro),
    isWeekend: Boolean(row.is_weekend),
    source: String(row.source)
  };
}

export async function getLatestWorkingRateBefore(dateStr) {
  await initRatesDatabase();
  const db = getDbClient();
  const iso = toIsoDate(dateStr);
  if (!iso) return null;

  const res = await db.execute({
    sql: `SELECT fecha, display_fecha, usd, euro, is_weekend, source 
          FROM rates 
          WHERE fecha < ? AND is_weekend = 0 AND usd > 0 
          ORDER BY fecha DESC 
          LIMIT 1`,
    args: [iso]
  });

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    fecha: row.display_fecha,
    usd: Number(row.usd),
    euro: Number(row.euro),
    isWeekend: false,
    source: String(row.source)
  };
}

export async function getLatestOverallRate() {
  await initRatesDatabase();
  const db = getDbClient();

  const res = await db.execute(`
    SELECT fecha, display_fecha, usd, euro, is_weekend, source 
    FROM rates 
    WHERE is_weekend = 0 AND usd > 0 
    ORDER BY fecha DESC 
    LIMIT 1
  `);

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    fecha: row.display_fecha,
    usd: Number(row.usd),
    euro: Number(row.euro),
    isWeekend: false,
    source: String(row.source)
  };
}

export async function getRatesForMonth(year, month) {
  await initRatesDatabase();
  const db = getDbClient();

  const mStr = String(month).padStart(2, '0');
  const startIso = `${year}-${mStr}-01`;
  const endOfMonthDay = new Date(year, month, 0).getDate();
  const endIso = `${year}-${mStr}-${String(endOfMonthDay).padStart(2, '0')}`;

  const res = await db.execute({
    sql: `SELECT fecha, display_fecha, usd, euro, is_weekend, source 
          FROM rates 
          WHERE fecha >= ? AND fecha <= ? 
          ORDER BY fecha DESC`,
    args: [startIso, endIso]
  });

  let monthRates = res.rows.map(r => ({
    fecha: String(r.display_fecha),
    usd: Number(r.usd),
    euro: Number(r.euro),
    isWeekend: Boolean(r.is_weekend),
    source: String(r.source)
  }));

  // Asegurar continuidad desde el día 01 del mes si faltan días al inicio
  const now = new Date();
  const isCurrentMonth = (year === now.getFullYear() && month === (now.getMonth() + 1));
  const nowDay = now.getDate();

  // El límite máximo a rellenar: si es mes actual, hasta hoy (o la fecha máxima oficial si hay adelanto)
  let maxDayToEnsure = endOfMonthDay;
  if (isCurrentMonth) {
    maxDayToEnsure = nowDay;
    // Si hay tasas oficiales con fecha adelantada en este mes, extender hasta esa fecha
    for (const r of monthRates) {
      const [d] = r.fecha.split('/').map(Number);
      if (d > maxDayToEnsure && !r.isWeekend) {
        maxDayToEnsure = d;
      }
    }
  }

  // Verificar si falta algún día entre el día 1 y maxDayToEnsure
  const existingMap = new Map();
  monthRates.forEach(r => existingMap.set(r.fecha, r));

  let missingAny = false;
  for (let day = 1; day <= maxDayToEnsure; day++) {
    const dStr = String(day).padStart(2, '0');
    const display = `${dStr}/${mStr}/${year}`;
    if (!existingMap.has(display)) {
      missingAny = true;
      break;
    }
  }

  if (missingAny) {
    // Buscar la última tasa hábil del mes anterior
    let lastKnown = await getLatestWorkingRateBefore(startIso);

    const filledList = [];
    const newItemsToPersist = [];

    for (let day = 1; day <= maxDayToEnsure; day++) {
      const dStr = String(day).padStart(2, '0');
      const display = `${dStr}/${mStr}/${year}`;
      const iso = `${year}-${mStr}-${dStr}`;
      const dObj = new Date(year, month - 1, day);
      const dow = dObj.getDay();
      const isActualWeekend = (dow === 0 || dow === 6);

      if (existingMap.has(display)) {
        const item = existingMap.get(display);
        if (!item.isWeekend && item.usd > 0) {
          lastKnown = item;
        }
        filledList.push(item);
      } else if (lastKnown) {
        const filledItem = {
          fecha: display,
          usd: lastKnown.usd,
          euro: lastKnown.euro,
          isWeekend: isActualWeekend,
          source: 'Fill-Forward'
        };
        filledList.push(filledItem);
        newItemsToPersist.push({ ...filledItem, iso });
      }
    }

    // Persistir las tasas rellenadas en segundo plano
    if (newItemsToPersist.length > 0) {
      saveRatesBatch(newItemsToPersist).catch(e => {
        console.warn("⚠️ No se pudieron persistir días rellenados:", e.message);
      });
    }

    // Ordenar descendente (más reciente primero) para compatibilidad
    filledList.sort((a, b) => {
      const [da, ma, ya] = a.fecha.split('/');
      const [db, mb, yb] = b.fecha.split('/');
      return new Date(`${yb}-${mb}-${db}`) - new Date(`${ya}-${ma}-${da}`);
    });

    monthRates = filledList;
  }

  return monthRates;
}

export async function exportYearToJson(year) {
  await initRatesDatabase();
  const db = getDbClient();

  const startIso = `${year}-01-01`;
  const endIso = `${year}-12-31`;

  const res = await db.execute({
    sql: `SELECT fecha, display_fecha, usd, euro, is_weekend, source 
          FROM rates 
          WHERE fecha >= ? AND fecha <= ? 
          ORDER BY fecha ASC`,
    args: [startIso, endIso]
  });

  const yearMap = {};
  for (let m = 1; m <= 12; m++) {
    yearMap[m] = [];
  }

  for (const r of res.rows) {
    const [y, m, d] = String(r.fecha).split('-').map(Number);
    yearMap[m].push({
      fecha: String(r.display_fecha),
      usd: Number(r.usd),
      euro: Number(r.euro),
      isWeekend: Boolean(r.is_weekend),
      source: String(r.source)
    });
  }

  // Ordenar cada mes desc (más reciente arriba)
  for (let m = 1; m <= 12; m++) {
    yearMap[m].reverse();
  }

  const outPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${year}.json`);
  try {
    fs.writeFileSync(outPath, JSON.stringify(yearMap, null, 2));
    console.log(`✅ Exportado a JSON: src/data/bcv/${year}.json`);
  } catch (e) {
    console.warn("⚠️ No se pudo escribir archivo JSON:", e.message);
  }

  return yearMap;
}
