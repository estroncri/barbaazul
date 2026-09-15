# De la demo a una plataforma real

Este documento responde a la pregunta de fondo: **¿qué de todo esto se puede hacer de verdad?**
Respuesta corta: casi todo, pero tres cosas no funcionan como uno se las imagina.
Aquí está el detalle y el camino para armarlo.

---

## 1. "Iniciar sesión con la cuenta de Free Fire"

**Esto no existe.** Garena no ofrece un "Login con Free Fire" para plataformas de terceros
(no hay OAuth público, como sí lo hay con Google o Facebook), ni una API oficial para consultar
el perfil de un jugador. Todo lo que circula por ahí son APIs no oficiales que raspan datos:
se caen sin aviso, mienten y van en contra de los términos de servicio de Garena.

**Nunca** le pidas al jugador su contraseña de Free Fire ni su cuenta de Google/Facebook
vinculada. Aparte de ser peligroso, te convierte a ti en el responsable si le roban la cuenta.

### Lo que sí se puede hacer (es lo que implementa la demo)

1. El jugador escribe su **ID de Free Fire** (el número del perfil, que es público).
2. La plataforma le da un **código corto** (ej. `AZ-4821`).
3. El jugador pone ese código en su **biografía del juego** y manda una captura del perfil.
4. Un admin (o una revisión con OCR) confirma que el código y el ID coinciden → cuenta verificada.
5. La sesión en la plataforma es propia: ID de Free Fire + contraseña, o un código por WhatsApp.

Es el mismo método que usan las plataformas serias de torneos. Se hace una sola vez por jugador
y deja una cuenta confiable: el ID queda amarrado a una persona y a un número de WhatsApp.

**Extra de confianza:** exigir que el nick registrado sea idéntico al del juego durante la
partida, y guardar el historial de torneos, kills y pagos de cada jugador (la demo ya lo muestra
en el perfil). Eso es lo que hace que la gente confíe: un historial público, no un logo.

---

## 2. Cobrar y pagar dinero de verdad

Se puede, pero **el saldo jamás se puede calcular en el navegador** como en esta demo.
Todo movimiento de plata va en un servidor, en una base de datos, con registro de auditoría.

### Recargas (entrada de dinero)

Pasarelas que funcionan en Colombia y aceptan Nequi/PSE/tarjeta:

| Pasarela | Notas |
|----------|-------|
| **Wompi** (Bancolombia) | La más común para empezar. Links de pago, Nequi, PSE, tarjetas. Buena documentación. |
| **Bold** | Comisiones competitivas, cobro con link, buen soporte local. |
| **Mercado Pago** | Fácil de integrar, muy conocido por los usuarios. |
| **ePayco / PayU** | Alternativas con PSE y efectivo (Efecty, Baloto). |

Flujo correcto:

1. El jugador pide recargar → el **backend** crea la transacción (`pendiente`) y devuelve el link de pago.
2. El jugador paga en la pasarela.
3. La pasarela llama al **webhook** del backend con la confirmación firmada.
4. El backend verifica la firma, marca la transacción `completada` y acredita el saldo.

Reglas que no se negocian:
- El webhook es **idempotente** (si llega dos veces, no acredita dos veces).
- Se valida la firma del webhook; nunca se confía en lo que diga el navegador.
- El saldo se calcula sumando el **libro de movimientos**, no guardando un número suelto.

### Retiros (salida de dinero)

Aquí es donde la mayoría se complica: las pasarelas cobran, pero **dispersar** plata a terceros
es otro producto y pide más papeleo.

- **Al arrancar (recomendado):** retiros manuales. El jugador pide el retiro, queda en la cola
  del panel de administración, tú lo pagas por Nequi/Bancolombia desde el celular y lo marcas
  como pagado. La demo ya tiene ese panel, con el saldo reservado mientras tanto y devolución
  automática si se rechaza. Con 20–50 retiros a la semana esto se maneja sin problema.
- **Cuando crezca:** dispersión automática con Movii, Daviplata empresarial, la dispersión de
  Bancolombia o dLocal. Piden empresa constituida y verificación (KYC).

### Antifraude mínimo

- Retención de 24 horas en el primer retiro de cada cuenta nueva.
- Un solo ID de Free Fire y un solo WhatsApp por cuenta.
- Revisión manual si el monto es alto o la cuenta es reciente.
- Grabación obligatoria de la partida para reclamar un resultado.

---

## 3. WhatsApp

Dos cosas que conviene saber antes de diseñar el flujo:

- **Los grupos de WhatsApp no se manejan por API oficial.** La API en la nube (Cloud API) de
  Meta manda mensajes a personas, no a grupos. Los avisos al grupo se siguen publicando a mano
  (la demo genera el mensaje ya armado y abre WhatsApp con un clic).
- **Las encuestas no se pueden crear por API.** Se crean a mano en el grupo. Lo que sí se hace,
  y es lo que la demo implementa, es **guardar el resultado de la encuesta** en la plataforma
  para que quede publicado en el torneo: la gente ve que el modo salió de la votación real.

Lo que sí se puede automatizar con la **WhatsApp Cloud API** (gratis hasta cierto volumen):

- Mensaje al jugador cuando se confirma su inscripción.
- Envío del ID y contraseña de la sala 10 minutos antes.
- Aviso de "tu retiro fue pagado".
- Recordatorio del torneo unas horas antes.

Ojo: fuera de la ventana de 24 horas hay que usar **plantillas aprobadas** por Meta.
Alternativa más simple para empezar: [Twilio](https://www.twilio.com/whatsapp) o 360dialog.

---

## 4. Arquitectura sugerida

La opción más rápida y barata para una plataforma de este tamaño:

```
Frontend (lo que ya está)      →  GitHub Pages / Vercel
Backend + base de datos        →  Supabase (Postgres + Auth + Edge Functions)
Pagos                          →  Wompi o Bold (webhooks hacia Edge Functions)
Notificaciones                 →  WhatsApp Cloud API
Archivos (capturas)            →  Supabase Storage
```

Con Supabase se evita montar servidor: la base de datos, la autenticación y las funciones
vienen incluidas, y el plan gratis aguanta perfectamente los primeros meses.

### Tablas

```sql
usuarios(id, ff_uid UNIQUE, nick, nivel, whatsapp, email, rol, verificado, creado_en)
torneos(id, nombre, modo, fecha, cupo_max, costo, premio_total, distribucion jsonb,
        mapa, reglas jsonb, estado, sala_id, sala_pass, publicada, creado_en)
inscripciones(id, torneo_id, usuario_id, equipo_nombre, miembros jsonb, estado, creado_en,
              UNIQUE(torneo_id, usuario_id))
resultados(id, inscripcion_id, puesto, kills, puntos, premio, verificado_por)
movimientos(id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado_en)
retiros(id, usuario_id, movimiento_id, metodo, cuenta, estado, pagado_por, pagado_en)
```

El saldo es `SELECT SUM(monto) FROM movimientos WHERE usuario_id = ? AND estado = 'completada'`.
Nunca una columna que se edita a mano.

### Seguridad con RLS (Row Level Security)

- Un jugador solo lee sus propios movimientos y retiros.
- `sala_id` y `sala_pass` solo se entregan a quien tenga una inscripción confirmada en ese torneo.
- Crear torneos, publicar salas, cargar resultados y aprobar retiros: solo rol `admin`.
- Acreditar saldo: **solo** desde el webhook de la pasarela, nunca desde el cliente.

### Migrar el frontend

`js/store.js` ya está hecho para esto. Cada función se reemplaza por su llamada:

```js
// Hoy (demo)
inscribirse: async (torneoId, equipo) => { /* ...localStorage... */ }

// Mañana (real)
inscribirse: async (torneoId, equipo) => {
    const r = await fetch(`${API}/inscripciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ torneoId, equipo })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    return r.json();
}
```

El resto de la aplicación no cambia una línea.

---

## 5. Lo legal (breve, pero importante)

No es asesoría jurídica, es lo que hay que revisar antes de cobrar:

- **Torneo de habilidad, no juego de azar.** En Colombia los juegos de suerte y azar los regula
  Coljuegos. Un torneo de eSports donde gana el que mejor juega normalmente no cae ahí, pero la
  diferencia se sostiene con hechos: premio anunciado de antemano, reglas públicas, resultados
  verificables y cero componente de azar. Vale la pena consultarlo con un abogado antes de mover
  volúmenes serios.
- **Menores de edad.** Buena parte de la comunidad de Free Fire es menor. Pide autorización del
  acudiente para participar con dinero y para retirar.
- **Términos, condiciones y política de datos** publicados (la demo ya tiene la pantalla de Reglas).
- **Marcas.** "Free Fire" y "Garena" son de Garena. Se pueden nombrar para decir de qué son los
  torneos, pero no se pueden usar sus logos ni dar a entender que hay patrocinio. Por eso el pie
  de página aclara que no hay afiliación.
- **Facturación e impuestos** por la comisión que se queda la plataforma.

---

## 6. Por dónde empezar

**Fase 1 — Validar (ya está lista)**
La demo sirve tal cual para mostrar el torneo, las inscripciones y los resultados. Los cobros
se hacen por Nequi a mano y el admin carga todo en el panel. Cero costo, sirve para probar si
la gente responde.

**Fase 2 — Backend (1–2 semanas)**
Supabase con las tablas de arriba, cuentas reales, verificación por código, saldo en servidor.
Los retiros se siguen pagando a mano desde el panel.

**Fase 3 — Pagos automáticos (1 semana)**
Wompi o Bold para las recargas con su webhook. Aquí ya se necesita empresa o persona natural
con RUT.

**Fase 4 — Automatización**
WhatsApp Cloud API para inscripciones, sala y pagos. Rankings por temporada, torneos recurrentes,
sistema de puntos.

### Costo aproximado al arrancar

| Concepto | Costo |
|----------|-------|
| Hosting (GitHub Pages / Vercel) | $0 |
| Supabase (plan gratis) | $0 hasta ~50.000 filas |
| Dominio propio | ~$50.000 COP/año |
| Comisión de pasarela | ~2,9% + $900 por transacción |
| WhatsApp Cloud API | Gratis las primeras 1.000 conversaciones/mes |

Se puede arrancar prácticamente en cero y solo pagar comisión cuando entre plata.
