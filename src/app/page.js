"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowsUpDownIcon,
  CalendarDaysIcon,
  CalculatorIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  BoltIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ShareIcon,
  SparklesIcon,
} from "@heroicons/react/24/solid";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import HistoryChart from "@/components/HistoryChart";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency } from "@/lib/utils";

export default function CurrencyApp() {
  const { user, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);

  // --- ESTADOS UX (Toast) ---
  const [toastMessage, setToastMessage] = useState(null);

  // --- ESTADOS CALCULADORA/HISTORIAL ---
  const chartRef = useRef(null);
  const dateInputRef = useRef(null);
  const shareRef = useRef(null);
  const historicoCache = useRef({});

  const [view, setView] = useState("calculator");
  const [amount, setAmount] = useState("");
  const [converted, setConverted] = useState(0);

  const [isForeignToVes, setIsForeignToVes] = useState(false);

  const [loading, setLoading] = useState(false);
  const [rates, setRates] = useState({
    bcv: 0,
    euro: 0,
    binance: 0,
  });
  const [activeRate, setActiveRate] = useState("bcv");
  const [selectedDate, setSelectedDate] = useState("");
  const [displayDate, setDisplayDate] = useState("");
  const [isHistoricalRate, setIsHistoricalRate] = useState(false);

  const [histMonth, setHistMonth] = useState(new Date().getMonth() + 1);
  const [histYear, setHistYear] = useState(new Date().getFullYear());
  const [histData, setHistData] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const buttonLabels = {
    bcv: "BCV $",
    euro: "BCV €",
    binance: "Binance",
  };
  const currentYear = new Date().getFullYear();
  const yearsRange = Array.from(
    { length: currentYear - 2020 + 1 },
    (_, i) => 2020 + i,
  ).reverse();
  const monthNames = [
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
  ];

  // --- LÓGICA DE CARGA INICIAL ---
  useEffect(() => {
    resetToToday();
  }, []);

  // --- FUNCIÓN PARA RESETEAR A HOY (LIVE) ---
  const resetToToday = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    setSelectedDate(todayStr);
    fetchCurrentRates();
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
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

  // --- FUNCIÓN PARA BUSCAR TASA HACIA ATRÁS (CRUZANDO MESES) ---
  const findValidRateBackwards = async (
    startDate,
    maxDays = 7,
    disableSync = false,
  ) => {
    let searchDate = new Date(startDate);

    for (let i = 0; i < maxDays; i++) {
      const year = searchDate.getFullYear();
      const month = searchDate.getMonth() + 1;
      const cacheKey = `${year}-${month}`;

      if (!historicoCache.current[cacheKey]) {
        try {
          const url = `/api/historico?mes=${month}&anio=${year}${disableSync ? "&sync=false" : ""}`;
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            historicoCache.current[cacheKey] = json.data || [];
          } else {
            console.warn(`⚠️ No se pudo cargar el historial para ${cacheKey}`);
            historicoCache.current[cacheKey] = [];
          }
        } catch (e) {
          console.error(`Error buscando historial para ${cacheKey}`, e);
          historicoCache.current[cacheKey] = [];
        }
      }

      const dStr = String(searchDate.getDate()).padStart(2, "0");
      const mStr = String(searchDate.getMonth() + 1).padStart(2, "0");
      const dateStr = `${dStr}/${mStr}/${searchDate.getFullYear()}`;
      const match = historicoCache.current[cacheKey].find(
        (d) => d.fecha === dateStr,
      );

      if (match) {
        return match;
      }

      searchDate.setDate(searchDate.getDate() - 1);
    }
    return null;
  };

  // --- LÓGICA DE TASAS (WEB API) MEJORADA ---
  const fetchCurrentRates = async () => {
    setLoading(true);
    historicoCache.current = {};
    try {
      const now = new Date();
      const fd = String(now.getDate()).padStart(2, "0");
      const fm = String(now.getMonth() + 1).padStart(2, "0");
      const todayStr = `${fd}/${fm}/${now.getFullYear()}`;

      let tasaHoy = await findValidRateBackwards(now, 1, false);

      const res = await fetch("/api/tasas");
      if (!res.ok) throw new Error("Falló API");
      const data = await res.json();

      if (tasaHoy && tasaHoy.fecha === todayStr) {
        setRates({
          ...data,
          bcv: tasaHoy.usd,
          euro: tasaHoy.euro,
        });
        setDisplayDate(todayStr);
      } else if (data.bcv > 0) {
        setRates(data);
        setDisplayDate(todayStr);

        if (data.fecha && data.fecha !== todayStr) {
          showToast(`Tasa oficial del ${data.fecha}`);
        }
      } else {
        let tasaVigente = await findValidRateBackwards(now, 7, false);

        if (tasaVigente) {
          setRates({
            ...data,
            bcv: tasaVigente.usd,
            euro: tasaVigente.euro,
          });
          setDisplayDate(todayStr);
          if (tasaVigente.fecha !== todayStr) {
            showToast(`Tasa del día ${tasaVigente.fecha}`);
          }
        } else {
          setRates(data);
          setDisplayDate(todayStr);
        }
      }

      setIsHistoricalRate(false);
    } catch (e) {
      console.error("Error cargando tasas:", e);
      showToast("Error al sincronizar tasas");
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = async (e) => {
    const newDate = e.target.value;
    if (!newDate) return;
    if (activeRate === "binance") {
      showToast("Historial solo disponible para tasas oficiales");
      return;
    }
    setSelectedDate(newDate);
    setLoading(true);
    try {
      let dateObj = new Date(newDate + "T12:00:00");
      let dayData = await findValidRateBackwards(dateObj, 7, true);

      if (dayData) {
        setRates((prev) => ({ ...prev, bcv: dayData.usd, euro: dayData.euro }));
        setIsHistoricalRate(true);

        const selDateObj = new Date(newDate + "T12:00:00");
        const selDay = String(selDateObj.getDate()).padStart(2, "0");
        const selMonth = String(selDateObj.getMonth() + 1).padStart(2, "0");
        const selectedDateFormatted = `${selDay}/${selMonth}/${selDateObj.getFullYear()}`;
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

  // --- LÓGICA DE HISTÓRICO GARANTIZADO DESDE API V2 ---
  const fetchHistory = async () => {
    setHistLoading(true);
    setHistData([]);
    try {
      const res = await fetch(
        `/api/historico?mes=${histMonth}&anio=${histYear}`,
      );
      const json = await res.json();
      const rawData = json.data || [];

      setHistData(rawData);
    } catch (err) {
      console.error(err);
      showToast("Error consultando histórico");
    } finally {
      setHistLoading(false);
    }
  };

  // --- CÁLCULO DE CONVERSIÓN ---
  useEffect(() => {
    const currentRate = rates[activeRate];
    if (!amount || isNaN(amount) || !currentRate) {
      setConverted(0);
      return;
    }
    const val = parseFloat(amount);
    if (isForeignToVes) {
      setConverted(val * currentRate);
    } else {
      setConverted(val / currentRate);
    }
  }, [amount, activeRate, rates, isForeignToVes]);

  const handleInvert = () => {
    setIsForeignToVes(!isForeignToVes);
  };

  const handleAmountChange = (e) => {
    const val = e.target.value.replace(/,/g, ".");
    if (!isNaN(val) || val === "") {
      setAmount(val);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData("text");
    const cleanPaste = paste.replace(/\./g, "").replace(/,/g, ".").trim();
    if (!isNaN(cleanPaste) && cleanPaste !== "") {
      setAmount(cleanPaste);
    }
  };

  const handleCopySingleResult = () => {
    if (!converted) return;
    const textToCopy = formatCurrency(converted);
    navigator.clipboard.writeText(textToCopy);
    showToast("Resultado copiado");
  };

  const handleCopyRate = () => {
    const currentRate = rates[activeRate];
    if (!currentRate) return;
    const textToCopy = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
    }).format(currentRate);
    navigator.clipboard.writeText(textToCopy);
    showToast(`Tasa ${buttonLabels[activeRate]} copiada`);
  };

  // --- GENERACIÓN DE IMAGEN PARA COMPARTIR ---
  const handleShareImage = async () => {
    if (!shareRef.current) return;
    showToast("Generando comprobante...");
    try {
      const canvas = await html2canvas(shareRef.current, {
        scale: 2,
        backgroundColor: "#070b14",
        useCORS: true,
      });

      canvas.toBlob(async (blob) => {
        if (!blob) return;

        const isMobile =
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent,
          );

        if (isMobile && navigator.canShare && navigator.canShare({ files: [new File([blob], "bolivar-flow.png", { type: "image/png" })] })) {
          const file = new File([blob], "bolivar-flow.png", {
            type: "image/png",
          });
          try {
            await navigator.share({
              files: [file],
              title: "Tasa de Cambio - Bolívar Flow",
              text: `Cotización de ${buttonLabels[activeRate]} al ${displayDate}`,
            });
            showToast("Compartido exitosamente");
          } catch (shareError) {
            if (shareError.name !== "AbortError") {
              downloadFallback(blob);
            }
          }
        } else {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            showToast("¡Imagen copiada al portapapeles!");
          } catch (clipError) {
            downloadFallback(blob);
          }
        }
      }, "image/png");
    } catch (e) {
      console.error(e);
      showToast("Error al generar imagen");
    }
  };

  const downloadFallback = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BolivarFlow_${activeRate}_${displayDate.replace(/\//g, "-")}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Imagen descargada");
  };

  // --- EXPORTAR EXCEL ---
  const exportToExcel = () => {
    if (histData.length === 0) return;
    const currentMonthName = monthNames[histMonth - 1] || histMonth;

    const dataToExport = histData.map((item) => ({
      Fecha: item.fecha,
      "Tasa USD": item.usd,
      "Tasa EUR": item.euro,
      Estado: item.isWeekend ? "Fin de semana / Feriado" : "Oficial BCV",
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Tasas_${histMonth}_${histYear}`);

    XLSX.writeFile(workbook, `BolivarFlow_BCV_${currentMonthName}_${histYear}.xlsx`);
    showToast("Archivo Excel descargado");
  };

  // --- EXPORTAR PDF ---
  const exportToPDF = () => {
    if (histData.length === 0) return;
    try {
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const cronoData = [...histData].reverse();

      doc.setFillColor(7, 11, 20);
      doc.rect(0, 0, pageWidth, 42, "F");

      doc.setTextColor(45, 212, 191);
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text("BOLÍVAR FLOW v2.0", 15, 18, { charSpace: 0 });

      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.setFont("helvetica", "normal");
      doc.text("SISTEMA DE GESTIÓN Y MONITOREO CAMBIARIO", 15, 25, { charSpace: 0 });
      doc.text("FUENTE OFICIAL: BANCO CENTRAL DE VENEZUELA", 15, 30, { charSpace: 0 });

      const currentMonthName = monthNames[histMonth - 1] || histMonth;
      doc.text(`MES: ${currentMonthName} / AÑO: ${histYear}`, pageWidth - 15, 22, {
        align: "right",
        charSpace: 0,
      });
      doc.text(`GENERADO POR: ${user}`, pageWidth - 15, 30, {
        align: "right",
        charSpace: 0,
      });

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

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, 65, 85, 22, 2, 2, "F");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.text("DIVISA: DÓLAR (USD)", 20, 71, { charSpace: 0 });
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(10);
      doc.text(`DE ${usdIni.toFixed(2)} Bs A ${usdFin.toFixed(2)} Bs`, 20, 77, { charSpace: 0 });
      doc.setTextColor(varUsd >= 0 ? 185 : 22, varUsd >= 0 ? 28 : 163, varUsd >= 0 ? 28 : 74);
      doc.setFont("helvetica", "bold");
      doc.text(`VAR: ${varUsd >= 0 ? "+" : ""}${varUsd.toFixed(2)}%`, 20, 83, { charSpace: 0 });

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(110, 65, 85, 22, 2, 2, "F");
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.text("DIVISA: EURO (EUR)", 115, 71, { charSpace: 0 });
      doc.setTextColor(30, 41, 59);
      doc.text(`DE ${eurIni.toFixed(2)} Bs A ${eurFin.toFixed(2)} Bs`, 115, 77, { charSpace: 0 });
      doc.setTextColor(varEur >= 0 ? 185 : 22, varEur >= 0 ? 28 : 163, varEur >= 0 ? 28 : 74);
      doc.setFont("helvetica", "bold");
      doc.text(`VAR: ${varEur >= 0 ? "+" : ""}${varEur.toFixed(2)}%`, 115, 83, { charSpace: 0 });

      autoTable(doc, {
        head: [["FECHA", "USD ($)", "EUR (€)", "ESTADO"]],
        body: histData.map((i) => [
          i.fecha,
          i.usd.toFixed(4),
          i.euro.toFixed(4),
          i.isWeekend ? "FIN DE SEMANA" : "OPERATIVO",
        ]),
        startY: 96,
        theme: "grid",
        headStyles: { fillColor: [7, 11, 20], halign: "center" },
        columnStyles: {
          0: { halign: "center" },
          1: { halign: "right" },
          2: { halign: "right" },
          3: { halign: "center" },
        },
        didDrawPage: (data) => {
          doc.setFontSize(8);
          doc.setTextColor(150);
          doc.setFont("helvetica", "normal");
          doc.text("rybak.Software © 2026 - Reporte generado por Bolívar Flow v2.0", 15, pageHeight - 10, { charSpace: 0 });
          doc.text(`Página ${doc.internal.getNumberOfPages()}`, pageWidth - 15, pageHeight - 10, { align: "right", charSpace: 0 });
        },
        didParseCell: (d) => {
          if (d.section === "body" && d.row.raw[3] === "FIN DE SEMANA") {
            d.cell.styles.textColor = [160, 160, 160];
          }
        },
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
    const body = histData
      .map((i) => `${i.fecha}\t${i.usd.toFixed(4)}\t${i.euro.toFixed(4)}`)
      .join("\n");
    const fullText = header + body;
    navigator.clipboard
      .writeText(fullText)
      .then(() => showToast("¡Tabla copiada al portapapeles!"));
  };

  // --- PANTALLA DE CARGA ---
  if (loading && rates.bcv === 0) {
    return (
      <div className="min-h-screen bg-[#070b14] flex flex-col items-center justify-center p-4">
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.2)]">
            <BoltIcon className="h-9 w-9 text-emerald-400 animate-pulse" />
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
          </span>
        </div>
        <p className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] font-bold animate-pulse">
          Sincronizando Mercado...
        </p>
        <span className="text-[10px] text-slate-500 font-mono mt-2">Bolívar Flow v2.0</span>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-transparent flex flex-col items-center p-3 sm:p-5 text-white font-sans relative">
      {/* COMPONENTE OCULTO PARA COMPARTIR EN CANVAS */}
      <div
        ref={shareRef}
        className="fixed top-0 left-[-9999px] w-[600px] bg-[#070b14] p-10 flex flex-col font-sans text-white border-4 border-emerald-500/30"
      >
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-5xl font-black uppercase tracking-tighter leading-none">
              <span className="emerald-gradient-text">BOLÍVAR</span> <span className="blue-gradient-text">FLOW</span>
            </h1>
            <BoltIcon className="h-11 w-9 text-blue-400 flex-shrink-0 -mt-1" />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              v2.0
            </span>
            <p className="text-xs text-slate-400 uppercase tracking-[0.4em] font-bold">
              Cotización Oficial
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 mb-8">
          <div className="bg-[#0f172a] p-8 rounded-3xl border border-slate-700/80 text-center shadow-2xl flex flex-col items-center">
            <p className="text-slate-400 uppercase text-xl tracking-widest font-bold mb-3">
              Tasa de Cambio: {buttonLabels[activeRate]}
            </p>

            <div className="flex justify-center items-baseline gap-3 mb-2">
              <span className="text-white text-7xl font-bold font-mono tracking-tight leading-none">
                {new Intl.NumberFormat("de-DE", {
                  minimumFractionDigits: 2,
                }).format(rates[activeRate] || 0)}
              </span>
              <span className="text-3xl font-bold text-emerald-400">Bs</span>
            </div>

            <div className="mt-4 bg-slate-900/90 px-8 py-2.5 rounded-full border border-emerald-500/30 flex items-center justify-center">
              <p className="text-emerald-400 text-lg uppercase font-mono font-bold tracking-wider">
                Vigencia: {displayDate}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex justify-between items-center bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
              <span className="text-slate-400 font-bold text-xl uppercase tracking-wider">
                Monto:
              </span>
              <span className="text-white font-mono text-4xl font-bold">
                {amount || "0"}{" "}
                <span className="text-slate-500 text-2xl ml-2">
                  {isForeignToVes ? (activeRate === "euro" ? "€" : "$") : "Bs"}
                </span>
              </span>
            </div>

            <div className="flex flex-col bg-emerald-950/20 p-8 rounded-2xl border border-emerald-500/30">
              <span className="text-emerald-400 font-bold text-lg uppercase tracking-widest mb-2">
                Equivale a:
              </span>
              <div className="flex justify-end items-baseline gap-3">
                <span className="text-white font-mono text-5xl font-black tracking-tight leading-none">
                  {new Intl.NumberFormat("de-DE", {
                    minimumFractionDigits: 2,
                  }).format(converted)}
                </span>
                <span className="text-emerald-400 text-3xl font-bold uppercase">
                  {isForeignToVes ? "Bs" : activeRate === "euro" ? "EUR" : "USD"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center pt-6 border-t border-slate-800/80 mt-auto flex items-center justify-between">
          <p className="text-sm font-bold text-slate-400">bolivar-flow.vercel.app</p>
          <p className="text-sm font-bold text-emerald-400">Rybak Software © 2026</p>
        </div>
      </div>

      {/* TOAST NOTIFICACIÓN */}
      {toastMessage && (
        <div className="fixed bottom-6 z-[200] animate-slide-up">
          <div className="bg-slate-900/95 border border-emerald-500/40 text-white px-4 py-2.5 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.8)] flex items-center gap-2.5 backdrop-blur-md">
            <SparklesIcon className="h-4 w-4 text-emerald-400 animate-spin" />
            <span className="text-xs font-semibold tracking-wide text-slate-100">
              {toastMessage}
            </span>
          </div>
        </div>
      )}

      {/* TOP USER BAR */}
      <div className="w-full max-w-md flex items-center justify-between mb-3 px-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </div>
          <p className="text-[11px] font-bold text-slate-400 tracking-wider">
            Hola, <span className="text-white">{user}</span>
          </p>
        </div>
        <button
          onClick={handleLogoutClick}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all duration-200 text-[11px] font-bold tracking-wider ${
            confirmLogout
              ? "bg-amber-500/20 text-amber-300 border-amber-500/50 scale-105"
              : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-red-400 hover:border-red-500/30"
          }`}
        >
          {confirmLogout ? (
            <>
              <ExclamationTriangleIcon className="h-3.5 w-3.5" /> Confirmar
            </>
          ) : (
            <>
              <ArrowRightOnRectangleIcon className="h-3.5 w-3.5" /> Salir
            </>
          )}
        </button>
      </div>

      {/* SELECTOR DE VISTA SUPERIOR (CALC / HISTORIAL) */}
      <div className="w-full max-w-md glass-card-subtle p-1 rounded-2xl mb-3.5 flex relative z-20">
        <button
          onClick={() => setView("calculator")}
          className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all ${
            view === "calculator"
              ? "bg-gradient-to-r from-emerald-500/20 to-blue-500/20 text-white border border-emerald-500/30 shadow-lg shadow-emerald-500/5"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <CalculatorIcon className={`h-4 w-4 ${view === "calculator" ? "text-emerald-400" : ""}`} />
          Calculadora
        </button>
        <button
          onClick={() => setView("history")}
          className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all ${
            view === "history"
              ? "bg-gradient-to-r from-emerald-500/20 to-blue-500/20 text-white border border-emerald-500/30 shadow-lg shadow-emerald-500/5"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <CalendarDaysIcon className={`h-4 w-4 ${view === "history" ? "text-emerald-400" : ""}`} />
          Histórico
        </button>
      </div>

      {/* CONTENEDOR PRINCIPAL */}
      <div className="w-full max-w-md glass-card p-6 sm:p-7 rounded-3xl min-h-[560px] relative z-10 flex flex-col shadow-2xl animate-slide-up">
        {view === "calculator" ? (
          <div className="flex-1 flex flex-col">
            {/* HEADER CON LOGO OFICIAL Y BADGE V2.0 */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2.5">
                <div className="relative w-9 h-9 rounded-xl overflow-hidden border border-emerald-500/30 bg-[#070b14] flex items-center justify-center shadow-lg shadow-emerald-500/10">
                  <Image
                    src="/logo.png"
                    alt="Bolívar Flow"
                    width={36}
                    height={36}
                    priority
                    className="object-contain"
                  />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-black uppercase tracking-tight leading-none">
                      <span className="emerald-gradient-text">BOLÍVAR</span>{" "}
                      <span className="blue-gradient-text">FLOW</span>
                    </h1>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                      v2.0
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-400 uppercase tracking-[0.25em] font-semibold mt-0.5">
                    Monitor Cambiario
                  </span>
                </div>
              </div>

              <div
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${
                  isHistoricalRate
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/40"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/40"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isHistoricalRate ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
                  }`}
                ></span>
                {isHistoricalRate ? "HISTÓRICO" : "LIVE"}
              </div>
            </div>

            {/* HERO CARD: TASA ACTIVA */}
            <div className="mb-6 p-5 sm:p-6 rounded-2xl bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-slate-800/80 text-center shadow-inner relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl pointer-events-none"></div>

              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Tasa {buttonLabels[activeRate]}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold tracking-wider ${
                    isHistoricalRate ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  {displayDate}
                </span>
              </div>

              {/* VALOR DE LA TASA */}
              <div className="flex items-baseline justify-center gap-2.5 my-2">
                <span className="text-xs sm:text-sm text-slate-500 font-medium">
                  1 {activeRate === "euro" ? "€" : "$"} =
                </span>
                <span className="text-4xl sm:text-5xl font-black text-white font-mono tracking-tight tabular-nums">
                  {new Intl.NumberFormat("de-DE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  }).format(rates[activeRate] || 0)}
                </span>
                <span className="text-lg sm:text-xl font-black text-emerald-400">Bs</span>
              </div>

              <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-white/5">
                <button
                  onClick={handleCopyRate}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/60 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 text-[11px] font-medium transition-all active:scale-95"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  <span>Copiar tasa</span>
                </button>
              </div>
            </div>

            {/* SELECTOR DE TASAS & FECHA HISTÓRICA */}
            <div className="flex items-center gap-2 mb-6">
              <div className="flex-1 grid grid-cols-3 gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                {["bcv", "euro", "binance"].map((key) => {
                  const isActive = activeRate === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setActiveRate(key);
                        if (key === "binance") {
                          resetToToday();
                        }
                      }}
                      className={`py-2 text-[11px] font-bold rounded-lg uppercase tracking-wider transition-all ${
                        isActive
                          ? "bg-slate-800 text-emerald-400 shadow-sm border border-slate-700/80"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {buttonLabels[key]}
                    </button>
                  );
                })}
              </div>

              {/* PICKER DE FECHA HISTÓRICA */}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      if (dateInputRef.current) {
                        if (typeof dateInputRef.current.showPicker === "function") {
                          dateInputRef.current.showPicker();
                        } else {
                          dateInputRef.current.focus();
                        }
                      }
                    } catch (e) {
                      dateInputRef.current?.focus();
                    }
                  }}
                  title="Consultar fecha histórica"
                  className={`relative flex items-center justify-center w-11 h-10 rounded-xl border transition-all cursor-pointer overflow-hidden active:scale-95 ${
                    isHistoricalRate
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                      : "bg-slate-950/80 border-slate-800 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-400"
                  }`}
                >
                  <CalendarDaysIcon className="h-5 w-5 pointer-events-none" />
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={selectedDate}
                    onChange={handleDateChange}
                    max={(() => {
                      const now = new Date();
                      const year = now.getFullYear();
                      const month = String(now.getMonth() + 1).padStart(2, "0");
                      const day = String(now.getDate()).padStart(2, "0");
                      const todayLocal = `${year}-${month}-${day}`;
                      if (rates.fecha) {
                        const [d, m, y] = rates.fecha.split("/");
                        const rateDate = `${y}-${m}-${d}`;
                        return rateDate > todayLocal ? rateDate : todayLocal;
                      }
                      return todayLocal;
                    })()}
                    className="absolute inset-0 opacity-0 pointer-events-none w-full h-full"
                    tabIndex={-1}
                  />
                </button>

                {isHistoricalRate && (
                  <button
                    onClick={resetToToday}
                    title="Volver a tasa de hoy"
                    className="flex items-center justify-center w-11 h-10 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-slate-950 transition-all active:scale-95"
                  >
                    <ArrowPathIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            {/* SECCIÓN CONVERSORA */}
            <div className="space-y-4 flex-1 flex flex-col">
              {/* INPUT MONTO A CONVERTIR */}
              <div className="w-full bg-slate-950/80 rounded-2xl border border-slate-800/80 flex items-center p-3.5 sm:p-4 focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all shadow-inner">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={handleAmountChange}
                  onPaste={handlePaste}
                  placeholder="0,00"
                  className="flex-1 bg-transparent text-3xl sm:text-4xl font-mono text-white outline-none min-w-0 placeholder:text-slate-700 tabular-nums"
                />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 py-1 bg-slate-800/60 rounded-md shrink-0">
                  {isForeignToVes ? (activeRate === "euro" ? "EUR" : "USD") : "Bs"}
                </span>
              </div>

              {/* BOTÓN INVERTIR (SWAP) */}
              <div className="flex justify-center relative my-1">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-full h-px bg-slate-800"></div>
                </div>
                <button
                  onClick={handleInvert}
                  title="Invertir conversión"
                  className="relative z-10 bg-gradient-to-r from-emerald-500 to-teal-400 p-3 rounded-2xl shadow-[0_0_20px_rgba(16,185,129,0.35)] hover:scale-105 active:scale-95 transition-all text-slate-950 group"
                >
                  <ArrowsUpDownIcon className="h-5 w-5 group-hover:rotate-180 transition-transform duration-300" />
                </button>
              </div>

              {/* CAJA RESULTADO */}
              <div className="w-full bg-gradient-to-br from-emerald-950/20 to-slate-950/80 p-4 sm:p-5 rounded-2xl border border-emerald-500/25 flex justify-between items-center shadow-lg">
                <div className="flex flex-col truncate pr-2">
                  <span className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-wider mb-1">
                    Equivalente
                  </span>
                  <span className="text-3xl sm:text-4xl font-mono text-emerald-400 font-black tracking-tight truncate tabular-nums">
                    {formatCurrency(converted)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleCopySingleResult}
                    title="Copiar resultado"
                    className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 transition-all active:scale-90 border border-white/5"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/30">
                    {isForeignToVes ? "Bs" : activeRate === "euro" ? "EUR" : "USD"}
                  </span>
                </div>
              </div>

              {/* BOTÓN COMPARTIR */}
              <button
                onClick={handleShareImage}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white rounded-xl flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] shadow-lg shadow-blue-500/20 font-bold text-xs uppercase tracking-widest"
              >
                <ShareIcon className="h-4 w-4" />
                <span>Compartir Cotización</span>
              </button>

              {/* BANNER A ANÁLISIS DIFERENCIAL */}
              <Link
                href="/analisis"
                className="group flex items-center gap-3.5 p-3.5 mt-auto bg-slate-950/60 hover:bg-blue-500/10 border border-slate-800 hover:border-blue-500/40 rounded-2xl transition-all duration-300"
              >
                <div className="p-2.5 bg-slate-900 group-hover:bg-blue-600 rounded-xl transition-all shadow-md group-hover:shadow-blue-500/20">
                  <ChartBarIcon className="w-5 h-5 text-blue-400 group-hover:text-white" />
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-200 group-hover:text-blue-400 transition-colors">
                    Análisis Diferencial
                  </p>
                  <p className="text-[10px] text-slate-500 truncate">
                    Conciliación inteligente de cuentas
                  </p>
                </div>
              </Link>
            </div>
          </div>
        ) : (
          /* VISTA HISTÓRICO */
          <div className="flex-1 flex flex-col animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black emerald-gradient-text flex items-center gap-2 tracking-tight uppercase">
                <CalendarDaysIcon className="h-5 w-5 text-emerald-400" /> Histórico Oficial BCV
              </h2>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-900/60 px-2 py-0.5 rounded border border-white/5">
                v2.0 Engine
              </span>
            </div>

            {/* SELECTORES DE MES Y AÑO */}
            <div className="flex gap-2 mb-4">
              <select
                value={histMonth}
                onChange={(e) => setHistMonth(parseInt(e.target.value))}
                className="bg-slate-950 text-white p-2.5 rounded-xl border border-slate-800 text-xs flex-1 outline-none cursor-pointer focus:border-emerald-500/50 transition-all font-bold uppercase tracking-wider"
              >
                {[
                  "Enero",
                  "Febrero",
                  "Marzo",
                  "Abril",
                  "Mayo",
                  "Junio",
                  "Julio",
                  "Agosto",
                  "Septiembre",
                  "Octubre",
                  "Noviembre",
                  "DICIEMBRE",
                ].map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={histYear}
                onChange={(e) => setHistYear(parseInt(e.target.value))}
                className="bg-slate-950 text-white p-2.5 rounded-xl border border-slate-800 text-xs w-28 outline-none cursor-pointer focus:border-emerald-500/50 transition-all font-bold uppercase tracking-wider"
              >
                {yearsRange.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* BOTÓN DE BÚSQUEDA */}
            <button
              onClick={fetchHistory}
              disabled={histLoading}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider mb-4 shadow-lg shadow-emerald-900/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {histLoading ? "Consultando Base de Datos..." : "Buscar Tasas Oficiales"}
            </button>

            {/* RESULTADOS DEL HISTÓRICO */}
            {histData.length > 0 ? (
              <div className="flex-1 flex flex-col">
                <div ref={chartRef} className="mb-3 bg-transparent">
                  <HistoryChart data={histData} />
                </div>

                <div className="overflow-y-auto max-h-[200px] mb-4 custom-scrollbar rounded-xl border border-slate-800 bg-slate-950/60">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="text-[10px] text-slate-400 uppercase bg-slate-900/90 sticky top-0 z-20 border-b border-slate-800">
                      <tr>
                        <th className="px-3 py-2.5 font-bold tracking-wider">Fecha</th>
                        <th className="px-3 py-2.5 text-right font-bold tracking-wider text-emerald-400">USD ($)</th>
                        <th className="px-3 py-2.5 text-right font-bold tracking-wider text-blue-400">EUR (€)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {histData.map((row, idx) => (
                        <tr
                          key={idx}
                          className={`hover:bg-slate-800/40 transition-colors ${
                            row.isWeekend ? "opacity-60 text-slate-400" : ""
                          }`}
                        >
                          <td className="px-3 py-2 flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                row.isWeekend ? "bg-slate-600" : "bg-emerald-400"
                              }`}
                            ></span>
                            {row.fecha}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-100 tabular-nums">
                            {row.usd.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-300 tabular-nums">
                            {row.euro.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* BOTONES DE EXPORTACIÓN */}
                <div className="grid grid-cols-3 gap-2 mt-auto">
                  <button
                    onClick={exportToExcel}
                    className="flex flex-col items-center p-2.5 bg-slate-950/70 rounded-xl border border-slate-800 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all active:scale-95 group"
                  >
                    <ArrowDownTrayIcon className="h-5 w-5 text-emerald-400 mb-1 group-hover:-translate-y-0.5 transition-transform" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-emerald-400">
                      Excel
                    </span>
                  </button>
                  <button
                    onClick={exportToPDF}
                    className="flex flex-col items-center p-2.5 bg-slate-950/70 rounded-xl border border-slate-800 hover:border-red-500/40 hover:bg-red-500/10 transition-all active:scale-95 group"
                  >
                    <DocumentTextIcon className="h-5 w-5 text-red-400 mb-1 group-hover:-translate-y-0.5 transition-transform" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-red-400">
                      PDF
                    </span>
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="flex flex-col items-center p-2.5 bg-slate-950/70 rounded-xl border border-slate-800 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all active:scale-95 group"
                  >
                    <ClipboardDocumentIcon className="h-5 w-5 text-blue-400 mb-1 group-hover:-translate-y-0.5 transition-transform" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-blue-400">
                      Copiar
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 p-6 text-center">
                <ChartBarIcon className="h-10 w-10 text-slate-600 mb-3" />
                <h3 className="text-slate-300 font-bold text-sm mb-1">Sin consulta activa</h3>
                <p className="text-[11px] text-slate-500">
                  Selecciona mes y año para cargar tasas de la base de datos
                </p>
              </div>
            )}
          </div>
        )}

        {/* PIE DE PÁGINA DISCRETO V2.0 */}
        <div className="mt-5 pt-3 border-t border-slate-800/80 text-center flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span className="text-emerald-400/80 font-bold">v2.0 • UltraFast</span>
          <span className="tracking-widest uppercase">RYBAK.SOFTWARE © 2026</span>
        </div>
      </div>
    </div>
  );
}
