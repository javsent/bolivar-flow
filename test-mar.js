fetch('http://localhost:3000/api/historico?mes=3&anio=2026')
    .then(res => res.json())
    .then(json => console.log("MARCH API OUTPUT:", json.data.slice(-5)))
    .catch(err => console.error(err));
