# El servidor de Torneos FF

Sin esto, cada navegador guarda lo suyo: tú ves unas inscripciones y tu amigo
ve otras. Con esto, **todos ven lo mismo**.

No usa ninguna librería externa. Solo necesita **Node 22 o superior**.

## Probarlo en tu computador

```bash
# 1. Arrancar el servidor (crea la cuenta de organizador la primera vez)
ADMIN_FF_UID=1000000001 ADMIN_PASS=tu-clave-buena node torneos/servidor/api/servidor.js

# 2. En torneos/js/config.js:
#    api: 'http://localhost:8790/api'

# 3. Abrir la página como siempre
python3 -m http.server 8099   # → http://localhost:8099/torneos/
```

Ábrela en dos navegadores distintos (o uno normal y otro de incógnito) y vas a
ver cómo lo que inscribe uno le aparece al otro.

## Ponerlo en internet

El servidor es un proceso de Node con un archivo SQLite al lado. Cualquiera de
estos servicios sirve, y todos tienen plan gratis para empezar:

| Servicio | Cómo |
|----------|------|
| **Render** | Nuevo *Web Service* → conecta el repo → Start command: `node torneos/servidor/api/servidor.js` → añade un *Disk* montado en `/data` |
| **Railway** | Nuevo proyecto desde el repo → mismo comando → añade un volumen |
| **Fly.io** | `fly launch` → volumen con `fly volumes create datos` |
| **Un VPS** | `node servidor.js` detrás de nginx, con systemd para que se levante solo |

**El disco importa.** Estos servicios borran el sistema de archivos en cada
despliegue: si la base de datos queda en la carpeta del proyecto, **se pierden
las cuentas y los saldos**. Hay que montar un disco persistente y apuntar ahí:

```
DB_RUTA=/data/torneos.db
```

### Variables de entorno

| Variable | Para qué |
|----------|----------|
| `PUERTO` | Puerto donde escucha (por defecto 8790). Render y Railway lo inyectan solos |
| `DB_RUTA` | Dónde vive la base de datos. **Apúntala al disco persistente** |
| `ORIGENES` | Direcciones autorizadas, separadas por coma. Ej: `https://estroncri.github.io` |
| `ADMIN_FF_UID` | Tu ID de Free Fire: esa cuenta será la del organizador |
| `ADMIN_PASS` | Su contraseña. **Cámbiala por una larga y que no uses en otro lado** |
| `MIN_RETIRO` | Retiro mínimo en pesos (por defecto 10.000) |
| `MIN_RECARGA` | Recarga mínima (por defecto 1.000) |

Después, en `torneos/js/config.js`:

```js
api: 'https://tu-servidor.onrender.com/api'
```

y súbelo. La página en GitHub Pages seguirá siendo estática; solo le cambia de
dónde saca los datos.

## Lo que decide el servidor (y no el navegador)

Todo lo que alguien podría querer falsear:

- **El saldo** no es un número guardado: es la suma del libro de movimientos.
  Recargas, premios, inscripciones, retiros y correcciones quedan anotados.
- **Una recarga no acredita sola.** Queda en revisión hasta que el organizador
  confirma que el dinero llegó. Mientras tanto no suma al saldo.
- **Un retiro pendiente sí reserva** el dinero, para que nadie gaste dos veces
  lo mismo mientras se le paga.
- **Cupos y cobros van en una transacción.** Dos personas inscribiéndose a la
  vez no pueden pasarse del cupo ni dejar un saldo en negativo.
- **El ID y la contraseña de la sala** solo viajan a quien está inscrito o al
  organizador. Al resto les llegan vacíos, no ocultos con CSS.
- **Crear torneos, publicar salas, cargar resultados y aprobar pagos** exigen
  rol de organizador, comprobado en cada petición.
- **Corregir un resultado no regala dinero**: si ya se había pagado un premio
  por esa inscripción, se descuenta antes de pagar el nuevo.

## Copias de seguridad

La base de datos es un archivo. Para respaldarla:

```bash
sqlite3 /data/torneos.db ".backup '/data/respaldo-$(date +%F).db'"
```

Vale la pena programarlo a diario. Son las cuentas y el dinero de la gente.

## Lo que todavía no hace

- **Cobrar de verdad.** Las recargas las confirma una persona. Para que el banco
  las confirme solo hay que conectar una pasarela (Wompi, Bold) y que su webhook
  llame a un endpoint que marque el movimiento como completado.
- **Pagar retiros solo.** El organizador transfiere y marca como pagado.
- **Recuperar contraseña.** Por ahora, si alguien la olvida, se cambia a mano en
  la base de datos.
