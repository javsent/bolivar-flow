const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

async function testBCV() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const { data } = await axios.get('https://www.bcv.org.ve', {
            httpsAgent: agent,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(data);
        const usd = $('#dolar strong').text().trim();
        const date = $('.pull-right.dinamico span').text().trim() || $('.date-display-single').text().trim();
        console.log(`BCV HTML -> USD: ${usd}, Date: ${date}`);
    } catch (e) {
        console.error('BCV HTML Error:', e.message);
    }

    try {
        const { data } = await axios.get('https://ve.dolarapi.com/v1/dolares');
        const oficial = data.find(d => d.fuente === 'oficial');
        console.log(`DolarAPI Oficial -> USD: ${oficial?.promedio}, Date: ${oficial?.fechaActualizacion}`);
    } catch (e) {
        console.error('DolarAPI Error:', e.message);
    }
}

testBCV();
