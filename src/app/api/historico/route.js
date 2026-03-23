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
      let fallbackHtmlDate = null; // Guardará la tasa HTML si el BCV tarda en subir el Excel

      const forceXlsx = searchParams.get('forceXlsx') === 'true';

      // --- 1. INTENTO RÁPIDO (HTML FRONT-PAGE) ---
      if (forceXlsx) {
        console.log("🛠️ Modo Auto-Saneamiento: Saltando inyección HTML rápida para obligar la lectura del archivo XLSX.");
      }

      if (!forceXlsx) {
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
                // Validar qué tan atrasados estamos buscando la última fecha OFICIAL real.
                let lastDateStr = null;

                // 1. Intentar en el mes actual
                if (requestedMonthData.length > 0) {
                  const lastOfficialIndex = requestedMonthData.findIndex(d => !d.isWeekend);
                  if (lastOfficialIndex !== -1) {
                    lastDateStr = requestedMonthData[lastOfficialIndex].fecha;
                  }
                }

                // 2. Si el mes actual está vacío de fechas oficiales, buscar en el mes anterior
                if (!lastDateStr) {
                  let prevMonth = mes - 1;
                  let prevYear = anio;
                  if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }

                  let prevData = [];
                  if (prevYear === anio) {
                    prevData = yearData[prevMonth] || [];
                  } else {
                    try {
                      const prevPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${prevYear}.json`);
                      if (fs.existsSync(prevPath)) {
                        const prevYearData = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
                        prevData = prevYearData[prevMonth] || [];
                      }
                    } catch (e) { }
                  }

                  if (prevData && prevData.length > 0) {
                    // findIndex gets the latest date because arrays are sorted descending
                    const lastOfficialIndex = prevData.findIndex(d => !d.isWeekend);
                    if (lastOfficialIndex !== -1) {
                      lastDateStr = prevData[lastOfficialIndex].fecha;
                    }
                  }
                }

                if (lastDateStr) {
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
                      isWeekend: false,
                      source: "HTML"
                    });
                    fastInjectSuccess = true;
                    console.log(`⚡ Fast Inject (HTML): ${fechaOficial}`);
                  } else if (hasMissingWeekdays) {
                    console.log(`⚠️ Gap contains missing weekdays (diffDays: ${diffDays}). Forcing XLSX Fallback.`);
                    fastInjectSuccess = false; // Force XLSX fallback to recover missing official days

                    // Almacenamos la fecha HTML como rescate por si el XLSX aún no ha sido actualizado
                    fallbackHtmlDate = { fecha: fechaOficial, usd: usdHome, euro: eurHome, isWeekend: false, source: "HTML" };
                  }
                } else {
                  // Si no hay datos del todo (ni este mes ni el anterior), inyectamos igual
                  datesFound.push({ fecha: fechaOficial, usd: usdHome, euro: eurHome, isWeekend: false, source: "HTML" });
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

          // OPTIMIZATION FOR VERCEL: Only fetch the VERY FIRST link (current year). 
          // Downloading multiple 5MB Excel files exceeds Vercel's 1024MB Memory / 10s Timeout.
          links = links.slice(0, 1);

          for (const link of links) {
            try {
              console.log(`📡 Descargando archivo XLSX: ${link}`);
              const response = await axios.get(link, {
                responseType: 'arraybuffer',
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
              });

              console.log(`✅ XLSX descargado. Parseando buffer...`);
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
                        isWeekend: false,
                        source: "XLSX"
                      });
                    }
                  }
                }
              });
              console.log(`Exito parcial: XLSX extrajo ${datesFound.length} fechas para el mes ${mes}`);
            } catch (e) {
              console.error(`💥 Error crítico leyendo XLS: ${link}`, e.message);
            }
          }
        } catch (e) {
          console.error("⚠️ Falló descarga índice XLSX Fallback.", e.message);
        }

        // --- 2.5 FALLBACK EXTRA: EXCHANGE MONITOR (SI BCV ESTÁ TOTALMENTE CAÍDO O DESACTUALIZADO) ---
        if (datesFound.length === 0 || !datesFound.some(d => d.fecha === `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`)) {
           console.log("🕵️ Intentando rescate vía Exchange Monitor (Oficial)...");
           try {
              const nowVET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }));
              const todayDisplay = `${String(nowVET.getDate()).padStart(2, '0')}/${String(nowVET.getMonth() + 1).padStart(2, '0')}/${nowVET.getFullYear()}`;
              
              const { data: htmlEM } = await axios.get('https://exchangemonitor.net/venezuela/dolar-bcv', { 
                headers: { 'User-Agent': 'Mozilla/5.0' }, 
                timeout: 5000 
              });
              const $em = cheerio.load(htmlEM);
              const metaDesc = $em('meta[name="description"]').attr('content') || $em('meta[property="og:description"]').attr('content') || "";
              
              const match = metaDesc.match(/(?:es de|en|cotiza\sen)\s*([\d,.]+)/i) || metaDesc.match(/(\d{2,},\d{2})/);
              if (match) {
                 const usd = parseFloat(match[1].replace(',', '.'));
                 if (usd > 0) {
                    console.log(`✅ Rescate EM OK: ${usd} para ${todayDisplay}`);
                    datesFound.push({
                       fecha: todayDisplay,
                       usd: usd,
                       euro: usd * 1.146, // Proporción aproximada si falla el rescate (aprox 512/446.8)
                       isWeekend: false,
                       source: "EM-Rescue"
                    });
                 }
              }
           } catch(e) { console.warn("⚠️ Falló rescate EM en histórico"); }
        }

        // --- 2.6 RESCATE DE TASA HTML (GRACEFUL DEGRADATION) ---
        // Si forzamos el XLSX porque faltaban días, pero el XLSX del BCV estaba desactualizado (o falló red)
        // y nos retornó CERO fechas nuevas para el mes actual, debemos rescatar la tasa del viernes (HTML).
        // Si no lo hacemos, datesFound = 0, fill-forward se salta, y el array queda vacío arruinando el calendario.
        if (datesFound.length === 0 && fallbackHtmlDate) {
          console.log(`🚑 XLSX estaba desactualizado/falló. Rescatando tasa HTML ignorada: ${fallbackHtmlDate.fecha}`);
          datesFound.push(fallbackHtmlDate);
          // Al hacer esto, 'changed' será true más abajo, e iniciará el 'fill-forward'. 
          // Los días de semana perdidos en el medio quedarán como 'Cerrados' temporalmente hasta el lunes.
        }
      }

      // --- PROCESAR INYECCIÓN Y FILL-FORWARD ---
      let forceFillForward = false;

      // DETECCIÓN DE HUECOS CRONOLÓGICOS (Ej: Saltamos del Viernes 13 al Lunes 16 sin pasar por 14 y 15)
      // Si hoy es Lunes y no tenemos Sábado/Domingo en el array, debemos forzar el rellenado.
      if (requestedMonthData.length > 0) {
        const lastInArray = requestedMonthData[0]; // Está ordenado desc
        const [d, m, y] = lastInArray.fecha.split('/');
        const lastDateInArray = new Date(y, m - 1, d, 12, 0, 0, 0);
        
        const nowVET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }));
        const todayVET = new Date(nowVET.getFullYear(), nowVET.getMonth(), nowVET.getDate(), 12, 0, 0, 0);
        
        const diff = Math.round((todayVET - lastDateInArray) / (1000 * 60 * 60 * 24));
        if (diff > 0) {
          console.log(`📅 Detectado hueco de ${diff} días entre última fecha (${lastInArray.fecha}) y hoy.`);
          forceFillForward = true;
        }
      }

      for (const entry of datesFound) {
        const index = requestedMonthData.findIndex(d => d.fecha === entry.fecha);
        if (index === -1) {
          requestedMonthData.push(entry);
          changed = true;
        } else {
          const existing = requestedMonthData[index];
          if (existing.isWeekend === true || entry.source === 'XLSX' || (entry.source === 'HTML' && entry.usd !== existing.usd && !existing.isWeekend)) {
            // SOBREESCRIBIR SI ES FIN DE SEMANA O SI ES UNA CORRECCIÓN REAL
            requestedMonthData[index] = { ...existing, usd: entry.usd, euro: entry.euro, isWeekend: entry.isWeekend };
            changed = true;
            console.log(`♻️ Refreshed Rate Data for: ${entry.fecha}`);
          }
        }
      }

      if (changed || forceFillForward) {
        requestedMonthData.sort((a, b) => {
          const [da, ma, ya] = a.fecha.split('/');
          const [db, mb, yb] = b.fecha.split('/');
          return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
        });

        const filledData = [];
        let lastKnown = null;

        // BUSCAR LASTKNOWN HEREDADO DEL MES ANTERIOR
        let prevMonth = mes - 1;
        let prevYear = anio;
        if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }

        let prevData = [];
        if (prevYear === anio) {
          prevData = yearData[prevMonth] || [];
        } else {
          try {
            const prevPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${prevYear}.json`);
            if (fs.existsSync(prevPath)) {
              const prevYearData = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
              prevData = prevYearData[prevMonth] || [];
            }
          } catch (e) { }
        }

        if (prevData && prevData.length > 0) {
          const oficiales = prevData.filter(d => !d.isWeekend);
          if (oficiales.length > 0) {
            const sortedPrev = [...oficiales].sort((a, b) => {
              const [da, ma, ya] = a.fecha.split('/');
              const [db, mb, yb] = b.fecha.split('/');
              return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
            });
            lastKnown = sortedPrev[sortedPrev.length - 1];
          }
        }

        // FORZAR EL INICIO EN EL DÍA 01 DEL MES SOLICITADO
        const mesStrP = mes.toString().padStart(2, '0');
        let current = new Date(`${anio}-${mesStrP}-01T12:00:00`);

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
        const yesterdayMidnight = new Date(nowMidnight);
        yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);

        // Limitar stopDate al último día del mes solicitado (para consultas de meses pasados)
        const endOfRequestedMonth = new Date(anio, mes, 0, 12, 0, 0, 0);
        let stopDate = lastOfficialDate > yesterdayMidnight ? lastOfficialDate : yesterdayMidnight;
        if (stopDate > endOfRequestedMonth) {
          stopDate = endOfRequestedMonth;
        }

        while (current <= stopDate && (current.getMonth() + 1) === mes) {
          const dayStr = current.getDate().toString().padStart(2, '0');
          const monthStr = (current.getMonth() + 1).toString().padStart(2, '0');
          const yearStr = current.getFullYear();
          const display = `${dayStr}/${monthStr}/${yearStr}`;

          const currentDow = current.getDay();
          const isActualWeekendDay = (currentDow === 0 || currentDow === 6);

          if (existingMap[display]) {
            // FIX: Ensure 'isWeekend' is strictly true only on actual weekends.
            // If the BCV is delayed, weekdays get gap-filled. We don't want to mark 
            // them as strictly "closed" so they stay selectable on the calendar.
            existingMap[display].isWeekend = isActualWeekendDay;

            if (!existingMap[display].isWeekend) {
              lastKnown = existingMap[display];
              filledData.push(lastKnown);
            } else {
              // Si ya existe como fin de semana real
              if (lastKnown) {
                // Lo actualizamos con la tasa real más reciente de este mes
                filledData.push({
                  fecha: display,
                  usd: lastKnown.usd,
                  euro: lastKnown.euro,
                  isWeekend: isActualWeekendDay
                });
              } else {
                // Al principio del mes, lastKnown es nulo
                filledData.push({
                  ...existingMap[display],
                  isWeekend: isActualWeekendDay
                });
              }
            }
          } else if (lastKnown) {
            // Hueco cronológico llenado con el último valor conocido.
            // Si es entre semana, hereda el valor y sigue siendo isWeekend: false.
            filledData.push({
              fecha: display,
              usd: lastKnown.usd,
              euro: lastKnown.euro,
              isWeekend: isActualWeekendDay
            });
          }
          current.setDate(current.getDate() + 1);
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