"use client";

// --- FORMATEADORES ---
export const formatCurrency = (val) => {
    return new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(val);
};

export const parseAnyDate = (input) => {
    if (!input) return null;

    // Si viene de Excel como número
    if (typeof input === 'number') {
        // Aproximación simple para fechas de Excel si no se usa la librería XLSX aquí
        // pero usualmente se procesa después de parsear con XLSX.
        // Dejamos la lógica robusta de page.js
        return null;
    }

    if (input instanceof Date && !isNaN(input)) return input;

    if (typeof input === 'string') {
        const cleanStr = input.trim().replace(/-/g, '/').replace(/\./g, '/');
        const parts = cleanStr.split('/');
        if (parts.length === 3) {
            let day, month, year;
            if (parts[0].length === 4) { [year, month, day] = parts; }
            else { [day, month, year] = parts; }
            if (year.length === 2) year = "20" + year;
            const date = new Date(year, month - 1, day);
            if (!isNaN(date)) return date;
        }
    }

    const finalTry = new Date(input);
    return isNaN(finalTry) ? null : finalTry;
};

export const formatFriendlyDate = (date) => {
    if (!date) return "---";
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${date.getFullYear()}`;
};

export const cleanAmount = (val) => {
    if (val === undefined || val === null || val === "" || val === 0) return 0;
    if (typeof val === 'number') return val;
    let str = val.toString().replace(/[^0-9.,-]/g, '');
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma && lastComma !== -1) {
        str = str.replace(/,/g, '');
    }
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
};
