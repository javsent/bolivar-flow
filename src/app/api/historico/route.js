import { NextResponse } from 'next/server';
import { getRatesForMonth, saveRate } from '@/lib/ratesRepository.js';
import { getVenezuelaDate, getAppBaseUrl } from '@/lib/db.js';
import { scrapeBCV } from '@/lib/bcvScraper.js';

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
 * Dispara el miner en background (fire-and-forget) para rellenar huecos.
 * Usa `mode=smart` (solo Q4, ~15s) cuando solo faltan pocos días recientes.
 * Usa `mode=full` cuando hay más de 5 días hábiles faltantes (backfill grande).
 */
async function triggerMinerBackground(baseUrl, cronSecret, mode = 'smart') {
    const url = `${baseUrl}/api/cron/miner?mode=${mode}`;
    fetch(url, {
        headers: { authorization: `Bearer ${cronSecret}` },
    }).catch(() => { /* silencioso */ });
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

        // 1. Obtener tasas del mes desde la DB Turso
        let monthRates = await getRatesForMonth(anio, mes);

        if (!disableSync) {

            // ──────────────────────────────────────────────────
            // 2. Auto-healing: detectar huecos en datos históricos
            // ──────────────────────────────────────────────────
            const upToDay = isCurrentMonth ? todayDay : new Date(anio, mes, 0).getDate();
            const missingWorkdays = countMissingWorkdays(monthRates, anio, mes, upToDay);

            const baseUrl = getAppBaseUrl();
            const cronSecret = process.env.CRON_SECRET || '';

            if (missingWorkdays > 0 && cronSecret) {
                const minerMode = missingWorkdays >= 5 ? 'full' : 'smart';
                console.log(`🔧 Auto-healing: ${missingWorkdays} día(s) hábil(es) faltantes en ${mes}/${anio} → disparando miner [${minerMode}]`);
                triggerMinerBackground(baseUrl, cronSecret, minerMode);
            }

            // ──────────────────────────────────────────────────
            // 3. Fast-Inject: si es el mes actual y hoy no está oficial,
            //    intentar consultar el BCV directamente
            // ──────────────────────────────────────────────────
            if (isCurrentMonth) {
                const hasToday = monthRates.some(r => r.fecha === todayDisplay && r.source !== 'Fill-Forward');

                if (!hasToday) {
                    const live = await scrapeBCV(2500);
                    if (live && live.usd > 0) {
                        const [ld, lm, ly] = live.fecha.split('/').map(Number);
                        if (lm === mes && ly === anio) {
                            const rateDateObj = new Date(ly, lm - 1, ld);
                            const dow = rateDateObj.getDay();
                            const isWeekend = (dow === 0 || dow === 6);

                            await saveRate({
                                fecha: live.fecha,
                                usd: live.usd,
                                euro: live.euro,
                                isWeekend,
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
