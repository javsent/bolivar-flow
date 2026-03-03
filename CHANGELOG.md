# Changelog

All notable changes to this project will be documented in this file.

## [2026-03-03] - Fix Transición de Mes en Histórico
### Fixed
- **Herencia de Tasa en Inicios de Mes (Bug 01/03)**: Se corrigió un bug donde el día `01` de un nuevo mes, si caía fin de semana, desaparecía de la API y forzaba a la App a usar la tasa del día actual. Ahora, la API arranca *siempre* a rellenar desde el día `01` y busca dinámicamente la última tasa oficial del **mes anterior** para arrastrarla exitosamente (ej. el 01/03 ahora copia perfectamente el 27/02).

## [2026-02-27] - Estabilidad en Vercel & Datos Históricos
### Fixed
- **Optimización de Fallback XLSX (Bug 28/02)**: Se redujo radicalmente el consumo de recursos de la API al descargar hojas de cálculo del BCV. Anteriormente intentaba descargar y procesar 5 archivos de años anteriores (15MB+), provocando un error de *Timeout* (504) por límite de tiempo de 10 segundos en Vercel. Ahora, descarga el top 1 estricto (año actual), resolviendo la pérdida invisible de días "jueves/viernes" pasados tras un finde.
- **Estabilidad de Historial en Vercel (Bug 26/02-27/02)**: Se implementó un *Caché en Memoria* (Memory Cache) para que la API recuerde los días pasados sin depender del disco de solo lectura de Vercel.
- **Detección Inteligente de Huecos Faltantes**: La API ahora detecta si entre su último dato y el actual falta algún día de semana (Lunes-Viernes). Si es así, fuerza la descarga del historial completo en Excel (Fallback) en lugar de asumir erróneamente que los días intermedios fueron feriados/cerrados.

## [2026-02-25] - Robustness & Fixes
### Added
- Created `CHANGELOG.md` to track project history.
- Added instruction to maintain changelog in project root.
- Global `try-catch` blocks in all API routes for robust error reporting.

### Fixed
- Error de reversión en historial: las tasas oficiales ahora sobrescriben correctamente los marcadores de "Día Cerrado".
- Regla 00:00 AM: Los marcadores de "Día Cerrado" solo se generan para días pasados, permitiendo al BCV publicar tasas durante todo el día actual sin bloqueos.
- Error de sintaxis (llave extra) en `/api/historico` que causaba fallo de compilación.
- Resolved 500 error in `/api/historico` and `/api/tasas` by making filesystem writes optional (Vercel compatibility).
- Improved "Fecha Valor" regex to handle variations like "25 de febrero".
- Fixed frontend crash when API returns non-JSON responses.
- Fixed date synchronization logic to avoid future-dated entries due to UTC offsets.

## [2026-02-23] - Sharing & Date Sync
### Added
- Direct WhatsApp sharing on mobile devices.
- Native sharing from PC (Copy to clipboard).
- Improved visual summary for shared reports.

### Fixed
- Decoupled "latest official rate" from "current calendar date" to prevent premature daily advancement.
