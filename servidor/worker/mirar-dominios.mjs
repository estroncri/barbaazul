#!/usr/bin/env node
/* ============================================================
   ¿Está libre este dominio?
   ------------------------------------------------------------
   Pregunta al registro oficial (RDAP, el sucesor del whois) en
   vez de adivinar. Un dominio que no contesta "existe" es un
   dominio que se puede comprar.

   Ojo: esto dice si está REGISTRADO, no si está en venta cara
   ni si alguien lo tiene reservado. Y libre hoy no es libre
   mañana: si uno te gusta, cómpralo el mismo día.

       node mirar-dominios.mjs torneosff.online arenaff.online
   ============================================================ */

const dominios = process.argv.slice(2).length
    ? process.argv.slice(2)
    : String(process.env.DOMINIOS || '').split(/[\s,]+/).filter(Boolean);

if (!dominios.length) {
    console.error('Dame dominios: node mirar-dominios.mjs torneosff.online');
    process.exit(1);
}

/* rdap.org nos contesta 403, así que se va a la fuente: la IANA publica qué
   registro manda en cada terminación, y a ese se le pregunta directo. */
let mapa = null;
async function baseDe(tld) {
    if (!mapa) {
        const r = await fetch('https://data.iana.org/rdap/dns.json', {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(15000)
        });
        mapa = await r.json();
    }
    for (const [tlds, bases] of mapa.services || []) {
        if (tlds.includes(tld)) return String(bases[0]).replace(/\/+$/, '');
    }
    return null;
}

const UA = 'TorneosFF/1.0 (comprobando dominios propios)';

async function mirar(dominio) {
    const tld = dominio.split('.').pop().toLowerCase();
    let base;
    try { base = await baseDe(tld); }
    catch (e) { return { duda: 'no se pudo leer la lista de la IANA: ' + e.message }; }
    if (!base) return { duda: `nadie publica registro para .${tld}` };

    try {
        const r = await fetch(`${base}/domain/${encodeURIComponent(dominio)}`, {
            headers: { Accept: 'application/rdap+json', 'User-Agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        });
        if (r.status === 404) return { libre: true };
        if (r.status === 200) {
            const d = await r.json().catch(() => ({}));
            const creado = (d.events || []).find((e) => e.eventAction === 'registration');
            return { libre: false, desde: creado ? String(creado.eventDate).slice(0, 10) : '' };
        }
        return { duda: `contestó ${r.status}` };
    } catch (e) {
        return { duda: e.message };
    }
}

console.log('');
for (const d of dominios) {
    const r = await mirar(d);
    const marca = r.libre ? '✔ LIBRE  ' : r.duda ? '? ' : '✘ ocupado';
    const nota = r.libre ? '' : r.duda ? r.duda : (r.desde ? `registrado desde ${r.desde}` : '');
    console.log(`  ${marca} ${d.padEnd(26)} ${nota}`);
}
console.log('\n  Libre = nadie lo ha registrado. Cómpralo el mismo día que lo decidas.\n');
