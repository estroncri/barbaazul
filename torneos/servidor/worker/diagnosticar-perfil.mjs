#!/usr/bin/env node
/* ============================================================
   ¿Por qué no detecta esta cuenta?
   ------------------------------------------------------------
   Pregunta por un ID a TODOS los servicios de perfiles y en
   TODAS las regiones, y enseña qué contestó cada uno. El
   servidor se para en el primero que acierta; esto no, para
   poder ver el cuadro completo.

       node diagnosticar-perfil.mjs 122100184

   Lo lanza GitHub (Actions → Diagnosticar una cuenta), porque
   desde aquí hay salida a internet y desde tu casa quizá no.
   ============================================================ */

import { PROVEEDORES, REGIONES, intentarPerfil } from './src/index.js';

const uid = String(process.argv[2] || process.env.UID_FF || '').replace(/\D/g, '');
if (!/^\d{6,14}$/.test(uid)) {
    console.error('Dame un ID de Free Fire: node diagnosticar-perfil.mjs 122100184');
    process.exit(1);
}

const env = { FF_API_KEY: process.env.FF_API_KEY || '' };
const nick = (d) => {
    const b = (d && (d.basicInfo || d.account || d.AccountInfo || d.data?.basicInfo)) || d || {};
    return b.nickname || b.nickName || b.nick || b.name || d?.nickname || '(sin nick)';
};

console.log(`\n▸ Buscando la cuenta ${uid}\n`);
let encontrada = 0;

for (const [nombre, prov] of Object.entries(PROVEEDORES)) {
    if (!prov.porRegion) {
        const r = await intentarPerfil(prov.url, uid, '', env);
        console.log(`  ${r.ok ? '✔' : '·'} ${nombre.padEnd(6)} (sin región)  ${r.ok ? nick(r.datos) : r.porque}`);
        if (r.ok) encontrada++;
        continue;
    }
    for (const region of REGIONES) {
        const r = await intentarPerfil(prov.url, uid, region, env);
        console.log(`  ${r.ok ? '✔' : '·'} ${nombre.padEnd(6)} ${region.padEnd(12)} ${r.ok ? nick(r.datos) : r.porque}`);
        if (r.ok) encontrada++;
    }
}

console.log(encontrada
    ? `\n  La cuenta existe: ${encontrada} servicio(s) la encontraron.\n`
    : `\n  Ningún servicio conoce esa cuenta. O el ID está mal, o los servicios\n`
      + `  están caídos: si todas las líneas dicen lo mismo (un 502, o que no\n`
      + `  respondieron), es lo segundo.\n`);
