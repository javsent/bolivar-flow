import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mes = parseInt(searchParams.get('mes'));
  const anio = parseInt(searchParams.get('anio'));

  const dataPath = path.join(process.cwd(), 'src', 'data', 'bcv', `${anio}.json`);
  let yearData = {};

  if (fs.existsSync(dataPath)) {
    yearData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  }

  const requestedMonthData = yearData[mes] || [];
  const now = new Date();

  // SOLO INTENTAR SINCRONIZAR SI ES EL MES/AÑO ACTUAL
  if (anio === now.getFullYear() && mes === (now.getMonth() + 1)) {
    try {
      const { data: html } = await axios.get('https://www.bcv.org.ve/', { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4000 
      });
      const $ = cheerio.load(html);

      // 1. EXTRAER LA "FECHA VALOR" DE LA HOME (Equivalente a D5)
      // El BCV la pone en un span con la clase .date-display-single
      const rawWebDate = $('.date-display-single').first().text().trim(); 
      // Ejemplo: "Jueves, 12 Febrero 2026"

      // 2. PARSEAR FECHA (Convertir "Febrero" a "02", etc.)
      const dateMatch = rawWebDate.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
      
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        const monthName = dateMatch[2].toLowerCase();
        const year = dateMatch[3];

        const meses = {
          enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
          julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
        };

        const month = meses[monthName];
        const fechaValorOficial = `${day}/${month}/${year}`; // DD/MM/YYYY

        // 3. EXTRAER TASAS (Verificado: Dólar es USD, Euro es EUR)
        const usdHome = parseFloat($('#dolar strong').text().replace(',', '.'));
        const eurHome = parseFloat($('#euro strong').text().replace(',', '.'));

        // 4. VERIFICAR SI YA EXISTE ESTA FECHA VALOR
        const alreadyExists = requestedMonthData.some(d => d.fecha === fechaValorOficial);

        if (!alreadyExists && !isNaN(usdHome) && !isNaN(eurHome)) {
          const newEntry = {
            fecha: fechaValorOficial, // USAMOS LA FECHA DE LA WEB, NO LA DEL SISTEMA
            usd: usdHome,
            euro: eurHome,
            isWeekend: false
          };

          // Inyectar al inicio, guardar y actualizar la variable de respuesta
          requestedMonthData.unshift(newEntry);
          yearData[mes] = requestedMonthData;
          fs.writeFileSync(dataPath, JSON.stringify(yearData, null, 2));
          
          console.log(`🚀 Inyección exitosa: ${fechaValorOficial} - USD: ${usdHome}`);
        }
      }
    } catch (e) {
      console.warn("⚠️ Sincronización on-demand fallida. Usando caché local.");
    }
  }

  if (requestedMonthData.length === 0) {
    return NextResponse.json({ error: "No hay datos" }, { status: 404 });
  }

  return NextResponse.json({ data: requestedMonthData });
}