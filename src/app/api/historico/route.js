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

  const dataPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${anio}.json`);
  let yearData = {};

  if (fs.existsSync(dataPath)) {
    yearData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  }

  let requestedMonthData = yearData[mes] || [];
  const now = new Date();

  // SOLO INTENTAR SINCRONIZAR SI ES EL MES/AÑO ACTUAL
  if (anio === now.getFullYear() && mes === (now.getMonth() + 1)) {
    try {
      const { data: html } = await axios.get(URL_BASE, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
      });
      const $ = cheerio.load(html);

      let links = [];
      $('a[href*="_smc.xls"]').each((i, el) => {
        const href = $(el).attr('href');
        const fullLink = href.startsWith('http') ? href : DOMAIN + href;
        if (!links.includes(fullLink)) links.push(fullLink);
      });

      // Procesamos los primeros 5 enlaces para no sobrecargar
      links = links.slice(0, 5);

      let datesFound = [];

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

      // Inyectar fechas faltantes
      let changed = false;
      for (const entry of datesFound) {
        const alreadyExists = requestedMonthData.some(d => d.fecha === entry.fecha);
        if (!alreadyExists) {
          requestedMonthData.push(entry);
          changed = true;
          console.log(`🚀 Inyección exitosa desde XLS: ${entry.fecha} - USD: ${entry.usd}`);
        }
      }

      if (changed) {
        // Ordenamos requestedMonthData (ascendente) para el rellenado (fill-forward)
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

          // Iterar desde el primer día registrado hasta hoy (o el fin del mes solicitado)
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

        // Ordenar descendente (más reciente primero) como lo espera la aplicación
        filledData.sort((a, b) => {
          const [da, ma, ya] = a.fecha.split('/');
          const [db, mb, yb] = b.fecha.split('/');
          return new Date(`${yb}-${mb}-${db}`) - new Date(`${ya}-${ma}-${da}`);
        });

        yearData[mes] = filledData;
        requestedMonthData = filledData;
        fs.writeFileSync(dataPath, JSON.stringify(yearData, null, 2));
      }

    } catch (e) {
      console.warn("⚠️ Sincronización on-demand fallida. Usando caché local.", e.message);
    }
  }

  if (requestedMonthData.length === 0) {
    return NextResponse.json({ error: "No hay datos" }, { status: 404 });
  }

  return NextResponse.json({ data: requestedMonthData });
}