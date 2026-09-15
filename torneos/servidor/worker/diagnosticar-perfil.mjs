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

/* Se prueba la región como la mandamos (mayúsculas) y también en
   minúsculas: si un proveedor cambió de criterio, el fallo se ve igual que
   "esa cuenta no existe" y se pierden horas buscando por el lado que no es. */
async function probar(etiqueta, url, region) {
    const r = await intentarPerfil(url, uid, region, env);
    console.log(`  ${r.ok ? '✔' : '·'} ${etiqueta.padEnd(28)} ${r.ok ? nick(r.datos) : r.porque}`);
    if (r.ok) encontrada++;
    return r.ok;
}

for (const [nombre, prov] of Object.entries(PROVEEDORES)) {
    if (!prov.porRegion) {
        await probar(`${nombre} (sin región)`, prov.url, '');
        continue;
    }
    for (const region of REGIONES) {
        if (await probar(`${nombre} ${region} (MAYÚS)`, prov.url, region)) break;
        /* La plantilla pone la región en mayúsculas; para probarla tal cual
           se escribe, se mete ya sustituida. */
        if (await probar(`${nombre} ${region} (minús)`, prov.url.replace('{region}', region), region)) break;
    }
}

/* Un servicio cualquiera que se quiera probar, sin tocar código:
   PLANTILLA='https://loquesea/info?uid={uid}&region={region}' */
if (process.env.PLANTILLA) {
    console.log('');
    for (const region of ['', ...REGIONES]) {
        if (await probar(`tuyo ${region || '(sin región)'}`, process.env.PLANTILLA, region)) break;
    }
}

console.log(encontrada
    ? `\n  La cuenta existe: ${encontrada} servicio(s) la encontraron.\n`
    : `\n  Ningún servicio conoce esa cuenta.\n`
      + `  Si TODAS las líneas dicen lo mismo, el problema no es el ID: es que\n`
      + `  los servicios ya no sirven. Prueba otro con PLANTILLA.\n`);
