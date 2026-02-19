import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

export async function GET() {
  // 1. Inicializamos con objeto extendido para incluir la fecha
  let rates = {
    bcv: 0,
    euro: 0,
    paralelo: 0,
    binance: 0,
    fecha: "" // Nueva propiedad para la fecha valor oficial
  };

  const agent = new https.Agent({ rejectUnauthorized: false });
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
  };

  console.log("⚡ Actualizando tasas y fecha valor...");

  // ==========================================
  // 1. BCV (OFICIAL) + EXTRACCIÓN DE FECHA VALOR
  // ==========================================
  try {
    const { data: htmlBCV } = await axios.get('http://www.bcv.org.ve/', { httpsAgent: agent, headers, timeout: 10000 });
    const $bcv = cheerio.load(htmlBCV);
    
    const parseBCV = (selector) => {
        const txt = $bcv(selector).find('strong').text().trim();
        return parseFloat(txt.replace(',', '.')) || 0;
    };

    // Extraemos las tasas
    rates.bcv = parseBCV('#dolar');
    rates.euro = parseBCV('#euro');

    // EXTRACCIÓN DE LA FECHA VALOR (El texto que dice "Fecha Valor: Viernes, 13 Febrero 2026")
    // El BCV suele poner esto en un span o div con clase 'dinamico' o dentro de la sección de tasas
    let fechaTexto = $bcv('.pull-right.dinamico span').text().trim() || 
                     $bcv('.date-display-single').text().trim();

    if (fechaTexto) {
        // Limpiamos el texto para dejar solo la fecha (ej: "13-02-2026")
        // Intentamos capturar el formato del BCV: "Viernes, 13 Febrero 2026"
        const partes = fechaTexto.match(/(\d{2})\s+(\w+)\s+(\d{4})/);
        if (partes) {
            const meses = {
                'Enero': '01', 'Febrero': '02', 'Marzo': '03', 'Abril': '04', 'Mayo': '05', 'Junio': '06',
                'Julio': '07', 'Agosto': '08', 'Septiembre': '09', 'Octubre': '10', 'Noviembre': '11', 'Diciembre': '12'
            };
            const dia = partes[1];
            const mes = meses[partes[2].charAt(0).toUpperCase() + partes[2].slice(1).toLowerCase()] || '01';
            const anio = partes[3];
            rates.fecha = `${dia}/${mes}/${anio}`;
        } else {
            rates.fecha = fechaTexto; // Fallback si el regex falla
        }
    }

    console.log(`✅ BCV OK: USD=${rates.bcv}, Fecha Valor=${rates.fecha}`);
  } catch (e) {
    console.error("❌ Error BCV:", e.message);
  }

  // ==========================================
  // 2. EXCHANGE MONITOR (PARALELO Y BINANCE)
  // ==========================================
  const scrapeExchangeMonitor = async (url, label) => {
    try {
        const response = await axios.get(url, { headers, timeout: 8000 });
        const html = response.data;
        const $ = cheerio.load(html);
        
        let precioEncontrado = 0;

        $('h1, h2, h3, div').each((i, el) => {
            if (precioEncontrado > 0) return;
            const texto = $(el).text().trim();
            const match = texto.match(/\$1\s*Bs\.\s*([\d,]+)/i);
            if (match && match[1]) {
                precioEncontrado = parseFloat(match[1].replace(',', '.'));
            }
        });

        if (precioEncontrado === 0) {
             const textoGeneral = $('body').text();
             const matchGeneral = textoGeneral.match(/Bs\.\s*([\d,]+)/);
             if (matchGeneral) {
                 precioEncontrado = parseFloat(matchGeneral[1].replace(',', '.'));
             }
        }

        return precioEncontrado;
    } catch (e) {
        console.error(`⚠️ Error scraping ${label}:`, e.message);
        return 0;
    }
  };

  const [precioParalelo, precioBinance] = await Promise.all([
    scrapeExchangeMonitor('https://exchangemonitor.net/venezuela/monitor-dolar', 'Paralelo'),
    scrapeExchangeMonitor('https://exchangemonitor.net/venezuela/dolar-binance', 'Binance')
  ]);

  if (precioParalelo > 0) rates.paralelo = precioParalelo;
  if (precioBinance > 0) rates.binance = precioBinance;

  // ==========================================
  // 3. RESPALDO (SOLO SI FALLA SCRAPING)
  // ==========================================
  if (rates.paralelo === 0 || rates.binance === 0) {
      try {
        const { data: dataApi } = await axios.get('https://ve.dolarapi.com/v1/dolares', { timeout: 5000 });
        const promedio = dataApi.find(d => d.fuente === 'paralelo')?.promedio || 0;
        if (rates.paralelo === 0) rates.paralelo = promedio;
        if (rates.binance === 0) rates.binance = promedio;
      } catch (e) {}
  }

  // Si no pudimos obtener fecha del BCV, usamos la de hoy como último recurso
  if (!rates.fecha) {
    rates.fecha = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return NextResponse.json(rates, { 
    headers: { 
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/json'
    } 
  });
}