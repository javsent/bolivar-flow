const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL_BASE = 'https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc';
const DOMAIN = 'https://www.bcv.org.ve';

async function testHistorico() {
    const anio = 2026;
    const mes = 2;
    const dataPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${anio}.json`);
    let yearData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    let requestedMonthData = yearData[mes] || [];

    let fastInjectSuccess = false;
    let datesFound = [];
    let changed = false;

    console.log("Starting length:", requestedMonthData.length);
    console.log("Last date:", requestedMonthData[requestedMonthData.length - 1].fecha);

    try {
        const { data: htmlFront } = await axios.get(DOMAIN, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
        const $front = cheerio.load(htmlFront);
        let fechaTexto = $front('.pull-right.dinamico span').text().trim() || $front('.date-display-single').text().trim();
        const usdHome = parseFloat($front('#dolar strong').text().replace(',', '.'));
        const eurHome = parseFloat($front('#euro strong').text().replace(',', '.'));

        if (fechaTexto && !isNaN(usdHome) && !isNaN(eurHome)) {
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
                    console.log("-- HTML Found:", fechaOficial, usdHome);

                    const alreadyExists = requestedMonthData.some(d => d.fecha === fechaOficial);
                    if (!alreadyExists) {
                        const lastOfficialIndex = requestedMonthData.findIndex(d => !d.isWeekend);
                        if (lastOfficialIndex !== -1) {
                            const lastDateStr = requestedMonthData[lastOfficialIndex].fecha;
                            const [d0, m0, y0] = lastDateStr.split('/');
                            const lastDateObj = new Date(`${y0}-${m0}-${d0}T12:00:00`);
                            const newDateObj = new Date(`${yearStr}-${monthStr}-${day}T12:00:00`);
                            const diffDays = Math.round((newDateObj - lastDateObj) / (1000 * 60 * 60 * 24));

                            let hasMissingWeekdays = false;
                            if (diffDays > 1) {
                                let checkDate = new Date(lastDateObj);
                                checkDate.setDate(checkDate.getDate() + 1);
                                while (checkDate < newDateObj) {
                                    const dow = checkDate.getDay();
                                    if (dow !== 0 && dow !== 6) { hasMissingWeekdays = true; break; }
                                    checkDate.setDate(checkDate.getDate() + 1);
                                }
                            }

                            if (diffDays > 0 && diffDays <= 4 && !hasMissingWeekdays) {
                                datesFound.push({ fecha: fechaOficial, usd: usdHome, euro: eurHome, isWeekend: false });
                                fastInjectSuccess = true;
                                console.log(`⚡ Fast Inject (HTML): ${fechaOficial}`);
                            } else if (hasMissingWeekdays) {
                                console.log(`⚠️ Gap contains missing weekdays (diffDays: ${diffDays}). Forcing XLSX Fallback.`);
                                fastInjectSuccess = false;
                            }
                        } else {
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
        console.error("Fast inject failed", e.message);
    }

    if (!fastInjectSuccess) {
        console.log("🐌 Recurriendo a XLSX Fallback...");
        try {
            const { data: htmlSMC } = await axios.get(URL_BASE, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
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
                    console.log("Fetching xlsx:", link);
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
                                    datesFound.push({ fecha: fechaOficial, usd: parseFloat(usdVal), euro: parseFloat(eurVal), isWeekend: false });
                                }
                            }
                        }
                    });
                } catch (e) {
                    console.warn(`Error leyendo XLS: ${link}`);
                }
            }
        } catch (e) { }
    }

    console.log("DatesFound:", datesFound.length);
    for (const entry of datesFound) {
        const index = requestedMonthData.findIndex(d => d.fecha === entry.fecha);
        if (index === -1) {
            requestedMonthData.push(entry);
            changed = true;
        } else if (requestedMonthData[index].isWeekend === true) {
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
        console.log("Sorted array top 5:", requestedMonthData.map(d => d.fecha).slice(0, 5));
        // ... we don't need to simulate fill-forward exactly if we just want to see if 26/02 and 27/02 get attached correctly.
        console.log("Does 26/02 exist?", requestedMonthData.find(d => d.fecha === '26/02/2026'));
        console.log("Does 27/02 exist?", requestedMonthData.find(d => d.fecha === '27/02/2026'));
    } else {
        console.log("NOT CHANGED. Fallback likely failed or skipped.");
    }
}
testHistorico();
