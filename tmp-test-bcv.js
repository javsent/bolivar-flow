const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');

async function testLinks() {
  console.log("Fetching BCV page...");
  const res = await axios.get('https://www.bcv.org.ve/estadisticas/tipo-cambio-de-referencia-smc', {
    httpsAgent: new (require('https').Agent)({rejectUnauthorized: false})
  });
  const $ = cheerio.load(res.data);
  let links = [];
  $('a[href*="_smc"]').each((i, el) => {
    let href = $(el).attr('href');
    if (!href.startsWith('http')) href = 'https://www.bcv.org.ve' + href;
    if (!links.includes(href)) links.push(href);
  });
  
  console.log("Found links:", links);
  
  for (let i=0; i < Math.min(2, links.length); i++) {
     console.log(`Downloading ${links[i]}...`);
     const xlsRes = await axios.get(links[i], {responseType: 'arraybuffer', httpsAgent: new (require('https').Agent)({rejectUnauthorized: false})});
     const wb = XLSX.read(xlsRes.data, {type: 'buffer'});
     let count = 0;
     wb.SheetNames.forEach(name => {
        const sheet = wb.Sheets[name];
        const d5Content = sheet['D5']?.v;
        if (typeof d5Content === 'string' && d5Content.includes('Fecha Valor:')) {
           const match = d5Content.match(/(\d{2})\/(\d{2})\/(\d{4})/);
           if (match) {
             const [_, day, monthStr, yearStr] = match;
             if (monthStr === '03') count++;
           }
        }
     });
     console.log(`${links[i]} has ${count} dates for March.`);
  }
}
testLinks().catch(console.error);
