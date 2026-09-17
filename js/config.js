/* ============================================================
   Torneos FF — Configuración
   ------------------------------------------------------------
   Aquí se decide de dónde salen los datos.

   api: ''  →  MODO LOCAL. Cada navegador guarda lo suyo; sirve para
               mirar el diseño, no para correr un torneo de verdad.

   api: 'https://...'  →  MODO COMPARTIDO. Todos ven lo mismo: las
               inscripciones, el saldo y los resultados viven en el
               servidor. Es lo que hay que usar en producción.

   Para probar en tu computador:
       node servidor/worker/servidor-local.mjs
       api: 'http://localhost:8790/api'

   nombreEnWompi: el nombre con el que Wompi identifica al comercio. Si no
               es el mismo de la plataforma, el jugador se va a encontrar un
               cobro a nombre de un desconocido y va a pensar que lo
               estafaron. Poniéndolo aquí, se le avisa antes de que pague.
               Cuando Wompi cambie el nombre, se deja vacío y el aviso
               desaparece solo.
   ============================================================ */

// Object.assign y no una asignación directa: así se puede fijar la
// dirección desde fuera (una prueba, otro despliegue) sin editar este archivo.
window.CONFIG_TORNEOS = Object.assign({
    api: 'https://torneos-ff.estroncri.workers.dev/api',
    nombreEnWompi: 'obsidiancol'
}, window.CONFIG_TORNEOS || {});
