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

## Cobrar con Wompi

Con esto conectado, el jugador paga con tarjeta, Nequi o PSE y **el saldo se
acredita solo** cuando Wompi avisa que el pago salió bien.

### Variables de entorno

| Variable | De dónde sale |
|----------|---------------|
| `WOMPI_LLAVE_PUBLICA` | Wompi → Desarrollo → Programadores → *Llave pública* |
| `WOMPI_INTEGRIDAD` | La misma pantalla → Secretos → *Integridad* |
| `WOMPI_EVENTOS` | La misma pantalla → Secretos → *Eventos* |
| `WOMPI_REDIRECT` | A dónde vuelve el jugador tras pagar. Ej: `https://estroncri.github.io/barbaazul/torneos/#/billetera` |

Y en Wompi, en **URL de Eventos**, se pone la dirección de tu servidor:

```
https://tu-servidor.onrender.com/api/wompi/eventos
```

### Tres cosas que no se pueden hacer mal

1. **La llave privada, el secreto de integridad y el de eventos NUNCA van al
   navegador.** La llave *pública* sí puede verse, para eso es. Los otros tres,
   si alguien los consigue, puede firmar cobros a tu nombre o inventar avisos de
   pagos que nunca ocurrieron. Van solo en las variables de entorno del servidor.
2. **Empieza en modo de pruebas.** Wompi tiene un botón de *Activar modo de
   pruebas* con llaves `pub_test_...`. Haz ahí las primeras recargas; cuando
   funcione, cambias a las de producción.
3. **Nunca compartas capturas de esa pantalla con los secretos visibles.** Si
   llegaste a mostrar alguno, usa *Rotación de llaves privadas* y actualiza las
   variables del servidor.

### Cómo se comprueba que un pago es de verdad

La dirección de eventos es pública: la puede llamar cualquiera que la adivine.
Antes de acreditar un solo peso, el servidor comprueba, en este orden:

1. **La firma del evento**, con el secreto de eventos. Un aviso inventado no
   pasa de aquí.
2. **Que la referencia exista** y corresponda a una recarga que ese jugador pidió.
3. **Que no esté resuelta ya.** Wompi reintenta los avisos; sin esto, una misma
   recarga se acreditaría dos veces.
4. **Que el monto pagado sea exactamente el solicitado.** Si no coincide, se
   marca como rechazada y no acredita.

Todo eso está probado: un evento falsificado devuelve 401, uno con monto
distinto no acredita, y el mismo evento repetido no suma dos veces.

### Comprobar la firma con tus llaves reales

```bash
WOMPI_LLAVE_PUBLICA=pub_prod_... WOMPI_INTEGRIDAD=... \
  node -e "const w=require('./torneos/servidor/api/wompi.js');
           console.log(w.checkout('TFF-prueba', 20000).url)"
```

Abre esa dirección: si Wompi muestra el cobro por $20.000 sin quejarse de la
firma, las llaves están bien puestas.

## Lo que todavía no hace

- **Pagar los retiros solo.** El organizador transfiere por Nequi o banco y lo
  marca como pagado. Wompi tiene *Pagos a Terceros*, que serviría para
  automatizarlo más adelante.
- **Sin las variables de Wompi**, las recargas vuelven al modo manual: el
  jugador paga por fuera y el organizador confirma desde el panel.
- **Recuperar contraseña.** Por ahora, si alguien la olvida, se cambia a mano en
  la base de datos.
