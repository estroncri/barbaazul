# Regenerar `css/iconos.css`

El archivo `torneos/css/iconos.css` lleva incrustados **solo** los iconos que usa la
plataforma (unos 4 KB en vez de los 130 KB de la fuente completa). Así no depende de
ningún CDN: carga instantáneo y no se rompe si el CDN falla o está bloqueado.

Hay que regenerarlo únicamente si se **añade un icono nuevo** al código.

```bash
pip install fonttools brotli
npm pack bootstrap-icons@1.11.3 && tar -xzf bootstrap-icons-1.11.3.tgz

# 1. Lista de iconos usados en el código:
grep -oh "bi bi-[a-z0-9-]*" torneos/js/*.js torneos/index.html | sed 's/bi bi-//' | sort -u

# 2. Sacar sus códigos de package/font/bootstrap-icons.json y recortar la fuente:
python3 -m fontTools.subset package/font/fonts/bootstrap-icons.woff2 \
    --unicodes=U+F123,U+F456,...  \
    --flavor=woff2 --output-file=bi-sub.woff2 \
    --layout-features= --no-hinting --desubroutinize

# 3. Pasar bi-sub.woff2 a base64 y pegarlo en el @font-face de css/iconos.css,
#    añadiendo la regla .bi-<nombre>::before { content: "\<código>"; }
```

Si se añade un icono y no se regenera el archivo, ese icono sale en blanco: no rompe nada,
pero se nota.

Bootstrap Icons es de Bootstrap, con licencia MIT.
