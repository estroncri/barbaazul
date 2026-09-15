#!/usr/bin/env node
/* ============================================================
   Torneos FF — Verificador del despliegue
   ------------------------------------------------------------
   Comprueba que el servidor quedó bien puesto en internet.

       node torneos/servidor/worker/verificar-despliegue.js https://torneos-ff.tu-usuario.workers.dev

   No pide ningún secreto: solo mira desde fuera, como lo haría
   cualquiera. Lo único que no puede comprobar solo es si el
   secreto de eventos coincide con el de Wompi; para eso está la
   última prueba, que hay que confirmar haciendo un pago real en
   modo de pruebas.
   ============================================================ */

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
    console.error('Falta la dirección. Ejemplo:\n  node verificar-despliegue.js https://torneos-ff.tu-usuario.workers.dev');
    process.exit(1);
}

const A = base.endsWith('/api') ? base : base + '/api';
const EN_LOCAL = /localhost|127\.0\.0\.1/.test(base);
let fallos = 0;

const marca = (ok, texto, detalle) => {
    if (!ok) fallos++;
    console.log(`  ${ok ? '✔' : '✘'} ${texto}${detalle ? ' — ' + detalle : ''}`);
};

async function pedir(ruta, op = {}) {
    const inicio = Date.now();
    const r = await fetch(A + ruta, {
        method: op.metodo || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, op.cabeceras || {}),
        body: op.cuerpo ? JSON.stringify(op.cuerpo) : undefined,
        signal: AbortSignal.timeout(30000)
    });
    let datos = null;
    try { datos = await r.json(); } catch (e) { /* puede no ser JSON */ }
    return { estado: r.status, datos, cabeceras: r.headers, ms: Date.now() - inicio };
}

(async () => {
    console.log(`\nRevisando ${A}\n`);

    /* 1. ¿Está vivo? */
    try {
        const s = await pedir('/salud');
        marca(s.estado === 200 && s.datos && s.datos.ok, 'El servidor responde', `${s.ms} ms`);
        if (s.ms > 15000) console.log('     (tardó bastante: si es plan gratuito, estaba dormido)');
    } catch (e) {
        marca(false, 'El servidor responde', e.message);
        console.log('\n  No se pudo conectar. Revisa que el despliegue esté activo.\n');
        process.exit(1);
    }

    /* 2. ¿La pasarela está configurada? */
    const p = await pedir('/pasarela');
    const wompiOk = p.datos && p.datos.wompi;
    if (EN_LOCAL && !wompiOk) {
        console.log('  · Wompi sin configurar — normal al probar en tu computador');
    } else {
        marca(wompiOk, 'Wompi configurado',
            wompiOk ? p.datos.llavePublica : 'faltan WOMPI_LLAVE_PUBLICA o WOMPI_INTEGRIDAD');
    }
    if (wompiOk) {
        const esPruebas = String(p.datos.llavePublica).startsWith('pub_test');
        console.log(`     Modo: ${esPruebas ? 'PRUEBAS (bien para empezar)' : 'PRODUCCIÓN — se cobra dinero real'}`);
    }

    /* 3. La dirección de eventos debe rechazar lo que no venga firmado */
    const falso = await pedir('/wompi/eventos', {
        metodo: 'POST',
        cuerpo: { event: 'transaction.updated', data: { transaction: { id: 'x', status: 'APPROVED', reference: 'TFF-inventada', amount_in_cents: 999999 } } }
    });
    marca(falso.estado === 401, 'Los avisos de pago sin firma se rechazan',
        falso.estado === 401 ? 'devuelve 401' : `devolvió ${falso.estado}: REVISA ESTO`);

    /* 4. Nadie sin sesión puede ver datos de nadie */
    const yo = await pedir('/yo');
    marca(yo.estado === 401, 'Sin sesión no se accede a datos de usuario');

    /* 5. Nadie de fuera puede crear torneos */
    const t = await pedir('/torneos', { metodo: 'POST', cuerpo: { nombre: 'pirata', modo: 'solo', fecha: '2030-01-01T00:00:00Z' } });
    marca(t.estado === 401 || t.estado === 403, 'Solo el organizador puede crear torneos');

    /* 6. CORS: tu página debe estar autorizada */
    const origenEsperado = EN_LOCAL ? 'http://localhost:8099' : 'https://estroncri.github.io';
    const cors = await pedir('/salud', { cabeceras: { Origin: origenEsperado } });
    const permitido = cors.cabeceras.get('access-control-allow-origin');
    marca(permitido === origenEsperado, `Tu página está autorizada (${origenEsperado})`,
        permitido || 'sin cabecera CORS');

    /* 7. Los torneos se leen sin necesidad de entrar */
    const lista = await pedir('/torneos');
    marca(lista.estado === 200 && Array.isArray(lista.datos),
        'La lista de torneos es pública', `${(lista.datos || []).length} torneo(s)`);

    if (fallos === 0 && EN_LOCAL) {
        console.log('\n  Todo en orden para trabajar en local.\n');
    } else if (fallos === 0) {
        console.log('\n  Todo en orden. Falta una sola cosa que solo se comprueba pagando:\n'
            + '  haz una recarga de prueba en Wompi y mira que el saldo aparezca solo.\n');
    } else {
        console.log(`\n  ${fallos} cosa(s) por revisar antes de cobrarle a nadie.\n`);
    }
    process.exit(fallos === 0 ? 0 : 1);
})();
