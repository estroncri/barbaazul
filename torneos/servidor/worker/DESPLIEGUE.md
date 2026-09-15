# Subir el servidor a Cloudflare

Gratis y sin tarjeta. Los datos **no se borran nunca**: viven en D1, la base de
datos de Cloudflare, no en el disco del servidor.

El plan gratuito da 100.000 peticiones al día y 5 GB de base de datos. Para un
torneo de barrio sobra de lejos.

Son unos 20 minutos, una sola vez.

---

## Atajo: el instalador

Si prefieres no seguir los pasos uno por uno, hay un instalador que hace todo
lo de abajo y te va preguntando lo que necesita:

```bash
cd torneos/servidor/worker
npm install
node instalar.mjs
```

Crea la base de datos, pone las tablas, guarda los secretos de Wompi, publica el
servidor, crea tu cuenta de organizador, deja la página apuntando a la dirección
nueva y la comprueba. Al final te dice las dos cosas que quedan por hacer a mano
(pegar la URL de eventos en Wompi y subir el cambio a GitHub).

Para ver lo que haría sin que toque nada: `node instalar.mjs --simular`.

Lo que sigue es el mismo proceso a mano, por si algo falla o prefieres ir viendo
cada paso.

---

## 1. Cuenta y herramienta

1. Crea cuenta en [dash.cloudflare.com](https://dash.cloudflare.com) (gratis, sin tarjeta).
2. En tu computador, dentro de la carpeta del proyecto:

```bash
cd torneos/servidor/worker
npm install            # baja wrangler, la herramienta de Cloudflare
npx wrangler login     # abre el navegador para autorizar
```

---

## 2. Crear la base de datos

```bash
npx wrangler d1 create torneos-ff
```

Te imprime algo así:

```
[[d1_databases]]
binding = "DB"
database_name = "torneos-ff"
database_id = "a1b2c3d4-...."
```

Copia ese `database_id` y pégalo en **`wrangler.toml`**, reemplazando
`PON_AQUI_EL_ID_QUE_TE_DE_WRANGLER`.

Luego crea las tablas:

```bash
npx wrangler d1 migrations apply torneos-ff --remote
```

---

## 3. Cargar los secretos

Uno por uno. Wrangler los pide por teclado y **no quedan en ningún archivo**:

```bash
npx wrangler secret put WOMPI_LLAVE_PUBLICA    # empieza con pub_test_ para probar
npx wrangler secret put WOMPI_INTEGRIDAD       # Wompi → Programadores → Secretos → Integridad
npx wrangler secret put WOMPI_EVENTOS          # la misma pantalla → Eventos
```

---

## 4. Publicar

```bash
npx wrangler deploy
```

Te da una dirección tipo `https://torneos-ff.tu-usuario.workers.dev`. Apúntala.

---

## 5. Crear tu cuenta de organizador

Es la única que verá el panel. Genera el comando:

```bash
node crear-organizador.mjs TU_ID_DE_FREE_FIRE "una-contraseña-larga" "TuNick" "573001112233"
```

Te imprime un comando `npx wrangler d1 execute ...` ya armado. Cópialo y
ejecútalo. La contraseña no viaja en texto: se manda ya convertida en hash.

---

## 6. Decirle a Wompi dónde avisar

En Wompi → **Desarrollo → Programadores → URL de Eventos**:

```
https://torneos-ff.tu-usuario.workers.dev/api/wompi/eventos
```

y **Guardar**. Sin esto, el saldo nunca se acredita solo.

---

## 7. Conectar la página

En `torneos/js/config.js`:

```js
api: 'https://torneos-ff.tu-usuario.workers.dev/api'
```

Súbelo a GitHub. Desde ese momento todos ven lo mismo.

---

## 8. Comprobar

```bash
node verificar-despliegue.js https://torneos-ff.tu-usuario.workers.dev
```

Todo con ✔. La que más importa: **"Los avisos de pago sin firma se rechazan"**.
Si esa falla, cualquiera podría inventarse pagos y regalarse saldo.

Después, la prueba de verdad:

1. Entra con tu cuenta de organizador y crea un torneo.
2. Desde otro navegador, regístrate como jugador.
3. Billetera → Recargar → pagas con la tarjeta de prueba de Wompi
   (`4242 4242 4242 4242`, fecha futura, CVC `123`).
4. El saldo debe aparecer **solo**.

---

## Pasar a cobrar de verdad

1. En Wompi, desactiva el modo de pruebas.
2. Vuelve a cargar los tres secretos con los valores de producción
   (`npx wrangler secret put ...` otra vez) y `npx wrangler deploy`.
3. Corre el verificador: debe decir **PRODUCCIÓN**.
4. Haz una recarga real de $1.000 y compruébala.

---

## Mantenimiento

**Copia de seguridad** (hazla cada semana):

```bash
npx wrangler d1 export torneos-ff --remote --output respaldo-$(date +%F).sql
```

**Ver qué está pasando** en vivo:

```bash
npx wrangler tail
```

Ahí salen los errores y los avisos de pago rechazados, con su motivo.

---

## Probar cambios sin desplegar

```bash
npm run probar     # 19 comprobaciones de las reglas de dinero, sin tocar internet
npx wrangler dev   # el servidor en tu computador, con una base de datos local
```
