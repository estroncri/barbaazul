# Arena Azul — Plataforma de torneos de Free Fire

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
- Conectar la cuenta con el ID de Free Fire (trae nick, nivel y rango, y pide un código de verificación).
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

## Qué está simulado

Esta demo **no mueve dinero real** y **no consulta a Garena**. Todo se guarda en el
`localStorage` del navegador:

- Las recargas se acreditan sin pasarela de pago.
- El perfil de Free Fire se genera a partir del ID, no viene de un servidor de Garena.
- La verificación de cuenta se aprueba automáticamente.
- Cada navegador tiene sus propios datos: lo que inscribe un celular no lo ve otro.

Para pasar a producción hace falta un backend. Está todo explicado en
[`ARQUITECTURA.md`](ARQUITECTURA.md).

## Estructura

```
torneos/
├── index.html          # Cascarón de la SPA (nav, footer, contenedor)
├── css/arena.css       # Estilos, mobile-first, sin framework
├── js/store.js         # Capa de datos: hoy localStorage, mañana llamadas al API
├── js/app.js           # Router por hash + vistas + panel de administración
├── README.md
└── ARQUITECTURA.md     # Cómo hacerlo real: pagos, cuentas, WhatsApp, legal
```

`store.js` es la pieza clave: **todas** sus funciones son asíncronas a propósito.
Cuando exista el backend, se cambia el cuerpo de cada función por un `fetch()` y
el resto de la aplicación no se entera.
