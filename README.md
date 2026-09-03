# 📜 Scriptorium — Editor de Tarjetas de Personaje e Historias RPG

**Scriptorium** es una herramienta web liviana, moderna y sin dependencias pesadas diseñada para la edición, formateo y gestión de tarjetas de personajes de IA (*CharaCardV2*) e historias RPG.

![Versión](https://img.shields.io/badge/version-1.2.4-gold)
![Licencia](https://img.shields.io/badge/license-MIT-blue)

👉 **[Usar Scriptorium en vivo](https://adrigb.github.io/scriptorium/)**

---

## ✨ Características Principales

* **Compatibilidad Estándar:** Importación y exportación compatible con los formatos `chara_card_v2` y `chara_card_v3` (soporta archivos `.json` y metadatos integrados en imágenes `.png`).
* **Lectura PNG completa:** Soporte para chunks PNG con metadatos `chara` y `ccv3`: `tEXt`, `zTXt` (comprimido deflate) e `iTXt` (UTF-8 con compresión opcional), dando prioridad a `ccv3` sobre `chara` según la especificación V3.
* **Escritura PNG:** Inyección directa de tarjetas de vuelta a imágenes PNG (`ccv3` para V3, `chara` para V2), eliminando chunks anteriores de ambos tipos para evitar colisiones e insertando el nuevo antes de `IEND`.
* **Preservación sin degradación:** Al exportar tarjetas V3, se conservan su especificación y campos avanzados (assets, flags extendidas de lorebook) sin degradar en silencio a V2.
* **Sustitución en Tiempo Real:** Reemplazo dinámico e interactivo de etiquetas de sistema como `{{char}}` y `{{user}}`.
* **Aislamiento de Metadatos:** Gestión de campos personalizados mediante el namespace `extensions.scriptorium` dentro de `data` (según la especificación V2), con versionado explícito de esquema (`version: 1`), evitando mezclar notas humanas con datos estructurados.
* **Compatibilidad hacia atrás:** Capacidad de lectura y extracción de esquemas y formatos legados (incluyendo `extensions` en la raíz) sin romper tarjetas antiguas. Migración automática al formato correcto al exportar.
* **Bóveda de Personajes:** Almacenamiento persistente en IndexedDB con guardado automático, exportación e importación de bundles (`.scriptorium`), límite de 500 personajes y actualización por nombre.
* **Recuperación de Sesión:** Al recargar la página, ofrece restaurar la última sesión guardada incluyendo perfil activo, campos procesados, lorebook, saludos alternativos y nombres de personaje/usuario.
* **Manejo de Perfiles:** Creación, guardado y alternancia de perfiles de aventurero y prompts del sistema en almacenamiento local (*LocalStorage*).
* **Modo Editor Interactivo:** Renombrado, reordenado, adición y eliminación de campos personalizados en vivo con confirmación de doble clic.
* **Editor JSON integrado:** Vista de árbol de solo lectura y vista de código editable, con validación de sintaxis al instante, detección de cambios, formateo y reversión.
* **Exportación Múltiple:** Descarga como JSON formateado (`chara_card_v2`), como PNG con metadatos embebidos, o copia al portapapeles de campos, lorebook y saludos alternativos.
* **Traducción Integrada:** Utilidad rápida de traducción de campos para adaptar escenarios o respuestas al español, con aviso de privacidad obligatorio antes del primer uso.
* **Procesado Local:** Todos los archivos se procesan en el navegador. Los datos no abandonan el dispositivo salvo el texto enviado a Google Translate.
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
    "first_mes": "¡Hola, aventurero!",
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
