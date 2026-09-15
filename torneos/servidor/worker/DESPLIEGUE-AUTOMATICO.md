# Desplegar desde GitHub, sin instalar nada

Esta es la forma de subir el servidor **sin escribir un solo comando** en tu
computador: lo hace GitHub por ti. Tú solo pegas unos secretos en una pantalla y
das a un botón.

Tarda unos 10 minutos la primera vez. Después, cada vez que se cambie el
servidor, se despliega solo.

---

## 1. Sacar la llave de Cloudflare

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) (crea la cuenta si no la tienes; es gratis y sin tarjeta).
2. Arriba a la derecha, tu perfil → **Tokens de API** → **Crear token**.
3. Elige **Crear token personalizado** y dale estos permisos:

   | Tipo | Permiso | Nivel |
   |------|---------|-------|
   | Cuenta | Workers Scripts | Editar |
   | Cuenta | D1 | Editar |

4. Créalo y **copia el token**. Cloudflare lo muestra una sola vez.
5. Copia también tu **Account ID**: está en la pantalla de inicio de Cloudflare,
   en la barra de la derecha.

> Ese token sirve para publicar el servidor, nada más. No es tu contraseña y no
> da acceso a tu cuenta. Puedes borrarlo cuando quieras desde la misma pantalla.

---

## 2. Guardar los secretos en GitHub

En tu repositorio: **Settings → Secrets and variables → Actions → New repository secret**.

Uno por uno:

| Nombre | Qué va |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | El token del paso anterior |
| `CLOUDFLARE_ACCOUNT_ID` | Tu Account ID |
| `ADMIN_FF_UID` | Tu ID de Free Fire. **Esa será la única cuenta con panel** |
| `ADMIN_PASS` | Tu contraseña de organizador (larga, que no uses en otro lado) |
| `ADMIN_NICK` | Tu nick |
| `ADMIN_WHATSAPP` | Tu número con indicativo: `573001112233` |
| `WOMPI_LLAVE_PUBLICA` | Empieza con `pub_test_` para probar |
| `WOMPI_INTEGRIDAD` | Wompi → Programadores → Secretos → Integridad |
| `WOMPI_EVENTOS` | La misma pantalla → Eventos |
| `FF_API_URL` | El servicio que trae el nick por ID. Ver abajo |
| `FF_API_KEY` | *(opcional)* si ese servicio pide llave |
| `SUBDOMINIO` | *(opcional)* el nombre que quieres para tu dirección: `algo`.workers.dev |
| `PASS_PIMIENTA` | *(opcional, recomendado)* un texto largo al azar. Protege las contraseñas si alguien roba la base |

Los que no pongas simplemente no se activan: sin los de Wompi las recargas van en
modo manual, y sin `FF_PROVEEDOR` el jugador escribe su nick a mano.

**Nadie más ve estos secretos.** GitHub los guarda cifrados, se los pasa solo a
este proceso y ni siquiera aparecen en los registros. A mí tampoco me llegan.

---

## 3. Darle al botón

Pestaña **Actions** → **Desplegar Torneos FF** → **Run workflow**.

Lo que hace, en orden:

1. Corre las 38 comprobaciones de las reglas del dinero. **Si alguna falla, no publica nada.**
2. Crea la base de datos si no existe, o usa la que ya esté.
3. Aplica las tablas que falten.
4. Guarda tus secretos en Cloudflare.
5. Registra tu dirección `algo.workers.dev` si la cuenta todavía no tiene una.
6. Publica el servidor.
7. Crea tu cuenta de organizador.

Cuando termina, en el resumen del propio proceso te deja la dirección del
servidor y las dos cosas que faltan.

---

## 4. Las dos cosas que quedan

Ninguna la puede hacer el despliegue solo:

**a) Decirle a Wompi dónde avisar.** En Wompi → Desarrollo → Programadores →
URL de Eventos:

```
https://torneos-ff.estroncri.workers.dev/api/wompi/eventos
```

**b) Conectar la página.** Ya está hecho: `torneos/js/config.js` apunta a

```js
api: 'https://torneos-ff.estroncri.workers.dev/api'
```

---

## 5. Comprobar

Con el repositorio descargado:

```bash
node torneos/servidor/worker/verificar-despliegue.js https://torneos-ff.estroncri.workers.dev
```

Y después la prueba de verdad: entra con tu cuenta, crea un torneo, y desde otro
navegador regístrate como jugador y recarga con la tarjeta de prueba de Wompi
(`4242 4242 4242 4242`). El saldo debe aparecer solo.

---

## Que el ID traiga el nick

Free Fire no tiene API oficial: para traer el nick de un ID hay que
preguntarle a un servicio de terceros. Los dos gratuitos que traía la
plataforma **dejaron de servir**: uno empezó a cobrar (contesta 402) y el otro
contesta 404 para cualquier cuenta, incluso las que existen.

Mientras no haya uno que funcione, el jugador escribe su nick a mano. La
plataforma ya lo hace así cuando la consulta falla, y no dice que la cuenta no
exista, porque no lo sabe.

Para enchufar uno nuevo no hay que tocar código:

1. **Pruébalo primero.** Actions → *Diagnosticar una cuenta* → pon un ID que
   exista y, en el segundo campo, la dirección del servicio con `{uid}` y
   `{region}` donde vayan:

   ```
   https://loquesea.com/info?uid={uid}&region={region}
   ```

   Si alguna línea sale con ✔ y el nick correcto, sirve.

2. **Guárdalo** como el secreto `FF_API_URL` (y `FF_API_KEY` si pide llave) y
   lanza el despliegue. Desde ese momento el ID trae el nick solo.

Ningún servicio gratuito de estos dura para siempre: si un día deja de
detectar cuentas, el diagnóstico te dice en un minuto si es el ID o es el
servicio.

---

## Las contraseñas y el plan gratuito

Cloudflare corta cada petición a los **10 ms de CPU** en el plan gratuito.
Guardar contraseñas como manda el manual (210.000 vueltas de PBKDF2) cuesta
33 ms, así que con eso **nadie puede entrar**: el servidor muere antes de
contestar y sale "Algo falló en el servidor".

Por eso se dan 20.000 vueltas (unos 5 ms) y se compensa con una **pimienta**:
un secreto que vive en el servidor y no en la base de datos. Quien se lleve la
base sin ese secreto no puede ni empezar a probar contraseñas.

Ponla ahora, mientras no haya jugadores: si la añades o la cambias después,
las contraseñas ya guardadas dejan de valer y cada uno tendrá que pedir
recuperación. Sirve cualquier texto largo al azar, cuanto más largo mejor.

Si algún día pasas al plan de pago, puedes subir las vueltas con el secreto
`PASS_VUELTAS` (por ejemplo `210000`) sin tocar nada más: las contraseñas
guardadas se rehacen solas la próxima vez que cada uno entre.

---

## Si algo falla

En **Actions** se ve cada paso con su error. Los tres típicos:

- **"Falta el secreto CLOUDFLARE_API_TOKEN"** — no se guardó, o se guardó con
  otro nombre. Ojo a mayúsculas.
- **"Authentication error"** — al token le faltan permisos. Revisa que tenga
  Workers Scripts: Editar y D1: Editar.
- **Falla `probar.mjs`** — hay un error en el código del servidor y por eso no se
  publicó. Mándame lo que diga.
