import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import { saveRate, getLatestOverallRate } from '@/lib/ratesRepository.js';
import { getVenezuelaDate } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    let rates = {
      bcv: 0,
      euro: 0,
      binance: 0,
      fecha: ""
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

    const agent = new https.Agent({ rejectUnauthorized: false });
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
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
    // 3. INTENTO DE FAST-SYNC CON BCV (SOLO SI NO TENEMOS TASA DE HOY)
    // ==============================================================
    const fetchBCVPromise = (async () => {
      // Si la DB ya tiene la tasa de hoy o una fecha adelantada, no hace falta raspar
      if (rates.bcv > 0 && rates.fecha === todayStr) {
        return null;
      }

      try {
        const { data: htmlBCV } = await axios.get('http://www.bcv.org.ve/', { 
          httpsAgent: agent, 
          headers, 
          timeout: 2500 
        });
        const $bcv = cheerio.load(htmlBCV);

        const parseBCV = (selector) => {
          const txt = $bcv(selector).find('strong').text().trim();
          return parseFloat(txt.replace(',', '.')) || 0;
        };

        const liveUsd = parseBCV('#dolar');
        const liveEuro = parseBCV('#euro');

        let fechaTexto = $bcv('.pull-right.dinamico span').first().text().trim() ||
          $bcv('.date-display-single').first().text().trim();

        let liveFecha = "";
        if (fechaTexto) {
          const partes = fechaTexto.match(/(\d{1,2})\s+(de\s+)?(\w+)\s+(\d{4})/i);
          if (partes) {
            const meses = {
              'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
              'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
            };
            const dia = partes[1].padStart(2, '0');
            const mesNombre = partes[3].toLowerCase();
            const mes = meses[mesNombre] || '01';
            const anio = partes[4];
            liveFecha = `${dia}/${mes}/${anio}`;
          }
        }

        if (liveUsd > 0) {
          return { usd: liveUsd, euro: liveEuro, fecha: liveFecha || todayStr };
        }
      } catch (e) {
        // Silencioso: la DB ya tiene el dato de respaldo
      }
      return null;
    })();

    // Ejecutar ambas búsquedas en paralelo sin bloquear
    const [binanceVal, liveBcv] = await Promise.all([fetchBinancePromise, fetchBCVPromise]);

    if (binanceVal > 0) {
      rates.binance = binanceVal;
    }

    if (liveBcv && liveBcv.usd > 0) {
      rates.bcv = liveBcv.usd;
      rates.euro = liveBcv.euro;
      rates.fecha = liveBcv.fecha;

      // Persistir en Turso en background sin retrasar la respuesta
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

    // Cache-Control con Edge Revalidation (Ultra-rápido en Vercel)
    return NextResponse.json(rates, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
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
