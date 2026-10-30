import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { saveRate, getLatestOverallRate } from '@/lib/ratesRepository.js';
import { getVenezuelaDate } from '@/lib/db.js';
import { scrapeBCV } from '@/lib/bcvScraper.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceFresh = searchParams.get('fresh') === '1' || request.headers.get('cache-control') === 'no-cache';

    let rates = {
      bcv: 0,
      euro: 0,
      binance: 0,
      fecha: "",
      isStale: false,
    };

    const nowVET = getVenezuelaDate();
    const fd = String(nowVET.getDate()).padStart(2, '0');
    const fm = String(nowVET.getMonth() + 1).padStart(2, '0');
    const todayStr = `${fd}/${fm}/${nowVET.getFullYear()}`;

    // ==============================================================
    // 1. CARGA ULTRA-RÁPIDA DESDE BASE DE DATOS TURSO (< 20ms)
    // ==============================================================
    try {
      const dbRate = await getLatestOverallRate();
      if (dbRate && dbRate.usd > 0) {
        rates.bcv = dbRate.usd;
        rates.euro = dbRate.euro;
        rates.fecha = dbRate.fecha;
      }
    } catch (dbErr) {
      console.warn("⚠️ No se pudo consultar tasa desde Turso:", dbErr.message);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // ==============================================================
    // 2. PARALELO / BINANCE: DolarAPI primero (rápido ~150ms)
    // ==============================================================
    const fetchBinancePromise = (async () => {
      try {
        const { data: dataApi } = await axios.get('https://ve.dolarapi.com/v1/dolares', { timeout: 2500 });
        const promedio = dataApi.find(d => d.fuente === 'paralelo')?.promedio || 0;
        if (promedio > 0) return promedio;
      } catch (e) {
        // Fallback a ExchangeMonitor con timeout corto
        try {
          const res = await axios.get('https://exchangemonitor.net/venezuela/dolar-binance', { headers, timeout: 3000 });
          const $ = cheerio.load(res.data);
          let match = $('body').text().match(/\$1\s*Bs\.\s*([\d,]+)/i) || $('body').text().match(/Bs\.\s*([\d,]+)/);
          if (match && match[1]) {
            return parseFloat(match[1].replace(',', '.'));
          }
        } catch (emErr) {}
      }
      return 0;
    })();

    // ==============================================================
    // 3. INTENTO DE FAST-SYNC CON BCV (SOLO SI NO TENEMOS TASA DE HOY O FORCEFRESH)
    // ==============================================================
    const fetchBCVPromise = (async () => {
      // Si la DB ya tiene la tasa de hoy y no se fuerza refresh, no hace falta raspar
      if (!forceFresh && rates.bcv > 0 && rates.fecha === todayStr) {
        return null;
      }

      try {
        const liveBcv = await scrapeBCV(2500);
        if (liveBcv && liveBcv.usd > 0) {
          return liveBcv;
        }
      } catch (e) {
        // Silencioso: la DB ya tiene el dato de respaldo
      }
      return null;
    })();

    // Ejecutar ambas búsquedas en paralelo
    const [binanceVal, liveBcv] = await Promise.all([fetchBinancePromise, fetchBCVPromise]);

    if (binanceVal > 0) {
      rates.binance = binanceVal;
    }

    if (liveBcv && liveBcv.usd > 0) {
      rates.bcv = liveBcv.usd;
      rates.euro = liveBcv.euro;
      rates.fecha = liveBcv.fecha || todayStr;

      // Persistir en Turso en background
      const dow = nowVET.getDay();
      saveRate({
        fecha: liveBcv.fecha,
        usd: liveBcv.usd,
        euro: liveBcv.euro,
        isWeekend: (dow === 0 || dow === 6),
        source: 'Live-Sync'
      }).catch(() => {});
    }

    if (!rates.fecha) {
      rates.fecha = todayStr;
    }

    // Si la fecha de la tasa oficial difiere de hoy, marcar como stale
    rates.isStale = Boolean(rates.fecha && rates.fecha !== todayStr);

    const cacheHeader = forceFresh
      ? 'no-cache, no-store, must-revalidate'
      : 'public, s-maxage=60, stale-while-revalidate=300';

    return NextResponse.json(rates, {
      headers: {
        'Cache-Control': cacheHeader,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("🔥 Error crítico en /api/tasas:", error);
    return NextResponse.json({
      error: "Error interno del servidor",
      message: error.message,
      success: false
    }, { status: 500 });
  }
}
