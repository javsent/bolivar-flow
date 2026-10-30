import { NextResponse } from 'next/server';
import axios from 'axios';
import * as XLSX from 'xlsx';
import https from 'https';
import { saveRatesBatch, initRatesDatabase, toIsoDate, toDisplayDate } from '@/lib/ratesRepository.js';
import { getVenezuelaDate, getDbClient } from '@/lib/db.js';

export const dynamic = 'force-dynamic';
// 60s max en plan Hobby de Vercel — la nueva lógica está optimizada para cumplirlo.
// En planes Pro/Team se puede subir a 300.
export const maxDuration = 60;

// Convención trimestral de nombres de archivos XLS del BCV para 2026.
// "d" = Q4 (trimestre más reciente), "a" = Q1.
// IMPORTANTE: al cambiar de año, actualizar esta lista.
const KNOWN_XLS_LINKS = [
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2d26_smc.xls',
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2c26_smc.xls',
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2b26_smc.xls',
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2a26_smc.xls',
];

/**
 * Descarga y parsea un archivo XLS del BCV.
 * Retorna un mapa { "YYYY-MM-DD": { usd, euro } } con las tasas encontradas.
 */
async function fetchAndParseXls(url, httpsAgent) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        httpsAgent,
    });

    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const rates = {};

    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const d5 = sheet['D5']?.v;
        if (d5 && typeof d5 === 'string' && d5.includes('Fecha Valor:')) {
            const match = d5.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (match) {
                const [, day, month, year] = match;
                const iso = `${year}-${month}-${day}`;
                const usdVal = sheet['G15']?.v;
                const eurVal = sheet['G11']?.v;
                if (usdVal && eurVal) {
                    rates[iso] = { usd: parseFloat(usdVal), euro: parseFloat(eurVal) };
                }
            }
        }
    }

    return rates;
}

/**
 * Guarda tasas usando INSERT OR REPLACE (fuentes oficiales: XLSX).
 * Guarda Fill-Forward con INSERT OR IGNORE (no sobreescribe oficiales/manuales).
 */
async function persistRates(officialRates, nowVET) {
    const db = getDbClient();
    const sortedDates = Object.keys(officialRates).sort();
    if (sortedDates.length === 0) return { savedOfficial: 0, savedFill: 0 };

    const todayISO = `${nowVET.getFullYear()}-${String(nowVET.getMonth() + 1).padStart(2, '0')}-${String(nowVET.getDate()).padStart(2, '0')}`;
    const lastExcelISO = sortedDates[sortedDates.length - 1];
    const stopISO = todayISO > lastExcelISO ? todayISO : lastExcelISO;

    const xlsxRows = [];
    const fillRows = [];
    let lastKnown = officialRates[sortedDates[0]];
    const nowISO = new Date().toISOString();

    let iter = new Date(sortedDates[0] + 'T12:00:00Z');
    const stop = new Date(stopISO + 'T12:00:00Z');

    while (iter <= stop) {
        const y = iter.getUTCFullYear();
        const m = iter.getUTCMonth() + 1;
        const d = iter.getUTCDate();
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const display = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
        const dow = iter.getUTCDay();
        const isWeekend = dow === 0 || dow === 6;

        if (officialRates[iso]) {
            lastKnown = officialRates[iso];
            xlsxRows.push([iso, display, lastKnown.usd, lastKnown.euro, 0, 'XLSX', nowISO]);
        } else {
            fillRows.push([iso, display, lastKnown.usd, lastKnown.euro, isWeekend ? 1 : 0, 'Fill-Forward', nowISO]);
        }

        iter.setUTCDate(iter.getUTCDate() + 1);
    }

    const chunkSize = 50;
    // XLSX — INSERT OR REPLACE (siempre actualiza)
    for (let i = 0; i < xlsxRows.length; i += chunkSize) {
        const stmts = xlsxRows.slice(i, i + chunkSize).map(row => ({
            sql: `INSERT OR REPLACE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: row,
        }));
        await db.batch(stmts, 'write');
    }

    // Fill-Forward — INSERT OR IGNORE (respeta entradas existentes)
    for (let i = 0; i < fillRows.length; i += chunkSize) {
        const stmts = fillRows.slice(i, i + chunkSize).map(row => ({
            sql: `INSERT OR IGNORE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: row,
        }));
        await db.batch(stmts, 'write');
    }

    return { savedOfficial: xlsxRows.length, savedFill: fillRows.length };
}

/**
 * GET /api/cron/miner
 *
 * Modos de operación (query param ?mode=):
 *   - "smart" (default): solo descarga el XLS más reciente (Q4/trimestre actual).
 *     Rápido (~10-15s), ideal para el cron diario.
 *   - "full": descarga los 4 XLS del año completo.
 *     Más lento (~40-50s), ideal para el cron semanal o para backfill manual.
 */
export async function GET(request) {
    const startTime = Date.now();

    try {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const mode = searchParams.get('mode') || 'smart';

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        await initRatesDatabase();

        const nowVET = getVenezuelaDate();

        // En modo "smart" solo procesamos el trimestre más reciente (primer link = más reciente).
        // En modo "full" procesamos todos los trimestres.
        const linksToProcess = mode === 'full' ? KNOWN_XLS_LINKS : [KNOWN_XLS_LINKS[0]];

        console.log(`📂 Miner Cron [${mode}]: procesando ${linksToProcess.length} XLS...`);

        const officialRates = {};
        let xlsErrors = 0;

        for (const link of linksToProcess) {
            try {
                console.log(`📥 Descargando: ${link.split('/').pop()}`);
                const rates = await fetchAndParseXls(link, httpsAgent);
                Object.assign(officialRates, rates);
            } catch (err) {
                xlsErrors++;
                console.error(`❌ Error en ${link.split('/').pop()}:`, err.message);
                // En modo smart, si falla el Q4 intentamos el Q3 como fallback
                if (mode === 'smart' && link === KNOWN_XLS_LINKS[0]) {
                    try {
                        console.log('🔄 Fallback a Q3...');
                        const fallback = await fetchAndParseXls(KNOWN_XLS_LINKS[1], httpsAgent);
                        Object.assign(officialRates, fallback);
                    } catch { /* ignorar */ }
                }
            }
        }

        const sortedDates = Object.keys(officialRates).sort();
        if (sortedDates.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No se hallaron datos válidos en los XLS del BCV.', xlsErrors },
                { status: 502 }
            );
        }

        console.log(`📊 Fechas extraídas: ${sortedDates.length}. Rango: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);

        const { savedOfficial, savedFill } = await persistRates(officialRates, nowVET);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`✨ Miner [${mode}] OK: ${savedOfficial} oficiales + ${savedFill} rellenos en ${elapsed}s`);

        return NextResponse.json({
            success: true,
            mode,
            summary: {
                xlsFilesProcessed: linksToProcess.length,
                xlsErrors,
                officialDates: sortedDates.length,
                rangeStart: sortedDates[0],
                rangeEnd: sortedDates[sortedDates.length - 1],
                savedOfficial,
                savedFill,
                elapsedSeconds: parseFloat(elapsed),
            },
        });

    } catch (error) {
        console.error('❌ Error crítico en cron/miner:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
