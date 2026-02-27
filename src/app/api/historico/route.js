import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL_BASE = 'https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc';
const DOMAIN = 'https://www.bcv.org.ve';

// In-Memory Cache to survive warm Vercel invocations across read-only filesystem limitations
// (Cleared natively on server restart or hot-reload)
let memoryCache = {};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const mes = parseInt(searchParams.get('mes'));
    const anio = parseInt(searchParams.get('anio'));
    const disableSync = searchParams.get('sync') === 'false';

    const dataPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${anio}.json`);
    let yearData = {};

    // 1. Check memory cache first
    if (memoryCache[anio] && memoryCache[anio][mes] && memoryCache[anio][mes].length > 0) {
      yearData = memoryCache[anio];
    }
    // 2. Fallback to disk (which might be stale on Vercel, but good for local dev / initial load)
    else if (fs.existsSync(dataPath)) {
      yearData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      // Populate cache on first disk read
      memoryCache[anio] = yearData;
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
          // Regex mejorada
          const partes = fechaTexto.match(/(\d{1,2})\s+(de\s+)?(\w+)\s+(\d{4})/i);
          if (partes) {
            const day = partes[1].padStart(2, '0');
            const monthNomes = {
              'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
              'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
            };
            const monthStr = monthNomes[partes[3].toLowerCase()];
            const yearStr = partes[4];

            if (monthStr && parseInt(yearStr) === anio && parseInt(monthStr) === mes) {
              const fechaOficial = `${day}/${monthStr}/${yearStr}`;
              const alreadyExists = requestedMonthData.some(d => d.fecha === fechaOficial);

              if (!alreadyExists) {
                // Validar qué tan atrasados estamos.
                if (requestedMonthData.length > 0) {
                  // Encuentra la última fecha OFICIAL real (no fines de semana generados)
                  const lastOfficialIndex = requestedMonthData.findIndex(d => !d.isWeekend);
                  if (lastOfficialIndex !== -1) {
                    const lastDateStr = requestedMonthData[lastOfficialIndex].fecha;
                    const [d0, m0, y0] = lastDateStr.split('/');
                    const lastDateObj = new Date(`${y0}-${m0}-${d0}T12:00:00`);
                    const newDateObj = new Date(`${yearStr}-${monthStr}-${day}T12:00:00`);

                    const diffDays = Math.round((newDateObj - lastDateObj) / (1000 * 60 * 60 * 24));

                    // SMART GAP DETECTION: If the gap represents missing weekdays, we MUST use XLSX
                    // to fill them properly. Fast inject alone will leave them as 'closed'.
                    let hasMissingWeekdays = false;
                    if (diffDays > 1) {
                      let checkDate = new Date(lastDateObj);
                      checkDate.setDate(checkDate.getDate() + 1);
                      while (checkDate < newDateObj) {
                        const dow = checkDate.getDay();
                        // 0 is Sunday, 6 is Saturday
                        if (dow !== 0 && dow !== 6) {
                          hasMissingWeekdays = true;
                          break;
                        }
                        checkDate.setDate(checkDate.getDate() + 1);
                      }
                    }

                    if (diffDays > 0 && diffDays <= 4 && !hasMissingWeekdays) {
                      datesFound.push({
                        fecha: fechaOficial,
                        usd: usdHome,
                        euro: eurHome,
                        isWeekend: false
                      });
                      fastInjectSuccess = true;
                      console.log(`⚡ Fast Inject (HTML): ${fechaOficial}`);
                    } else if (hasMissingWeekdays) {
                      console.log(`⚠️ Gap contains missing weekdays (diffDays: ${diffDays}). Forcing XLSX Fallback.`);
                      fastInjectSuccess = false; // Force XLSX fallback to recover missing official days
                    }
                  } else {
                    // Si no hay datos previos (o solo placeholders), inyectamos
                    datesFound.push({ fecha: fechaOficial, usd: usdHome, euro: eurHome, isWeekend: false });
                    fastInjectSuccess = true;
                  }
                } else {
                  // Si no hay datos del todo, inyectamos igual
                  datesFound.push({ fecha: fechaOficial, usd: usdHome, euro: eurHome, isWeekend: false });
                  fastInjectSuccess = true;
                }
              } else {
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
        const index = requestedMonthData.findIndex(d => d.fecha === entry.fecha);
        if (index === -1) {
          requestedMonthData.push(entry);
          changed = true;
        } else if (requestedMonthData[index].isWeekend === true) {
          // SOBREESCRIBIR SI ES UN PLACEHOLDER DE FIN DE SEMANA/CERRADO
          requestedMonthData[index] = entry;
          changed = true;
          console.log(`♻️ Refreshed Placeholder with Official Rate: ${entry.fecha}`);
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

          // Obtener la fecha de "hoy" en Venezuela para el stop cronológico
          const nowVET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }));
          const nowMidnight = new Date(nowVET.getFullYear(), nowVET.getMonth(), nowVET.getDate(), 12, 0, 0, 0);

          const existingMap = {};
          requestedMonthData.forEach(d => existingMap[d.fecha] = d);

          // El stop debe ser hoy o la fecha más reciente oficial (si BCV adelantó la tasa)
          let lastOfficialDate = requestedMonthData.reduce((max, entry) => {
            if (entry.isWeekend) return max;
            const [d, m, y] = entry.fecha.split('/').map(Number);
            const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
            return dt > max ? dt : max;
          }, new Date(0));

          // REGLA 00:00 AM: Solo rellenar hasta ayer (o hoy si ya es mañana VET)
          // Esto evita marcar como "cerrado" el día actual antes de que termine.
          const yesterdayMidnight = new Date(nowMidnight);
          yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);

          const stopDate = lastOfficialDate > yesterdayMidnight ? lastOfficialDate : yesterdayMidnight;

          while (current <= stopDate && (current.getMonth() + 1) === mes) {
            const dayStr = current.getDate().toString().padStart(2, '0');
            const monthStr = (current.getMonth() + 1).toString().padStart(2, '0');
            const yearStr = current.getFullYear();
            const display = `${dayStr}/${monthStr}/${yearStr}`;

            if (existingMap[display]) {
              if (!existingMap[display].isWeekend) {
                lastKnown = existingMap[display];
                filledData.push(lastKnown);
              } else {
                // Si ya existe como fin de semana/feriado
                if (lastKnown) {
                  // Lo actualizamos con la tasa real más reciente de este mes
                  filledData.push({
                    fecha: display,
                    usd: lastKnown.usd,
                    euro: lastKnown.euro,
                    isWeekend: true
                  });
                } else {
                  // Al principio del mes, lastKnown es nulo. Mantenemos el marcador heredado del mes anterior.
                  filledData.push(existingMap[display]);
                }
              }
            } else if (lastKnown) {
              // Ensure we accurately record Sat/Sun vs missing weekday (Feriado)
              const currentDow = current.getDay();
              const isActualWeekendDay = (currentDow === 0 || currentDow === 6);

              filledData.push({
                fecha: display,
                usd: lastKnown.usd,
                euro: lastKnown.euro,
                // Si es un hueco en día de semana, igual lo tratamos como cerrado/feriado, 
                // pero estructuralmente sabemos por qué es
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

        // Update memory cache!
        memoryCache[anio] = yearData;

        // ESCRITURA SEGURA (Opcional para Vercel)
        try {
          fs.writeFileSync(dataPath, JSON.stringify(yearData, null, 2));
          console.log("✅ JSON de mes actualizado exitosamente.");
        } catch (fsError) {
          console.warn("⚠️ No se pudo escribir en el disco (Vercel):", fsError.message);
        }
      }
    }

    if (requestedMonthData.length === 0) {
      return NextResponse.json({ error: "No hay datos" }, { status: 404 });
    }

    return NextResponse.json({ data: requestedMonthData });
  } catch (error) {
    console.error("🔥 Error crítico en /api/historico:", error);
    return NextResponse.json({
      error: "Error interno del servidor",
      message: error.message,
      success: false
    }, { status: 500 });
  }
}