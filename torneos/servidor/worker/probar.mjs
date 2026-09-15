#!/usr/bin/env node
/* ============================================================
   Banco de pruebas del Worker
   ------------------------------------------------------------
   Ejecuta el Worker de verdad (src/index.js) contra un D1 de
   mentira construido sobre node:sqlite. Así se prueban las
   reglas de dinero sin desplegar nada ni gastar cuota.

       node torneos/servidor/worker/probar.mjs
   ============================================================ */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from './src/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(':memory:');
for (const archivo of ['0001_inicial.sql', '0002_cuentas.sql']) {
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
const org = await llamar('POST', '/api/auth/registro', { ffUid: '1000000001', nick: 'ORG', whatsapp: '573000000000', pass: 'clave-larga' });
db.prepare("UPDATE usuarios SET rol='admin' WHERE ff_uid='1000000001'").run();
const tokOrg = org.datos.token;
comprobar(!!tokOrg, 'El organizador se registra y recibe sesión');

/* Un jugador normal no puede crear torneos */
const jug = await llamar('POST', '/api/auth/registro', { ffUid: '2148563097', nick: 'Jugador', whatsapp: '573001112233', pass: 'clave123' });
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
const pobre = await llamar('POST', '/api/auth/registro', { ffUid: '3312778455', nick: 'Pobre', whatsapp: '573004445566', pass: 'clave123' });
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

console.log(fallos === 0 ? '\n  Todo correcto.\n' : `\n  ${fallos} prueba(s) fallaron.\n`);
process.exit(fallos ? 1 : 0);
