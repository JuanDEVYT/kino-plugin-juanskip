# JuanSkip

Plugin oficial de marcas de tiempo e intros para [Kino](https://kinotv.app).

Detecta de forma inteligente los tiempos de inicio y fin de intros, recaps, créditos y previos para mostrar automáticamente los botones nativos **"Saltar intro"** y **"Siguiente episodio"** en Kino.

## 🚀 Fuentes soportadas

- **AniSkip**: Base comunitaria líder para anime. Proporciona aperturas (`op`), cierres (`ed`) y resúmenes (`recap`) precisos cuadro por cuadro. Mapeo automático de títulos a través de AniList GraphQL.
- **TheIntroDB**: Base de datos comunitaria abierta para series occidentales, anime y películas (soporta IDs de TMDB, IMDb y TVDB).

## ⚙️ Características

- **Capacidad Segments nativa**: Usa la API `segments` de Kino (`apiVersion: 7+`), compatible directamente con el reproductor de la app en móvil, TV y escritorio.
- **Doble motor con respaldo**: Si una fuente no cuenta con registros para un título, consulta automáticamente la siguiente en paralelo.
- **Desduplicación y normalización**: Combina marcas, evita solapamientos y ajusta los créditos finales según la duración real de la reproducción.
- **Ajustes configurables**: Permite activar o desactivar AniSkip o TheIntroDB individualmente desde los Ajustes del plugin en Kino.

## 📦 Instalación en Kino

1. Ve a **Ajustes > Plugins**.
2. Pulsa en **Instalar plugin desde URL** (o el botón `+`).
3. Introduce la URL del repositorio:
   ```text
   https://github.com/JuanDEVYT/kino-plugin-juanskip
   ```
4. ¡Listo! El botón de saltar intro aparecerá automáticamente durante la reproducción de series, anime y películas compatibles.

## 📄 Licencia

MIT © [JuanDEVYT](https://github.com/JuanDEVYT)
