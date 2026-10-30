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
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
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

export const parseAmountToNumber = (val) => {
    if (val === undefined || val === null || val === "" || val === 0) return 0;
    if (typeof val === "number") return isNaN(val) ? 0 : val;
    const str = val.toString().replace(/\./g, "").replace(",", ".");
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
};

export const parsePastedAmount = (text) => {
    if (!text || typeof text !== "string") return "";

    // Eliminar símbolos de moneda y caracteres de texto, conservando dígitos, puntos, comas y signo menos
    let cleaned = text.trim().replace(/[^0-9.,-]/g, "");
    if (!cleaned || cleaned === "-") return "";

    const isNegative = cleaned.startsWith("-");
    cleaned = cleaned.replace(/-/g, "");

    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");
    let intPart = "";
    let decPart = "";

    if (hasComma && hasDot) {
        const lastComma = cleaned.lastIndexOf(",");
        const lastDot = cleaned.lastIndexOf(".");
        if (lastComma > lastDot) {
            // Formato Europeo / Venezolano: 1.234,56
            intPart = cleaned.slice(0, lastComma).replace(/\./g, "");
            decPart = cleaned.slice(lastComma + 1);
        } else {
            // Formato USA / Internacional: 1,234.56
            intPart = cleaned.slice(0, lastDot).replace(/,/g, "");
            decPart = cleaned.slice(lastDot + 1);
        }
    } else if (hasDot) {
        const parts = cleaned.split(".");
        if (parts.length > 2) {
            // Múltiples puntos -> separadores de miles (ej: 1.000.000)
            intPart = parts.join("");
            decPart = "00";
        } else {
            // Un solo punto (ej: 150.50, 150.5, 1.000)
            if (parts[1].length === 3 && parts[0] !== "0") {
                // Típico separador de miles en estado de cuenta (ej: 1.000)
                intPart = parts.join("");
                decPart = "00";
            } else {
                intPart = parts[0] || "0";
                decPart = parts[1];
            }
        }
    } else if (hasComma) {
        const parts = cleaned.split(",");
        if (parts.length > 2) {
            // Múltiples comas -> separadores de miles (ej: 1,000,000)
            intPart = parts.join("");
            decPart = "00";
        } else {
            // Una sola coma (ej: 150,50, 150,5, 1,000)
            if (parts[1].length === 3 && parts[0] !== "0") {
                // Típico separador de miles en formato anglo (ej: 1,000)
                intPart = parts.join("");
                decPart = "00";
            } else {
                intPart = parts[0] || "0";
                decPart = parts[1];
            }
        }
    } else {
        // Entero puro sin ningún divisor (ej: 50, 100, 1500)
        intPart = cleaned;
        decPart = "00";
    }

    // Normalizar ceros a la izquierda
    intPart = intPart.replace(/^0+(?=\d)/, "") || "0";

    // Si viene 1 solo decimal (ej: 150.5), formatear a 2 decimales estándar bancario
    if (decPart.length === 1) {
        decPart = decPart + "0";
    } else if (decPart.length === 0) {
        decPart = "00";
    }

    return (isNegative ? "-" : "") + intPart + "," + decPart;
};

export const formatAmountDisplay = (val) => {
    if (!val || val === "0") return "0,00";
    const str = val.toString().trim();
    if (!str.includes(",")) return str + ",00";
    const [intPart, decPart = ""] = str.split(",");
    if (decPart.length === 0) return (intPart || "0") + ",00";
    if (decPart.length === 1) return (intPart || "0") + "," + decPart + "0";
    return (intPart || "0") + "," + decPart;
};
