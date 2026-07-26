# 📜 Scriptorium — Editor de Tarjetas de Personaje e Historias RPG

**Scriptorium** es una herramienta web liviana, moderna y sin dependencias pesadas diseñada para la edición, formateo y gestión de tarjetas de personajes de IA (*CharaCardV2*) e historias RPG.

![Versión](https://img.shields.io/badge/version-1.0-gold)
![Licencia](https://img.shields.io/badge/license-MIT-blue)

👉 **[Usar Scriptorium en vivo](https://tu-usuario.github.io/scriptorium/)**

---

## ✨ Características Principales

* **Compatibilidad Estándar:** Importación y exportación compatible con el formato `chara_card_v2` (soporta archivos `.json` y metadatos integrados en imágenes `.png`).
* **Sustitución en Tiempo Real:** Reemplazo dinámico e interactivo de etiquetas de sistema como `{{char}}` y `{{user}}`.
* **Aislamiento de Metadatos:** Gestión de campos personalizados mediante el namespace `extensions.scriptorium` con versionado explícito de esquema (`version: 1`), evitando mezclar notas humanas con datos estructurados.
* **Compatibilidad hacia atrás:** Capacidad de lectura y extracción de esquemas y formatos legados sin romper tarjetas antiguas.
* **Manejo de Perfiles:** Creación, guardado y alternancia de perfiles de aventurero y prompts del sistema en almacenamiento local (*LocalStorage*).
* **Modo Editor Interactivo:** Renombrado, reordenado y adición de campos personalizados en vivo.
* **Editor JSON integrado:** Inspección y edición directa del árbol JSON con validación de sintaxis al instante.
* **Traducción Integrada:** Utilidad rápida de traducción de campos para adaptar escenarios o respuestas al español.
* **Interfaz Themed & Oscura:** Diseño responsivo con estética *Dark Fantasy*, animaciones sutiles y soporte para atajos de teclado.

---

## 🚀 Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Invocar y procesar texto / sustitución |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> | Aplicar cambios desde el editor JSON |
| <kbd>Ctrl</kbd> + <kbd>E</kbd> | Alternar / Activar el Modo Editor |
| <kbd>Esc</kbd> | Cerrar modales |

---

## ⚙️ Arquitectura de Extensión

Los campos personalizados creados o modificados en Scriptorium se estructuran de forma limpia bajo el objeto de extensiones estándar:

```json
{
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
```

---

## 🛠️ Tecnologías Utilizadas

* **HTML5 & Vanilla JavaScript (ES6+):** Sin frameworks ni pesados compiladores intermedios.
* **Tailwind CSS (CDN):** Estilizado utilitario rápido y dinámico.
* **FontAwesome 6:** Iconografía temática.

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para más detalles.
