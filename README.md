```markdown
# 📜 Scriptorium — Editor de Tarjetas de Personaje e Historias RPG

**Scriptorium** es una herramienta web liviana, moderna y sin dependencias pesadas diseñada para la edición, formateo y gestión de tarjetas de personajes de IA (*CharaCardV2*) e historias RPG.

![Versión](https://img.shields.io/badge/version-1.1-gold)
![Licencia](https://img.shields.io/badge/license-MIT-blue)

👉 **[Usar Scriptorium en vivo](https://adrigb.github.io/scriptorium/)**

---

## ✨ Características Principales

* **Compatibilidad Estándar:** Importación y exportación compatible con el formato `chara_card_v2` (soporta archivos `.json` y metadatos integrados en imágenes `.png`).
* **Lectura PNG completa:** Soporte para los tres tipos de chunks PNG con metadatos `chara`: `tEXt`, `zTXt` (comprimido deflate) e `iTXT` (UTF-8 con compresión opcional).
* **Escritura PNG:** Inyección directa de tarjetas de vuelta a imágenes PNG, eliminando chunks anteriores e insertando el nuevo antes de `IEND`.
* **Sustitución en Tiempo Real:** Reemplazo dinámico e interactivo de etiquetas de sistema como `{{char}}` y `{{user}}`.
* **Aislamiento de Metadatos:** Gestión de campos personalizados mediante el namespace `extensions.scriptorium` dentro de `data` (según la especificación V2), con versionado explícito de esquema (`version: 1`), evitando mezclar notas humanas con datos estructurados.
* **Compatibilidad hacia atrás:** Capacidad de lectura y extracción de esquemas y formatos legados (incluyendo `extensions` en la raíz) sin romper tarjetas antiguas. Migración automática al formato correcto al exportar.
* **Bóveda de Personajes:** Almacenamiento persistente en IndexedDB con guardado automático, exportación e importación de bundles (`.scriptorium`), límite de 500 personajes y actualización por nombre.
* **Recuperación de Sesión:** Al recargar la página, ofrece restaurar la última sesión guardada incluyendo perfil activo, estado del editor, campos procesados y nombres de personaje/usuario.
* **Manejo de Perfiles:** Creación, guardado y alternancia de perfiles de aventurero y prompts del sistema en almacenamiento local (*LocalStorage*).
* **Modo Editor Interactivo:** Renombrado, reordenado, adición y eliminación de campos personalizados en vivo con confirmación de doble clic.
* **Editor JSON integrado:** Inspección y edición directa del árbol JSON con validación de sintaxis al instante, detección de cambios (dirty), formateo y reversión.
* **Exportación Múltiple:** Descarga como JSON formateado (`chara_card_v2`), como PNG con metadatos embebidos, o copia al portapeglado de todo el texto procesado.
* **Traducción Integrada:** Utilidad rápida de traducción de campos para adaptar escenarios o respuestas al español, con aviso de privacidad obligatorio antes del primer uso.
* **Procesado Local:** Todos los archivos se procesan en el navegador. Los datos no abandonan el dispositivo salvo el texto traducido.
* **Interfaz Themed & Oscura:** Diseño responsivo con estética *Dark Fantasy*, animaciones sutiles, canvas de estrellas y soporte para atajos de teclado.
* **Accesibilidad:** ARIA roles, focus trapping en modales, `prefers-reduced-motion` y etiquetas `sr-only`.

---

## 🚀 Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Invocar y procesar texto / sustitución |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> | Aplicar cambios desde el editor JSON |
| <kbd>Ctrl</kbd> + <kbd>E</kbd> | Alternar / Activar el Modo Editor |
| <kbd>Esc</kbd> | Cerrar modal activo |

---

## ⚙️ Arquitectura de Extensión

Los campos personalizados creados o modificados en Scriptorium se estructuran de forma limpia bajo el objeto de extensiones estándar, dentro de `data` según la especificación CharaCardV2:

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Personaje",
    "description": "Descripción del personaje...",
    "personality": "Amable y valiente...",
    "scenario": "En un mundo de fantasía...",
    "first_mes": "¡Hola, aventurero.",
    "extensions": {
      "scriptorium": {
        "version": 1,
        "fields": {
          "mi_campo_personalizado": {
            "value": "Contenido del campo...",
            "created": true
          }
        }
      }
    }
  }
}
```

Para compatibilidad con archivos anteriores que tenían `extensions` en la raíz, la aplicación lee ambos lugares al importar y migra automáticamente al formato correcto al exportar.

---

## 🏗️ Estructura del Proyecto

```
index.html              Interfaz principal
js/
├── app.js              Orquestador
├── state.js            Estado centralizado y constantes
├── chara-card.js       Extracción y construcción de tarjetas V2
├── editor.js           Motor de edición y renderizado
├── export.js           Exportación JSON y PNG
├── png-parser.js       Lectura de metadatos PNG (tEXt, zTXt, iTXt)
├── png-writer.js       Escritura de metadatos PNG
├── profiles.js         Gestión de perfiles
├── storage.js          Bóveda con IndexedDB
├── translator.js       Traducción vía Google Translate
├── ui.js               Inicialización de componentes UI
├── utils.js            Utilidades compartidas (Storage, showToast, etc.)
└── vault.js            UI del modal de bóveda
```

Todos los módulos comparten un único objeto `state` exportado desde `state.js`. La persistencia opera en dos capas:

* **LocalStorage** — Perfiles y preferencias de UI.
* **IndexedDB** — Sesión activa y personajes en la bóveda.

---

## 🛠️ Tecnologías Utilizadas

* **HTML5 & Vanilla JavaScript (ES6+ módulos):** Sin frameworks ni pesados compiladores intermedios.
* **Tailwind CSS (CDN):** Estilizado utilitario rápido y dinámico.
* **FontAwesome 6:** Iconografía temática.
* **IndexedDB API:** Almacenamiento persistente del lado del cliente.
* **esbuild:** Verificación de imports en CI (sin runtime en producción).

---

## 🔧 Desarrollo

```bash
npm install
npm run check
```

El comando `check` usa [esbuild](https://esbuild.github.io/) para bundlear todos los módulos y verificar que no hay imports rotos antes de publicar.

---

## 🔒 Privacidad

* Los archivos se procesan localmente en el navegador.
* La función de traducción envía texto a Google Translate. Se muestra un aviso de privacidad obligatorio antes del primer uso.
* Los datos se almacenan en IndexedDB y LocalStorage (no se envían a ningún servidor).

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para más detalles.
```