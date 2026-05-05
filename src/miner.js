const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Bypass de seguridad para el BCV
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL_BASE = 'https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc';
const DOMAIN = 'https://www.bcv.org.ve';

// RUTA FIJA: Desde la raíz del proyecto hacia src/data/bcv
const OUTPUT_DIR = path.join(process.cwd(), 'src', 'data', 'bcv');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function runMiner() {
    console.log("⚡ Iniciando Bolívar Flow Miner v3.1 (Multi-Page & Strict D5 Logic)...");
    
    try {
        const links = [];
        let page = 0;
        let keepScanning = true;

        while (keepScanning) {
            console.log(`🔍 Escaneando enlaces en página ${page}...`);
            const urlConPaginacion = `${URL_BASE}?page=${page}`;
            let found2026OnPage = false;
            
            try {
                const { data: html } = await axios.get(urlConPaginacion, { 
                    headers: { 'User-Agent': 'Mozilla/5.0' } 
                });
                const $ = cheerio.load(html);
                
                $('a[href*=".xls"]').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href && href.includes('26_smc.xls')) {
                        found2026OnPage = true;
                        const fullLink = href.startsWith('http') ? href : DOMAIN + href;
                        // Evitamos duplicados por si acaso un archivo aparece en dos páginas
                        if (!links.includes(fullLink)) {
                            links.push(fullLink);
                        }
                    }
                });

                if (!found2026OnPage) {
                    console.log(`🛑 No se encontraron archivos del 2026 en la página ${page}. Deteniendo escaneo.`);
                    keepScanning = false;
                } else {
                    page++;
                }
            } catch (pageError) {
                console.error(`⚠️ Error escaneando página ${page}:`, pageError.message);
                keepScanning = false;
            }
        }

        console.log(`📂 Total de archivos Excel hallados: ${links.length}`);

        let globalHistory = {}; 

        for (const link of links) {
            try {
                console.log(`📥 Procesando archivo: ${link.split('/').pop()}`);
                const response = await axios.get(link, { responseType: 'arraybuffer' });
                const workbook = XLSX.read(response.data, { type: 'buffer' });

                workbook.SheetNames.forEach(name => {
                    const sheet = workbook.Sheets[name];
                    const d5Content = sheet['D5']?.v; // Fuente de verdad

                    if (d5Content && d5Content.includes('Fecha Valor:')) {
                        const match = d5Content.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                        
                        if (match) {
                            const [_, day, month, year] = match;
                            const isoDate = `${year}-${month}-${day}`;
                            
                            const eurVal = sheet['G11']?.v;
                            const usdVal = sheet['G15']?.v;

                            if (eurVal && usdVal) {
                                globalHistory[isoDate] = { 
                                    usd: parseFloat(usdVal), 
                                    euro: parseFloat(eurVal) 
                                };
                            }
                        }
                    }
                });
            } catch (linkError) {
                console.error(`❌ Error procesando ${link}:`, linkError.message);
            }
        }

        // --- LÓGICA DE CALENDARIO Y ARRASTRE (FILL-FORWARD) ---
        const sortedDates = Object.keys(globalHistory).sort();
        if (sortedDates.length === 0) throw new Error("No se hallaron datos válidos en D5.");

        const firstDate = new Date(sortedDates[0] + "T12:00:00");
        const lastDate = new Date(sortedDates[sortedDates.length - 1] + "T12:00:00");
        
        let finalData = {}; // Manteniendo el formato { 2026: { 1: [...] } }
        let lastKnownRate = globalHistory[sortedDates[0]];

        let iter = new Date(firstDate);
        while (iter <= lastDate) {
            const y = iter.getFullYear();
            const m = iter.getMonth() + 1;
            const iso = iter.toISOString().split('T')[0];
            const display = iter.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

            if (globalHistory[iso]) {
                lastKnownRate = globalHistory[iso];
                push(finalData, y, m, { fecha: display, ...lastKnownRate, isWeekend: false });
            } else {
                push(finalData, y, m, { fecha: display, ...lastKnownRate, isWeekend: true });
            }
            iter.setDate(iter.getDate() + 1);
        }

        // Guardar archivos JSON por año (Formato original preservado)
        for (const year in finalData) {
            const yearData = finalData[year];
            for (const month in yearData) { 
                yearData[month].reverse(); // Reciente arriba
            }
            
            fs.writeFileSync(path.join(OUTPUT_DIR, `${year}.json`), JSON.stringify(yearData, null, 2));
            console.log(`✅ Archivo generado: src/data/bcv/${year}.json`);
        }

        console.log("\n✨ Sincronización completa. Datos de múltiples páginas procesados.");

    } catch (e) { console.error("❌ Error Crítico:", e.message); }
}

function push(map, y, m, data) {
    if (!map[y]) map[y] = {};
    if (!map[y][m]) map[y][m] = [];
    map[y][m].push(data);
}

runMiner();