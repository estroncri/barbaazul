# Subir el servidor a Render y conectar Wompi

Son unos 15 minutos. Hay que hacerlo desde tu cuenta: yo no puedo entrar a
Render por ti, y los secretos de Wompi no deben pasar por ningún chat —
se escriben directamente en el panel de Render.

---

## Antes de empezar: el plan

**El plan gratuito de Render no admite disco.** Sin disco, el archivo de la base
de datos se borra **en cada despliegue y cada reinicio**: se irían las cuentas,
los saldos y las inscripciones. Para algo que maneja dinero eso no sirve.

Por eso `render.yaml` pide el plan **Starter (unos 7 USD al mes)** con un disco
de 1 GB. Es lo más barato que aguanta.

Si prefieres no pagar todavía: despliega en gratuito solo para probar el flujo
completo con Wompi en modo pruebas, sabiendo que **los datos se borran solos**.
Para cobrarle a jugadores de verdad, pasa a Starter antes.

---

## 1. Crear el servicio

1. Entra a [dashboard.render.com](https://dashboard.render.com) y conecta tu GitHub.
2. **New → Blueprint**.
3. Elige el repositorio **estroncri/barbaazul**, rama `main`.
4. Render lee `render.yaml` y arma el servicio solo. **Apply**.

Te va a pedir los valores marcados como secretos. Escríbelos ahí:

| Variable | Qué poner |
|----------|-----------|
| `ADMIN_FF_UID` | Tu ID de Free Fire. **Esa cuenta será la única con panel** |
| `ADMIN_PASS` | Una contraseña larga que no uses en ningún otro lado |
| `ADMIN_NICK` | Tu nick, como quieres que aparezca |
| `ADMIN_WHATSAPP` | Tu número con indicativo: `573001112233` |
| `WOMPI_LLAVE_PUBLICA` | **Empieza con `pub_test_`**, la de modo pruebas |
| `WOMPI_INTEGRIDAD` | Wompi → Desarrollo → Programadores → Secretos → *Integridad* |
| `WOMPI_EVENTOS` | La misma pantalla → *Eventos* |
| `WOMPI_REDIRECT` | `https://estroncri.github.io/barbaazul/torneos/#/billetera` |

Cuando termine, Render te da una dirección tipo
`https://torneos-ff-api.onrender.com`. Apúntala.

> **Para las pruebas usa las llaves de pruebas.** En Wompi, botón *Activar modo
> de pruebas*: te da unas llaves `pub_test_...`. Con esas no se mueve dinero real.

---

## 2. Comprobar que quedó bien

Desde tu computador, con el repositorio descargado:

```bash
node torneos/servidor/api/verificar-despliegue.js https://tu-servidor.onrender.com
```

Tiene que salir todo con ✔. Revisa especialmente **"Los avisos de pago sin firma
se rechazan"**: si eso falla, cualquiera podría inventarse pagos y regalarse
saldo. No sigas hasta que dé 401.

---

## 3. Decirle a Wompi dónde avisar

En Wompi → **Desarrollo → Programadores → URL de Eventos**, pega:

```
https://tu-servidor.onrender.com/api/wompi/eventos
```

y **Guardar**. Ahí es donde Wompi avisa cuando alguien paga; sin esto, el saldo
nunca se acredita solo.

---

## 4. Conectar la página

En `torneos/js/config.js`, cambia la línea:

```js
api: 'https://tu-servidor.onrender.com/api'
```

Súbelo (o pídemelo y lo hago). Desde ese momento la página deja de guardar en
cada navegador: **todos ven lo mismo**.

---

## 5. La prueba de fuego

1. Entra a la página con tu cuenta de organizador y crea un torneo.
2. Entra desde otro navegador (o el celular), regístrate como jugador normal.
3. Billetera → Recargar → te lleva a Wompi.
4. Paga con una [tarjeta de prueba de Wompi](https://docs.wompi.co/docs/colombia/ambientes-y-llaves/)
   (`4242 4242 4242 4242`, cualquier fecha futura, CVC `123`).
5. Vuelves a la billetera: **el saldo debe aparecer solo**, sin que tú confirmes nada.

Si el saldo no aparece:

- Mira en Wompi → **Debugger**: ahí se ve si el aviso salió y qué respondió tu servidor.
- Mira los *Logs* de Render: si dice `Evento de Wompi rechazado: La firma no coincide`,
  el `WOMPI_EVENTOS` de Render no es el mismo que el de Wompi.
- Si el servicio está en plan gratuito puede estar dormido y el primer aviso
  llegar tarde. Wompi reintenta; el servidor está preparado para no acreditar
  dos veces.

---

## 6. Pasar a cobrar de verdad

Cuando la prueba funcione:

1. En Wompi, desactiva el modo de pruebas.
2. En Render → Environment, cambia `WOMPI_LLAVE_PUBLICA`, `WOMPI_INTEGRIDAD` y
   `WOMPI_EVENTOS` por los de producción. Guardar reinicia el servicio.
3. Si no lo has hecho, pasa el servicio a plan **Starter con disco**.
4. Vuelve a correr el verificador: debe decir **PRODUCCIÓN**.
5. Haz una recarga real pequeña, de $1.000, y compruébala.

---

## Mantenimiento

**Copias de seguridad.** La base de datos es un archivo. En Render → Shell:

```bash
sqlite3 /data/torneos.db ".backup '/data/respaldo-$(date +%F).db'"
```

Vale la pena hacerlo cada semana y bajarte una copia de vez en cuando. Son las
cuentas y el dinero de la gente.

**Si rotas las llaves de Wompi**, actualiza las variables en Render el mismo día:
mientras no coincidan, ninguna recarga se acredita.
