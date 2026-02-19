"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowsUpDownIcon, CalendarDaysIcon, CalculatorIcon,
  ArrowDownTrayIcon, ClipboardDocumentIcon, DocumentTextIcon,
  BoltIcon, ChartBarIcon, ArrowRightOnRectangleIcon,
  ExclamationTriangleIcon, ArrowPathIcon, ShareIcon
} from '@heroicons/react/24/solid';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import HistoryChart from '@/components/HistoryChart';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/lib/utils';

export default function CurrencyApp() {
  const { user, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);

  // --- ESTADOS UX (Toast) ---
  const [toastMessage, setToastMessage] = useState(null);

  // --- ESTADOS CALCULADORA/HISTORIAL ---
  const chartRef = useRef(null);
  const dateInputRef = useRef(null);
  const shareRef = useRef(null);

  const [view, setView] = useState('calculator');
  const [amount, setAmount] = useState('');
  const [converted, setConverted] = useState(0);

  const [isForeignToVes, setIsForeignToVes] = useState(false);

  const [loading, setLoading] = useState(false);
  const [rates, setRates] = useState({ bcv: 0, euro: 0, binance: 0, paralelo: 0 });
  const [activeRate, setActiveRate] = useState('bcv');
  const [selectedDate, setSelectedDate] = useState('');
  const [displayDate, setDisplayDate] = useState('');
  const [isHistoricalRate, setIsHistoricalRate] = useState(false);

  const [histMonth, setHistMonth] = useState(new Date().getMonth() + 1);
  const [histYear, setHistYear] = useState(new Date().getFullYear());
  const [histData, setHistData] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const buttonLabels = { bcv: "BCV $", euro: "BCV €", binance: "Binance", paralelo: "Paralelo" };
  const currentYear = new Date().getFullYear();
  const yearsRange = Array.from({ length: currentYear - 2020 + 1 }, (_, i) => 2020 + i).reverse();
  const monthNames = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  // --- LÓGICA DE CARGA INICIAL ---
  useEffect(() => {
    resetToToday();
  }, []);

  // --- FUNCIÓN PARA RESETEAR A HOY (LIVE) ---
  const resetToToday = () => {
    const now = new Date();
    setSelectedDate(now.toISOString().split('T')[0]);
    fetchCurrentRates();
  };

  // --- TOAST HELPER ---
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleLogoutClick = () => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      setTimeout(() => setConfirmLogout(false), 3000);
    } else {
      logout();
      setConfirmLogout(false);
    }
  };

  // --- LÓGICA DE TASAS (WEB API) MEJORADA ---
  const fetchCurrentRates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasas');
      if (!res.ok) throw new Error("Falló API");
      const data = await res.json();

      const today = new Date();
      const resHisto = await fetch(`/api/historico?mes=${today.getMonth() + 1}&anio=${today.getFullYear()}`);
      const jsonHisto = await resHisto.json();
      const historico = jsonHisto.data || [];

      let tasaVigente = null;
      let fechaBusqueda = new Date(today);

      for (let i = 0; i < 7; i++) {
        const fechaStr = fechaBusqueda.toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        });
        const coincidencia = historico.find(d => d.fecha === fechaStr);
        if (coincidencia) {
          tasaVigente = coincidencia;
          break;
        }
        fechaBusqueda.setDate(fechaBusqueda.getDate() - 1);
      }

      if (tasaVigente) {
        setRates({
          ...data,
          bcv: tasaVigente.usd,
          euro: tasaVigente.euro
        });
        setDisplayDate(today.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }));
      } else {
        setRates(data);
        setDisplayDate(today.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }));
      }

      setIsHistoricalRate(false);
    } catch (e) {
      console.error("Error cargando tasas:", e);
      showToast("Error al sincronizar fecha valor");
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = async (e) => {
    const newDate = e.target.value;
    if (!newDate) return;
    if (activeRate === 'paralelo' || activeRate === 'binance') {
      showToast("Historial solo disponible para tasas oficiales");
      return;
    }
    setSelectedDate(newDate);
    setLoading(true);
    try {
      let dateObj = new Date(newDate + "T12:00:00");
      let found = false;
      let dayData = null;

      // Intentar buscar hasta 7 días hacia atrás (para cubrir fines de semana y feriados largos)
      for (let i = 0; i < 7; i++) {
        const res = await fetch(`/api/historico?mes=${dateObj.getMonth() + 1}&anio=${dateObj.getFullYear()}`);
        const json = await res.json();
        const dayStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        dayData = json.data?.find(d => d.fecha === dayStr);

        if (dayData) {
          found = true;
          break;
        }
        // Si no se halla, retroceder un día
        dateObj.setDate(dateObj.getDate() - 1);
      }

      if (found && dayData) {
        setRates(prev => ({ ...prev, bcv: dayData.usd, euro: dayData.euro }));
        setIsHistoricalRate(true);

        // CORRECCIÓN: Mostramos la fecha que el usuario seleccionó, no la de la tasa hallada
        const selectedDateFormatted = new Date(newDate + "T12:00:00").toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        });
        setDisplayDate(selectedDateFormatted);

        if (dayData.fecha !== selectedDateFormatted) {
          showToast(`Usando tasa del día ${dayData.fecha}`);
        }
      } else {
        showToast("No se halló registro reciente");
        fetchCurrentRates();
      }
    } catch (e) {
      console.error(e);
      fetchCurrentRates();
    } finally {
      setLoading(false);
    }
  };

  // --- LÓGICA DE HISTÓRICO CON RELLENADO Y STOP CRONOLÓGICO ---
  const fetchHistory = async () => {
    setHistLoading(true);
    setHistData([]);
    try {
      const res = await fetch(`/api/historico?mes=${histMonth}&anio=${histYear}`);
      const json = await res.json();
      const rawData = json.data || [];

      if (rawData.length === 0) {
        setHistData([]);
        return;
      }

      const parseFecha = (str) => {
        const [d, m, y] = str.split('/').map(Number);
        return new Date(y, m - 1, d);
      };

      const lastEntryDate = rawData.reduce((max, entry) => {
        const d = parseFecha(entry.fecha);
        return d > max ? d : max;
      }, parseFecha(rawData[0].fecha));

      const filledData = [];
      let lastValidUsd = rawData[0].usd;
      let lastValidEuro = rawData[0].euro;

      const stopDay = lastEntryDate.getDate();

      for (let day = 1; day <= stopDay; day++) {
        const currentSearchDate = new Date(histYear, histMonth - 1, day);
        const dayStr = currentSearchDate.toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const entry = rawData.find(d => d.fecha === dayStr);

        if (entry) {
          lastValidUsd = entry.usd;
          lastValidEuro = entry.euro;
          filledData.push({ ...entry });
        } else {
          filledData.push({
            fecha: dayStr,
            usd: lastValidUsd,
            euro: lastValidEuro,
            isWeekend: true
          });
        }
      }

      setHistData(filledData.reverse());
    } catch (err) {
      console.error(err);
    } finally {
      setHistLoading(false);
    }
  };

  // --- LÓGICA DE INPUT FINANCIERO (PUNTO FIJO) ---
  const handleAmountChange = (e) => {
    const val = e.target.value.replace(/\D/g, ''); // Solo números
    const num = parseInt(val || '0', 10);
    const formatted = formatCurrency(num / 100);
    setAmount(formatted);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    let text = e.clipboardData.getData('text');
    const cleanText = text.replace(/\D/g, '');
    if (cleanText) {
      const num = parseInt(cleanText, 10);
      const formatted = formatCurrency(num / 100);
      setAmount(formatted);
    }
  };

  const handleInvert = () => {
    // Intercambiar dirección
    const nextIsForeignToVes = !isForeignToVes;
    setIsForeignToVes(nextIsForeignToVes);

    // Intercambiar valores
    const newAmount = formatCurrency(converted);
    setAmount(newAmount);
  };

  useEffect(() => {
    const rateVal = rates[activeRate] || 0;
    const cleanAmountStr = amount.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleanAmountStr) || 0;
    setConverted(isForeignToVes ? num * rateVal : (rateVal > 0 ? num / rateVal : 0));
  }, [amount, activeRate, isForeignToVes, rates]);

  // --- UTILS DE COPIADO ---
  const handleCopySingleResult = () => {
    const val = formatCurrency(converted);
    navigator.clipboard.writeText(val)
      .then(() => showToast(`Monto copiado: ${val}`))
      .catch(err => console.error(err));
  };

  const handleCopyRate = () => {
    const rateVal = rates[activeRate] || 0;
    const val = formatCurrency(rateVal);
    navigator.clipboard.writeText(val)
      .then(() => showToast(`Tasa copiada: ${val}`))
      .catch(err => console.error(err));
  };

  // --- COMPARTIR IMAGEN ---
  const handleShareImage = async () => {
    if (!shareRef.current) return;
    if (!amount || amount === '0') {
      showToast("Ingresa un monto para compartir");
      return;
    }
    try {
      showToast("Generando imagen...");
      const canvas = await html2canvas(shareRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
        windowWidth: 600,
        windowHeight: shareRef.current.scrollHeight
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const inputSymbol = isForeignToVes ? (activeRate === 'euro' ? '€' : '$') : 'Bs';
        const outputSymbol = isForeignToVes ? 'Bs' : (activeRate === 'euro' ? '€' : '$');
        const rateVal = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(rates[activeRate] || 0);
        const inputVal = amount;
        const outputVal = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(converted);
        const file = new File([blob], 'calculo-bolivar-flow.png', { type: 'image/png' });
        const shareText = `📊 *Reporte Bolivar Flow*\n\n` +
          `📆 Fecha: ${displayDate}\n` +
          `💵 Tasa: ${rateVal} Bs\n` +
          `🔄 Conversión: ${inputVal} ${inputSymbol} ➝ ${outputVal} ${outputSymbol}\n\n` +
          `🚀 Calculado en: bolivar-flow.vercel.app`;

        if (navigator.share) {
          try {
            await navigator.share({ files: [file], title: 'Bolívar Flow Cálculo', text: shareText });
          } catch (error) {
            if (error.name !== 'AbortError') console.error('Error sharing:', error);
          }
        } else {
          const link = document.createElement('a');
          link.download = 'bolivar-flow.png';
          link.href = canvas.toDataURL();
          link.click();
        }
      }, 'image/png');
    } catch (e) { showToast("Error generando imagen"); }
  };

  // --- EXPORTACIONES ---
  const exportToExcel = () => {
    const dataClean = histData.map(item => ({ "Fecha Valor": item.fecha, "USD (Bs)": item.usd, "EUR (Bs)": item.euro }));
    const worksheet = XLSX.utils.json_to_sheet(dataClean);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Historial BCV");
    XLSX.writeFile(workbook, `Historial_BCV_${histMonth}_${histYear}.xlsx`);
  };

  const exportToPDF = async () => {
    if (histData.length === 0) return;
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const cronoData = [...histData].reverse();

      // --- HEADER ---
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 45, 'F');
      doc.setFontSize(24);
      doc.setTextColor(16, 185, 129);
      doc.setFont("helvetica", "bold");
      doc.text("BOLÍVAR FLOW", 15, 22, { charSpace: 0 });
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.setFont("helvetica", "normal");
      doc.text("REPORTE ANALÍTICO DE TASAS OFICIALES BCV", 15, 30, { charSpace: 0 });
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);

      // CAMBIO: Mostrar nombre del mes en lugar del número
      const currentMonthName = monthNames[histMonth - 1] || histMonth;
      doc.text(`MES: ${currentMonthName} / AÑO: ${histYear}`, pageWidth - 15, 22, { align: 'right', charSpace: 0 });
      doc.text(`GENERADO POR: ${user}`, pageWidth - 15, 30, { align: 'right', charSpace: 0 });

      // --- BLOQUE ESTADÍSTICO DUAL ---
      const usdIni = cronoData[0].usd;
      const usdFin = cronoData[cronoData.length - 1].usd;
      const eurIni = cronoData[0].euro;
      const eurFin = cronoData[cronoData.length - 1].euro;

      const varUsd = ((usdFin - usdIni) / usdIni) * 100;
      const varEur = ((eurFin - eurIni) / eurIni) * 100;

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("ANÁLISIS DE VARIACIÓN MENSUAL", 15, 58, { charSpace: 0 });
      doc.setDrawColor(226, 232, 240);
      doc.line(15, 61, pageWidth - 15, 61);

      // Card USD
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, 65, 85, 22, 2, 2, 'F');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.text("DIVISA: DÓLAR (USD)", 20, 71, { charSpace: 0 });
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(10);
      doc.text(`DE ${usdIni.toFixed(2)} Bs A ${usdFin.toFixed(2)} Bs`, 20, 77, { charSpace: 0 });
      doc.setTextColor(varUsd >= 0 ? 185 : 22, varUsd >= 0 ? 28 : 163, varUsd >= 0 ? 28 : 74);
      doc.setFont("helvetica", "bold");
      doc.text(`VAR: ${varUsd >= 0 ? '+' : ''}${varUsd.toFixed(2)}%`, 20, 83, { charSpace: 0 });

      // Card EUR
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(110, 65, 85, 22, 2, 2, 'F');
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.text("DIVISA: EURO (EUR)", 115, 71, { charSpace: 0 });
      doc.setTextColor(30, 41, 59);
      doc.text(`DE ${eurIni.toFixed(2)} Bs A ${eurFin.toFixed(2)} Bs`, 115, 77, { charSpace: 0 });
      doc.setTextColor(varEur >= 0 ? 185 : 22, varEur >= 0 ? 28 : 163, varEur >= 0 ? 28 : 74);
      doc.setFont("helvetica", "bold");
      doc.text(`VAR: ${varEur >= 0 ? '+' : ''}${varEur.toFixed(2)}%`, 115, 83, { charSpace: 0 });

      // --- GRÁFICA VECTORIAL ---
      const gY = 105;
      const gH = 45;
      const gW = pageWidth - 40;
      const gX = 25;

      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("HISTÓRICO COMPARATIVO BCV", 15, 100, { charSpace: 0 });

      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.1);
      doc.line(gX, gY, gX, gY + gH);
      doc.line(gX, gY + gH, gX + gW, gY + gH);

      const allRates = [...cronoData.map(d => d.usd), ...cronoData.map(d => d.euro)];
      const maxV = Math.max(...allRates) * 1.02;
      const minV = Math.min(...allRates) * 0.98;
      const rangeV = maxV - minV;

      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(maxV.toFixed(2), gX - 2, gY + 2, { align: 'right', charSpace: 0 });
      doc.text(minV.toFixed(2), gX - 2, gY + gH, { align: 'right', charSpace: 0 });

      const getP = (val, i) => ({
        x: gX + (i * (gW / (cronoData.length - 1))),
        y: (gY + gH) - ((val - minV) / rangeV * gH)
      });

      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(0.5);
      for (let i = 0; i < cronoData.length - 1; i++) {
        const p1 = getP(cronoData[i].usd, i);
        const p2 = getP(cronoData[i + 1].usd, i + 1);
        doc.line(p1.x, p1.y, p2.x, p2.y);
      }

      doc.setDrawColor(59, 130, 246);
      for (let i = 0; i < cronoData.length - 1; i++) {
        const p1 = getP(cronoData[i].euro, i);
        const p2 = getP(cronoData[i + 1].euro, i + 1);
        doc.line(p1.x, p1.y, p2.x, p2.y);
      }

      // --- TABLA Y PIE DE PÁGINA GLOBAL ---
      autoTable(doc, {
        head: [['FECHA', 'USD ($)', 'EUR (€)', 'ESTADO']],
        body: histData.map(i => [i.fecha, i.usd.toFixed(4), i.euro.toFixed(4), i.isWeekend ? 'CERRADO' : 'OPERATIVO']),
        startY: 162,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], halign: 'center' },
        columnStyles: {
          0: { halign: 'center' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'center' }
        },
        didDrawPage: (data) => {
          doc.setFontSize(8);
          doc.setTextColor(150);
          doc.setFont("helvetica", "normal");
          doc.text("rybak.Software © 2026 - Reporte generado por sistema Bolívar Flow", 15, pageHeight - 10, { charSpace: 0 });
          doc.text(`Página ${doc.internal.getNumberOfPages()}`, pageWidth - 15, pageHeight - 10, { align: 'right', charSpace: 0 });
        },
        didParseCell: (d) => {
          if (d.section === 'body' && d.row.raw[3] === 'CERRADO') d.cell.styles.textColor = [160, 160, 160];
        }
      });

      doc.save(`REPORTE_BCV_${currentMonthName}_${histYear}.pdf`);
      showToast("Reporte PDF generado");
    } catch (e) {
      console.error(e);
      showToast("Error en PDF");
    }
  };

  const copyToClipboard = () => {
    const header = "Fecha Valor\tUSD\tEUR\n";
    const body = histData.map(i => `${i.fecha}\t${i.usd.toFixed(4)}\t${i.euro.toFixed(4)}`).join('\n');
    const fullText = header + body;
    navigator.clipboard.writeText(fullText).then(() => showToast("¡Tabla copiada al portapapeles!"));
  };

  // --- CUADRO DE CARGA ---
  if (loading && rates.bcv === 0) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-4">
        <BoltIcon className="h-12 w-12 text-emerald-500 animate-pulse mb-4" />
        <p className="text-emerald-500 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">Sincronizando Mercado...</p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-transparent flex flex-col items-center p-4 text-white font-sans relative">

      <div ref={shareRef} className="fixed top-0 left-[-9999px] w-[600px] bg-[#0f172a] p-10 flex flex-col font-sans text-white border-4 border-emerald-500/20">
        <div className="text-center mb-10 flex flex-col items-center">
          <div className="flex items-center justify-center gap-4">
            <h1 className="text-5xl font-black uppercase tracking-tighter text-emerald-400 leading-none">
              BOLÍVAR <span className="text-blue-500">FLOW</span>
            </h1>
            <BoltIcon className="h-12 w-10 text-blue-500 flex-shrink-0 -mt-1" />
          </div>
          <p className="text-sm text-slate-500 uppercase tracking-[0.6em] font-bold mt-3">Análisis Cambiario</p>
        </div>

        <div className="flex flex-col gap-8 mb-10">
          <div className="bg-[#1e293b] p-10 rounded-[2.5rem] border-2 border-slate-700 text-center shadow-2xl flex flex-col items-center">
            <p className="text-slate-400 uppercase text-2xl tracking-widest font-bold mb-4">Tasa de Cambio: {buttonLabels[activeRate]}</p>

            <div className="flex justify-center items-baseline gap-3 mb-2">
              <span className="text-white text-7xl font-bold font-mono tracking-tight leading-none">
                {new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(rates[activeRate] || 0)}
              </span>
              <span className="text-3xl font-bold text-emerald-500">Bs</span>
            </div>

            <div className="mt-14 bg-slate-900 px-10 h-14 rounded-full border-2 border-yellow-500/40 flex items-center justify-center min-w-[240px]">
              <p className="text-yellow-400 text-2xl uppercase font-black tracking-[0.2em] leading-none pb-5">
                {displayDate}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <div className="flex justify-between items-center bg-slate-800/40 p-8 rounded-3xl border border-slate-700/50">
              <span className="text-slate-400 font-bold text-2xl uppercase tracking-wider">Monto:</span>
              <span className="text-white font-mono text-5xl font-bold">
                {amount || '0'} <span className="text-slate-500 text-3xl ml-2">{isForeignToVes ? (activeRate === 'euro' ? '€' : '$') : 'Bs'}</span>
              </span>
            </div>

            <div className="flex flex-col bg-emerald-900/10 p-10 rounded-3xl border-2 border-emerald-500/30">
              <span className="text-emerald-400 font-bold text-2xl uppercase tracking-widest mb-4">Equivale a:</span>
              <div className="flex justify-end items-baseline gap-3">
                <span className="text-white font-mono text-6xl font-black tracking-tight leading-none">
                  {new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(converted)}
                </span>
                <span className="text-emerald-500 text-4xl font-bold uppercase">
                  {isForeignToVes ? 'Bs' : (activeRate === 'euro' ? 'EUR' : 'USD')}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center pt-8 border-t border-slate-800 mt-auto">
          <p className="text-2xl font-black text-blue-500 tracking-tighter">bolivar-flow.vercel.app</p>
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-10 z-[200] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2">
            <ClipboardDocumentIcon className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold tracking-wide">{toastMessage}</span>
          </div>
        </div>
      )}

      <div className="w-full max-w-md flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Hola, <span className="text-white italic">{user}</span></p>
        </div>
        <button onClick={handleLogoutClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all duration-300 text-[10px] font-bold uppercase tracking-widest group animate-in slide-in-from-right-2 ${confirmLogout ? 'bg-amber-500 text-white border-amber-400 scale-105 shadow-lg shadow-amber-900/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white'}`}>
          {confirmLogout ? <><ExclamationTriangleIcon className="h-4 w-4" /> ¿Confirmar?</> : <><ArrowRightOnRectangleIcon className="h-4 w-4" /> Salir</>}
        </button>
      </div>

      <div className="w-full max-w-md bg-[#1e293b] p-1 rounded-xl mb-4 flex border border-[#334155] shadow-md relative z-20">
        <button onClick={() => setView('calculator')} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${view === 'calculator' ? 'bg-[#334155] text-emerald-400 font-bold shadow-inner' : 'text-slate-500 hover:text-white'}`}>
          <CalculatorIcon className="h-4 w-4" /> Calc
        </button>
        <button onClick={() => setView('history')} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${view === 'history' ? 'bg-[#334155] text-emerald-400 font-bold shadow-inner' : 'text-slate-500 hover:text-white'}`}>
          <CalendarDaysIcon className="h-4 w-4" /> Histórico
        </button>
      </div>

      <div className="w-full max-w-md bg-[#1e293b] p-6 rounded-2xl min-h-[520px] relative z-10 flex flex-col shadow-xl border border-[#334155]">


        {view === 'calculator' ? (
          <div className="animate-in fade-in duration-300 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-black uppercase tracking-tight text-emerald-400">
                  BOLÍVAR <span className="text-blue-500">FLOW</span>
                </h1>
                <BoltIcon className="h-8 w-8 text-blue-500 animate-pulse" />
              </div>
              <div className={`px-2 py-1 rounded text-[10px] font-bold border ${isHistoricalRate ? 'bg-amber-500/10 text-amber-400 border-amber-500' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500'}`}>
                {isHistoricalRate ? 'HISTO' : 'LIVE'}
              </div>
            </div>

            <div className="mb-6 p-6 rounded-2xl bg-slate-900 border border-slate-700 text-center shadow-inner relative overflow-hidden">
              <h2 className="text-xl font-extrabold text-emerald-400 uppercase mb-1">{buttonLabels[activeRate]}</h2>
              <p className={`text-[10px] mb-3 font-bold uppercase tracking-[0.2em] ${isHistoricalRate ? 'text-amber-400' : 'text-slate-500'}`}>
                {isHistoricalRate ? 'Fecha Valor: ' : 'Vigencia: '} {displayDate}
              </p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg text-slate-400">1 {activeRate === 'euro' ? '€' : '$'} =</span>
                <span className="text-4xl font-bold text-white">{new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(rates[activeRate] || 0)}</span>
                <button onClick={handleCopyRate} className="p-1.5 rounded-md hover:bg-slate-800 text-slate-500 hover:text-emerald-400 transition-colors">
                  <ClipboardDocumentIcon className="h-4 w-4" />
                </button>
                <span className="text-lg font-bold text-slate-400">Bs</span>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-6">
              <div className="flex-1 grid grid-cols-4 gap-1 bg-[#0f172a] p-1 rounded-xl">
                {['bcv', 'euro', 'binance', 'paralelo'].map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveRate(key);
                      if (key === 'binance' || key === 'paralelo') {
                        resetToToday();
                      }
                    }}
                    className={`py-2 text-[10px] font-bold rounded-lg uppercase transition-all ${activeRate === key ? 'bg-[#334155] text-emerald-400' : 'text-slate-500 hover:text-white'}`}
                  >
                    {buttonLabels[key]}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <div
                  onClick={() => { try { dateInputRef.current?.showPicker(); } catch (e) { } }}
                  className={`relative flex items-center justify-center w-12 h-[42px] rounded-xl border transition-all cursor-pointer overflow-hidden ${isHistoricalRate ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-[#0f172a] border-[#334155] text-slate-400 hover:border-emerald-500'}`}
                >
                  <CalendarDaysIcon className="h-5 w-5 pointer-events-none relative z-0" />
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={selectedDate}
                    onChange={handleDateChange}
                    max={new Date().toISOString().split('T')[0]}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                    style={{ fontSize: '16px' }}
                  />
                </div>

                {isHistoricalRate && (
                  <button
                    onClick={resetToToday}
                    className="flex items-center justify-center w-12 h-[42px] rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
                  >
                    <ArrowPathIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-6 flex-1">
              <div className="w-full bg-[#0f172a] rounded-xl border border-[#334155] flex items-center p-4 focus-within:border-emerald-500 transition-colors">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={handleAmountChange}
                  onPaste={handlePaste}
                  placeholder="0,00"
                  className="flex-1 bg-transparent text-3xl font-mono text-white outline-none min-w-0"
                />
                <span className="text-sm text-slate-500 font-sans uppercase font-bold ml-2 shrink-0">
                  {isForeignToVes ? (activeRate === 'euro' ? 'EUR' : 'USD') : 'Bs'}
                </span>
              </div>

              <div className="flex justify-center">
                <button onClick={handleInvert} className="bg-[#10b981] p-3 rounded-full shadow-lg hover:scale-110 active:scale-95 transition-all">
                  <ArrowsUpDownIcon className="h-6 w-6 text-slate-900" />
                </button>
              </div>

              <div className="flex flex-col gap-3">
                <div className="w-full bg-[#334155]/20 text-3xl font-mono text-emerald-400 p-4 rounded-xl border border-[#334155]/30 flex justify-between items-center h-[80px]">
                  <span className="truncate pr-2">
                    {formatCurrency(converted)}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleCopySingleResult}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 transition-all active:scale-95"
                    >
                      <ClipboardDocumentIcon className="h-5 w-5" />
                    </button>
                    <span className="text-sm text-slate-500 font-sans uppercase font-bold shrink-0">
                      {isForeignToVes ? 'Bs' : (activeRate === 'euro' ? 'EUR' : 'USD')}
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleShareImage}
                  className="w-full h-[54px] bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg group"
                >
                  <ShareIcon className="h-5 w-5 group-hover:rotate-12 transition-transform" />
                  <span className="text-sm font-black uppercase tracking-widest">Compartir</span>
                </button>
              </div>

              <Link href="/analisis" className="group flex items-center gap-4 p-4 mt-8 bg-slate-900/50 hover:bg-emerald-500/10 border border-slate-700 hover:border-emerald-500/50 rounded-2xl transition-all duration-300">
                <div className="p-3 bg-slate-800 group-hover:bg-emerald-600 rounded-xl transition-colors">
                  <ChartBarIcon className="w-5 h-5 text-emerald-400 group-hover:text-white" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-black uppercase tracking-widest text-white">Análisis Diferencial</p>
                  <p className="text-[9px] text-slate-500 uppercase mt-0.5 font-bold tracking-wider">Análisis de estados de cuenta</p>
                </div>
              </Link>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2"><CalendarDaysIcon className="h-5 w-5" /> Histórico Oficial BCV</h2>
            <div className="flex gap-2 mb-4">
              <select value={histMonth} onChange={(e) => setHistMonth(parseInt(e.target.value))} className="bg-[#0f172a] text-white p-2 rounded-lg border border-[#334155] text-sm flex-1 outline-none cursor-pointer">{['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => (<option key={i} value={i + 1}>{m}</option>))}</select>
              <select value={histYear} onChange={(e) => setHistYear(parseInt(e.target.value))} className="bg-[#0f172a] text-white p-2 rounded-lg border border-[#334155] text-sm w-32 outline-none cursor-pointer">{yearsRange.map(y => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <button onClick={fetchHistory} className="w-full bg-[#059669] text-white py-3 rounded-xl font-bold mb-6 shadow-lg active:scale-95 transition-all hover:bg-emerald-600">{histLoading ? 'Cargando...' : 'Buscar Tasas Oficiales'}</button>
            {histData.length > 0 ? (
              <div className="animate-in fade-in">
                <div ref={chartRef} className="mb-4 bg-transparent pt-2"><HistoryChart data={histData} /></div>
                <div className="overflow-y-auto max-h-[180px] mb-6 scrollbar-hide pr-2 rounded-xl border border-[#334155]">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="text-[10px] text-slate-500 uppercase bg-[#1e293b] sticky top-0 z-20"><tr><th className="px-3 py-3">Fecha</th><th className="px-3 py-3 text-right">USD</th><th className="px-3 py-3 text-right">EUR</th></tr></thead>
                    <tbody className="divide-y divide-slate-800">{histData.map((row, idx) => (
                      <tr key={idx} className={`hover:bg-slate-800/50 ${row.isWeekend ? 'opacity-50 italic text-slate-500' : ''}`}><td className="px-3 py-2 font-mono text-[11px]">{row.fecha}</td><td className={`px-3 py-2 font-mono text-right font-bold ${row.isWeekend ? '' : 'text-emerald-500'}`}>{row.usd.toFixed(2)}</td><td className={`px-3 py-2 font-mono text-right font-bold ${row.isWeekend ? '' : 'text-blue-500'}`}>{row.euro.toFixed(2)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={exportToExcel} className="flex flex-col items-center p-2 bg-[#0f172a] rounded-lg border border-[#334155] hover:bg-slate-800 transition-all group"><ArrowDownTrayIcon className="h-5 w-5 text-emerald-500 mb-1" /><span className="text-[9px] font-bold uppercase text-slate-400">Excel</span></button>
                  <button onClick={exportToPDF} className="flex flex-col items-center p-2 bg-[#0f172a] rounded-lg border border-[#334155] hover:bg-slate-800 transition-all group"><DocumentTextIcon className="h-5 w-5 text-red-500 mb-1" /><span className="text-[9px] font-bold uppercase text-slate-400">PDF</span></button>
                  <button onClick={copyToClipboard} className="flex flex-col items-center p-2 bg-[#0f172a] rounded-lg border border-[#334155] hover:bg-slate-800 transition-all group"><ClipboardDocumentIcon className="h-5 w-5 text-blue-500 mb-1" /><span className="text-[9px] font-bold uppercase text-slate-400">Copiar</span></button>
                </div>
              </div>
            ) : (
              <div className="w-full h-[250px] flex flex-col items-center justify-center border-2 border-dashed border-[#334155] rounded-2xl bg-[#0f172a]/30 p-8 text-center"><ChartBarIcon className="h-12 w-12 text-slate-600 mb-4" /><h3 className="text-slate-400 font-bold mb-2">Sin datos</h3><p className="text-[10px] text-slate-500 uppercase tracking-widest">Selecciona mes y busca</p></div>
            )}
          </div>
        )}
        <div className="mt-auto pt-4 border-t border-[#334155]/30 text-center"><p className="text-[10px] text-slate-600 font-mono uppercase tracking-[0.4em]">© 2026 RYBAK.SOFTWARE</p></div>
      </div>
    </div>
  );
}