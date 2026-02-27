const axios = require('axios');
const XLSX = require('xlsx');
const https = require('https');

async function testAllSheets() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const link = 'https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2a26_smc.xls';
        console.log("Downloading", link);
        const response = await axios.get(link, { responseType: 'arraybuffer', httpsAgent: agent });
        const workbook = XLSX.read(response.data, { type: 'buffer' });

        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            const d5 = sheet['D5']?.v;
            if (typeof d5 === 'string' && d5.includes('Fecha Valor:')) {
                const eur = sheet['G11']?.v;
                const usd = sheet['G15']?.v;
                console.log(`Sheet: ${name}, D5: ${d5}, EUR: ${eur}, USD: ${usd}`);
            }
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

testAllSheets();
