"use client";
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { 
  ArrowLeftIcon, 
  DocumentArrowDownIcon, 
  BoltIcon, 
  ArrowRightOnRectangleIcon, 
  ExclamationTriangleIcon 
} from '@heroicons/react/24/outline';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import whitelist from '@/data/whitelist.json'; 

export default function AnalisisDiferencial() {
  // --- ESTADOS ---
  const [isAuth, setIsAuth] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [authError, setAuthError] = useState(false);
  const [activeUser, setActiveUser] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [rawDataExcel, setRawDataExcel] = useState(null); 
  const [historicoGlobal, setHistoricoGlobal] = useState(null); 
  const [moneda, setMoneda] = useState('usd'); 
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resumen, setResumen] = useState(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('rybak_user');
    if (savedUser && whitelist.authorized.includes(savedUser)) {
      setIsAuth(true);
      setActiveUser(savedUser);
    }
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    const cleanUser = userInput.trim();
    if (whitelist.authorized.includes(cleanUser)) {
      localStorage.setItem('rybak_user', cleanUser);
      setIsAuth(true);
      setActiveUser(cleanUser);
      setAuthError(false);
    } else {
      setAuthError(true);
      setTimeout(() => setAuthError(false), 2000);
    }
  };

  const handleLogout = () => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      setTimeout(() => setConfirmLogout(false), 3000);
    } else {
      localStorage.removeItem('rybak_user');
      setIsAuth(false);
      setActiveUser('');
      setUserInput('');
      setConfirmLogout(false);
    }
  };

  // --- LÓGICA DE FECHAS ---
  const parseAnyDate = (input) => {
    if (!input) return null;
    if (typeof input === 'number') {
      const excelDate = XLSX.SSF.parse_date_code(input);
      return new Date(excelDate.y, excelDate.m - 1, excelDate.d);
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

  const formatToFriendlyDate = (input) => {
    const date = parseAnyDate(input);
    if (!date) return "---";
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${date.getFullYear()}`;
  };

  const formatInvertedDate = (input) => {
    const date = parseAnyDate(input);
    if (!date) return "---";
    const m = String(date.getDate()).padStart(2, '0');
    const d = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${date.getFullYear()}`;
  };

  const cleanAmount = (val) => {
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

  const procesarDiferencial = (excelRows, tasasMes, currency) => {
    if (!excelRows || !tasasMes || excelRows.length < 2) return;
    const indexSaldoFinal = excelRows.findIndex(row => 
      row.Concepto && row.Concepto.toString().toUpperCase().includes("SALDO FINAL")
    );
    const movimientos = indexSaldoFinal !== -1 ? excelRows.slice(0, indexSaldoFinal) : excelRows.slice(0, -1);
    const filaSaldoFinal = indexSaldoFinal !== -1 ? excelRows[indexSaldoFinal] : excelRows[excelRows.length - 1];

    const processed = movimientos.map(row => {
      const fechaStr = formatToFriendlyDate(row.Fecha);
      const fechaInvertidaStr = formatInvertedDate(row.Fecha);
      let infoTasa = tasasMes?.find(t => t.fecha === fechaStr) || tasasMes?.find(t => t.fecha === fechaInvertidaStr);
      const tasaDia = infoTasa ? infoTasa[currency] : 0;
      const ingBs = cleanAmount(row.Haber);
      const egrBs = cleanAmount(row.Debe);
      const montoBs = ingBs - egrBs;
      const montoUsd = tasaDia > 0 ? montoBs / tasaDia : 0;
      return { 
        fecha: infoTasa ? infoTasa.fecha : fechaStr,
        tasa: tasaDia, montoBs, montoUsd, 
        ingUsd: ingBs > 0 ? montoUsd : 0, egrUsd: egrBs > 0 ? Math.abs(montoUsd) : 0 
      };
    });

    const fechaFinStr = formatToFriendlyDate(filaSaldoFinal.Fecha);
    const fechaFinInvStr = formatInvertedDate(filaSaldoFinal.Fecha);
    let infoTasaFin = tasasMes?.find(t => t.fecha === fechaFinStr) || tasasMes?.find(t => t.fecha === fechaFinInvStr);
    const tasaCierre = infoTasaFin ? infoTasaFin[currency] : 0;
    const saldoFinalBs = cleanAmount(filaSaldoFinal.Haber);
    const saldoRealUsd = tasaCierre > 0 ? saldoFinalBs / tasaCierre : 0;
    const totalIn = processed.reduce((acc, r) => acc + r.ingUsd, 0);
    const totalOut = processed.reduce((acc, r) => acc + r.egrUsd, 0);
    const saldoTeorico = totalIn - totalOut;

    setData(processed);
    setResumen({ 
      saldoTeorico, saldoRealUsd, diferencial: saldoRealUsd - saldoTeorico, 
      porcentaje: saldoTeorico !== 0 ? ((saldoRealUsd - saldoTeorico) / Math.abs(saldoTeorico)) * 100 : 0, 
      tasaCierre, fechaCierre: infoTasaFin ? infoTasaFin.fecha : fechaFinStr, 
      saldoFinalBs, totalIn, totalOut 
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const dataBin = event.target.result;
        const wb = XLSX.read(dataBin, { type: 'binary', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(ws, { header: ["Fecha", "Concepto", "Debe", "Haber"], range: 5, defval: 0 }).filter(r => r.Fecha && r.Fecha !== "Fecha");
        if (rawData.length === 0) throw new Error("No hay datos en la tabla");
        const primeraFecha = parseAnyDate(rawData[0].Fecha);
        let mes = primeraFecha instanceof Date ? primeraFecha.getMonth() + 1 : primeraFecha.m;
        let anio = primeraFecha instanceof Date ? primeraFecha.getFullYear() : primeraFecha.y;
        const res = await fetch(`/api/historico?mes=${mes}&anio=${anio}`);
        const json = await res.json();
        if (json.data) {
          setRawDataExcel(rawData);
          setHistoricoGlobal(json.data);
          procesarDiferencial(rawData, json.data, moneda);
        }
      } catch (error) { alert("Error: " + error.message); } finally { setLoading(false); }
    };
    reader.readAsBinaryString(file);
  };

  const handleCurrencyChange = (newMoneda) => {
    setMoneda(newMoneda);
    if (rawDataExcel && historicoGlobal) { procesarDiferencial(rawDataExcel, historicoGlobal, newMoneda); }
  };

  // --- EXPORTACIÓN PDF ---
  const exportarPDF = () => {
    if (!resumen || data.length === 0) return;
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const simbolo = moneda === 'usd' ? '$' : '€';

    // Cabecera
    doc.setFontSize(22); doc.setTextColor(16, 185, 129); doc.text("RYBAK.SOFTWARE", 14, 20);
    doc.setFontSize(10); doc.setTextColor(100); doc.text("REPORTE DE ANÁLISIS DIFERENCIAL CAMBIARIO", 14, 28);
    doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString()}`, 14, 33);
    doc.text(`DIVISA DE ANÁLISIS: ${moneda.toUpperCase()}`, 14, 38);

    // Tabla de Resumen
    autoTable(doc, {
      startY: 45,
      head: [['Concepto', 'Monto en Divisa', 'Detalle']],
      body: [
        ['Flujo Teórico Acumulado', `${simbolo}${resumen.saldoTeorico.toFixed(2)}`, `Entra: ${simbolo}${resumen.totalIn.toFixed(2)} / Sale: ${simbolo}${resumen.totalOut.toFixed(2)}`],
        ['Valor Real de Mercado', `${simbolo}${resumen.saldoRealUsd.toFixed(2)}`, `Tasa Cierre: ${resumen.tasaCierre.toFixed(2)}`],
        ['Diferencial Final', `${resumen.diferencial >= 0 ? '+' : ''}${simbolo}${resumen.diferencial.toFixed(2)}`, `Variación: ${resumen.porcentaje.toFixed(2)}%`],
      ],
      theme: 'striped', headStyles: { fillColor: [15, 23, 42] }
    });

    // --- GRÁFICO MEJORADO SIN SOLAPAMIENTO ---
    const chartYBase = doc.lastAutoTable.finalY + 30;
    const chartX = 75; 
    const chartW = 75; 
    const chartH = 55; // Aumentamos altura para montos verticales

    doc.setFontSize(10); doc.setTextColor(30, 41, 59);
    doc.text("COMPARATIVA DE SALDOS Y DIFERENCIAL", 14, chartYBase - 15);
    doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`Cifras expresadas en ${moneda.toUpperCase()}`, 14, chartYBase - 10);

    // Eje base
    doc.setDrawColor(200); doc.setLineWidth(0.5);
    doc.line(chartX - 10, chartYBase + chartH, chartX + chartW + 10, chartYBase + chartH);

    const maxVal = Math.max(resumen.saldoTeorico, resumen.saldoRealUsd);
    const hTeorico = (resumen.saldoTeorico / maxVal) * chartH;
    const hReal = (resumen.saldoRealUsd / maxVal) * chartH;
    const colorDiff = resumen.diferencial >= 0 ? [16, 185, 129] : [239, 68, 68];

    // Función auxiliar para texto vertical con reborde
    const drawVerticalAmount = (text, x, barHeight, yBase) => {
        doc.saveGraphicsState();
        doc.setFontSize(9);
        // Reborde negro para legibilidad
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);
        doc.setTextColor(255, 255, 255);
        
        // El texto se coloca en el centro de la barra
        const textY = yBase + chartH - (barHeight / 2);
        // Rotación 90 grados
        doc.text(text, x + 12, textY, { angle: 90, align: 'center', renderingMode: 'fillAndStroke' });
        doc.restoreGraphicsState();
    };

    // Barra Teórica
    doc.setFillColor(30, 41, 59);
    doc.rect(chartX, chartYBase + chartH - hTeorico, 20, hTeorico, 'F');
    drawVerticalAmount(`${simbolo}${resumen.saldoTeorico.toFixed(2)}`, chartX, hTeorico, chartYBase);
    doc.setFontSize(8); doc.setTextColor(30, 41, 59);
    doc.text("TEÓRICO", chartX + 2, chartYBase + chartH + 7);

    // Barra Real
    doc.setFillColor(16, 185, 129);
    doc.rect(chartX + 45, chartYBase + chartH - hReal, 20, hReal, 'F');
    drawVerticalAmount(`${simbolo}${resumen.saldoRealUsd.toFixed(2)}`, chartX + 45, hReal, chartYBase);
    doc.setTextColor(16, 185, 129);
    doc.text("REAL", chartX + 51, chartYBase + chartH + 7);

    // --- LÍNEA DE DIFERENCIAL ---
    doc.setDrawColor(colorDiff[0], colorDiff[1], colorDiff[2]);
    doc.setLineWidth(0.4);
    doc.setLineDash([1.5, 1], 0);
    doc.line(chartX + 20, chartYBase + chartH - hTeorico, chartX + 45, chartYBase + chartH - hReal);
    
    // Etiqueta de diferencial centrada sobre la línea de conexión
    const midX = chartX + 24;
    const midY = (chartYBase + chartH - hTeorico + chartYBase + chartH - hReal) / 2;
    doc.setFontSize(8); doc.setTextColor(colorDiff[0], colorDiff[1], colorDiff[2]);
    doc.text(`${resumen.diferencial >= 0 ? 'GANANCIA' : 'PÉRDIDA'}: ${simbolo}${Math.abs(resumen.diferencial).toFixed(2)}`, midX, midY - 3);
    doc.setLineDash([], 0);

    // Tabla de Movimientos
    autoTable(doc, {
      startY: chartYBase + chartH + 25,
      head: [['Fecha', `Tasa ${moneda.toUpperCase()}`, 'Monto Bs.', `Valor ${simbolo}`]],
      body: data.map(row => [row.fecha, row.tasa.toFixed(2), row.montoBs.toLocaleString('de-DE', {minimumFractionDigits: 2}), `${simbolo}${row.montoUsd.toFixed(2)}`]),
      foot: [['SALDO FINAL REAL', resumen.tasaCierre.toFixed(2), resumen.saldoFinalBs.toLocaleString('de-DE', {minimumFractionDigits: 2}), `${simbolo}${resumen.saldoRealUsd.toFixed(2)}`]],
      showFoot: 'lastPage',
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
            const val = parseFloat(data.cell.raw.replace(/[^0-9.-]+/g,""));
            if (val > 0) data.cell.styles.textColor = [37, 99, 235]; // Azul
            if (val < 0) data.cell.styles.textColor = [220, 38, 38]; // Rojo
        }
      },
      headStyles: { fillColor: [16, 185, 129] }, 
      footStyles: { fillColor: [30, 41, 59] },
      didDrawPage: (data) => { 
        doc.setFontSize(8); 
        doc.setTextColor(150); 
        doc.text("Reporte generado por rybak.Software @ 2026", 14, pageHeight - 10); 
      }
    });

    doc.save(`Auditoria_Rybak_${moneda.toUpperCase()}_${new Date().getTime()}.pdf`);
  };

  // --- DESCARGAR FORMATO EXCEL ---
  const descargarFormato = () => {
    const dataFormato = [
      ["BOLÍVAR FLOW - MÓDULO DE AUDITORÍA RYBAK"],
      ["INSTRUCCIÓN 1 (FECHAS):", "Las celdas de fechas deben estar formateadas como TEXTO en excel para evitar errores a la hora de la lectura. Formato DD/MM/AAAA (Ej: 01/03/2025)."],
      ["INSTRUCCIÓN 2 (MONTOS):", "No use separadores de miles (puntos). Use coma para decimales."],
      ["INSTRUCCIÓN 3 (ESTRUCTURA):", "La tabla DEBE empezar con 'Saldo Inicial' y terminar con 'Saldo Final'."],
      [""], 
      ["Fecha", "Concepto", "Debe (Egreso Bs)", "Haber (Ingreso Bs)"],
      ["01/03/2025", "Saldo Inicial de Mes", 0, 10000.00],
      ["05/03/2025", "Gasto Operativo", 2500.00, 0],
      ["31/03/2025", "Saldo Final", 0, 7500.00]
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(dataFormato);
    ws['!cols'] = [{ wch: 25 }, { wch: 65 }, { wch: 20 }, { wch: 20 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } }, { s: { r: 2, c: 1 }, e: { r: 2, c: 3 } }, { s: { r: 3, c: 1 }, e: { r: 3, c: 3 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Formato_Auditoria");
    XLSX.writeFile(wb, "Formato_Auditoria_Rybak.xlsx");
  };

// --- CUADRO DE AUTENTICACION/LOGIN INICIA ---//
if (!isAuth) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0f172a] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-[#1e293b] p-8 rounded-3xl border border-slate-700 shadow-2xl text-center animate-in zoom-in duration-300">
          <div className="mb-6">
            <BoltIcon className="h-12 w-12 text-blue-500 mx-auto mb-2 animate-pulse" />
            <h1 className="text-2xl font-black uppercase tracking-tighter text-emerald-400">
              BOLÍVAR <span className="text-blue-500">FLOW</span>
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Calculadora Monetaria</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="@usuario"
              className={`w-full bg-slate-900 border ${authError ? 'border-red-500 animate-pulse' : 'border-slate-700'} rounded-xl p-4 text-center text-white outline-none focus:border-emerald-500 transition-all font-mono`}
            />
            
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-4 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
              >
                Acceder al Sistema
              </button>

              {/* Botón de Invitado: Reutiliza la lógica de login con valor predefinido */}
              <button
                type="button"
                onClick={() => {
                  setUserInput('@invitado');
                  // Forzamos el login inmediato con el usuario @invitado
                  const loginEvent = { preventDefault: () => {} };
                  setTimeout(() => {
                     // Usamos una pequeña demora para asegurar que el estado de userInput se procese o 
                     // simplemente llamamos a la lógica manualmente
                    if (whitelist.authorized.includes('@invitado')) {
                        localStorage.setItem('rybak_user', '@invitado');
                        setIsAuth(true);
                        setActiveUser('@invitado');}

                  }, 10);
                }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-bold uppercase py-3 rounded-xl transition-all active:scale-95 border border-slate-700 text-[11px] tracking-widest"
              >
                Entrar como Invitado
              </button>
              <p className="text-[8px] text-slate-300 items-center align-middle uppercase tracking-widest pt-0"> Contacto: rybak.software@gmail.com</p>
              <p className="text-[6px] text-slate-500 items-center align-middle uppercase tracking-widest pt-0"> Rybak.Software © 2026 - Todos los derechos reservados</p>
            </div>
          </form>

          {authError && (
            <p className="text-red-400 text-[9px] font-bold uppercase mt-4 tracking-wider animate-in fade-in">
              Acceso denegado: Usuario no autorizado
            </p>
          )}
        </div>
      </div>
    );
  }
// --- CUADRO DE AUTENTICACION/LOGIN TERMINA ---//

  return (
    <div className="p-4 md:p-8 text-white bg-[#0f172a] min-h-screen font-sans relative">
      <div className="max-w-4xl mx-auto flex justify-end mb-4">
        <button onClick={handleLogout} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all duration-300 text-[10px] font-bold uppercase tracking-widest group animate-in slide-in-from-right-2 ${confirmLogout ? 'bg-amber-500 text-white border-amber-400 scale-105 shadow-lg shadow-amber-900/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white'}`}>
          {confirmLogout ? <><ExclamationTriangleIcon className="h-3.5 w-3.5" /> ¿Confirmar?</> : <><ArrowRightOnRectangleIcon className="h-3.5 w-3.5" /> Salir</>}
        </button>
      </div>

      <div className="max-w-4xl mx-auto mb-4 flex items-center justify-start gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Hola, <span className="text-white italic">{activeUser}</span></p>
      </div>

      <div className="max-w-4xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-400 mb-6 transition-colors group">
          <ArrowLeftIcon className="w-3 h-3 transform group-hover:-translate-x-1 transition-transform" /> Volver al Monitor
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-black uppercase tracking-tighter text-emerald-400 italic">Análisis Diferencial</h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500 font-bold mt-1">Modulo de analisis diferencial V1.1</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700 shadow-xl min-h-[180px] flex flex-col justify-between transition-all hover:border-slate-600">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 block">1. Subir Estado de Cuenta</label>
              <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-emerald-600 file:text-white cursor-pointer bg-slate-900/50 rounded-xl border border-slate-800 p-2" />
            </div>
            <div className="mt-4 space-y-2">
              <button onClick={descargarFormato} className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 underline decoration-dotted underline-offset-4 uppercase tracking-wider">Para descargar el formato, haga clic aquí</button>
              <p className="text-[9px] text-slate-500 italic block leading-relaxed">
                * A:Fecha, C:Debe, D:Haber. <br />
                <span className="text-emerald-500/80 font-bold">Importante:</span> La última fila debe ser el <span className="text-white">SALDO FINAL</span>.
              </p>
            </div>
          </div>

          <div className={`bg-[#1e293b] p-6 rounded-2xl border shadow-xl min-h-[180px] flex flex-col justify-between transition-all duration-300 ${data.length > 0 ? 'border-blue-500/30 opacity-100' : 'border-slate-700 opacity-40'}`}>
            <label className="text-[10px] font-black uppercase text-blue-400 tracking-widest mb-4 block">2. Configurar Divisa de Análisis</label>
            <select disabled={data.length === 0} value={moneda} onChange={(e) => handleCurrencyChange(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm font-bold text-white outline-none focus:border-blue-500 cursor-pointer disabled:cursor-not-allowed">
              <option value="usd">USD (BCV $)</option>
              <option value="euro">Euro (BCV €)</option>
            </select>
            <p className="text-[9px] text-slate-500 italic mt-4 uppercase tracking-wider">* El cambio de divisa recalcula el reporte instantáneamente.</p>
          </div>
        </div>

        {loading && <div className="flex flex-col items-center justify-center py-20 gap-4 text-emerald-500"><div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div><p className="text-[10px] font-black uppercase tracking-widest">Sincronizando tasas del mes...</p></div>}

        {data.length > 0 && resumen && !loading && (
          <div className="space-y-10 animate-in fade-in duration-500">
            <div className="bg-[#1e293b] rounded-3xl border border-slate-700 overflow-hidden shadow-2xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-800/80 text-[9px] uppercase font-black tracking-widest text-slate-500">
                  <tr><th className="p-4">Fecha Operación</th><th className="p-4 text-right">Tasa {moneda.toUpperCase()}</th><th className="p-4 text-right">Monto Bs.</th><th className="p-4 text-right">Valor {moneda === 'usd' ? '$' : '€'}</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {data.map((row, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-mono opacity-60 text-[10px]">{row.fecha}</td>
                      <td className="p-4 text-right font-bold text-blue-400">{row.tasa > 0 ? row.tasa.toFixed(2) : "---"}</td>
                      <td className={`p-4 text-right font-mono ${row.montoBs >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>{row.montoBs.toLocaleString('de-DE', {minimumFractionDigits: 2})}</td>
                      <td className={`p-4 text-right font-black ${row.montoUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{moneda === 'usd' ? '$' : '€'}{Math.abs(row.montoUsd).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-500/5 border-t-2 border-blue-500/30 font-black">
                    <td className="p-4 italic uppercase text-blue-400 text-[10px]">Saldo Final (Cierre)</td>
                    <td className="p-4 text-right text-blue-500">{resumen.tasaCierre > 0 ? resumen.tasaCierre.toFixed(2) : "---"}</td>
                    <td className="p-4 text-right text-blue-300">{resumen.saldoFinalBs.toLocaleString('de-DE', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right text-blue-400 underline underline-offset-4">{moneda === 'usd' ? '$' : '€'}{resumen.saldoRealUsd.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800/60 p-5 rounded-2xl border border-slate-700 min-h-[120px] flex flex-col justify-between">
                  <p className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Flujo Teórico ({moneda.toUpperCase()})</p>
                  <div className="text-2xl font-mono font-bold tracking-tighter text-white">{moneda === 'usd' ? '$' : '€'}{resumen.saldoTeorico.toLocaleString('de-DE', {minimumFractionDigits: 2})}</div>
                  <div className="flex gap-3 text-[8px] font-bold uppercase border-t border-slate-700 pt-2">
                      <span className="text-emerald-500 font-black">ENTRA: <span className="text-white">{moneda === 'usd' ? '$' : '€'}{resumen.totalIn.toFixed(2)}</span></span>
                      <span className="text-red-400 font-black">SALE: <span className="text-white">{moneda === 'usd' ? '$' : '€'}{resumen.totalOut.toFixed(2)}</span></span>
                  </div>
              </div>
              <div className="bg-slate-800/60 p-5 rounded-2xl border border-slate-700 min-h-[120px] flex flex-col justify-between border-b-blue-500 border-b-2">
                  <p className="text-[9px] font-black uppercase text-blue-400 tracking-wider">Valor Real de Mercado</p>
                  <div className="text-2xl font-mono font-bold tracking-tighter text-white">{moneda === 'usd' ? '$' : '€'}{resumen.saldoRealUsd.toLocaleString('de-DE', {minimumFractionDigits: 2})}</div>
                  <div className="text-[8px] font-bold uppercase text-blue-500/60 text-right italic">Tasa cierre: {resumen.tasaCierre.toFixed(2)}</div>
              </div>
              <div className={`p-5 rounded-2xl border min-h-[120px] flex flex-col justify-between shadow-xl ${resumen.diferencial >= 0 ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-red-500/10 border-red-500/50'}`}>
                  <p className={`text-[9px] font-black uppercase tracking-wider ${resumen.diferencial >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>Diferencial Cambiario</p>
                  <div className={`text-2xl font-black tracking-tighter ${resumen.diferencial >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{resumen.diferencial >= 0 ? '+' : ''}{moneda === 'usd' ? '$' : '€'}{resumen.diferencial.toLocaleString('de-DE', {minimumFractionDigits: 2})}</div>
                  <div className={`text-[9px] font-bold text-right italic ${resumen.diferencial >= 0 ? 'text-emerald-500/70' : 'text-red-400/70'}`}>VAR: {resumen.porcentaje.toFixed(2)}%</div>
              </div>
            </div>

            <div className="flex justify-center pb-10">
              <button onClick={exportarPDF} className="w-full md:w-max px-12 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase py-4 rounded-2xl flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02] shadow-xl shadow-blue-900/30 border border-blue-400/20">
                <DocumentArrowDownIcon className="w-5 h-5" /> Finalizar y Exportar Reporte de Auditoría
              </button>
            </div>
          </div>
        )}

        <div className="mt-10 pt-4 border-t border-[#334155]/30 text-center pb-10">
          <p className="text-[10px] text-slate-600 font-mono uppercase tracking-[0.4em]">© 2026 RYBAK.SOFTWARE</p>
        </div>
      </div>
    </div>
  );
}