#!/usr/bin/env node
/* ============================================================
   La constancia, en un navegador de verdad
   ------------------------------------------------------------
   Dos cosas que no se comprueban solas desde el servidor:

   Que el jugador no pueda crear la cuenta sin marcar que leyó
   las reglas, y que quede guardado qué versión aceptó y cuándo.

   Que el organizador pueda pegar el enlace de la captura del
   marcador al publicar la tabla, y que el jugador lo vea.

     npm i playwright-core
     DB_RUTA=/tmp/t.db node servidor-local.mjs
     python3 -m http.server 8099      (desde la raíz del repo)
     DB=/tmp/t.db node probar-constancia.mjs
   ============================================================ */

import { chromium } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
const WEB = 'http://localhost:8099', API = 'http://localhost:8790/api';
const DB = process.env.DB;
let fallos = 0;
const marca = (ok, t, d) => { if (!ok) fallos++; console.log(`  ${ok ? '✔' : '✘'} ${t}${d !== undefined ? ' — ' + d : ''}`); };

const nav = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const ctx = await nav.newContext({ timezoneId: 'America/Bogota', locale: 'es-CO' });
await ctx.route('**', (r) => (r.request().url().includes('localhost') ? r.continue() : r.abort()));
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  [error página]', e.message));
await p.addInitScript(`window.CONFIG_TORNEOS = { api: '${API}' };`);

/* ---- Registrarse desde la página, con la casilla ---- */
const uid = '2' + String(Date.now()).slice(-9);
await p.goto(`${WEB}/#/registro`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.fill('#regUid', uid);
await p.click('#btnBuscar');
await p.waitForTimeout(3500);

const aMano = await p.locator('#btnManual').count();
if (aMano) { await p.locator('#btnManual').click(); await p.waitForTimeout(800); }
const nickManual = await p.locator('#regNickManual').count();
if (nickManual) await p.fill('#regNickManual', 'PruebaHoy');

await p.fill('#regWa', '3016909344');
await p.fill('#regPass', 'clave-larga-123');
await p.fill('#regPass2', 'clave-larga-123');

marca(await p.locator('#regAcepto').count() === 1, 'La casilla de aceptar las reglas está ahí');

/* Sin marcarla, no deja */
await p.click('#btnCrear');
await p.waitForTimeout(1500);
const err = await p.locator('#regMsg2').textContent().catch(() => '');
marca(/aceptar las reglas/i.test(err || ''), 'Sin marcarla no crea la cuenta', (err || '').trim().slice(0, 50));

/* Marcándola, sí */
await p.check('#regAcepto');
await p.click('#btnCrear');
await p.waitForTimeout(3500);
const hash = await p.evaluate(() => location.hash);
marca(hash.includes('billetera'), 'Marcándola, la cuenta se crea', hash);

const db = new DatabaseSync(DB);
const fila = db.prepare('SELECT terminos, terminos_fecha FROM usuarios WHERE ff_uid = ?').get(uid);
marca(!!fila && !!fila.terminos, 'Y queda guardado qué versión aceptó', fila && fila.terminos);
marca(!!fila && !!fila.terminos_fecha, 'Con la fecha', fila && fila.terminos_fecha);

/* ---- La evidencia, desde el panel ---- */
db.prepare("UPDATE usuarios SET rol='admin' WHERE ff_uid=?").run(uid);
db.close();

await p.goto(`${WEB}/#/admin`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.locator('#adminTabs .tab:has-text("Crear")').click();
await p.waitForTimeout(800);
await p.fill('#cNombre', 'Torneo con evidencia');
await p.fill('#cFecha', '2026-09-19T20:00');
await p.click('#btnCrearTorneo');
await p.waitForTimeout(3000);
await p.keyboard.press('Escape');
await p.waitForTimeout(600);

/* Sin inscritos el modal de resultados no abre, así que metemos uno.
   El id del torneo sale de la base, igual que lo haría el panel. */
const db2 = new DatabaseSync(DB);
const tor = db2.prepare('SELECT id FROM torneos ORDER BY creado DESC LIMIT 1').get();
const usr = db2.prepare('SELECT id FROM usuarios WHERE ff_uid = ?').get(uid);
db2.prepare(`INSERT INTO inscripciones (id, torneo_id, usuario_id, equipo, miembros, grupo, estado, creado)
             VALUES ('i-prueba', ?, ?, 'Equipo', '[]', 'i-prueba', 'confirmada', ?)`)
    .run(tor.id, usr.id, new Date().toISOString());
db2.close();

await p.goto(`${WEB}/#/admin`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
await p.locator(`[data-result="${tor.id}"]`).click();
await p.waitForTimeout(1500);

const hayCampo = await p.locator('#resEvidencia').count();
marca(hayCampo === 1, 'El campo de la captura está en el modal de resultados');
if (hayCampo) {
    await p.fill('#resEvidencia', 'https://drive.google.com/mi-captura');
    await p.fill('[data-r-puesto="i-prueba"]', '1');
    await p.fill('[data-r-kills="i-prueba"]', '7');
    await p.click('#resOk');
    await p.waitForTimeout(3000);
    await p.goto(`${WEB}/#/torneo/${tor.id}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    const enlace = p.locator('a:has-text("Ver la captura del marcador")');
    marca(await enlace.count() === 1, 'Y el jugador ve la captura en el torneo');
    marca(await enlace.getAttribute('href') === 'https://drive.google.com/mi-captura',
        'Con el enlace que puso el organizador');
}
if (!hayCampo) {
    const t = await p.locator('#modalBg').textContent().catch(() => '(sin modal)');
    console.log('  modal dice:', (t || '').trim().slice(0, 160));
}

await nav.close();
console.log(fallos === 0 ? '\n  Todo correcto.\n' : `\n  ${fallos} fallaron.\n`);
process.exit(fallos ? 1 : 0);
