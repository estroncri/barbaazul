/* ============================================================
   Torneos FF — Capa de datos contra la API (store-api.js)
   ------------------------------------------------------------
   Mismas funciones que store.js, pero hablando con el servidor.
   Si config.js trae una dirección de API, este archivo reemplaza
   a window.Store y el resto de la aplicación no se entera.

   Nada de lo que importa se decide aquí: los cupos, el saldo y los
   permisos los comprueba el servidor. Esta capa solo pide y muestra.
   ============================================================ */

(function () {
    'use strict';

    const CFG = window.CONFIG_TORNEOS || {};
    if (!CFG.api) return;                    // sin API configurada, se queda el modo local

    const BASE = String(CFG.api).replace(/\/$/, '');
    const CLAVE_TOKEN = 'torneos_ff_token';
    const local = window.Store;              // para reutilizar formatos y constantes

    let token = null;
    try { token = localStorage.getItem(CLAVE_TOKEN); } catch (e) { token = null; }
    let yoCache = null;

    function guardarToken(t) {
        token = t;
        try { t ? localStorage.setItem(CLAVE_TOKEN, t) : localStorage.removeItem(CLAVE_TOKEN); }
        catch (e) { /* sin almacenamiento, la sesión dura lo que la pestaña */ }
    }

    async function pedir(ruta, opciones) {
        const op = opciones || {};
        const cabeceras = { 'Content-Type': 'application/json' };
        if (token) cabeceras.Authorization = 'Bearer ' + token;

        let r;
        try {
            r = await fetch(BASE + ruta, {
                method: op.metodo || 'GET',
                headers: cabeceras,
                body: op.cuerpo ? JSON.stringify(op.cuerpo) : undefined,
                signal: AbortSignal.timeout(15000)
            });
        } catch (e) {
            // Si el usuario cambió de pantalla, el navegador cancela la petición:
            // eso no es un fallo y no se le debe mostrar como tal.
            if (e.name === 'AbortError') {
                const cancelada = new Error('Petición cancelada.');
                cancelada.silencioso = true;
                throw cancelada;
            }
            throw new Error(e.name === 'TimeoutError'
                ? 'El servidor tardó demasiado. Intenta otra vez.'
                : 'No pudimos conectarnos con el servidor. Revisa tu internet.');
        }

        if (r.status === 401) {
            guardarToken(null);
            yoCache = null;
        }

        let datos = null;
        try { datos = await r.json(); } catch (e) { datos = null; }

        if (!r.ok) throw new Error((datos && datos.error) || `El servidor respondió ${r.status}.`);
        return datos;
    }

    async function refrescarYo() {
        if (!token) { yoCache = null; return null; }
        try { yoCache = await pedir('/yo'); }
        catch (e) { yoCache = null; }
        return yoCache;
    }

    const api = {
        modo: 'api',
        fmtCOP: local.fmtCOP,
        cupoPorModo: local.cupoPorModo,
        nombreModo: local.nombreModo,
        config: local.config,

        /* ---- Cuenta ---- */
        consultarPerfilFF: local.consultarPerfilFF,

        registrar: async (datos) => {
            const r = await pedir('/auth/registro', { metodo: 'POST', cuerpo: datos });
            guardarToken(r.token);
            yoCache = r.usuario;
            return r.usuario;
        },

        login: async (usuario, pass) => {
            const r = await pedir('/auth/login', { metodo: 'POST', cuerpo: { usuario, pass } });
            guardarToken(r.token);
            yoCache = r.usuario;
            return r.usuario;
        },

        logout: async () => {
            try { await pedir('/auth/logout', { metodo: 'POST' }); } catch (e) { /* da igual si falla */ }
            guardarToken(null);
            yoCache = null;
        },

        yo: () => yoCache,
        esAdmin: () => !!yoCache && yoCache.rol === 'admin',
        sesionLista: refrescarYo,

        actualizarPerfilFF: async () => {
            const yo = yoCache;
            if (!yo) throw new Error('Inicia sesión.');
            const p = await window.PerfilFF.consultar(yo.ffUid, yo.region, { sinCache: true });
            // Los datos del juego se guardan en el perfil local de la sesión;
            // el nick oficial solo cambia si vino del servicio de verdad.
            yoCache = Object.assign({}, yo, {
                perfil: p,
                nick: p.fuente === 'api' && p.nick ? p.nick : yo.nick,
                nivel: p.fuente === 'api' && p.nivel ? p.nivel : yo.nivel
            });
            return yoCache;
        },

        /* ---- Torneos ---- */
        torneos: () => pedir('/torneos'),
        torneo: (id) => pedir('/torneos/' + encodeURIComponent(id)),

        crearTorneo: (datos) => pedir('/torneos', {
            metodo: 'POST',
            cuerpo: Object.assign({}, datos, {
                reglas: typeof datos.reglas === 'string'
                    ? datos.reglas.split('\n').map((s) => s.trim()).filter(Boolean)
                    : (datos.reglas || [])
            })
        }),

        actualizarTorneo: (id, cambios) =>
            pedir('/torneos/' + encodeURIComponent(id), { metodo: 'PATCH', cuerpo: cambios }),

        publicarSala: (id, salaId, pass) =>
            pedir('/torneos/' + encodeURIComponent(id) + '/sala', { metodo: 'POST', cuerpo: { salaId, pass } }),

        guardarEncuesta: (id, encuesta) =>
            pedir('/torneos/' + encodeURIComponent(id), { metodo: 'PATCH', cuerpo: { encuesta } }),

        /* ---- Inscripciones ---- */
        inscribirse: async (torneoId, equipo) => {
            const r = await pedir('/torneos/' + encodeURIComponent(torneoId) + '/inscripciones',
                { metodo: 'POST', cuerpo: { equipo } });
            await refrescarYo();      // el cobro ya cambió el saldo
            return r;
        },

        cancelarInscripcion: async (torneoId) => {
            const r = await pedir('/torneos/' + encodeURIComponent(torneoId) + '/inscripciones', { metodo: 'DELETE' });
            await refrescarYo();
            return r;
        },

        misTorneos: () => pedir('/mis-torneos'),

        cancelarTorneo: (id) => pedir('/torneos/' + encodeURIComponent(id) + '/cancelar', { metodo: 'POST' }),

        registrarResultados: async (torneoId, filas) => {
            const r = await pedir('/torneos/' + encodeURIComponent(torneoId) + '/resultados',
                { metodo: 'POST', cuerpo: { filas } });
            await refrescarYo();
            return r;
        },

        /* ---- Billetera ---- */
        movimientos: () => pedir('/movimientos'),

        recargar: async (monto, metodo, ref) => {
            const r = await pedir('/recargas', { metodo: 'POST', cuerpo: { monto: Number(monto), metodo, ref } });
            await refrescarYo();
            return r;   // { movimiento, checkout? } — si hay checkout, el navegador va a la pasarela
        },

        pasarela: () => pedir('/pasarela'),

        solicitarRetiro: async (monto, metodo, cuenta) => {
            const r = await pedir('/retiros', { metodo: 'POST', cuerpo: { monto: Number(monto), metodo, cuenta } });
            await refrescarYo();
            return r;
        },

        /* ---- Panel ---- */
        pendientes: () => pedir('/admin/pendientes'),

        retirosPendientes: async () => (await pedir('/admin/pendientes')).filter((m) => m.tipo === 'retiro'),

        resolverPendiente: (id, aprobar, nota) =>
            pedir('/admin/pendientes/' + encodeURIComponent(id), { metodo: 'POST', cuerpo: { aprobar, nota } }),

        resolverRetiro: (id, aprobar, nota) =>
            pedir('/admin/pendientes/' + encodeURIComponent(id), { metodo: 'POST', cuerpo: { aprobar, nota } }),

        /* ---- Varios ---- */
        estadisticas: () => pedir('/estadisticas'),

        reiniciarDemo: async () => {
            throw new Error('Los datos viven en el servidor: no se reinician desde aquí.');
        },
        entrarComoDemo: async () => { throw new Error('Las cuentas de prueba solo existen en el modo local.'); },
        entrarComoAdmin: async () => { throw new Error('Las cuentas de prueba solo existen en el modo local.'); }
    };

    window.Store = api;
})();
