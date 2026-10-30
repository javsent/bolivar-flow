import { NextResponse } from 'next/server';
import { getRatesForMonth, saveRate, getRateByDate } from '@/lib/ratesRepository.js';
import { getVenezuelaDate } from '@/lib/db.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

/** Calcula cuántos días hábiles (lun-vie) faltan sin tasa oficial en monthRates. */
function countMissingWorkdays(monthRates, year, month, upToDay) {
    const existing = new Set(
        monthRates
            .filter(r => r.source !== 'Fill-Forward')
            .map(r => r.fecha)
    );
    let missing = 0;
    for (let d = 1; d <= upToDay; d++) {
        const dt = new Date(year, month - 1, d);
        const dow = dt.getDay();
        if (dow === 0 || dow === 6) continue; // fin de semana — no cuenta
        const key = `${String(d).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
        if (!existing.has(key)) missing++;
    }
    return missing;
}

/**
 * Intenta obtener la tasa del día desde el HTML del BCV (rápido, ~2-3s).
 * Retorna { usd, euro, fecha } o null si falla.
 */
async function scrapeBCVFront() {
    try {
        const agent = new https.Agent({ rejectUnauthorized: false });
        const { data: html } = await axios.get('http://www.bcv.org.ve/', {
            httpsAgent: agent,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 3000,
        });
        const $ = cheerio.load(html);
        const usd = parseFloat($('#dolar strong').text().replace(',', '.'));
        const euro = parseFloat($('#euro strong').text().replace(',', '.'));

        let fechaRaw =
            $('.pull-right.dinamico span').first().text().trim() ||
            $('.date-display-single').first().text().trim();

        if (!usd || !fechaRaw) return null;

        const mesesMap = {
            enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
            julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
        };
        const partes = fechaRaw.match(/(\d{1,2})\s+(?:de\s+)?(\w+)\s+(\d{4})/i);
        if (!partes) return null;
        const mes = mesesMap[partes[2].toLowerCase()];
        if (!mes) return null;

        return {
            fecha: `${partes[1].padStart(2, '0')}/${mes}/${partes[3]}`,
            usd,
            euro,
        };
    } catch {
        return null;
    }
}

/**
 * Dispara el miner en background (fire-and-forget) para rellenar huecos.
 * Usa `mode=smart` (solo Q4, ~15s) cuando solo faltan pocos días recientes.
 * Usa `mode=full` cuando hay más de 5 días hábiles faltantes (backfill grande).
 */
async function triggerMinerBackground(baseUrl, cronSecret, mode = 'smart') {
    const url = `${baseUrl}/api/cron/miner?mode=${mode}`;
    // No hacemos await — lo dejamos correr en background
    fetch(url, {
        headers: { authorization: `Bearer ${cronSecret}` },
    }).catch(() => { /* silencioso — el usuario recibe respuesta normal */ });
}

// ─────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const mes = parseInt(searchParams.get('mes'));
        const anio = parseInt(searchParams.get('anio'));
        const disableSync = searchParams.get('sync') === 'false';

        if (!mes || !anio || isNaN(mes) || isNaN(anio)) {
            return NextResponse.json({ error: "Parámetros 'mes' y 'anio' requeridos" }, { status: 400 });
        }

        const now = getVenezuelaDate();
        const isCurrentMonth = anio === now.getFullYear() && mes === (now.getMonth() + 1);
        const todayDisplay = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        const todayDay = now.getDate();

        // 1. Obtener tasas del mes desde la DB
        let monthRates = await getRatesForMonth(anio, mes);

        if (!disableSync) {

            // ──────────────────────────────────────────────────
            // 2. Auto-healing: detectar huecos en datos históricos
            // ──────────────────────────────────────────────────
            const upToDay = isCurrentMonth ? todayDay : new Date(anio, mes, 0).getDate();
            const missingWorkdays = countMissingWorkdays(monthRates, anio, mes, upToDay);

            const baseUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : 'http://localhost:3000';
            const cronSecret = process.env.CRON_SECRET || '';

            if (missingWorkdays > 0 && cronSecret) {
                // Si faltan 5 o más días hábiles → miner full (backfill histórico)
                // Si faltan 1-4 días → miner smart (solo trimestre reciente, más rápido)
                const minerMode = missingWorkdays >= 5 ? 'full' : 'smart';
                console.log(`🔧 Auto-healing: ${missingWorkdays} día(s) hábil(es) faltantes en ${mes}/${anio} → disparando miner [${minerMode}]`);
                triggerMinerBackground(baseUrl, cronSecret, minerMode);
            }

            // ──────────────────────────────────────────────────
            // 3. Fast-Inject: si es el mes actual y hoy no está oficial,
            //    intentar scraperear el BCV directamente (respuesta inmediata)
            // ──────────────────────────────────────────────────
            if (isCurrentMonth) {
                const hasToday = monthRates.some(r => r.fecha === todayDisplay && r.source !== 'Fill-Forward');

                if (!hasToday) {
                    const live = await scrapeBCVFront();
                    if (live && live.usd > 0) {
                        // Solo guardamos si la fecha que devuelve el BCV coincide con hoy o días recientes del mes
                        const [ld, lm, ly] = live.fecha.split('/').map(Number);
                        if (lm === mes && ly === anio) {
                            await saveRate({
                                fecha: live.fecha,
                                usd: live.usd,
                                euro: live.euro,
                                isWeekend: false,
                                source: 'HTML-Fast',
                            });
                            // Refrescar con la nueva tasa inyectada
                            monthRates = await getRatesForMonth(anio, mes);
                        }
                    }
                }
            }
        }

        if (!monthRates || monthRates.length === 0) {
            return NextResponse.json({ error: "No hay datos para el período solicitado" }, { status: 404 });
        }

        return NextResponse.json(
            { data: monthRates },
            {
                headers: {
                    'Cache-Control': isCurrentMonth ? 'no-cache, no-store' : 'public, max-age=86400',
                    'Content-Type': 'application/json',
                },
            }
        );

    } catch (error) {
        console.error("🔥 Error crítico en /api/historico:", error);
        return NextResponse.json({
            error: "Error interno del servidor",
            message: error.message,
            success: false,
        }, { status: 500 });
    }
}
