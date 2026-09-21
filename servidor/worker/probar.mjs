#!/usr/bin/env node
/* ============================================================
   Banco de pruebas del Worker
   ------------------------------------------------------------
   Ejecuta el Worker de verdad (src/index.js) contra un D1 de
   mentira construido sobre node:sqlite. Así se prueban las
   reglas de dinero sin desplegar nada ni gastar cuota.

       node servidor/worker/probar.mjs
   ============================================================ */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from './src/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(':memory:');
/* Todas las migraciones, en orden. Leerlas de la carpeta y no de una lista
   escrita a mano evita lo de siempre: añadir una tabla y que las pruebas
   sigan corriendo contra la base de antes. */
for (const archivo of readdirSync(join(aqui, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(aqui, 'migrations', archivo), 'utf8'));
}

/* D1 de mentira: mismas funciones que usa el Worker.
   batch() se ejecuta dentro de una transacción, igual que el D1 real. */
const D1 = {
    prepare(sql) {
        const stmt = { sql, args: [] };
        stmt.bind = (...a) => { stmt.args = a; return stmt; };
        stmt.first = async () => db.prepare(sql).get(...stmt.args) ?? null;
        stmt.all = async () => ({ results: db.prepare(sql).all(...stmt.args) });
        stmt.run = async () => {
            const r = db.prepare(sql).run(...stmt.args);
            return { meta: { changes: Number(r.changes) } };
        };
        return stmt;
    },
    async batch(stmts) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const salida = [];
            for (const s of stmts) salida.push(await s.run());
            db.exec('COMMIT');
            return salida;
        } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
};

const env = {
    DB: D1,
    ORIGENES: 'https://estroncri.github.io',
    WOMPI_LLAVE_PUBLICA: 'pub_test_ejemplo',
    WOMPI_INTEGRIDAD: 'integridad_de_prueba',
    WOMPI_EVENTOS: 'eventos_de_prueba'
};

const llamar = async (metodo, ruta, cuerpo, token) => {
    const r = await worker.fetch(new Request('https://x' + ruta, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }), env);
    return { estado: r.status, datos: await r.json() };
};

let fallos = 0;
const comprobar = (ok, texto, detalle) => {
    if (!ok) fallos++;
    console.log(`  ${ok ? '✔' : '✘'} ${texto}${detalle !== undefined ? ' — ' + detalle : ''}`);
};

const firmarEvento = async (tx, secreto = env.WOMPI_EVENTOS) => {
    const props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
    const c = { event: 'transaction.updated', data: { transaction: tx }, timestamp: 1789000000, signature: { properties: props, checksum: '' } };
    const v = props.map((p) => String(p.split('.').reduce((o, k) => o?.[k], c.data) ?? ''));
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(v.join('') + c.timestamp + secreto));
    c.signature.checksum = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return c;
};

console.log('\n── Worker de Cloudflare, sobre D1 ──\n');

/* Organizador */
const org = await llamar('POST', '/api/auth/registro', { ffUid: '1000000001', nick: 'ORG', whatsapp: '573000000000', pass: 'clave-larga', terminos: '2026-09-18' });
db.prepare("UPDATE usuarios SET rol='admin' WHERE ff_uid='1000000001'").run();
const tokOrg = org.datos.token;
comprobar(!!tokOrg, 'El organizador se registra y recibe sesión');

/* Un jugador normal no puede crear torneos */
const jug = await llamar('POST', '/api/auth/registro', { ffUid: '2148563097', nick: 'Jugador', whatsapp: '573001112233', pass: 'clave123', terminos: '2026-09-18' });
const tokJ = jug.datos.token;
const pirata = await llamar('POST', '/api/torneos', { nombre: 'Pirata', modo: 'solo', fecha: '2030-01-01T00:00:00Z' }, tokJ);
comprobar(pirata.estado === 403, 'Un jugador no puede crear torneos', 'HTTP ' + pirata.estado);

/* Torneo con las reglas reales */
const t = (await llamar('POST', '/api/torneos', {
    nombre: 'Copa', modo: 'solo', fecha: '2030-01-01T00:00:00Z', cupoMax: 2, costo: 5000
}, tokOrg)).datos;
comprobar(t.precioKill === 3000 && t.premioGanador === 10000 && t.minimo === 20,
    'Toma las reglas del modo Solo', `kill ${t.precioKill}, ganador ${t.premioGanador}, mínimo ${t.minimo}`);

/* Saldo: la recarga pendiente no acredita */
const rec = (await llamar('POST', '/api/recargas', { monto: 20000 }, tokJ)).datos;
const saldo = async (tok) => (await llamar('GET', '/api/yo', null, tok)).datos.saldo;
comprobar((await saldo(tokJ)) === 0, 'Una recarga sin pagar no suma al saldo');
comprobar(!!rec.checkout?.url, 'Se genera el enlace de pago de Wompi');

/* Evento falsificado */
const falso = await llamar('POST', '/api/wompi/eventos',
    await firmarEvento({ id: 'x', status: 'APPROVED', amount_in_cents: 2000000, reference: rec.movimiento.ref }, 'otro-secreto'));
comprobar(falso.estado === 401 && (await saldo(tokJ)) === 0, 'Un aviso de pago falsificado no acredita', 'HTTP ' + falso.estado);

/* Evento legítimo */
await llamar('POST', '/api/wompi/eventos',
    await firmarEvento({ id: 'y', status: 'APPROVED', amount_in_cents: 2000000, reference: rec.movimiento.ref }));
comprobar((await saldo(tokJ)) === 20000, 'El pago aprobado acredita el saldo', await saldo(tokJ));

/* El mismo evento otra vez */
await llamar('POST', '/api/wompi/eventos',
    await firmarEvento({ id: 'y', status: 'APPROVED', amount_in_cents: 2000000, reference: rec.movimiento.ref }));
comprobar((await saldo(tokJ)) === 20000, 'El mismo aviso repetido no acredita dos veces', await saldo(tokJ));

/* Inscripción */
await llamar('POST', `/api/torneos/${t.id}/inscripciones`, { equipo: { nombre: 'Yo', miembros: [{ nick: 'Jugador', uid: '2148563097' }] } }, tokJ);
comprobar((await saldo(tokJ)) === 15000, 'Inscribirse cobra el cupo', await saldo(tokJ));

/* Dos veces no */
const dosVeces = await llamar('POST', `/api/torneos/${t.id}/inscripciones`, { equipo: { nombre: 'Otra', miembros: [{ nick: 'x', uid: '1' }] } }, tokJ);
comprobar(dosVeces.estado === 400 && (await saldo(tokJ)) === 15000, 'No se puede inscribir dos veces', dosVeces.datos.error);

/* Sin saldo no entra */
const pobre = await llamar('POST', '/api/auth/registro', { ffUid: '3312778455', nick: 'Pobre', whatsapp: '573004445566', pass: 'clave123', terminos: '2026-09-18' });
const sinPlata = await llamar('POST', `/api/torneos/${t.id}/inscripciones`, { equipo: { nombre: 'Pobre', miembros: [{ nick: 'Pobre', uid: '3312778455' }] } }, pobre.datos.token);
comprobar(sinPlata.estado === 400 && /aldo/.test(sinPlata.datos.error), 'Sin saldo no se puede inscribir', sinPlata.datos.error);

/* La sala solo para inscritos */
await llamar('POST', `/api/torneos/${t.id}/sala`, { salaId: '99887766', pass: '1234' }, tokOrg);
const comoInscrito = (await llamar('GET', `/api/torneos/${t.id}`, null, tokJ)).datos;
const comoAjeno = (await llamar('GET', `/api/torneos/${t.id}`, null, pobre.datos.token)).datos;
comprobar(comoInscrito.sala.id === '99887766' && comoAjeno.sala.id === '',
    'La sala solo le llega al inscrito', `inscrito "${comoInscrito.sala.id}" / ajeno "${comoAjeno.sala.id}"`);

/* Premios por kill */
await llamar('POST', `/api/torneos/${t.id}/resultados`,
    { filas: [{ inscripcionId: comoInscrito.participantes[0].id, puesto: 1, kills: 7, puntos: 20 }] }, tokOrg);
comprobar((await saldo(tokJ)) === 15000 + 31000, 'Premio = 7 kills x 3.000 + 10.000 al ganador', await saldo(tokJ));

/* Corregir no regala dinero */
await llamar('POST', `/api/torneos/${t.id}/resultados`,
    { filas: [{ inscripcionId: comoInscrito.participantes[0].id, puesto: 1, kills: 2, puntos: 9 }] }, tokOrg);
comprobar((await saldo(tokJ)) === 15000 + 16000, 'Corregir descuenta el premio anterior', await saldo(tokJ));

/* Retiro: primero hay que verificar la cuenta (regla nueva) */
const pideVer = await llamar('POST', '/api/verificaciones', null, tokJ);
const colaVer = await llamar('GET', '/api/admin/verificaciones', null, tokOrg);
await llamar('POST', `/api/admin/verificaciones/${colaVer.datos[0].id}`, { aprobar: true }, tokOrg);
comprobar((await llamar('GET', '/api/yo', null, tokJ)).datos.verificado === true,
    'La cuenta queda verificada antes de poder retirar', pideVer.datos.codigo);

/* Retiro: no más de lo que hay */
const retiroGrande = await llamar('POST', '/api/retiros', { monto: 999999, metodo: 'Nequi', cuenta: '3001112233' }, tokJ);
comprobar(retiroGrande.estado === 400, 'No se puede retirar más de lo que hay', retiroGrande.datos.error);

const retiro = await llamar('POST', '/api/retiros', { monto: 20000, metodo: 'Nequi', cuenta: '3001112233' }, tokJ);
comprobar((await saldo(tokJ)) === 31000 - 20000, 'El retiro pendiente reserva el dinero', await saldo(tokJ));
await llamar('POST', `/api/admin/pendientes/${retiro.datos.id}`, { aprobar: false, nota: 'prueba' }, tokOrg);
comprobar((await saldo(tokJ)) === 31000, 'Al rechazarlo, el dinero vuelve', await saldo(tokJ));

/* Cancelar un torneo devuelve */
const t2 = (await llamar('POST', '/api/torneos', { nombre: 'Se cancela', modo: 'duo', fecha: '2030-02-01T00:00:00Z', cupoMax: 10, costo: 5000 }, tokOrg)).datos;
await llamar('POST', `/api/torneos/${t2.id}/inscripciones`, { equipo: { nombre: 'Duo', miembros: [{ nick: 'a', uid: '1' }, { nick: 'b', uid: '2' }] } }, tokJ);
const antes = await saldo(tokJ);
const can = await llamar('POST', `/api/torneos/${t2.id}/cancelar`, null, tokOrg);
comprobar((await saldo(tokJ)) === antes + 10000, 'Cancelar devuelve el cupo completo', `${antes} → ${await saldo(tokJ)}`);

/* ============================================================
   Eliminar un torneo — solo cuando ya no hay plata en juego
   ------------------------------------------------------------
   Borrar de verdad (no solo cancelar) tiene que estar cerrado
   mientras haya inscritos que pagaron: si no, se les borra la
   prueba de que el torneo existió sin devolverles nada.
   ============================================================ */

/* Con gente adentro y sin cancelar: no se deja */
const t2b = (await llamar('POST', '/api/torneos', { nombre: 'Con gente', modo: 'solo', fecha: '2030-02-05T00:00:00Z', cupoMax: 5, costo: 1000 }, tokOrg)).datos;
await llamar('POST', `/api/torneos/${t2b.id}/inscripciones`, { equipo: { nombre: 'x', miembros: [{ nick: 'x', uid: '1' }] } }, tokJ);
const noBorra = await llamar('DELETE', `/api/torneos/${t2b.id}`, null, tokOrg);
comprobar(noBorra.estado === 400, 'Con inscritos y sin cancelar, no se puede eliminar', noBorra.datos.error);
comprobar((await llamar('GET', `/api/torneos/${t2b.id}`, null, tokOrg)).estado === 200, 'Y el torneo sigue existiendo');

/* Ya cancelado (o sea, ya devolvió todo): sí se deja */
const borrado = await llamar('DELETE', `/api/torneos/${t2.id}`, null, tokOrg);
comprobar(borrado.estado === 200, 'Un torneo ya cancelado sí se puede eliminar', borrado.datos.error);
comprobar((await llamar('GET', `/api/torneos/${t2.id}`, null, tokOrg)).estado === 404, 'Y desaparece de verdad');

/* Sin inscritos, aunque nunca se haya cancelado: también se deja */
const vacio = (await llamar('POST', '/api/torneos', { nombre: 'Vacío', modo: 'solo', fecha: '2030-02-06T00:00:00Z', cupoMax: 5, costo: 1000 }, tokOrg)).datos;
const borraVacio = await llamar('DELETE', `/api/torneos/${vacio.id}`, null, tokOrg);
comprobar(borraVacio.estado === 200, 'Un torneo sin inscritos se puede eliminar sin cancelarlo antes');

/* Solo el organizador puede eliminar */
const t2c = (await llamar('POST', '/api/torneos', { nombre: 'Ajeno', modo: 'solo', fecha: '2030-02-07T00:00:00Z', cupoMax: 5, costo: 1000 }, tokOrg)).datos;
const noAdmin = await llamar('DELETE', `/api/torneos/${t2c.id}`, null, tokJ);
comprobar(noAdmin.estado === 403, 'Un jugador no puede eliminar torneos', noAdmin.datos.error);

/* Cupo lleno */
const t3 = (await llamar('POST', '/api/torneos', { nombre: 'Un cupo', modo: 'solo', fecha: '2030-03-01T00:00:00Z', cupoMax: 1, costo: 1000 }, tokOrg)).datos;
await llamar('POST', `/api/torneos/${t3.id}/inscripciones`, { equipo: { nombre: 'Primero', miembros: [{ nick: 'a', uid: '1' }] } }, tokJ);
const rec2 = (await llamar('POST', '/api/recargas', { monto: 5000 }, pobre.datos.token)).datos;
await llamar('POST', '/api/wompi/eventos', await firmarEvento({ id: 'z', status: 'APPROVED', amount_in_cents: 500000, reference: rec2.movimiento.ref }));
const tarde = await llamar('POST', `/api/torneos/${t3.id}/inscripciones`, { equipo: { nombre: 'Tarde', miembros: [{ nick: 'b', uid: '2' }] } }, pobre.datos.token);
comprobar(tarde.estado === 400 && (await saldo(pobre.datos.token)) === 5000,
    'Con el cupo lleno no entra nadie más y no se cobra', tarde.datos.error);

/* ============================================================
   Cuentas: intentos, recuperación y verificación
   ============================================================ */
console.log('\n── Seguridad de las cuentas ──\n');

/* Freno a la fuerza bruta */
let ultimo;
for (let i = 0; i < 6; i++) {
    ultimo = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'clave-mala-' + i });
}
comprobar(ultimo.estado === 429, 'Tras 5 intentos fallidos se bloquea', ultimo.datos.error);

const buenaPeroBloqueada = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'clave123' });
comprobar(buenaPeroBloqueada.estado === 429, 'Ni con la contraseña correcta entra mientras está bloqueado');

// Se levanta el bloqueo como si hubieran pasado los 15 minutos
db.prepare("UPDATE intentos SET bloqueado_hasta = NULL, fallos = 0").run();
const entra = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'clave123' });
comprobar(entra.estado === 200, 'Pasado el bloqueo, entra normal');
const tokJ2 = entra.datos.token;

/* Se le quita la verificación para probar la barrera del retiro */
db.prepare("UPDATE usuarios SET verificado = 0 WHERE ff_uid = '2148563097'").run();
db.prepare("DELETE FROM verificaciones").run();

/* Retirar exige cuenta verificada */
const retiroSinVerificar = await llamar('POST', '/api/retiros', { monto: 10000, metodo: 'Nequi', cuenta: '3001112233' }, tokJ2);
comprobar(retiroSinVerificar.estado === 400 && /verificar/i.test(retiroSinVerificar.datos.error),
    'Sin cuenta verificada no se puede retirar', retiroSinVerificar.datos.error);

/* Pedir verificación y que el organizador la apruebe */
const pide = await llamar('POST', '/api/verificaciones', null, tokJ2);
comprobar(pide.estado === 200 && /^FF-\d{4}$/.test(pide.datos.codigo), 'Se pide verificación y da un código', pide.datos.codigo);

const repetida = await llamar('POST', '/api/verificaciones', null, tokJ2);
comprobar(repetida.estado === 400, 'No se puede pedir dos veces seguidas');

const cola = await llamar('GET', '/api/admin/verificaciones', null, tokOrg);
comprobar(cola.datos.length === 1 && cola.datos[0].codigo === pide.datos.codigo,
    'Al organizador le llega la solicitud con el código');

const colaAjena = await llamar('GET', '/api/admin/verificaciones', null, tokJ2);
comprobar(colaAjena.estado === 403, 'Un jugador no puede ver la cola de verificaciones');

await llamar('POST', `/api/admin/verificaciones/${cola.datos[0].id}`, { aprobar: true }, tokOrg);
const yoVerificado = await llamar('GET', '/api/yo', null, tokJ2);
comprobar(yoVerificado.datos.verificado === true, 'Tras aprobar, la cuenta queda verificada');

const retiroAhora = await llamar('POST', '/api/retiros', { monto: 10000, metodo: 'Nequi', cuenta: '3001112233' }, tokJ2);
comprobar(retiroAhora.estado === 200, 'Ya verificado, el retiro se puede pedir');

/* Recuperar contraseña */
db.prepare("DELETE FROM intentos").run();
const rec1 = await llamar('POST', '/api/auth/recuperar', { usuario: '2148563097' });
const recInventada = await llamar('POST', '/api/auth/recuperar', { usuario: '9999999999' });
comprobar(rec1.datos.mensaje === recInventada.datos.mensaje,
    'Responde igual exista o no la cuenta (no delata quién está registrado)');

const colaRec = await llamar('GET', '/api/admin/recuperaciones', null, tokOrg);
comprobar(colaRec.datos.length === 1 && colaRec.datos[0].ffUid === '2148563097',
    'Al organizador le llega la solicitud con el WhatsApp del jugador', colaRec.datos[0]?.whatsapp);

const temporal = await llamar('POST', `/api/admin/recuperaciones/${colaRec.datos[0].id}`, { aprobar: true }, tokOrg);
comprobar(!!temporal.datos.temporal, 'Genera una contraseña temporal para pasarle por WhatsApp', temporal.datos.temporal);

const viejaYaNo = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'clave123' });
comprobar(viejaYaNo.estado === 401, 'La contraseña vieja deja de servir');

const conTemporal = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: temporal.datos.temporal });
comprobar(conTemporal.estado === 200 && conTemporal.datos.debeCambiar === true,
    'Entra con la temporal y se le exige cambiarla');

const cambio = await llamar('POST', '/api/auth/cambiar-pass', { nueva: 'mi-clave-nueva' }, conTemporal.datos.token);
comprobar(cambio.estado === 200, 'Puede poner su contraseña nueva sin saber la anterior');

const conNueva = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'mi-clave-nueva' });
comprobar(conNueva.estado === 200 && !conNueva.datos.debeCambiar, 'Entra con la nueva y ya no se le exige nada');

const cambioSinSaberla = await llamar('POST', '/api/auth/cambiar-pass', { nueva: 'otra-mas', actual: 'me-la-invento' }, conNueva.datos.token);
comprobar(cambioSinSaberla.estado === 400, 'Sin la temporal, cambiar la clave exige saber la anterior');


/* ============================================================
   Leer el perfil de una página web
   ------------------------------------------------------------
   Los servicios de perfiles que devolvían JSON dejaron de
   servir, así que el último recurso es leer la página pública
   que cualquiera abriría en el navegador. Estas pruebas cuidan
   que se lea lo correcto, incluidos los nicks con caracteres
   raros, que en Free Fire son la norma y no la excepción.
   ============================================================ */
console.log('\n── Leer el perfil de una página ──\n');

const { extraerDeHtml } = await import('./src/index.js');

/* Tal como llega de verdad: el nick lleva un espacio invisible y símbolos. */
const paginaReal = `<!DOCTYPE html><html><head>
<title>Nxlson\u3164ҳ̸INX (ID 1221001584): perfil de Free Fire | Free Fire Mania</title>
<meta property="og:title" content="Nxlson\u3164ҳ̸INX (ID 1221001584): perfil de Free Fire">
</head><body>
<h1>Perfil del Jugador Nxlson\u3164ҳ̸INX en Free Fire</h1>
<p>"Nxlson\u3164ҳ̸INX" es un jugador de Free Fire que tiene el ID (UID) 1221001584, su cuenta es de la
regi\u00f3n Estados Unidos, creada el 21 de julio de 2019, tiene nivel 70, con 8.544 me gusta.</p>
<span class="chip">Nivel 70</span><span class="chip">Regi\u00f3n: US</span><span class="chip">\u2665 8.544</span>
</body></html>`;

const p1 = extraerDeHtml(paginaReal, '1221001584', 'us');
comprobar(p1 && p1.basicInfo.nickname === 'Nxlson\u3164ҳ̸INX',
    'Saca el nick tal cual, con sus caracteres raros', p1 && p1.basicInfo.nickname);
comprobar(p1.basicInfo.level === 70, 'Saca el nivel', p1.basicInfo.level);
comprobar(p1.basicInfo.liked === 8544, 'Saca los me gusta', p1.basicInfo.liked);
comprobar(p1.basicInfo.region === 'us', 'Saca la región', p1.basicInfo.region);
comprobar(p1.basicInfo.accountId === '1221001584', 'Y el ID que se preguntó');

/* Los nicks con & o comillas no pueden salir escritos como los guarda el HTML */
const conEntidades = `<meta property="og:title" content="Ju&amp;n &#39;El Duro&#39; (ID 9999999999): perfil de Free Fire">`;
const p2 = extraerDeHtml(conEntidades, '9999999999', 'sac');
comprobar(p2.basicInfo.nickname === "Ju&n 'El Duro'", 'Devuelve el nick legible, no el del código HTML', p2.basicInfo.nickname);

/* Si la página cambia y ya no está el nick, hay que decir que no, no inventar */
comprobar(extraerDeHtml('<html><body>otra cosa</body></html>', '1', 'us') === null,
    'Si la página cambia, no se inventa un nick');
comprobar(extraerDeHtml('', '1', 'us') === null, 'Con la página vacía tampoco');

/* El título sin og:title también vale */
const soloTitulo = `<title>ELCOSTA (ID 123456789): perfil de Free Fire</title>`;
comprobar(extraerDeHtml(soloTitulo, '123456789', 'us').basicInfo.nickname === 'ELCOSTA',
    'Si no hay og:title, sirve el título de la pestaña');


/* ============================================================
   Jugadores sin compañero
   ------------------------------------------------------------
   Mucha gente no tiene con quién jugar un dúo. Ahora se puede
   entrar solo: se paga la parte de uno y la plataforma junta a
   los sueltos entre sí. Aquí se comprueba lo que cuesta dinero.
   ============================================================ */
console.log('\n── Jugadores sin compañero ──\n');

const duo = (await llamar('POST', '/api/torneos', {
    nombre: 'Dúo por kill', modo: 'duo', fecha: '2030-02-01T00:00:00Z', cupoMax: 2
}, tokOrg)).datos;
comprobar(duo.costo === 5000, 'El dúo cuesta 5.000 por jugador', duo.costo);

const conSaldo = async (ffUid, nick) => {
    const u = (await llamar('POST', '/api/auth/registro',
        { ffUid, nick, whatsapp: '573000000000', pass: 'clave123', terminos: '2026-09-18' })).datos;
    const r = (await llamar('POST', '/api/recargas', { monto: 20000 }, u.token)).datos;
    await llamar('POST', '/api/wompi/eventos',
        await firmarEvento({ id: 'p' + ffUid, status: 'APPROVED', amount_in_cents: 2000000, reference: r.movimiento.ref }));
    return u.token;
};

const tokA = await conSaldo('4100000001', 'SoloA');
const tokB = await conSaldo('4100000002', 'SoloB');

/* Se inscribe sin compañero: paga SU parte, no el equipo entero */
const solaA = await llamar('POST', `/api/torneos/${duo.id}/inscripciones`, {
    buscarCompanero: true,
    equipo: { nombre: 'SoloA', miembros: [{ nick: 'SoloA', uid: '4100000001' }] }
}, tokA);
comprobar(solaA.estado === 200, 'Se puede entrar a un dúo sin compañero', solaA.datos.error);
comprobar((await saldo(tokA)) === 15000, 'Paga solo su parte: 5.000, no 10.000', await saldo(tokA));
comprobar(solaA.datos.buscando === true, 'Queda marcado como que está buscando');

/* No vale colarse con un equipo a medias sin decirlo */
const aMedias = await llamar('POST', `/api/torneos/${duo.id}/inscripciones`, {
    equipo: { nombre: 'Tramposo', miembros: [{ nick: 'Tramposo', uid: '4100000009' }] }
}, tokB);
comprobar(aMedias.estado === 400, 'Un equipo incompleto sin avisar se rechaza', aMedias.datos.error);

/* Llega otro suelto: la plataforma los junta */
const solaB = await llamar('POST', `/api/torneos/${duo.id}/inscripciones`, {
    buscarCompanero: true,
    equipo: { nombre: 'SoloB', miembros: [{ nick: 'SoloB', uid: '4100000002' }] }
}, tokB);
comprobar(solaB.estado === 200, 'El segundo suelto también entra', solaB.datos.error);
comprobar((await saldo(tokB)) === 15000, 'Y también paga solo su parte', await saldo(tokB));

const verDuo = (await llamar('GET', `/api/torneos/${duo.id}`, null, tokA)).datos;
const deA = verDuo.participantes.find((p) => p.equipo.miembros[0].nick === 'SoloA');
const deB = verDuo.participantes.find((p) => p.equipo.miembros[0].nick === 'SoloB');
comprobar(deA.grupo === deB.grupo, 'Los dos sueltos quedan en el mismo equipo');
comprobar(!deA.buscando && !deB.buscando, 'Y ya ninguno está buscando');
comprobar(/SoloA \+ SoloB/.test(deA.equipo.nombre), 'El equipo se llama por sus dos jugadores', deA.equipo.nombre);
comprobar(verDuo.inscritos === 1 && verDuo.jugadores === 2,
    'Los dos ocupan UN cupo pero cuentan como dos jugadores',
    `${verDuo.inscritos} cupo(s), ${verDuo.jugadores} jugador(es)`);

/* El premio se reparte entre los dos, no se lo lleva el primero */
await llamar('POST', `/api/torneos/${duo.id}/sala`, { salaId: '111', pass: '222' }, tokOrg);
await llamar('POST', `/api/torneos/${duo.id}/resultados`,
    { filas: [{ inscripcionId: deA.id, puesto: 1, kills: 4, puntos: 10 }] }, tokOrg);

/* 4 kills x 3.000 + 15.000 al ganador = 27.000, a partes iguales */
comprobar((await saldo(tokA)) === 15000 + 13500, 'Al primero le toca la mitad del premio', await saldo(tokA));
comprobar((await saldo(tokB)) === 15000 + 13500, 'Y al compañero la otra mitad', await saldo(tokB));

/* El que se queda sin pareja decide: jugar solo, o que le devuelvan */
const duo2 = (await llamar('POST', '/api/torneos', {
    nombre: 'Dúo sin gente', modo: 'duo', fecha: '2030-03-01T00:00:00Z', cupoMax: 8
}, tokOrg)).datos;
const tokC = await conSaldo('4100000003', 'SoloC');
await llamar('POST', `/api/torneos/${duo2.id}/inscripciones`, {
    buscarCompanero: true, equipo: { nombre: 'SoloC', miembros: [{ nick: 'SoloC', uid: '4100000003' }] }
}, tokC);
comprobar((await saldo(tokC)) === 15000, 'Entra solo y paga su parte', await saldo(tokC));

const jugarSolo = await llamar('POST', `/api/torneos/${duo2.id}/jugar-solo`, null, tokC);
comprobar(jugarSolo.estado === 200, 'Puede decidir jugar solo igual');
const verDuo2 = (await llamar('GET', `/api/torneos/${duo2.id}`, null, tokC)).datos;
comprobar(verDuo2.participantes[0].buscando === false, 'Y deja de aparecer como que busca');

const yaNo = await llamar('POST', `/api/torneos/${duo2.id}/jugar-solo`, null, tokC);
comprobar(yaNo.estado === 400, 'No puede decidirlo dos veces', yaNo.datos.error);

/* O que le devuelvan lo suyo, que es solo lo suyo */
const tokD = await conSaldo('4100000004', 'SoloD');
await llamar('POST', `/api/torneos/${duo2.id}/inscripciones`, {
    buscarCompanero: true, equipo: { nombre: 'SoloD', miembros: [{ nick: 'SoloD', uid: '4100000004' }] }
}, tokD);
await llamar('DELETE', `/api/torneos/${duo2.id}/inscripciones`, null, tokD);
comprobar((await saldo(tokD)) === 20000, 'Cancelar le devuelve su parte, ni más ni menos', await saldo(tokD));


/* ============================================================
   Las contraseñas y el presupuesto de CPU
   ------------------------------------------------------------
   El plan gratuito de Cloudflare corta cada petición a los 10 ms
   de CPU. Con 210.000 vueltas de PBKDF2 (33 ms) nadie podía
   entrar: el servidor moría antes de contestar. Estas pruebas
   cuidan que no se vuelva a colar ese número.
   ============================================================ */
console.log('\n── Contraseñas ──\n');

const cripto = await import('./src/cripto.js');

const t0 = Date.now();
const nueva = await cripto.hashPass('una-clave-cualquiera', env);
const msHash = Date.now() - t0;
comprobar(msHash < 25, 'Calcular una contraseña cabe en el presupuesto de CPU', `${msHash} ms`);
comprobar(nueva.hash.startsWith('v2$'), 'La contraseña guardada dice con qué sistema se hizo');
comprobar(await cripto.verificarPass('una-clave-cualquiera', nueva.hash, nueva.sal, env),
    'La contraseña correcta se reconoce');
comprobar(!(await cripto.verificarPass('otra-clave', nueva.hash, nueva.sal, env)),
    'Una contraseña parecida no cuela');

/* La pimienta: sin ella, el hash robado de la base no sirve de nada */
const conPim = { ...env, PASS_PIMIENTA: 'la-pimienta-del-servidor' };
const guardado = await cripto.hashPass('clave-del-jugador', conPim);
comprobar(await cripto.verificarPass('clave-del-jugador', guardado.hash, guardado.sal, conPim),
    'Con la pimienta del servidor, la contraseña entra');
comprobar(!(await cripto.verificarPass('clave-del-jugador', guardado.hash, guardado.sal, env)),
    'Sin la pimienta, ni la contraseña buena vale');
comprobar(!(await cripto.verificarPass('clave-del-jugador', guardado.hash, guardado.sal,
    { ...env, PASS_PIMIENTA: 'otra-pimienta' })), 'Con otra pimienta, tampoco');

/* Una cuenta guardada con el sistema viejo tiene que poder entrar igual,
   y salir de ahí sola. */
const salVieja = cripto.aleatorio(16);
const hashViejo = await (async () => {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', enc.encode('clave-de-antes'), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salVieja), iterations: 210000, hash: 'SHA-256' }, k, 256);
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
})();

comprobar(cripto.esViejo(hashViejo), 'Se reconoce una contraseña guardada con el sistema viejo');
comprobar(await cripto.verificarPass('clave-de-antes', hashViejo, salVieja, env),
    'Una contraseña del sistema viejo sigue sirviendo');

db.prepare("UPDATE usuarios SET pass_hash = ?, pass_sal = ? WHERE ff_uid = '2148563097'")
    .run(hashViejo, salVieja);
const entraVieja = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'clave-de-antes' });
comprobar(entraVieja.estado === 200, 'Entra con la contraseña de antes del cambio');

const rehecha = db.prepare("SELECT pass_hash FROM usuarios WHERE ff_uid = '2148563097'").get();
comprobar(String(rehecha.pass_hash).startsWith('v2$'),
    'Al entrar, su contraseña queda guardada con el sistema nuevo');
const entraOtraVez = await llamar('POST', '/api/auth/login', { usuario: '2148563097', pass: 'clave-de-antes' });
comprobar(entraOtraVez.estado === 200, 'Y sigue entrando con la misma contraseña de siempre');

/* ============================================================
   Los mensajes para el grupo
   ------------------------------------------------------------
   Los escribe la plataforma para que el organizador no copie a
   mano la hora y el cupo al chat. Si salen mal, salen mal para
   todo el grupo a la vez, y nadie los revisa antes de pegarlos.
   ============================================================ */
console.log('\n── Mensajes para el grupo ──\n');

globalThis.window = globalThis;
new Function(readFileSync(join(aqui, '..', '..', 'js', 'mensajes.js'), 'utf8'))();
const MSG = globalThis.MensajesTorneo;

/* 8:00 p. m. en Colombia = 01:00 UTC del día siguiente. */
const torneoDuo = {
    nombre: 'Copa Prueba', modo: 'duo', fecha: '2026-09-20T01:00:00.000Z',
    cupoMax: 48, inscritos: 3, jugadores: 6, costo: 5000,
    precioKill: 3000, premioGanador: 15000, minimo: 5, mapa: 'Bermuda', estado: 'abierto'
};

const anuncio = MSG.para(torneoDuo, 'anuncio');

/* cupo_max cuenta equipos, no personas: un Dúo con cupo 48 son 48 dúos.
   Anunciarlo como "48 jugadores" es prometer la mitad de los cupos. */
comprobar(anuncio.includes('48 dúos'), 'El cupo de un Dúo se anuncia en dúos, no en jugadores');
comprobar(!anuncio.includes('48 jugadores'), 'Y no se cuela la palabra jugadores en el cupo');

/* La hora se fija a Bogotá: el organizador puede tener el portátil en otro
   huso, pero el torneo sigue siendo a las 8 de la noche en Colombia. */
comprobar(anuncio.includes('8:00 p. m.'), 'La hora sale en hora de Colombia', anuncio.match(/\d+:\d+ [ap]\. m\./)?.[0]);
comprobar(anuncio.includes('19 de septiembre'), 'Y con la fecha de Colombia, no la del UTC');

/* La hora en es-CO ya termina en punto: una frase que cierra con ella
   acababa en "p. m..". */
for (const m of MSG.lista(torneoDuo, { podio: [], jugaron: 0 })) {
    comprobar(!m.texto.includes('..'), `Sin puntos dobles en "${m.titulo}"`);
}

/* La sala se publica en la página, donde solo la ve quien pagó. Que ningún
   mensaje la lleve no es estética: en un grupo la ve cualquiera. */
const conSala = Object.assign({}, torneoDuo, { sala: { id: '987654321', pass: 'clave1', publicada: true } });
for (const m of MSG.lista(conSala, { podio: [], jugaron: 0 })) {
    comprobar(!m.texto.includes('987654321') && !m.texto.includes('clave1'),
        `"${m.titulo}" no lleva los datos de la sala`);
}
comprobar(MSG.para(conSala, 'recordatorio').includes('7:50 p. m.'),
    'El recordatorio dice a qué hora se libera la sala, no cuál es');

/* El mensaje que toca según el estado: el organizador con prisa no debería
   tener que elegir. */
comprobar(MSG.sugerido(torneoDuo) === 'faltan', 'Con 3 dúos de 5, lo que toca avisar es que faltan');
comprobar(MSG.sugerido({ ...torneoDuo, inscritos: 46, minimo: 5 }) === 'ultimos', 'Casi lleno: últimos cupos');
comprobar(MSG.sugerido({ ...torneoDuo, inscritos: 0 }) === 'anuncio', 'Recién creado: el anuncio');
comprobar(MSG.sugerido({ ...torneoDuo, estado: 'cancelado' }) === 'cancelado', 'Cancelado: el de la devolución');
comprobar(MSG.sugerido({ ...torneoDuo, estado: 'finalizado' }) === 'resultados', 'Finalizado: la tabla');

const tabla = MSG.para({ ...torneoDuo, estado: 'finalizado' }, 'resultados',
    { podio: [{ nombre: 'Uno + Dos', kills: 11, premio: 48000 }, { nombre: 'Tres + Cuatro', kills: 1, premio: 3000 }], jugaron: 44 });
comprobar(tabla.includes('🥇 Uno + Dos — 11 kills — $48.000'), 'El podio sale con kills y premio');
comprobar(tabla.includes('1 kill —'), 'Una sola kill se dice en singular');
comprobar(tabla.includes('los 44 que jugaron'), 'Y dice cuántos jugaron');

/* Cancelar es lo que más reclamos genera: el mensaje tiene que decir que la
   plata ya volvió, no que va a volver. */
const cancel = MSG.para({ ...torneoDuo, estado: 'cancelado' }, 'cancelado');
comprobar(cancel.includes('devolvió el cupo completo'), 'El de cancelado dice que la plata ya volvió');
comprobar(cancel.includes('mínimo de 5 dúos'), 'Y por qué no se jugó');

/* En Solo no hay compañero que buscar ni pareja que gane. */
const solo = MSG.para({ ...torneoDuo, modo: 'solo', premioGanador: 10000 }, 'anuncio');
comprobar(!solo.includes('Inscríbete solo'), 'En Solo no se ofrece buscar compañero');
comprobar(solo.includes('al ganador') && !solo.includes('a la pareja'), 'En Solo gana un jugador, no una pareja');
comprobar(MSG.para({ ...torneoDuo, modo: 'escuadra', premioGanador: 9000 }, 'anuncio').includes('al equipo ganador'),
    'En Escuadra gana un equipo');

/* Un torneo sin mapa no debe dejar un renglón vacío en la mitad del aviso. */
const sinMapa = MSG.para({ ...torneoDuo, mapa: '' }, 'anuncio');
comprobar(!/\n\n\n/.test(sinMapa) && !sinMapa.includes('🗺️'), 'Sin mapa, el aviso no deja el hueco');

/* ============================================================
   Lo que hay que poder enseñar cuando alguien reclame
   ------------------------------------------------------------
   Dos cosas que no son funciones sino constancia: qué aceptó
   el jugador al registrarse, y con qué se decidió su premio.
   Sin ellas, un reclamo se resuelve con la palabra de uno
   contra la del otro, y el que cobra es el que grita más.
   ============================================================ */
console.log('\n── Constancia ──\n');

const sinAceptar = await llamar('POST', '/api/auth/registro',
    { ffUid: '9000000001', nick: 'SinLeer', whatsapp: '573001110000', pass: 'clave123' });
comprobar(sinAceptar.estado === 400, 'No se puede crear cuenta sin aceptar las reglas', sinAceptar.estado);

const aceptando = await llamar('POST', '/api/auth/registro',
    { ffUid: '9000000002', nick: 'Leyo', whatsapp: '573001110001', pass: 'clave123', terminos: '2026-09-18' });
comprobar(aceptando.estado === 200, 'Aceptándolas sí');

const aceptacion = db.prepare("SELECT terminos, terminos_fecha FROM usuarios WHERE ff_uid = '9000000002'").get();
comprobar(aceptacion.terminos === '2026-09-18', 'Queda guardada la versión que aceptó', aceptacion.terminos);
comprobar(!!aceptacion.terminos_fecha, 'Y el día en que la aceptó', aceptacion.terminos_fecha);

/* La evidencia del marcador. Va con la tabla y no en un mensaje aparte:
   una captura que se manda por WhatsApp se pierde en la conversación. */
const tPrueba = (await llamar('POST', '/api/torneos', {
    nombre: 'Con evidencia', modo: 'solo', fecha: '2026-12-01T20:00:00.000Z', cupoMax: 10
}, tokOrg)).datos;

const conLink = await llamar('POST', `/api/torneos/${tPrueba.id}/resultados`,
    { filas: [], evidencia: 'https://drive.google.com/captura' }, tokOrg);
comprobar(conLink.estado === 200, 'Se puede guardar el enlace de la captura');
comprobar((await llamar('GET', `/api/torneos/${tPrueba.id}`)).datos.evidencia === 'https://drive.google.com/captura',
    'Y queda publicado con el torneo');

const feo = await llamar('POST', `/api/torneos/${tPrueba.id}/resultados`,
    { filas: [], evidencia: 'javascript:alert(1)' }, tokOrg);
comprobar(feo.estado === 400, 'Un enlace que no es https se rechaza', feo.estado);
comprobar((await llamar('GET', `/api/torneos/${tPrueba.id}`)).datos.evidencia === 'https://drive.google.com/captura',
    'Y el que ya estaba no se pierde por intentarlo');

/* ============================================================
   El nick que se lee de una página web
   ------------------------------------------------------------
   Cuando la cuenta no existe, freefiremania no devuelve un 404:
   devuelve su buscador. Dar por bueno ese título ponía a un
   jugador a llamarse "Buscador de Cuenta Free Fire por ID", y
   un nick que no coincide con el del juego descalifica al
   equipo sin devolución.
   ============================================================ */
console.log('\n── El nick leído de una página ──\n');

const bueno = extraerDeHtml('<title>ElNickDeVerdad (ID 6897985889) — Free Fire</title>', '6897985889', 'us');
comprobar(bueno?.basicInfo?.nickname === 'ElNickDeVerdad', 'De una página de cuenta sale el nick', bueno?.basicInfo?.nickname);

comprobar(extraerDeHtml('<title>Buscador de Cuenta Free Fire por ID: Consulta tu Perfil</title>', '6897985889', 'us') === null,
    'El buscador genérico no se da por cuenta encontrada');

comprobar(extraerDeHtml('<title>OtroJugador (ID 1111111111)</title>', '6897985889', 'us') === null,
    'La página de otra cuenta tampoco, aunque traiga nick');

comprobar(extraerDeHtml('<title>(ID 6897985889)</title>', '6897985889', 'us') === null,
    'Un título sin nick delante del ID no vale');

const conDosPuntos = extraerDeHtml('<title>Nick2 (ID: 6897985889)</title>', '6897985889', 'us');
comprobar(conDosPuntos?.basicInfo?.nickname === 'Nick2', 'Con "ID:" también se entiende', conDosPuntos?.basicInfo?.nickname);

const conMeta = extraerDeHtml(
    '<meta property="og:title" content="DelMeta (ID 6897985889)"><title>otra cosa</title>', '6897985889', 'us');
comprobar(conMeta?.basicInfo?.nickname === 'DelMeta', 'Se prefiere el og:title al title', conMeta?.basicInfo?.nickname);

console.log(fallos === 0 ? '\n  Todo correcto.\n' : `\n  ${fallos} prueba(s) fallaron.\n`);
process.exit(fallos ? 1 : 0);
