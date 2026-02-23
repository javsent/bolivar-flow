# Reglas de Sistema para Agente Gemini en Google Antigravity

## Orquestación del Flujo de Trabajo

### 0. Preámbulo

- Siempre deberás hablar en español, salvo que te solicite explícitamente lo contrario.
- **Legibilidad de URLs**: Todas las rutas de la aplicación deben ser legibles para el usuario final. Se deben utilizar `slugs` descriptivos en lugar de `IDs` (UUIDs) en las URLs para evitar exponer información técnica o delicada y mejorar la experiencia del usuario.
- **Seguridad en URLs**: Nunca incluyas información sensible o códigos internos feos en las direcciones del navegador.

- Todas las variables establecidas deberán tener nombres en español, camelcase, y que hagan referencia a aquello para lo que fueron creadas.

### 1. Modo de Planificación por Defecto (Plan Node)

- Entra en modo de planificación generando un **Artefacto (Implementation Plan)** para CUALQUIER tarea no trivial (3+ pasos o decisiones arquitectónicas).

- Si algo sale mal o la ejecución falla repetidamente, DETENTE y vuelve a planificar de inmediato; no sigas iterando a ciegas sobre el error.

- Usa el modo de planificación para diseñar los pasos de verificación, no solo para la construcción de código.

- Escribe especificaciones detalladas por adelantado para reducir la ambigüedad en el Agent Manager.

### 2. Estrategia de Subagentes (Agent Manager)

- Usa el Agent Manager de forma liberal para instanciar subagentes y mantener limpia la ventana de contexto de tu hilo principal.

- Delega la investigación de código base, exploración y análisis paralelo a subagentes.

- Para problemas complejos de refactorización o arquitectura, asigna más capacidad de cómputo dividiendo el problema entre varios subagentes.

- Un objetivo principal por subagente para garantizar una ejecución enfocada y asíncrona.

### 3. Bucle de Automejora (Memoria Persistente)

- Después de CUALQUIER corrección manual del usuario: actualiza el archivo `tasks/lessons.md` en el workspace con el patrón del error.

- Transforma los errores en reglas en ese documento para evitar cometer el mismo error lógico en el futuro.

- Itera implacablemente sobre estas lecciones hasta que la tasa de errores en ese dominio disminuya a cero.

- **REGLA DE INICIO CONSTANTE**: Al iniciar cualquier interacción o sesión nueva con este proyecto, DEBES leer el archivo `tasks/development_plan.md` combinado con `tasks/todo.md` y `tasks/lessons.md`. El `development_plan.md` es el mapa de ruta maestro de todo el software y te guiará sobre el estado de las fases.

### 4. Verificación Antes de Finalizar (Zero Trust)

- NUNCA marques una tarea como completa en Antigravity sin demostrar empíricamente que funciona.

- Analiza el diff entre la rama principal y tus cambios usando las herramientas del IDE.

- Pregúntate antes de terminar: "¿Aprobaría este PR un Staff Engineer?".

- Usa la terminal de Antigravity para ejecutar pruebas (Unit/E2E), revisa los logs generados y usa el navegador integrado para demostrar la corrección en la UI si aplica.

### 5. Exigir Elegancia (Equilibrio de Ingeniería)

- Para cambios no triviales: haz una pausa en la ejecución y evalúa: "¿Hay una forma más elegante o escalable de hacer esto?".

- Si una solución parece un parche (hacky) o deuda técnica: "Sabiendo todo lo que sé ahora sobre este codebase, implementa la solución elegante".

- Omite esta regla exclusivamente para fixes tipográficos o de dependencias obvias; no sobre-ingenies lo simple.

- Cuestiona y audita tu propio código (self-review) antes de presentarlo como entregable.

### 6. Corrección Autónoma de Errores (Bug Fixing)

- Cuando se te proporcione un reporte de error: simplemente arréglalo de principio a fin. No pidas instrucciones paso a paso.

- Usa tus herramientas para apuntar a los logs, buscar el stack trace, leer las pruebas fallidas y resolver la causa raíz de forma autónoma.

- Cero cambios de contexto requeridos por parte del usuario. Haz el trabajo de investigación por tu cuenta.

- Ejecuta los tests de CI en la terminal local y no te detengas hasta que pasen en verde.

## Gestión de Tareas y Artefactos

1. **Planificar Primero:** Escribe tu plan en `tasks/todo.md` estructurado con checkboxes (`[ ]`).

2. **Verificar el Plan:** Espera confirmación del usuario en el chat antes de comenzar la implementación que altera el código.

3. **Rastrear el Progreso:** Usa tus capacidades de edición de archivos para marcar los elementos como completados (`[x]`) a medida que avanzas.

4. **Explicar los Cambios:** Proporciona resúmenes concisos de alto nivel en la interfaz del chat tras cada paso importante completado.

5. **Documentar Resultados:** Añade una sección de revisión final (Retro) a `tasks/todo.md` al culminar.

6. **Capturar Lecciones:** Actualiza `tasks/lessons.md` en caso de que el enfoque inicial haya requerido pivotes o correcciones.

## Principios Fundamentales (Core)

- **Simplicidad Primero:** Haz que cada cambio sea lo más simple posible y siga los patrones de diseño existentes.

- **Cero Pereza:** Encuentra las causas raíz absolutas. Prohibidos los arreglos temporales o ignorar advertencias del linter. Debes operar bajo estándares de Senior Developer.

- **Impacto Mínimo:** Los cambios y refactorizaciones solo deben tocar los archivos estrictamente necesarios. Evita efectos secundarios no deseados o reescrituras innecesarias.
