const http = require('http');
const fs = require('fs');

http.get('http://localhost:3000/api/historico?mes=2&anio=2026', (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
        fs.writeFileSync('test-historico.json', body);
        console.log('done');
    });
});
