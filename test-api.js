const http = require('http');

http.get('http://localhost:3000/api/historico?mes=3&anio=2026&forceXlsx=true', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log("HISTORICO:");
    console.log(JSON.parse(data));
  });
}).on('error', err => {
  console.log('Error: ', err.message);
});

http.get('http://localhost:3000/api/tasas', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log("TASAS:");
    console.log(JSON.parse(data));
  });
}).on('error', err => {
  console.log('Error: ', err.message);
});
