# Dejar Torneos FF listo para cobrar de verdad

Lista para pasar de "funciona en pruebas" a "hay plata real adentro". El
orden importa: cada paso se comprueba antes de seguir al siguiente.

Lo que ya está hecho y no hay que tocar: el servidor publicado, la base de
datos, entrar con contraseña, la detección del nick por ID, las
inscripciones, el reparto de premios y los avisos de pago de Wompi.

---

## 1. El dominio

**Comprar.** Cualquier registrador sirve (Namecheap, GoDaddy, Hostinger).
Un `.online` anda por 1–3 USD el primer año y 20–30 USD al renovar: mira el
precio de **renovación**, no el de estreno, que es donde está la trampa.

**Apuntarlo a GitHub.** En el panel del registrador, en la zona de DNS:

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | estroncri.github.io |

**Decirle a GitHub cuál es.** En el repositorio: Settings → Pages → Custom
domain → escribes el dominio → Save. Marca *Enforce HTTPS* cuando se
active (tarda unos minutos en aparecer).

**Decirle al servidor cuál es.** Este es el paso que se olvida y rompe
todo: si el servidor no conoce la dirección nueva, el navegador bloquea las
peticiones por seguridad y el jugador ve la página pero no puede entrar ni
pagar. Se arregla con un secreto:

| Secreto | Valor |
|---------|-------|
| `SITIO` | La dirección completa de la página, sin barra al final |

Ejemplo: `https://torneosff.online` — o con la carpeta, si la página no
queda en la raíz: `https://torneosff.online/torneos`

Después, **Actions → Desplegar Torneos FF → Run workflow**. El despliegue
autoriza el dominio nuevo sin quitar el viejo, así que mientras el DNS
propaga (puede tardar horas) las dos direcciones funcionan.

---

## 2. Borrar lo de las pruebas — ANTES de tocar las llaves

El saldo de un jugador es la suma de sus movimientos, y los de las pruebas
valen lo mismo que los de verdad: la base de datos no sabe que Wompi estaba
en modo de pruebas cuando entraron.

Si pasas a producción sin limpiar, ese dinero inventado se puede **retirar
como plata real**, y tus cuentas dirán que le debes a alguien un dinero que
nunca entró.

**Actions → Limpiar datos de prueba → Run workflow**, y escribe `BORRAR` en
la casilla de confirmación. Borra torneos, inscripciones, resultados y
movimientos; deja las cuentas y sus contraseñas. Si también quieres borrar
las cuentas de prueba, pon `si` en la segunda casilla: la de organizador
nunca se toca.

Lo que borra no se recupera. Hazlo con calma y antes del paso siguiente.

---

## 3. Wompi en producción

Ahora mismo está en pruebas: los pagos van a Wompi pero no mueven dinero.
Para cobrar de verdad hay que cambiar **las tres llaves a la vez**.

En Wompi, con el interruptor de arriba en **producción**, en Desarrollo →
Programadores, copia y guarda como secretos de GitHub:

| Secreto | Dónde está |
|---------|------------|
| `WOMPI_LLAVE_PUBLICA` | Llaves del API → Llave pública (empieza por `pub_prod_`) |
| `WOMPI_INTEGRIDAD` | Secretos → Integridad |
| `WOMPI_EVENTOS` | Secretos → Eventos |

Las tres de la misma pantalla. Si se mezclan ambientes el despliegue se
planta y te dice cuál está desparejada: con la llave de producción se cobra
de verdad, pero con el secreto de eventos de pruebas ese cobro no se
acredita nunca — el jugador paga y se queda sin saldo.

**La URL de Eventos también es distinta en producción.** En esa misma
pantalla, en Seguimiento de transacciones:

```
https://torneos-ff.estroncri.workers.dev/api/wompi/eventos
```

Guardar, y lanzar el despliegue.

---

## 4. Tu WhatsApp

El número del organizador va en el secreto `ADMIN_WHATSAPP` (con indicativo,
sin espacios: `573192559674`). Es el número al que le llegan las solicitudes
de verificación y de recuperación de contraseña. Ya está puesto.

Lo otro es el WhatsApp de cara a los jugadores: el perfil de empresa, la
comunidad, los grupos y lo que va escrito en cada uno. Está todo listo para
copiar en [`WHATSAPP.md`](WHATSAPP.md). Cuando la comunidad exista, su enlace
de invitación va en `whatsappGrupo` dentro de `js/config.js`; mientras esté
vacío, el botón no sale en la página.

---

## 5. La prueba con plata de verdad

Antes de abrirlo a la gente, hazlo tú con un monto pequeño:

1. Recarga $10.000 con tu tarjeta o Nequi de verdad. El saldo tiene que
   aparecer solo, sin que toques nada.
2. Inscríbete a un torneo de prueba.
3. Cancela la inscripción: la plata vuelve a tu saldo.
4. Pide un retiro de ese dinero y págate a ti mismo desde tu Nequi.

Si los cuatro pasos salen, el circuito del dinero está cerrado.

---

## 6. Antes de que entre el primer jugador

- **Ten saldo en tu Nequi para pagar retiros.** El dinero de las
  inscripciones no llega a tu cuenta al instante: Wompi lo consolida y lo
  gira según su calendario. Si alguien gana y pide retirar el mismo día,
  tienes que poder pagarle de tu bolsillo mientras tanto.
- **Los retiros son manuales.** Te aparecen en el panel, en Pagos, con el
  número de cada quien. Tú transfieres y confirmas. Automatizarlo requiere
  activar *Pagos a Terceros* en Wompi.
- **Escribe tus reglas** en la página de Reglas: qué pasa si alguien se
  desconecta, si un nick no coincide, si no se llega al mínimo.
- **Menores de edad.** Vas a tener jugadores de 14 y 15 años pagando y
  cobrando. Piensa qué vas a hacer con eso antes de que pase, no después.
- **Coljuegos.** Cobrar por participar y repartir premios en dinero puede
  caer bajo la regulación de juegos de suerte y azar en Colombia. Un torneo
  de habilidad no es lo mismo que un juego de azar, pero la línea no la
  dibujo yo: si esto crece, consulta a alguien que sepa.

---

## Si algo se rompe

| Síntoma | Casi seguro es |
|---------|----------------|
| La página carga pero no deja entrar ni pagar | El servidor no conoce el dominio nuevo: revisa el secreto `SITIO` y relanza el despliegue |
| Se paga pero el saldo no entra | La URL de Eventos en Wompi, o las llaves mezcladas entre ambientes |
| El ID no trae el nick | Actions → Diagnosticar una cuenta. Te dice si es el ID o es el servicio |
| No sé si el servidor está bien | Cada despliegue corre 83 comprobaciones y siete pruebas contra el servidor publicado. Mira el resumen en Actions |
