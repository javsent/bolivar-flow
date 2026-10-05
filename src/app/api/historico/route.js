import { NextResponse } from 'next/server';
import { getRatesForMonth, saveRate, getRateByDate } from '@/lib/ratesRepository.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const mes = parseInt(searchParams.get('mes'));
    const anio = parseInt(searchParams.get('anio'));
    const disableSync = searchParams.get('sync') === 'false';

    if (!mes || !anio || isNaN(mes) || isNaN(anio)) {
      return NextResponse.json({ error: "Parámetros 'mes' y 'anio' requeridos" }, { status: 400 });
    }

    // 1. Obtener tasas del mes desde la Base de Datos con herencia continua garantizada
    let monthRates = await getRatesForMonth(anio, mes);

    const now = new Date();
    const isCurrentMonth = (anio === now.getFullYear() && mes === (now.getMonth() + 1));
    const todayDisplay = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // 2. Si es el mes en curso y aún no tenemos la tasa de hoy, intento de Fast-Inject (< 2.5 seg)
    const hasToday = monthRates.some(r => r.fecha === todayDisplay);
    if (isCurrentMonth && !hasToday && !disableSync) {
      try {
        const agent = new https.Agent({ rejectUnauthorized: false });
        const { data: htmlFront } = await axios.get('http://www.bcv.org.ve/', {
          httpsAgent: agent,
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 2500
        });

        const $ = cheerio.load(htmlFront);
        const usdVal = parseFloat($('#dolar strong').text().replace(',', '.'));
        const eurVal = parseFloat($('#euro strong').text().replace(',', '.'));

        let fechaTexto = $('.pull-right.dinamico span').first().text().trim() ||
          $('.date-display-single').first().text().trim();

        if (usdVal > 0 && fechaTexto) {
          const partes = fechaTexto.match(/(\d{1,2})\s+(de\s+)?(\w+)\s+(\d{4})/i);
          if (partes) {
            const mesesMap = {
              'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
              'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
            };
            const d = partes[1].padStart(2, '0');
            const m = mesesMap[partes[3].toLowerCase()];
            const y = partes[4];

            if (m && parseInt(y) === anio && parseInt(m) === mes) {
              const fechaOficial = `${d}/${m}/${y}`;
              await saveRate({
                fecha: fechaOficial,
                usd: usdVal,
                euro: eurVal,
                isWeekend: false,
                source: 'HTML-Fast'
              });
              // Refrescar tasas del mes con la nueva tasa inyectada
              monthRates = await getRatesForMonth(anio, mes);
            }
          }
        }
      } catch (fastErr) {
        // Si el scraping en vivo falla o tarda, respondemos con los datos existentes sin bloquear
        console.warn("⚠️ Fast-Inject en histórico omitido:", fastErr.message);
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
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error("🔥 Error crítico en /api/historico:", error);
    return NextResponse.json({
      error: "Error interno del servidor",
      message: error.message,
      success: false
    }, { status: 500 });
  }
}