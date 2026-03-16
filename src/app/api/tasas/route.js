import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

export async function GET() {
  try {
    // 1. Inicializamos con objeto extendido para incluir la fecha
    let rates = {
      bcv: 0,
      euro: 0,
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

      // EXTRACCIÓN DE LA FECHA VALOR (El texto que dice "Fecha Valor: Miércoles, 25 Febrero 2026")
      let fechaTexto = $bcv('.pull-right.dinamico span').text().trim() ||
        $bcv('.date-display-single').text().trim();

      if (fechaTexto) {
        // Regex mejorada para manejar "de" (25 de febrero) o formato directo (25 febrero)
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
          rates.fecha = `${dia}/${mes}/${anio}`;
        } else {
          rates.fecha = fechaTexto; // Fallback
        }
      }

      console.log(`✅ BCV OK: USD=${rates.bcv}, Fecha Valor=${rates.fecha}`);
    } catch (e) {
      console.error("❌ Error BCV:", e.message);
    }

    // 0. OBTENER FECHA DE HOY (SISTEMA)
    const now = new Date();
    const fd = String(now.getDate()).padStart(2, '0');
    const fm = String(now.getMonth() + 1).padStart(2, '0');
    const todayStr = `${fd}/${fm}/${now.getFullYear()}`;

    // ==========================================
    // 2. FALLBACK: EXCHANGE MONITOR (OFICIAL BCV)
    // ==========================================
    if (rates.bcv === 0 || rates.euro === 0 || rates.fecha !== todayStr) {
      console.log(`🔍 Intentando fallback con Exchange Monitor (Oficial)... [Motivo: ${rates.fecha !== todayStr ? "Fecha desactualizada" : "Tasa en 0"}]`);
      try {
        const { data: htmlEM } = await axios.get('https://exchangemonitor.net/venezuela/dolar-bcv', { headers, timeout: 8000 });
        const $em = cheerio.load(htmlEM);
        
        // 1. Intentar extraer del input de la calculadora (más preciso si está en el HTML)
        const emUSD_input = parseFloat($em('#input-amount-to').val()?.replace(',', '.') || '0');
        
        // 2. Extraer de la Meta Description o Title (Muy fiable en Exchange Monitor)
        const metaDesc = $em('meta[name="description"]').attr('content') || "";
        const ogDesc = $em('meta[property="og:description"]').attr('content') || "";
        const pageTitle = $em('title').text() || "";
        
        const extractFromText = (text) => {
           if (!text) return 0;
           // Busca patrones como "446,80", "446.80", "es de 446,80", etc.
           // Primero intentamos con el prefijo "de " o "en " que es muy común en EM
           const preciseMatch = text.match(/(?:es de|en|en\sBs\.|cotiza\sen)\s*([\d,.]+)/i);
           if (preciseMatch) return parseFloat(preciseMatch[1].replace(',', '.')) || 0;

           // Fallback a cualquier número con formato de moneda (ej: 446,80)
           const generalMatch = text.match(/(\d{2,},\d{2})/);
           if (generalMatch) return parseFloat(generalMatch[1].replace(',', '.')) || 0;
           
           return 0;
        };

        let emUSD = emUSD_input;
        if (emUSD === 0) emUSD = extractFromText(metaDesc);
        if (emUSD === 0) emUSD = extractFromText(ogDesc);
        if (emUSD === 0) emUSD = extractFromText(pageTitle);

        if (emUSD > 0) {
          rates.bcv = emUSD;
          // Buscar Euro en la página
          $em('div, span, p, td, a').each((i, el) => {
             const txt = $em(el).text().toUpperCase();
             if (txt.includes('EURO') && (txt.includes('BS.') || txt.includes('VES'))) {
                const val = extractFromText($em(el).text());
                if (val > 0 && val > emUSD * 0.9) rates.euro = val; 
             }
          });
        }

        // 3. Si falla el euro, probar página específica
        if (rates.euro === 0 || rates.euro < rates.bcv) {
          try {
             console.log("🔍 Consultando página específica de Euro BCV para precisión...");
             const { data: htmlEM_EUR } = await axios.get('https://exchangemonitor.net/venezuela/euro-bcv', { headers, timeout: 5000 });
             const $eur = cheerio.load(htmlEM_EUR);
             
             // Extraer del input (más preciso)
             const eurVal_input = parseFloat($eur('#input-amount-to').val()?.replace(',', '.') || '0');
             
             // Extraer de meta tags
             const metaEur = $eur('meta[name="description"]').attr('content') || $eur('meta[property="og:description"]').attr('content') || "";
             const eurVal_meta = extractFromText(metaEur);
             
             const eurFinal = eurVal_input > 0 ? eurVal_input : eurVal_meta;
             if (eurFinal > 0) rates.euro = eurFinal;
          } catch(e) { console.warn("⚠️ Falló scraping Euro EM"); }
        }

        if (rates.bcv > 0) {
           console.log(`✅ Fallback EM OK: USD=${rates.bcv}, EUR=${rates.euro}`);
           rates.fecha = todayStr; // Garantizamos que la fecha sea hoy ya que EM está al día
        }
      } catch (e) {
        console.error("❌ Error Fallback EM:", e.message);
      }
    }

    // ==========================================
    // 3. EXCHANGE MONITOR (PARALELO Y BINANCE)
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

    const [precioBinance] = await Promise.all([
      scrapeExchangeMonitor('https://exchangemonitor.net/venezuela/dolar-binance', 'Binance')
    ]);

    if (precioBinance > 0) rates.binance = precioBinance;

    // ==========================================
    // 4. RESPALDO FINAL (SOLO SI FALLA TODO)
    // ==========================================
    if (rates.binance === 0) {
      try {
        const { data: dataApi } = await axios.get('https://ve.dolarapi.com/v1/dolares', { timeout: 5000 });
        const promedio = dataApi.find(d => d.fuente === 'paralelo')?.promedio || 0;
        if (rates.binance === 0) rates.binance = promedio;
      } catch (e) { }
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
  } catch (error) {
    console.error("🔥 Error crítico en /api/tasas:", error);
    return NextResponse.json({
      error: "Error interno del servidor",
      message: error.message,
      success: false
    }, { status: 500 });
  }
}
