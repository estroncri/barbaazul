#!/usr/bin/env node
/* ============================================================
   El ciclo completo, en un navegador de verdad
   ------------------------------------------------------------
   Hace lo mismo que haría una persona: se registra, se inscribe
   con el nick del compañero traído por el ID, ve la sala cuando
   el organizador la publica, y cobra el premio.

   Las pruebas de probar.mjs miran el servidor por dentro. Esta
   mira lo que el jugador ve, que es donde aparecen los fallos
   que el servidor no nota.

   No va en el despliegue: necesita un navegador y tres cosas
   levantadas a mano. Para correrla:

     npm i playwright-core
     node servidor-local.mjs                 (con FF_API_URL)
     python3 -m http.server 8099             (desde torneos/)
     DB=ruta/al.db node probar-ciclo.mjs
   ============================================================ */

import { chromium } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
const WEB = 'http://localhost:8099';
const API = 'http://localhost:8791/api';
const db = new DatabaseSync(process.env.DB);
let fallos = 0;
const marca = (ok, t, d) => { if (!ok) fallos++; console.log(`  ${ok ? '✔' : '✘'} ${t}${d !== undefined ? ' — ' + d : ''}`); };

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function abrir() {
    const ctx = await nav.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('   [error página]', e.message));
    await p.addInitScript(`window.CONFIG_TORNEOS = { api: '${API}' };`);
    return p;
}

async function entrar(p, usuario, pass) {
    await p.goto(`${WEB}/#/entrar`, { waitUntil: 'networkidle' });
    await p.fill('#loginUser', usuario);
    await p.fill('#loginPass', pass);
    await p.click('#btnEntrar, button:has-text("Entrar")');
    await p.waitForTimeout(2500);
}

/* ---- El jugador se registra ---- */
const jugador = await abrir();
const miUid = '2' + String(Date.now()).slice(-9);
await jugador.goto(`${WEB}/#/registro`, { waitUntil: 'networkidle' });
await jugador.fill('#regUid', miUid);
await jugador.click('#btnBuscar');
await jugador.waitForSelector('#regPass, #btnManual', { timeout: 20000 });
const aMano = await jugador.$('#btnManual');
if (aMano) { await aMano.click(); await jugador.waitForSelector('#regPass'); }
marca(!aMano, 'El ID trae el perfil del juego al registrarse');
await jugador.fill('#regWa', '573001112233');
await jugador.fill('#regEmail', `${miUid}@example.com`);
await jugador.fill('#regPass', 'clave-larga-123');
await jugador.fill('#regPass2', 'clave-larga-123');
await jugador.click('#btnCrear');
await jugador.waitForSelector('#btnRecargar', { timeout: 20000 });
marca(true, 'La cuenta queda creada y entra a su billetera');

/* Saldo (la pasarela ya se probó aparte) */
const u = db.prepare('SELECT id FROM usuarios WHERE ff_uid = ?').get(miUid);
db.prepare(`INSERT INTO movimientos (id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado)
            VALUES (?,?,'recarga',50000,'completada','Prueba','','Recarga de prueba',datetime('now'))`).run('tx_' + miUid, u.id);

/* ---- Se inscribe con compañero detectado por el ID ---- */
await jugador.goto(`${WEB}/#/torneos`, { waitUntil: 'networkidle' });
await jugador.waitForTimeout(800);
await jugador.click('text=Copa de prueba');
await jugador.waitForSelector('#btnInscribir', { timeout: 15000 });
await jugador.click('#btnInscribir');
await jugador.waitForSelector('[data-uid="1"]', { timeout: 10000 });
await jugador.fill('#equipoNombre', 'LOS PROBADORES');
await jugador.fill('[data-uid="1"]', '2148563097');
await jugador.waitForFunction(() => document.querySelector('[data-nick="1"]').value.trim().length > 0, { timeout: 15000 });
const nickCompa = await jugador.inputValue('[data-nick="1"]');
marca(!!nickCompa, 'El nick del compañero se trae con el ID', nickCompa);

await jugador.click('#confirmarInsc');
await jugador.waitForTimeout(3000);
const trasInscribir = await jugador.textContent('#app');
marca(/Ya estás inscrito/.test(trasInscribir), 'Queda inscrito');
marca(/LOS PROBADORES/.test(trasInscribir), 'El equipo aparece en la lista de participantes');
const saldoTras = (await jugador.evaluate(() => fetch(window.CONFIG_TORNEOS.api + '/yo', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('torneos_ff_token') } }).then((r) => r.json()))).saldo;
marca(saldoTras === 40000, 'Le cobró los 10.000 del cupo de dúo', saldoTras);

/* ---- El organizador publica la sala ---- */
const org = await abrir();
await entrar(org, '1890109056', 'clave-de-prueba');
marca(/ADMIN|Panel|Organizador/i.test(await org.textContent('body')), 'El organizador entra a su panel');

const t = db.prepare("SELECT id FROM torneos WHERE nombre = 'Copa de prueba'").get();
await org.evaluate(async ({ id }) => {
    await fetch(window.CONFIG_TORNEOS.api + `/torneos/${id}/sala`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('torneos_ff_token') },
        body: JSON.stringify({ salaId: '55443322', pass: 'clave' })
    });
}, { id: t.id });

await jugador.reload();
await jugador.waitForTimeout(2500);
const conSala = await jugador.textContent('#app');
marca(/55443322/.test(conSala), 'Al inscrito le aparece el ID de la sala');

const curioso = await abrir();
await curioso.goto(`${WEB}/#/torneo/${t.id}`, { waitUntil: 'networkidle' });
await curioso.waitForTimeout(2000);
marca(!/55443322/.test(await curioso.textContent('#app')), 'Y a quien no está inscrito, no');

/* ---- Resultados y premio ---- */
const ins = db.prepare('SELECT id FROM inscripciones WHERE torneo_id = ?').get(t.id);
await org.evaluate(async ({ id, insId }) => {
    await fetch(window.CONFIG_TORNEOS.api + `/torneos/${id}/resultados`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('torneos_ff_token') },
        body: JSON.stringify({ filas: [{ inscripcionId: insId, puesto: 1, kills: 5, puntos: 20 }] })
    });
}, { id: t.id, insId: ins.id });

await jugador.reload();
await jugador.waitForTimeout(2500);
const saldoFinal = (await jugador.evaluate(() => fetch(window.CONFIG_TORNEOS.api + '/yo', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('torneos_ff_token') } }).then((r) => r.json()))).saldo;
/* 5 kills x 3.000 + 15.000 al ganador = 30.000 */
marca(saldoFinal === 40000 + 30000, 'El premio cae solo al saldo: 5 kills x 3.000 + 15.000', saldoFinal);

await jugador.goto(`${WEB}/#/billetera`, { waitUntil: 'networkidle' });
await jugador.waitForTimeout(2000);
const billetera = await jugador.textContent('#app');
marca(/30\.000/.test(billetera), 'Y el movimiento del premio se ve en la billetera');

await nav.close();
console.log(fallos === 0 ? '\n  Todo correcto.\n' : `\n  ${fallos} fallo(s).\n`);
process.exit(fallos ? 1 : 0);
