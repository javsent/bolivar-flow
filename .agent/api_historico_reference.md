# 📚 Documentación Exhaustiva: API Histórico BCV (`/api/historico`)

## 🎯 Propósito General
La API de Histórico (`/api/historico`) se encarga de servir las tasas oficiales de cambio Dólar (USD) y Euro (EUR) emitidas por el Banco Central de Venezuela (BCV), proporcionando una serie de tiempo continua, ininterrumpida y cronológica por mes y año. 

Esta API está diseñada específicamente para ser altamente **resiliente, tolerante a fallos y superar las limitaciones nativas de plataformas Serverless (como Vercel)**, donde el sistema de archivos (`fs`) es de solo lectura.

---

## 🔧 Parámetros de Solicitud (Query Parameters)
Endpoint principal: `GET /api/historico`

| Parámetro | Tipo | Obligatorio | Descripción |
| :--- | :--- | :--- | :--- |
| `mes` | `Number` | Sí | Número del mes a consultar (1 para Enero, 12 para Diciembre). |
| `anio` | `Number` | Sí | Año a consultar (Ej: 2026). |
| `sync` | `String` | No | Si es `"false"`, le ordena a la API que se abstenga de hacer Web Scraping para ahorrar tiempo de carga. Ideal cuando se están consultando historiales antiguos estáticos. |

Ejemplo: `/api/historico?mes=2&anio=2026`

---

## 🛠 Arquitectura de Persistencia de Datos (El problema Vercel)

El mayor reto de esta API es el reseteo del Disco Duro Virtual (Amnesia Serverless) de Vercel tras cada despliegue o al quedarse inactivo la máquina virtual. 

**Solución híbrida dual:**
1. **Archivo JSON local (Disco):** Ubicado en `src/data/bcv/[año].json`. Actúa como base inmutable proveniente de los "commits" cargados al repositorio Git.
2. **`memoryCache` (Memoria RAM Global):** Variable local a nivel global en `route.js`. Las invocaciones de las Serverless Functions de Vercel (*warm container*) ocurren en el mismo contenedor hasta que Vercel destruye esa instancia. 
Al guardar los nuevos datos en el objeto `memoryCache`, futuras peticiones a la API mientras el contenedor esté "vivo" leerán de la RAM y no del archivo empaquetado del disco original. Evita el temido problema donde consultar "Hoy" funcionaba, pero el sistema olvidaba la extracción del día "Ayer".

---

## 🔄 Flujo de Sincronización (Sync Loop)
El núcleo de extracción, que solo ocurre en **el mes actual y el año actual** (a menos que `sync === 'false'`), consta de tres mecanismos jerárquicos:

### 1️⃣ Inicialización de Cache vs Filesystem
- La API intenta primero cargar `memoryCache[anio]`.
- En caso de ser nulo o estar vacío, recurre a hacer un `JSON.parse(fs.readFileSync(path))` del archivo JSON empaquetado y, acto seguido, hidrata la `memoryCache` con ese archivo para proteger consultas futuras.

### 2️⃣ Fast-Inject (Web Scraping Ligero HTML)
Se llama a la página principal del BCV (usando `axios` y `cheerio`) para tratar de atrapar las tasas más recientes en el DOM, ya que descargarlas de allí tarda ~500 milisegundos.
- Se lee el texto del div dinámico buscando "27 de febrero" y, a través de una expresión regular poderosa, se traduce en una fecha formato `DD/MM/YYYY`.
- Se comprueba la diferencia en días (`diffDays`) entre nuestro último dato "OFICIAL" almacenado vs este nuevo dato atraído del HTML.
- **`Smart Gap Detection` (Detección de Feriados vs Errores):** Si salta del "3 de Marzo" al "5 de Marzo" por ejemplo (un hueco de 1 día hábil `diffDays > 1`), la API comprueba mediante `Date.getDay()` si el "4 de Marzo" es Lunes-Viernes o Sábado/Domingo. Si es algún día hábil, la API declara **`hasMissingWeekdays = true`** y cancela el intento Rápido HTML para obligar al sistema a descargar el Excel, porque el "Fast Inject" es incapaz de conseguir información de días pasados (solo trae el de hoy). Así garantizamos no usar tasas repetidas cuando los feriados se mezclan con desconexiones del BCV.

### 3️⃣ Fallback Pesado (XLSX Parsing)
Se recurre a descargar los últimos excels hiperlanzados en `_smc.xls`. Un proceso durísimo y lento (tarda 3-6 segundos) pero sumamente infalible:
- Descarga el Stream en Buffer (`arraybuffer`).
- Utiliza la biblioteca `xlsx` para cruzar múltiples pestañas del documento (una pestaña por cada feriado o iteración matemática).
- Busca fijamente la celda `D5` ("Fecha Valor: DD/MM/YYYY").
- Tras validar, extrae el Euro en `G11` y el Dólar en `G15`.

---

## 🏗 Procesamiento Posterior (Fill-Forward y Regeneración Continua)

Aquí es donde la API construye el historial ininterrumpido a prueba de baches visuales en la tabla o en el gráfico de Canvas (El efecto de la "línea recta" entre un Viernes y un Lunes en las calculadoras contables).

**Regla Cero (00:00 AM Constraint)**: Para evitar que el sistema se rinda y cierre el "día actual" prematuramente asumiendo que es feriado nada más despertar, hemos establecido que **nuestro `stopDate` siempre debe ser hasta `yesterdayMidnight`** como máximo (el día "ayer"). Solo cerraremos vacíos si ya están realmente en el pasado; le damos al BCV hasta las 11:59PM del día de hoy para publicar su tasa.

### Ciclo Cronológico (`while current <= stopDate`)
1. Comienza iterando un objeto `Date` desde la primera fecha oficial del mes.
2. Suma constantemente 1 día y valida si esta fecha existe en la base (que ya fusionó RAM + Scraping + Disco local).
3. ¿Existe como tasa oficial (`!isWeekend`)? -> Añade a `filledData`.
4. ¿No existe en la base temporal? (Vació / Feriado / 04 de Marzo):
   - Mantiene la variable `lastKnown` (las tasas del martes oficial).
   - Registra en `filledData` la tasa de ese Martes Oficial, bajo la nueva y vacía fecha del "Miércoles", adjuntándole la etiqueta crítica `isWeekend: true` (Alias: Placeholder / Marcador de Cerrado).
5. **Sobrescritura Segura**: Si en un futuro resulta que la extracción descubre que un `isWeekend: true` generado por impaciencia en realidad sí poseía un valor real de BCV, la API permite sobrescribir los campos `isWeekend` con datos nuevos y reales en el momento en el que sean inyectados. Esta resiliencia erradica las anomalías históricas.

---

## 📁 Grabado Condicional
```javascript
// Actualizamos el Caché principal en memoria
memoryCache[anio] = yearData;

try {
  fs.writeFileSync(dataPath, JSON.stringify(yearData, null, 2));
} catch (fsError) {
  // Ignorado elegantemente en Vercel o en containers read-only
}
```

## 📝 Lista de Verificación en una implementación Futura
- [ ] Importar las librerías `axios`, `cheerio` y `xlsx`.
- [ ] Establecer explícitamente `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` para el scraping, ya que el portal BCV en Venezuela sufre reasignación errática SSL y arrojaría rechazos TLS de validación.
- [ ] Definir el Objeto Global superior para alojar la Memoria RAM.
- [ ] Incorporar el "Smart Gap Detection" usando `Date.getDay()` cada vez que querramos saltar fechas basándonos en Scraping de portada, y desatar siempre un Fallback.

---
*Hecho por Bolívar Flow & IA Agent "Antigravity"*
