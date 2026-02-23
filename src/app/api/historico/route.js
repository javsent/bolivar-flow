import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL_BASE = 'https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc';
const DOMAIN = 'https://www.bcv.org.ve';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mes = parseInt(searchParams.get('mes'));
  const anio = parseInt(searchParams.get('anio'));
  const disableSync = searchParams.get('sync') === 'false';

  const dataPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${anio}.json`);
  let yearData = {};

  if (fs.existsSync(dataPath)) {
    yearData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  }

  let requestedMonthData = yearData[mes] || [];
  const now = new Date();

  // SOLO INTENTAR SINCRONIZAR SI ES EL MES/AÑO ACTUAL Y NO ESTÁ DESHABILITADO
  if (anio === now.getFullYear() && mes === (now.getMonth() + 1) && !disableSync) {
    let fastInjectSuccess = false;
    let datesFound = [];
    let changed = false;

    // --- 1. INTENTO RÁPIDO (HTML FRONT-PAGE) ---
    try {
      const { data: htmlFront } = await axios.get(DOMAIN, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4000
      });
      const $front = cheerio.load(htmlFront);

      let fechaTexto = $front('.pull-right.dinamico span').text().trim() ||
        $front('.date-display-single').text().trim();

      const usdHome = parseFloat($front('#dolar strong').text().replace(',', '.'));
      const eurHome = parseFloat($front('#euro strong').text().replace(',', '.'));

      if (fechaTexto && !isNaN(usdHome) && !isNaN(eurHome)) {
        const partes = fechaTexto.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (partes) {
          const day = partes[1].padStart(2, '0');
          const monthNomes = {
            'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
            'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
          };
          const monthStr = monthNomes[partes[2].toLowerCase()];
          const yearStr = partes[3];

          if (monthStr && parseInt(yearStr) === anio && parseInt(monthStr) === mes) {
            const fechaOficial = `${day}/${monthStr}/${yearStr}`;
            const alreadyExists = requestedMonthData.some(d => d.fecha === fechaOficial);

            if (!alreadyExists) {
              // Validar qué tan atrasados estamos. Si falta solo 1 o 2 días (ej. fin de semana), podemos saltar XLSX
              if (requestedMonthData.length > 0) {
                const lastDateStr = requestedMonthData[0].fecha;
                const [d0, m0, y0] = lastDateStr.split('/');
                const lastDateObj = new Date(`${y0}-${m0}-${d0}T12:00:00`);
                const newDateObj = new Date(`${yearStr}-${monthStr}-${day}T12:00:00`);

                const diffDays = Math.round((newDateObj - lastDateObj) / (1000 * 60 * 60 * 24));
                if (diffDays > 0 && diffDays <= 4) { // Gap pequeño (incluye fin de semana)
                  datesFound.push({
                    fecha: fechaOficial,
                    usd: usdHome,
                    euro: eurHome,
                    isWeekend: false
                  });
                  fastInjectSuccess = true;
                  console.log(`⚡ Fast Inject (HTML): ${fechaOficial}`);
                }
              }
            } else {
              // Ya lo tenemos. No hace falta scraping. ¡Optimizado!
              fastInjectSuccess = true;
            }
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Falló Fast Inject HTML.", e.message);
    }

    // --- 2. FALLBACK PESADO (XLSX SCRAPING) ---
    if (!fastInjectSuccess) {
      console.log("🐌 Recurriendo a XLSX Fallback...");
      try {
        const { data: htmlSMC } = await axios.get(URL_BASE, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000
        });
        const $smc = cheerio.load(htmlSMC);

        let links = [];
        $smc('a[href*="_smc.xls"]').each((i, el) => {
          const href = $smc(el).attr('href');
          const fullLink = href.startsWith('http') ? href : DOMAIN + href;
          if (!links.includes(fullLink)) links.push(fullLink);
        });

        links = links.slice(0, 5);

        for (const link of links) {
          try {
            const response = await axios.get(link, { responseType: 'arraybuffer', timeout: 8000 });
            const workbook = XLSX.read(response.data, { type: 'buffer' });

            workbook.SheetNames.forEach(name => {
              const sheet = workbook.Sheets[name];
              const d5Content = sheet['D5']?.v;

              if (typeof d5Content === 'string' && d5Content.includes('Fecha Valor:')) {
                const match = d5Content.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (match) {
                  const [_, day, monthStr, yearStr] = match;
                  const eurVal = sheet['G11']?.v;
                  const usdVal = sheet['G15']?.v;

                  if (eurVal && usdVal && parseInt(yearStr) === anio && parseInt(monthStr) === mes) {
                    const fechaOficial = `${day}/${monthStr}/${yearStr}`;
                    datesFound.push({
                      fecha: fechaOficial,
                      usd: parseFloat(usdVal),
                      euro: parseFloat(eurVal),
                      isWeekend: false
                    });
                  }
                }
              }
            });
          } catch (e) {
            console.warn(`Error leyendo XLS: ${link}`);
          }
        }
      } catch (e) {
        console.warn("⚠️ Falló XLSX Fallback.", e.message);
      }
    }

    // --- PROCESAR INYECCIÓN Y FILL-FORWARD ---
    for (const entry of datesFound) {
      const alreadyExists = requestedMonthData.some(d => d.fecha === entry.fecha);
      if (!alreadyExists) {
        requestedMonthData.push(entry);
        changed = true;
      }
    }

    if (changed) {
      requestedMonthData.sort((a, b) => {
        const [da, ma, ya] = a.fecha.split('/');
        const [db, mb, yb] = b.fecha.split('/');
        return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
      });

      const filledData = [];
      let lastKnown = null;

      if (requestedMonthData.length > 0) {
        const firstStr = requestedMonthData[0].fecha;
        const [d0, m0, y0] = firstStr.split('/');
        let current = new Date(`${y0}-${m0}-${d0}T12:00:00`);

        const nowMidnight = new Date();
        nowMidnight.setHours(12, 0, 0, 0);

        const existingMap = {};
        requestedMonthData.forEach(d => existingMap[d.fecha] = d);

        while (current <= nowMidnight && (current.getMonth() + 1) === mes) {
          const dayStr = current.getDate().toString().padStart(2, '0');
          const monthStr = (current.getMonth() + 1).toString().padStart(2, '0');
          const yearStr = current.getFullYear();
          const display = `${dayStr}/${monthStr}/${yearStr}`;

          if (existingMap[display]) {
            lastKnown = existingMap[display];
            filledData.push(lastKnown);
          } else if (lastKnown) {
            filledData.push({
              fecha: display,
              usd: lastKnown.usd,
              euro: lastKnown.euro,
              isWeekend: true
            });
          }
          current.setDate(current.getDate() + 1);
        }
      }

      filledData.sort((a, b) => {
        const [da, ma, ya] = a.fecha.split('/');
        const [db, mb, yb] = b.fecha.split('/');
        return new Date(`${yb}-${mb}-${db}`) - new Date(`${ya}-${ma}-${da}`);
      });

      yearData[mes] = filledData;
      requestedMonthData = filledData;
      fs.writeFileSync(dataPath, JSON.stringify(yearData, null, 2));
      console.log("✅ JSON de mes actualizado exitosamente.");
    }
  }

  if (requestedMonthData.length === 0) {
    return NextResponse.json({ error: "No hay datos" }, { status: 404 });
  }

  return NextResponse.json({ data: requestedMonthData });
}