# Torneos FF — Plataforma de torneos de Free Fire

Prototipo funcional (demo) de una plataforma para organizar torneos de Free Fire:
inscripciones pagas, lista pública de participantes, sala privada para los inscritos,
resultados con premios y billetera con retiros.

Vive en `/torneos/` dentro del sitio de Barba Azul, sin tocar la página de la barbería.

## Cómo probarlo

Al ser un sitio estático, basta con abrirlo desde un servidor local:

```bash
python3 -m http.server 8000
# luego: http://localhost:8000/torneos/
```

O, ya publicado en GitHub Pages: `https://estroncri.github.io/barbaazul/torneos/`

### Cuentas de prueba

| Rol | ID de Free Fire | Contraseña |
|-----|-----------------|------------|
| Jugador | `2148563097` | `demo123` |
| Administrador | `1000000001` | `admin123` |

También hay dos botones de acceso rápido en la pantalla **Entrar**.

## Qué se puede hacer hoy

**Como jugador**
- Conectar la cuenta escribiendo el ID de Free Fire: la plataforma trae nick, nivel, EXP, likes,
  región, rango BR y CS, honor, gremio y fecha de creación de la cuenta, y después pide un código
  de verificación para confirmar que la cuenta es suya.
- Recargar saldo y ver el historial de movimientos.
- Comprar el cupo de un torneo (solo, dúo o escuadra) y aparecer al instante en la lista de participantes.
- Cancelar la inscripción y recuperar el dinero mientras la sala no se haya publicado.
- Ver el ID y la contraseña de la sala (solo si estás inscrito).
- Ver resultados, kills, puestos y premios; pedir el retiro del dinero.
- Compartir el torneo por WhatsApp con un mensaje ya armado.

**Como administrador**
- Crear torneos (modo, fecha, cupo, costo, premio, reparto, mapa, reglas) con cálculo automático
  de lo que se recauda y el premio sugerido.
- Publicar el ID y la contraseña de la sala.
- Cargar resultados: los premios se abonan solos al saldo de cada ganador.
- Aprobar o rechazar retiros (al rechazar, el saldo vuelve al jugador).
- Generar el aviso del torneo para el grupo de WhatsApp y guardar el resultado de la encuesta
  (Solo / Dúo / Escuadra) para que quede publicado en el torneo.

## Los dos modos

Todo depende de una línea en `js/config.js`:

| `api` | Qué pasa |
|-------|----------|
| `''` (vacío) | **Modo local.** Cada navegador guarda lo suyo. Sirve para ver el diseño |
| `'https://…'` | **Modo compartido.** Las inscripciones, el saldo y los resultados viven en el servidor: todos ven lo mismo |

El servidor está en [`servidor/api/`](servidor/api/README.md) y no usa ninguna
librería externa; solo Node 22 o superior. Para probarlo:

```bash
ADMIN_FF_UID=tu-id ADMIN_PASS=tu-clave node torneos/servidor/api/servidor.js
# y en js/config.js →  api: 'http://localhost:8790/api'
```

En modo compartido la pantalla se actualiza sola: si entra otro inscrito o el
organizador publica la sala, aparece sin recargar.

## Qué está simulado

Esta demo **no mueve dinero real** y **no consulta a Garena**. Todo se guarda en el
`localStorage` del navegador:

- Las recargas se acreditan sin pasarela de pago.
- El perfil de Free Fire se genera a partir del ID mientras `perfilApi` esté vacío en
  `js/store.js`. Con el proveedor conectado, los datos son reales; la pantalla siempre
  dice de dónde vienen.
- La verificación de cuenta se aprueba automáticamente.
- Cada navegador tiene sus propios datos: lo que inscribe un celular no lo ve otro.

Para pasar a producción hace falta un backend. Está todo explicado en
[`ARQUITECTURA.md`](ARQUITECTURA.md).

## Poner el logo y la portada

Los archivos van en `torneos/img/` y la página los detecta sola, sin tocar código:

| Archivo | Dónde sale |
|---------|-----------|
| `logo.png` (sin fondo) | Barra superior, inicio, pantalla de carga |
| `portada.jpg` | Detrás del inicio, con acercamiento lento |

Si no están, el logo cae a un SVG dibujado a mano y el inicio se queda sin portada,
pero nada se rompe. Detalles y tamaños recomendados en [`img/LEEME.md`](img/LEEME.md).

## Tamaños de pantalla

Probado de 320 px (iPhone SE viejo) a 1920 px, más celular acostado y tablet:
sin desbordes horizontales y con todo lo que se pulsa por encima de 44 px en pantallas
táctiles. Las rejillas se acomodan solas al ancho disponible en vez de saltar entre
tamaños fijos.

## Estructura

```
torneos/
├── index.html          # Cascarón de la SPA (nav, footer, contenedor)
├── css/estilos.css       # Estilos, mobile-first, sin framework
├── js/config.js        # La única línea que decide: modo local o modo compartido
├── js/perfil-ff.js     # Consulta del perfil de Free Fire por ID (proveedor + normalización + caché)
├── js/store.js         # Capa de datos en modo local (localStorage)
├── js/store-api.js     # Capa de datos en modo compartido (habla con el servidor)
├── js/app.js           # Router por hash + vistas + panel de administración
├── servidor/
│   ├── perfil-ff.worker.js   # Intermediario para Cloudflare Workers (evita CORS y bloqueos de IP)
│   └── mock-perfil.js        # Proveedor de prueba para desarrollar en local
├── README.md
└── ARQUITECTURA.md     # Cómo hacerlo real: pagos, cuentas, WhatsApp, legal
```

`store.js` es la pieza clave: **todas** sus funciones son asíncronas a propósito.
Cuando exista el backend, se cambia el cuerpo de cada función por un `fetch()` y
el resto de la aplicación no se entera.

## Conectar los datos reales de Free Fire

Para que el ID traiga el perfil de verdad y no datos de ejemplo:

```bash
node torneos/servidor/proxy-local.js
```

y en `js/store.js`, dentro de `config`: `perfilApi: 'http://localhost:8787/perfil'`.

Eso ya trae nick, nivel, rango, likes, gremio y fecha de creación reales desde tu computador.
Para que funcione en internet hay que desplegar `servidor/perfil-ff.worker.js` en Cloudflare
Workers (gratis). La lista de proveedores y los pasos están en
[`ARQUITECTURA.md`](ARQUITECTURA.md).

**Importante:** ver el perfil de un ID no prueba que la cuenta sea de quien la registra —
cualquiera puede escribir el ID de otro. Por eso el segundo paso (el código en la biografía del
juego) no se puede saltar.

## Archivos del servidor

| Archivo | Para qué |
|---------|----------|
| `servidor/proxy-local.js` | Probar con proveedores reales desde tu computador, sin desplegar nada |
| `servidor/perfil-ff.worker.js` | El mismo proxy para Cloudflare Workers, para producción |
| `servidor/mock-perfil.js` | Proveedor de mentiras, para trabajar sin internet |
