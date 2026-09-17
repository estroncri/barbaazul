#!/usr/bin/env node
/* ============================================================
   Borrar lo que se hizo probando
   ------------------------------------------------------------
   El saldo de un jugador es la suma de sus movimientos. Los de
   las pruebas valen lo mismo que los de verdad: la base no sabe
   que Wompi estaba en modo de pruebas cuando entraron.

   Si se pasa a producción sin limpiar, ese saldo inventado se
   puede retirar como plata real. Por eso esto va antes de
   cambiar las llaves, no después.

   Borra: movimientos, inscripciones, resultados y torneos.
   Conserva: las cuentas, sus contraseñas y sus verificaciones.
   Con BORRAR_CUENTAS=si, también las cuentas menos la tuya.

   Lo lanza GitHub (Actions → Limpiar datos de prueba), que es
   quien tiene las llaves de Cloudflare.
   ============================================================ */

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const NOMBRE_BASE = 'torneos-ff';

if (String(process.env.CONFIRMAR || '').trim().toUpperCase() !== 'BORRAR') {
    console.error('\n  Para que esto corra hay que escribir BORRAR en la casilla de confirmación.');
    console.error('  Es a propósito: lo que borra no se puede recuperar.\n');
    process.exit(1);
}

function d1(sql) {
    const r = spawnSync('npx', ['wrangler', 'd1', 'execute', NOMBRE_BASE, '--remote', '--json', '--command', sql],
        { cwd: AQUI, encoding: 'utf8', env: process.env });
    const salida = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) { console.error(salida); throw new Error('Falló la consulta a la base.'); }
    try {
        const json = JSON.parse(salida.slice(salida.indexOf('[')));
        return json[0]?.results || [];
    } catch (e) { return []; }
}

const uno = (sql) => Object.values(d1(sql)[0] || {})[0] ?? 0;
const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

/* ---- Qué hay antes de tocar nada ---- */
console.log('\n▸ Lo que hay ahora en la base\n');

const antes = {
    torneos: uno('SELECT COUNT(*) FROM torneos'),
    inscripciones: uno('SELECT COUNT(*) FROM inscripciones'),
    movimientos: uno('SELECT COUNT(*) FROM movimientos'),
    cuentas: uno("SELECT COUNT(*) FROM usuarios WHERE rol != 'admin'"),
    saldos: uno(`SELECT COALESCE(SUM(monto),0) FROM movimientos
                 WHERE estado = 'completada' OR (estado = 'pendiente' AND monto < 0)`)
};

console.log(`  Torneos:            ${antes.torneos}`);
console.log(`  Inscripciones:      ${antes.inscripciones}`);
console.log(`  Movimientos:        ${antes.movimientos}`);
console.log(`  Cuentas (jugadores): ${antes.cuentas}`);
console.log(`  Saldo repartido:    ${pesos(antes.saldos)}   ← esto es lo que desaparece`);

/* ---- Borrar ---- */
console.log('\n▸ Borrando\n');

/* El orden importa aunque haya CASCADE: así se ve qué se fue en cada paso. */
d1('DELETE FROM resultados');
console.log('  ✔ Resultados');
d1('DELETE FROM inscripciones');
console.log('  ✔ Inscripciones');
d1('DELETE FROM torneos');
console.log('  ✔ Torneos');
d1('DELETE FROM movimientos');
console.log('  ✔ Movimientos: todos los saldos quedan en cero');

if (String(process.env.BORRAR_CUENTAS || '').toLowerCase() === 'si') {
    /* La del organizador no se toca: es con la que entras. */
    d1("DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE rol != 'admin')");
    d1("DELETE FROM recuperaciones WHERE usuario_id IN (SELECT id FROM usuarios WHERE rol != 'admin')");
    d1("DELETE FROM verificaciones WHERE usuario_id IN (SELECT id FROM usuarios WHERE rol != 'admin')");
    d1("DELETE FROM usuarios WHERE rol != 'admin'");
    console.log('  ✔ Cuentas de prueba (la de organizador se queda)');
}

d1('DELETE FROM intentos');
console.log('  ✔ Intentos fallidos de entrar');

/* ---- Cómo quedó ---- */
const despues = {
    torneos: uno('SELECT COUNT(*) FROM torneos'),
    movimientos: uno('SELECT COUNT(*) FROM movimientos'),
    cuentas: uno("SELECT COUNT(*) FROM usuarios WHERE rol != 'admin'"),
    admin: uno("SELECT COUNT(*) FROM usuarios WHERE rol = 'admin'")
};

console.log(`
──────────────────────────────────────────────────────────────
  Torneos:      ${despues.torneos}
  Movimientos:  ${despues.movimientos}
  Jugadores:    ${despues.cuentas}
  Organizador:  ${despues.admin}   ← tu cuenta sigue ahí

  Los saldos quedaron en cero. Ahora sí se pueden poner las
  llaves de producción sin que quede dinero inventado adentro.
──────────────────────────────────────────────────────────────
`);

if (!despues.admin) {
    console.error('  AVISO: no quedó ninguna cuenta de organizador. El próximo despliegue la vuelve a crear.');
}
