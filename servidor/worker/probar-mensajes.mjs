#!/usr/bin/env node
/* ============================================================
   Los mensajes del grupo, en un navegador de verdad
   ------------------------------------------------------------
   probar.mjs comprueba el texto que sale de mensajes.js. Esta
   comprueba lo otro: que el organizador llegue hasta él sin
   buscarlo. Crea un torneo desde el panel y mira que el aviso
   aparezca solo, con la hora y el cupo de ese torneo.

   No va en el despliegue: necesita un navegador y dos cosas
   levantadas a mano.

     npm i playwright-core
     DB_RUTA=/tmp/t.db node servidor-local.mjs
     python3 -m http.server 8099        (desde la raíz del repo)
     DB=/tmp/t.db node probar-mensajes.mjs
   ============================================================ */

import { chromium } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
const WEB = 'http://localhost:8099', API = 'http://localhost:8790/api';
const DB = process.env.DB;
let fallos = 0;
/* Chromium mete un espacio fino (U+202F) entre "p." y "m."; Node uno normal.
   La prueba compara texto, no tipografía. */
const llano = (x) => String(x).replace(/[\u00a0\u202f\u2009]/g, ' ');
const marca = (ok, t, d) => { if (!ok) fallos++; console.log(`  ${ok ? '✔' : '✘'} ${t}${d !== undefined ? ' — ' + d : ''}`); };

const nav = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
});

/* Con la zona de Colombia puesta: el organizador escribe "20:00" pensando en
   su hora, y el mensaje tiene que decir esa misma. */
const ctx = await nav.newContext({ timezoneId: 'America/Bogota', locale: 'es-CO' });
await ctx.route('**', (ruta) => (ruta.request().url().includes('localhost') ? ruta.continue() : ruta.abort()));
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  [error página]', e.message));
await p.addInitScript(`window.CONFIG_TORNEOS = { api: '${API}' };`);

const uid = '1' + String(Date.now()).slice(-9);
await p.goto(`${WEB}/#/entrar`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1000);
await p.evaluate(async ([api, u]) => {
    await fetch(api + '/auth/registro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ffUid: u, nick: 'ORG', whatsapp: '573192559674', pass: 'clave-larga-123' })
    });
}, [API, uid]);

const db = new DatabaseSync(DB);
db.prepare("UPDATE usuarios SET rol='admin' WHERE ff_uid=?").run(uid);
db.close();

await p.goto(`${WEB}/#/entrar`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);
await p.fill('#loginUser', uid);
await p.fill('#loginPass', 'clave-larga-123');
await p.click('button:has-text("Entrar")');
await p.waitForTimeout(2500);

await p.goto(`${WEB}/#/admin`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
const tabCrear = p.locator('.tab:has-text("Crear")');
if (await tabCrear.count()) { await tabCrear.first().click(); await p.waitForTimeout(800); }
marca(await p.locator('#cNombre').count() === 1, 'El formulario de crear torneo está ahí');

await p.fill('#cNombre', 'Copa Prueba');
await p.selectOption('#cModo', 'duo');
await p.waitForTimeout(500);
await p.fill('#cFecha', '2026-09-19T20:00');
await p.click('#btnCrearTorneo');
await p.waitForTimeout(3000);

marca(await p.locator('#modalBg').count() === 1, 'Al crear el torneo salen solos los mensajes');
const titulo = await p.locator('#modalBg .modal-head h3').textContent().catch(() => '');
marca(/Mensajes para el grupo/.test(titulo || ''), 'Con el título correcto', titulo);

const texto = await p.locator('.msg-texto').textContent();
console.log('\n----- lo que muestra -----\n' + texto + '\n--------------------------\n');
marca(/TORNEO ABIERTO — DÚO/.test(texto), 'Es el anuncio del torneo');
marca(llano(texto).includes('8:00 p. m.'), 'Con la hora que se escribió');
marca(texto.includes('19 de septiembre'), 'Y la fecha');
marca(texto.includes('dúos'), 'El cupo va en dúos');
marca(texto.includes('localhost:8099'), 'El enlace apunta al sitio donde corre la página');

const pestanas = await p.locator('#modalBg .msg-tabs .tab').count();
marca(pestanas === 6, 'Están las seis pestañas', pestanas);
await p.locator('#modalBg .msg-tabs .tab:has-text("Recordatorio")').click();
await p.waitForTimeout(400);
const rec = await p.locator('.msg-texto').textContent();
marca(llano(rec).includes('7:50 p. m.'), 'El recordatorio calcula solo la hora de la sala');

const href = await p.locator('.msg-abrir').getAttribute('href');
marca(/^https:\/\/wa\.me\/\?text=/.test(href || ''), 'El botón de WhatsApp lleva el mensaje');
marca(decodeURIComponent((href || '').split('text=')[1] || '').includes('7:50'),
    'Y lleva justo el que está en pantalla');

await p.keyboard.press('Escape');
await p.waitForTimeout(500);
await p.goto(`${WEB}/#/admin`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
const btn = p.locator('[data-mensajes]');
marca(await btn.count() >= 1, 'El botón Mensajes está en la tarjeta del torneo');
await btn.first().click();
await p.waitForTimeout(2000);
marca(await p.locator('.msg-texto').count() === 1, 'Y vuelve a abrirlos desde el panel');

/* La pestaña de WhatsApp del panel, que antes prometía un premio total
   que ya no se paga. */
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.locator('#adminTabs .tab:has-text("WhatsApp")').click();
await p.waitForTimeout(1800);
const enTab = await p.locator('#waCaja .msg-texto').textContent();
marca(/TORNEO ABIERTO/.test(enTab), 'La pestaña WhatsApp usa los mismos mensajes');
marca(!/Premio total/.test(enTab), 'Y ya no promete una bolsa de premios que no existe');
marca(await p.locator('#waCaja .msg-tabs .tab').count() === 6, 'Con las seis opciones también ahí');

await nav.close();
console.log(fallos === 0 ? '\n  Todo correcto.\n' : `\n  ${fallos} fallaron.\n`);
process.exit(fallos ? 1 : 0);
