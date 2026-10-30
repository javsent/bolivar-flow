import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

// Agente HTTPS aislado exclusivamente para el dominio bcv.org.ve
// requerido debido a que el BCV utiliza una entidad certificadora estatal (SUSCERTE)
// no incluida en los almacenes raíz estándar de Node.js / Mozilla.
const bcvHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
};

const MONTHS_MAP = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};

/**
 * Realiza el scraping de la página principal del BCV (http://www.bcv.org.ve/)
 * Retorna { usd, euro, fecha } en formato DD/MM/YYYY o null si falla.
 */
export async function scrapeBCV(timeoutMs = 3000) {
  try {
    const { data: html } = await axios.get('http://www.bcv.org.ve/', {
      httpsAgent: bcvHttpsAgent,
      headers: DEFAULT_HEADERS,
      timeout: timeoutMs,
    });

    const $ = cheerio.load(html);

    const parseRate = (selector) => {
      const txt = $(selector).find('strong').text().trim();
      return parseFloat(txt.replace(',', '.')) || 0;
    };

    const usd = parseRate('#dolar');
    const euro = parseRate('#euro');

    let fechaTexto =
      $('.pull-right.dinamico span').first().text().trim() ||
      $('.date-display-single').first().text().trim();

    let fechaFormatted = '';
    if (fechaTexto) {
      const partes = fechaTexto.match(/(\d{1,2})\s+(?:de\s+)?(\w+)\s+(\d{4})/i);
      if (partes) {
        const dia = partes[1].padStart(2, '0');
        const mesNombre = partes[2].toLowerCase();
        const mes = MONTHS_MAP[mesNombre] || '01';
        const anio = partes[3];
        fechaFormatted = `${dia}/${mes}/${anio}`;
      }
    }

    if (usd > 0) {
      return {
        usd,
        euro,
        fecha: fechaFormatted,
      };
    }
  } catch (err) {
    // Falla silenciosa esperada cuando el BCV está offline o con lentitud
  }
  return null;
}
