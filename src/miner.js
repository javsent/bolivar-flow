const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

// Bypass SSL para BCV
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL_BASE = 'https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc';
const DOMAIN = 'https://www.bcv.org.ve';
const OUTPUT_DIR = path.join(process.cwd(), 'src', 'data', 'bcv');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function runMiner() {
    console.log("⚡ Iniciando Bolívar Flow Miner v4.0 (Multi-File + SQLite + JSON Sync)...");
    
    try {
        const links = [];
        let page = 0;
        let keepScanning = true;

        while (keepScanning && page < 5) {
            console.log(`🔍 Escaneando enlaces en página ${page}...`);
            const urlConPaginacion = `${URL_BASE}?page=${page}`;
            let found2026OnPage = false;
            
            try {
                const { data: html } = await axios.get(urlConPaginacion, { 
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 15000
                });
                const $ = cheerio.load(html);
                
                $('a[href*=".xls"]').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.includes('26_smc.xls') || href.includes('2_1_2d26_smc') || href.includes('2_1_2c26_smc') || href.includes('2_1_2b26_smc') || href.includes('2_1_2a26_smc'))) {
                        found2026OnPage = true;
                        const fullLink = href.startsWith('http') ? href : DOMAIN + href;
                        if (!links.includes(fullLink)) {
                            links.push(fullLink);
                        }
                    }
                });

                if (!found2026OnPage && page > 0) {
                    keepScanning = false;
                } else {
                    page++;
                }
            } catch (pageError) {
                console.error(`⚠️ Error escaneando página ${page}:`, pageError.message);
                keepScanning = false;
            }
        }

        // Si la paginación no devolvió todos, aseguramos los links conocidos por convención trimestral
        const knownLinks = [
            'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2d26_smc.xls',
            'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2c26_smc.xls',
            'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2b26_smc.xls',
            'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2a26_smc.xls'
        ];

        for (const kl of knownLinks) {
            if (!links.includes(kl)) links.push(kl);
        }

        console.log(`📂 Total de archivos Excel del 2026 a procesar: ${links.length}`);

        let globalHistory = {}; 

        for (const link of links) {
            try {
                console.log(`📥 Procesando archivo: ${link.split('/').pop()}`);
                const response = await axios.get(link, { 
                    responseType: 'arraybuffer',
                    timeout: 45000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const workbook = XLSX.read(response.data, { type: 'buffer' });

                workbook.SheetNames.forEach(name => {
                    const sheet = workbook.Sheets[name];
                    const d5Content = sheet['D5']?.v;

                    if (d5Content && typeof d5Content === 'string' && d5Content.includes('Fecha Valor:')) {
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

        const sortedDates = Object.keys(globalHistory).sort();
        if (sortedDates.length === 0) throw new Error("No se hallaron datos válidos en D5.");

        console.log(`📊 Fechas oficiales extraídas de Excel: ${sortedDates.length}. Rango: ${sortedDates[0]} hasta ${sortedDates[sortedDates.length - 1]}`);

        // Cargar overrides manuales existentes para no sobreescribirlos
        let existingOverrides = {};
        if (fs.existsSync(OUTPUT_DIR)) {
            const availableYears = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'));
            for (const file of availableYears) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8'));
                    for (const month in content) {
                        for (const entry of content[month]) {
                            if (entry.source === 'Manual') {
                                existingOverrides[entry.fecha] = entry;
                            }
                        }
                    }
                } catch (e) {}
            }
        }

        const firstDate = new Date(sortedDates[0] + "T12:00:00");
        
        // Rellenar siempre hasta HOY para evitar huecos
        const nowVET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }));
        const todayDate = new Date(nowVET.getFullYear(), nowVET.getMonth(), nowVET.getDate(), 12, 0, 0, 0);
        
        const lastExcelDate = new Date(sortedDates[sortedDates.length - 1] + "T12:00:00");
        const stopDate = todayDate > lastExcelDate ? todayDate : lastExcelDate;
        
        let finalData = {};
        let allDbEntries = [];
        let lastKnownRate = globalHistory[sortedDates[0]];

        let iter = new Date(firstDate);
        while (iter <= stopDate) {
            const y = iter.getFullYear();
            const m = iter.getMonth() + 1;
            const d = iter.getDate();
            const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const display = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
            const dow = iter.getDay();
            const isActualWeekend = (dow === 0 || dow === 6);

            let entryToAdd;
            if (existingOverrides[display]) {
                const manualEntry = existingOverrides[display];
                lastKnownRate = { usd: manualEntry.usd, euro: manualEntry.euro };
                entryToAdd = { ...manualEntry };
            } else if (globalHistory[iso]) {
                lastKnownRate = globalHistory[iso];
                entryToAdd = { fecha: display, ...lastKnownRate, isWeekend: false, source: "XLSX" };
            } else {
                // Hueco o fin de semana: arrastra la tasa anterior
                entryToAdd = { fecha: display, ...lastKnownRate, isWeekend: true, source: "Fill-Forward" };
            }

            push(finalData, y, m, entryToAdd);
            allDbEntries.push({
                fecha: iso,
                display_fecha: display,
                usd: entryToAdd.usd,
                euro: entryToAdd.euro,
                is_weekend: entryToAdd.isWeekend ? 1 : 0,
                source: entryToAdd.source || 'XLSX'
            });

            iter.setDate(iter.getDate() + 1);
        }

        // 1. Guardar archivos JSON por año
        for (const year in finalData) {
            const yearData = finalData[year];
            for (const month in yearData) { 
                yearData[month].reverse(); // Reciente arriba
            }
            
            fs.writeFileSync(path.join(OUTPUT_DIR, `${year}.json`), JSON.stringify(yearData, null, 2));
            console.log(`✅ Archivo JSON generado: src/data/bcv/${year}.json`);
        }

        // 2. Guardar en SQLite
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const dbPath = path.join(dataDir, 'bolivar_flow.db').replace(/\\/g, '/');
        const db = createClient({ url: `file:${dbPath}` });

        await db.execute(`
            CREATE TABLE IF NOT EXISTS rates (
                fecha TEXT PRIMARY KEY,
                display_fecha TEXT NOT NULL,
                usd REAL NOT NULL,
                euro REAL NOT NULL,
                is_weekend INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);

        console.log(`💾 Guardando ${allDbEntries.length} tasas en la base de datos SQLite...`);
        const nowIso = new Date().toISOString();
        const chunkSize = 50;
        for (let i = 0; i < allDbEntries.length; i += chunkSize) {
            const chunk = allDbEntries.slice(i, i + chunkSize);
            const stmts = chunk.map(e => ({
                sql: `INSERT OR REPLACE INTO rates (fecha, display_fecha, usd, euro, is_weekend, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [e.fecha, e.display_fecha, e.usd, e.euro, e.is_weekend, e.source, nowIso]
            }));
            await db.batch(stmts, 'write');
        }

        console.log("\n✨ Sincronización completa. Base de datos SQLite y JSON sincronizados con éxito.");

    } catch (e) { 
        console.error("❌ Error Crítico en miner:", e.message); 
    }
}

function push(map, y, m, data) {
    if (!map[y]) map[y] = {};
    if (!map[y][m]) map[y][m] = [];
    map[y][m].push(data);
}

runMiner();