# Imágenes de la marca

Esta carpeta es donde van el logo y la portada. **No hay que tocar código**: la página
los busca sola al cargar y, si no están, sigue funcionando.

| Archivo | Para qué | Formatos que acepta |
|---------|----------|---------------------|
| `logo.png` | El escudo, en la barra superior y en el inicio. Mejor **sin fondo** (PNG transparente) | `.png`, `.webp`, `.jpg` |
| `portada.jpg` | La imagen grande detrás del inicio | `.jpg`, `.png`, `.webp` |

Los busca en ese orden y se queda con el primero que encuentre.

## Mientras no estén

- Sin `logo.png` usa `logo.svg`, un escudo dibujado a mano que se parece pero no es el original.
- Sin `portada.*` el inicio se queda con el fondo de brasas, sin imagen. No se rompe nada.

## Cómo subirlos sin usar la terminal

1. Entra a la carpeta en GitHub:
   `github.com/estroncri/barbaazul/tree/claude/free-fire-tournament-platform-s9aprh/torneos/img`
2. Botón **Add file → Upload files**.
3. Arrastra `logo.png` y `portada.jpg`, y confirma con **Commit changes**.

## Recomendaciones de tamaño

- **Logo:** cuadrado, mínimo 512×512, fondo transparente.
- **Portada:** apaisada, entre 1600×900 y 2400×1350. Que lo importante esté en el centro:
  en celular se recorta por los lados. Si pesa más de 500 KB, conviene comprimirla
  (por ejemplo en squoosh.app) para que la página cargue rápido con datos móviles.
