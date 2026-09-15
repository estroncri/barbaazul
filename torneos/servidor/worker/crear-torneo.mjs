#!/usr/bin/env node
/* ============================================================
   Torneos FF — Crear un torneo desde GitHub
   ------------------------------------------------------------
   Hace exactamente lo que harías tú desde el panel: entra con la
   cuenta de organizador y pide al servidor que cree el torneo.
   Nada de meter filas a mano en la base: pasa por las mismas
   comprobaciones que cualquier torneo.

   Lo lanza el propio GitHub (pestaña Actions → Crear torneo), así
   que la contraseña no sale de los Secrets.

   Los precios no se escriben aquí: si no se dicen, el servidor
   pone los de las reglas de cada modo (REGLAS-TORNEOS.md).
   ============================================================ */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/* La dirección del servidor sale del mismo sitio que usa la página, para que
   no haya dos verdades sobre dónde vive.

   Va aparte y sin tocar disco para poder probarla: este trozo ya ha fallado
   dos veces por lo mismo. config.js explica sus opciones con ejemplos que
   tienen la forma exacta de la opción de verdad, y se acaba leyendo el
   ejemplo. */
export function direccionDe(textoConfig) {
    const limpio = String(textoConfig)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')     // los ejemplos viven en los comentarios
        .replace(/^\s*\/\/.*$/gm, ' ');        // y el // de mitad de línea es el de https://

    const m = limpio.match(/api:\s*'([^']*)'/);
    if (!m || !m[1]) throw new Error('config.js no tiene dirección de servidor: está en modo local.');
    if (!/^https?:\/\//.test(m[1])) throw new Error(`config.js apunta a "${m[1]}", que no es una dirección.`);
    return m[1].replace(/\/api\/?$/, '');
}

/* Colombia no cambia de hora en todo el año, así que el desfase es fijo. */
export function cuando(fecha, hora) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw new Error('La fecha va como 2026-09-19.');
    if (!/^\d{2}:\d{2}$/.test(String(hora || ''))) throw new Error('La hora va como 20:00.');
    const iso = `${fecha}T${hora}:00-05:00`;
    if (Number.isNaN(Date.parse(iso))) throw new Error('Esa fecha y hora no existen.');
    return iso;
}

const servidor = () => (process.env.SERVIDOR
    ? process.env.SERVIDOR.replace(/\/$/, '')
    : direccionDe(readFileSync(join(AQUI, '..', '..', 'js', 'config.js'), 'utf8')));

/* Importado desde las pruebas solo se quieren las funciones de arriba: el
   torneo se crea únicamente cuando se ejecuta a propósito. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const ok = (t) => console.log(`  ✔ ${t}`);
    const API = servidor() + '/api';

    const pedir = async (ruta, cuerpo, token) => {
        const r = await fetch(API + ruta, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' },
                token ? { Authorization: 'Bearer ' + token } : {}),
            body: JSON.stringify(cuerpo)
        });
        const datos = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(datos.error || `El servidor contestó ${r.status}.`);
        return datos;
    };

    console.log(`\n▸ Creando el torneo en ${API}\n`);

    if (!process.env.ADMIN_FF_UID || !process.env.ADMIN_PASS) {
        throw new Error('Faltan ADMIN_FF_UID o ADMIN_PASS en los secretos.');
    }

    const sesion = await pedir('/auth/login', {
        usuario: process.env.ADMIN_FF_UID,
        pass: process.env.ADMIN_PASS
    });
    ok(`Dentro como ${sesion.usuario.nick}`);

    const torneo = await pedir('/torneos', {
        nombre: process.env.NOMBRE || 'Torneo Free Fire',
        modo: String(process.env.MODO || 'solo').toLowerCase(),
        fecha: cuando(process.env.FECHA, process.env.HORA || '20:00'),
        cupoMax: process.env.CUPO || undefined,
        mapa: process.env.MAPA || 'Bermuda',
        reglas: (process.env.REGLAS || '').split('\n').map((l) => l.trim()).filter(Boolean)
    }, sesion.token);

    ok(`Creado: ${torneo.nombre}`);

    const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
    const enColombia = new Date(torneo.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    console.log(`
──────────────────────────────────────────────────────────────
  ${torneo.nombre}

  Modo:        ${torneo.modo}
  Cuándo:      ${enColombia}
  Mapa:        ${torneo.mapa}
  Cupos:       ${torneo.cupoMax}
  Inscripción: ${pesos(torneo.costo)} por jugador
  Por kill:    ${pesos(torneo.precioKill)}
  Al ganador:  ${pesos(torneo.premioGanador)}
  Mínimo para que se juegue: ${torneo.minimo}

  Ya está visible para todo el mundo. Desde tu panel puedes
  cambiarle lo que quieras, incluso con gente ya inscrita.
──────────────────────────────────────────────────────────────
`);

    if (process.env.GITHUB_STEP_SUMMARY) {
        writeFileSync(process.env.GITHUB_STEP_SUMMARY,
            `## ${torneo.nombre}\n\n`
            + `- **Modo:** ${torneo.modo}\n`
            + `- **Cuándo:** ${enColombia}\n`
            + `- **Inscripción:** ${pesos(torneo.costo)} · **Por kill:** ${pesos(torneo.precioKill)}`
            + ` · **Ganador:** ${pesos(torneo.premioGanador)}\n`
            + `- **Cupos:** ${torneo.cupoMax} · **Mínimo:** ${torneo.minimo}\n`, { flag: 'a' });
    }
}
