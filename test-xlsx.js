const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');
const https = require('https');

async function testXlsx() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const { data: htmlSMC } = await axios.get('https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc', {
            httpsAgent: agent,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $smc = cheerio.load(htmlSMC);
        let links = [];
        $smc('a[href*="_smc.xls"]').each((i, el) => {
            const href = $smc(el).attr('href');
            const fullLink = href.startsWith('http') ? href : 'https://www.bcv.org.ve' + href;
            if (!links.includes(fullLink)) links.push(fullLink);
        });

        console.log("XLSX Links found:", links);

        for (const link of links.slice(0, 1)) {
            console.log("Downloading", link);
            const response = await axios.get(link, { responseType: 'arraybuffer', httpsAgent: agent });
            const workbook = XLSX.read(response.data, { type: 'buffer' });

            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            console.log("D5:", sheet['D5']?.v);
            console.log("G11 (EUR):", sheet['G11']?.v);
            console.log("G15 (USD):", sheet['G15']?.v);
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

testXlsx();
