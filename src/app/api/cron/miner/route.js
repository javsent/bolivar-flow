import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';
import https from 'https';
import { saveRatesBatch, initRatesDatabase } from '@/lib/ratesRepository.js';
import { getVenezuelaDate } from '@/lib/db.js';

export const dynamic = 'force-dynamic';
// Vercel tiene un límite de 60s en funciones serverless del plan Hobby.
// En Pro/Team el límite puede extenderse a 300s via maxDuration.
export const maxDuration = 300;

const URL_BASE = 'https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc';
const DOMAIN = 'https://www.bcv.org.ve';

// Links conocidos por convención trimestral del BCV (año 2026)
const KNOWN_XLS_LINKS = [
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2d26_smc.xls',
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2c26_smc.xls',
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2b26_smc.xls',
    'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2a26_smc.xls',
];

/**
 * Cron Miner — descarga los XLS del BCV, parsea todas las tasas del año
 * y las persiste en la base de datos remota (Turso/libSQL).
 *
 * A diferencia del cron /api/cron/sync (que solo raspa la tasa del día),
 * este endpoint rellena TODOS los días que falten en la DB, incluyendo
 * días pasados donde el scraping diario pudo haber fallado.
 */
export async function GET(request) {
    const startTime = Date.now();

    try {
        // — Autenticación por header Bearer —
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const axiosHeaders = { 'User-Agent': 'Mozilla/5.0' };

        // ──────────────────────────────────────────────────────
        // 1. Descubrir links XLS en el sitio del BCV + conocidos
        // ──────────────────────────────────────────────────────
        const links = new Set(KNOWN_XLS_LINKS);

        try {
            for (let page = 0; page < 5; page++) {
                const url = `${URL_BASE}?page=${page}`;
                let foundOnPage = false;

                try {
                    const { data: html } = await axios.get(url, {
                        headers: axiosHeaders,
                        timeout: 12000,
                        httpsAgent,
                    });
                    const $ = cheerio.load(html);

                    $('a[href*=".xls"]').each((_, el) => {
                        const href = $(el).attr('href');
                        if (
                            href &&
                            (href.includes('26_smc.xls') ||
                                /2_1_2[a-z]26_smc/.test(href))
                        ) {
                            foundOnPage = true;
                            const full = href.startsWith('http')
                                ? href
                                : DOMAIN + href;
                            links.add(full);
                        }
                    });

                    if (!foundOnPage && page > 0) break;
                } catch {
                    // Si una página falla, seguimos con los links conocidos
                    break;
                }
            }
        } catch {
            // Error de descubrimiento no es fatal; usamos KNOWN_XLS_LINKS
        }

        console.log(`📂 Miner Cron: procesando ${links.size} archivo(s) XLS`);

        // ──────────────────────────────────────────────────────
        // 2. Descargar y parsear cada XLS
        // ──────────────────────────────────────────────────────
        /** @type {Record<string, { usd: number; euro: number }>} */
        const officialRates = {}; // clave: "YYYY-MM-DD"
        let xlsErrors = 0;

        for (const link of links) {
            try {
                console.log(`📥 Descargando: ${link.split('/').pop()}`);
                const response = await axios.get(link, {
                    responseType: 'arraybuffer',
                    timeout: 45000,
                    headers: axiosHeaders,
                    httpsAgent,
                });

                const workbook = XLSX.read(response.data, { type: 'buffer' });

                workbook.SheetNames.forEach((name) => {
                    const sheet = workbook.Sheets[name];
                    const d5 = sheet['D5']?.v;

                    if (d5 && typeof d5 === 'string' && d5.includes('Fecha Valor:')) {
                        const match = d5.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                        if (match) {
                            const [, day, month, year] = match;
                            const iso = `${year}-${month}-${day}`;
                            const eurVal = sheet['G11']?.v;
                            const usdVal = sheet['G15']?.v;
                            if (eurVal && usdVal) {
                                officialRates[iso] = {
                                    usd: parseFloat(usdVal),
                                    euro: parseFloat(eurVal),
                                };
                            }
                        }
                    }
                });
            } catch (err) {
                xlsErrors++;
                console.error(`❌ Error descargando ${link.split('/').pop()}:`, err.message);
            }
        }

        const sortedDates = Object.keys(officialRates).sort();
        if (sortedDates.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No se hallaron datos válidos en los XLS del BCV.', xlsErrors },
                { status: 502 }
            );
        }

        console.log(
            `📊 Fechas oficiales extraídas: ${sortedDates.length}. Rango: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`
        );

        // ──────────────────────────────────────────────────────
        // 3. Rellenar todos los días (Fill-Forward para huecos y fines de semana)
        // ──────────────────────────────────────────────────────
        await initRatesDatabase();

        const nowVET = getVenezuelaDate();
        const todayISO = `${nowVET.getFullYear()}-${String(nowVET.getMonth() + 1).padStart(2, '0')}-${String(nowVET.getDate()).padStart(2, '0')}`;

        const lastExcelISO = sortedDates[sortedDates.length - 1];
        const stopISO = todayISO > lastExcelISO ? todayISO : lastExcelISO;

        /** @type {Array<import('@/lib/ratesRepository.js').RateEntry>} */
        const allEntries = [];
        let lastKnown = officialRates[sortedDates[0]];

        let iter = new Date(sortedDates[0] + 'T12:00:00Z');
        const stop = new Date(stopISO + 'T12:00:00Z');

        while (iter <= stop) {
            const y = iter.getUTCFullYear();
            const m = iter.getUTCMonth() + 1;
            const d = iter.getUTCDate();
            const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const display = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
            const dow = iter.getUTCDay(); // 0=Dom, 6=Sáb
            const isActualWeekend = dow === 0 || dow === 6;

            if (officialRates[iso]) {
                lastKnown = officialRates[iso];
                allEntries.push({
                    fecha: display,
                    usd: lastKnown.usd,
                    euro: lastKnown.euro,
                    isWeekend: false,
                    source: 'XLSX',
                });
            } else {
                // Hueco (feriado, fin de semana, día sin publicación BCV): arrastra tasa anterior
                allEntries.push({
                    fecha: display,
                    usd: lastKnown.usd,
                    euro: lastKnown.euro,
                    isWeekend: isActualWeekend,
                    source: 'Fill-Forward',
                });
            }

            iter.setUTCDate(iter.getUTCDate() + 1);
        }

        // ──────────────────────────────────────────────────────
        // 4. Persistir en base de datos (XLSX source tiene prioridad sobre Fill-Forward)
        // ──────────────────────────────────────────────────────
        // Separamos: primero guardamos los oficiales (XLSX) para no sobreescribir
        // entradas manuales, y luego Fill-Forward solo si no existe ya un registro.
        const xlsxEntries = allEntries.filter((e) => e.source === 'XLSX');
        const fillEntries = allEntries.filter((e) => e.source === 'Fill-Forward');

        // Los oficiales siempre se sobreescriben (INSERT OR REPLACE)
        const savedOfficial = await saveRatesBatch(xlsxEntries);

        // Los Fill-Forward solo si la fecha no existe en DB (INSERT OR IGNORE)
        const savedFill = await saveRatesBatchIgnore(fillEntries);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(
            `✨ Miner Cron OK: ${savedOfficial} oficiales + ${savedFill} rellenos guardados en ${elapsed}s`
        );

        return NextResponse.json({
            success: true,
            summary: {
                xlsFilesProcessed: links.size,
                xlsErrors,
                officialDates: sortedDates.length,
                rangeStart: sortedDates[0],
                rangeEnd: stopISO,
                savedOfficial,
                savedFill,
                elapsedSeconds: parseFloat(elapsed),
            },
        });
    } catch (error) {
        console.error('❌ Error crítico en cron/miner:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

/**
 * Guarda un lote de tasas usando INSERT OR IGNORE para no sobreescribir
 * entradas existentes (respeta entradas oficiales/manuales previas).
 */
async function saveRatesBatchIgnore(ratesArray) {
    if (!ratesArray.length) return 0;

    const { getDbClient } = await import('@/lib/db.js');
    const { toIsoDate, toDisplayDate } = await import('@/lib/ratesRepository.js');
    const db = getDbClient();
    const now = new Date().toISOString();
    const statements = [];

    for (const item of ratesArray) {
        const iso = toIsoDate(item.fecha);
        const display = toDisplayDate(iso);
        if (iso && item.usd > 0) {
            statements.push({
                sql: `INSERT OR IGNORE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [iso, display, Number(item.usd), Number(item.euro || 0), item.isWeekend ? 1 : 0, item.source, now],
            });
        }
    }

    const chunkSize = 50;
    for (let i = 0; i < statements.length; i += chunkSize) {
        await db.batch(statements.slice(i, i + chunkSize), 'write');
    }

    return statements.length;
}
