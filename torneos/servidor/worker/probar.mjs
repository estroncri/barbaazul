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
db.exec(readFileSync(join(aqui, 'migrations/0001_inicial.sql'), 'utf8'));

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

console.log(fallos === 0 ? '\n  Todo correcto.\n' : `\n  ${fallos} prueba(s) fallaron.\n`);
process.exit(fallos ? 1 : 0);
