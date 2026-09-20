#!/usr/bin/env node
/* ============================================================
   Comprobar que la copia sirve
   ------------------------------------------------------------
   Una copia que nadie ha restaurado nunca no es una copia: es
   un archivo. Esto la restaura de verdad, en una base en
   memoria, y mira que esté lo que tiene que estar.

   Si esto pasa, ese .sql se puede devolver a Cloudflare con
   wrangler d1 execute --file y la plataforma vuelve.

       node comprobar-copia.mjs copia.sql
   ============================================================ */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync } from 'node:fs';

const archivo = process.argv[2] || 'copia.sql';

/* Las tablas sin las que la plataforma no es la plataforma. */
const TABLAS = ['usuarios', 'sesiones', 'torneos', 'inscripciones',
                'resultados', 'movimientos', 'verificaciones',
                'recuperaciones', 'intentos'];

let fallos = 0;
const comprobar = (ok, texto, detalle) => {
    if (!ok) fallos++;
    console.log(`  ${ok ? '✔' : '✘'} ${texto}${detalle !== undefined ? ' — ' + detalle : ''}`);
};

const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

console.log('\n▸ Comprobando la copia\n');

const tam = statSync(archivo).size;
comprobar(tam > 500, 'El archivo tiene contenido', `${(tam / 1024).toFixed(1)} KB`);

const sql = readFileSync(archivo, 'utf8');

/* Restaurarla de verdad. Si esto revienta, la copia no sirve, y es mejor
   enterarse hoy que el día que haga falta. */
const db = new DatabaseSync(':memory:');
try {
    db.exec(sql);
    comprobar(true, 'La copia se restaura sin errores');
} catch (e) {
    comprobar(false, 'La copia se restaura sin errores', e.message);
    console.error('\n  Esa copia NO se puede restaurar. Revisa la corrida.\n');
    process.exit(1);
}

const hay = (t) => {
    try { return db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
    catch (e) { return null; }
};

console.log('');
for (const t of TABLAS) {
    const n = hay(t);
    comprobar(n !== null, `Está la tabla ${t}`, n === null ? 'no aparece' : `${n} fila(s)`);
}

/* El libro del dinero, que es lo que de verdad se está protegiendo. */
const saldos = (() => {
    try {
        return db.prepare(`SELECT COALESCE(SUM(monto),0) AS n FROM movimientos
                           WHERE estado = 'completada' OR (estado = 'pendiente' AND monto < 0)`).get().n;
    } catch (e) { return null; }
})();

const jugadores = hay('usuarios');
const admins = (() => {
    try { return db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin'").get().n; }
    catch (e) { return 0; }
})();

console.log('');
comprobar(admins > 0, 'Hay cuenta de organizador dentro', `${admins}`);
comprobar(saldos !== null, 'Se puede leer el libro del dinero',
    saldos === null ? 'no' : `${pesos(saldos)} repartidos entre ${jugadores} cuenta(s)`);

console.log(fallos === 0
    ? `\n  La copia sirve. Si hoy se pierde la base, con este archivo vuelve todo.\n`
    : `\n  ${fallos} problema(s) con la copia. No confíes en ella.\n`);

process.exit(fallos ? 1 : 0);
