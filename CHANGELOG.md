# Changelog

All notable changes to this project will be documented in this file.

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
