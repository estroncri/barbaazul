#!/usr/bin/env node
/* Ejecuta el Worker en tu computador, sobre SQLite, para probar la página
   completa sin desplegar nada:   node servidor-local.mjs            */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './src/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.DB_RUTA || ':memory:');
for (const m of ['0001_inicial.sql', '0002_cuentas.sql']) {
    try { db.exec(readFileSync(join(aqui, 'migrations', m), 'utf8')); } catch (e) { /* ya aplicada */ }
}

const D1 = {
    prepare(sql) {
        const s = { sql, args: [] };
        s.bind = (...a) => { s.args = a; return s; };
        s.first = async () => db.prepare(sql).get(...s.args) ?? null;
        s.all = async () => ({ results: db.prepare(sql).all(...s.args) });
        s.run = async () => ({ meta: { changes: Number(db.prepare(sql).run(...s.args).changes) } });
        return s;
    },
    async batch(stmts) {
        db.exec('BEGIN IMMEDIATE');
        try { const r = []; for (const s of stmts) r.push(await s.run()); db.exec('COMMIT'); return r; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
    }
};

const env = {
    DB: D1,
    ORIGENES: process.env.ORIGENES || 'http://localhost:8099,http://127.0.0.1:8099',
    WOMPI_LLAVE_PUBLICA: process.env.WOMPI_LLAVE_PUBLICA || '',
    WOMPI_INTEGRIDAD: process.env.WOMPI_INTEGRIDAD || '',
    WOMPI_EVENTOS: process.env.WOMPI_EVENTOS || '',
    FF_API_URL: process.env.FF_API_URL || '',
    FF_PROVEEDOR: process.env.FF_PROVEEDOR || '',
    FF_API_KEY: process.env.FF_API_KEY || ''
};

/* En Cloudflare existe caches.default; en Node no. Se simula en memoria
   para que el mismo código corra igual aquí. */
if (typeof globalThis.caches === 'undefined') {
    const memoria = new Map();
    globalThis.caches = {
        default: {
            async match(req) {
                const g = memoria.get(req.url);
                if (!g || g.hasta < Date.now()) return undefined;
                return new Response(g.cuerpo, { headers: { 'Content-Type': 'application/json' } });
            },
            async put(req, res) {
                memoria.set(req.url, { cuerpo: await res.text(), hasta: Date.now() + 300000 });
            }
        }
    };
}

/* Para trabajar en local: asciende a organizador el ID que se indique.
   En producción esto lo hace crear-organizador.mjs contra la base real. */
if (process.env.ADMIN_FF_UID) {
    try {
        db.prepare("UPDATE usuarios SET rol='admin' WHERE ff_uid = ?").run(process.env.ADMIN_FF_UID);
    } catch (e) { /* aún no existe; se asciende al reiniciar */ }
    setInterval(() => {
        try { db.prepare("UPDATE usuarios SET rol='admin' WHERE ff_uid = ?").run(process.env.ADMIN_FF_UID); }
        catch (e) { /* nada */ }
    }, 1000);
}

const PUERTO = Number(process.env.PUERTO || 8790);
createServer(async (req, res) => {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const r = await worker.fetch(new Request('http://local' + req.url, {
        method: req.method,
        headers: req.headers,
        body: trozos.length ? Buffer.concat(trozos) : undefined
    }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
}).listen(PUERTO, () => console.log(`Worker local en http://localhost:${PUERTO}/api`));
