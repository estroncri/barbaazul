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
       node torneos/servidor/worker/servidor-local.mjs
       api: 'http://localhost:8790/api'
   ============================================================ */

// Object.assign y no una asignación directa: así se puede fijar la
// dirección desde fuera (una prueba, otro despliegue) sin editar este archivo.
window.CONFIG_TORNEOS = Object.assign({
    api: 'https://torneos-ff.estroncri.workers.dev/api'
}, window.CONFIG_TORNEOS || {});
