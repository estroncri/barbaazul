/* ============================================================
   Torneos FF (Cloudflare) — Wompi
   ------------------------------------------------------------
   Mismo comportamiento que la versión de Node, con WebCrypto.
   Los secretos llegan por env (wrangler secret put) y nunca
   salen del servidor.
   ============================================================ */

import { sha256, iguales } from './cripto.js';

export const configurado = (env) => !!(env.WOMPI_LLAVE_PUBLICA && env.WOMPI_INTEGRIDAD);

export const referenciaDe = (movimientoId) => 'TFF-' + movimientoId;

/* Firma de integridad: SHA256(referencia + centavos + moneda + secreto) */
export async function checkout(env, referencia, pesos, cliente) {
    if (!configurado(env)) return null;
    const centavos = Math.round(pesos) * 100;
    const moneda = 'COP';
    const firma = await sha256(`${referencia}${centavos}${moneda}${env.WOMPI_INTEGRIDAD}`);

    const params = new URLSearchParams({
        'public-key': env.WOMPI_LLAVE_PUBLICA,
        'currency': moneda,
        'amount-in-cents': String(centavos),
        'reference': referencia,
        'signature:integrity': firma
    });
    if (env.WOMPI_REDIRECT) params.set('redirect-url', env.WOMPI_REDIRECT);
    if (cliente?.email) params.set('customer-data:email', cliente.email);
    if (cliente?.telefono) {
        params.set('customer-data:phone-number', cliente.telefono);
        params.set('customer-data:phone-number-prefix', '+57');
    }
    if (cliente?.nombre) params.set('customer-data:full-name', cliente.nombre);

    const base = env.WOMPI_CHECKOUT || 'https://checkout.wompi.co/p/';
    return { url: base + '?' + params.toString(), referencia, centavos, moneda, llavePublica: env.WOMPI_LLAVE_PUBLICA, firma };
}

/* El aviso de pago lo puede enviar cualquiera que conozca la dirección.
   Se comprueba la firma antes de mirar siquiera qué dice. */
export async function eventoValido(env, cuerpo) {
    if (!env.WOMPI_EVENTOS) return { ok: false, razon: 'El servidor no tiene configurado WOMPI_EVENTOS.' };
    if (!cuerpo?.signature?.properties || !Array.isArray(cuerpo.signature.properties)) {
        return { ok: false, razon: 'El evento no trae firma.' };
    }
    const valores = cuerpo.signature.properties.map((ruta) =>
        String(ruta.split('.').reduce((o, k) => (o == null ? o : o[k]), cuerpo.data) ?? ''));

    const calculado = await sha256(valores.join('') + String(cuerpo.timestamp ?? '') + env.WOMPI_EVENTOS);
    return iguales(calculado, String(cuerpo.signature.checksum || '').toLowerCase())
        ? { ok: true }
        : { ok: false, razon: 'La firma del evento no coincide.' };
}
