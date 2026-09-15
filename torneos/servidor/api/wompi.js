/* ============================================================
   Torneos FF — Integración con Wompi
   ------------------------------------------------------------
   Dos piezas:

   1) FIRMA DE INTEGRIDAD para abrir el checkout. Se calcula con el
      "secreto de integridad", que NUNCA puede estar en el navegador:
      quien lo tenga puede firmar cobros a tu nombre. Por eso se firma
      aquí y al navegador solo le llega la firma ya hecha.

   2) VERIFICACIÓN DE EVENTOS. Cuando alguien paga, Wompi llama a tu
      URL de eventos. Esa llamada la puede falsificar cualquiera que
      sepa la dirección, así que se comprueba la firma con el "secreto
      de eventos" antes de acreditar un solo peso.

   Variables de entorno:
     WOMPI_LLAVE_PUBLICA    pub_prod_... o pub_test_...
     WOMPI_INTEGRIDAD       secreto de integridad
     WOMPI_EVENTOS          secreto de eventos
     WOMPI_REDIRECT         a dónde vuelve el jugador tras pagar
     WOMPI_CHECKOUT         (opcional) por defecto https://checkout.wompi.co/p/
   ============================================================ */

const crypto = require('node:crypto');

const CFG = {
    publica: process.env.WOMPI_LLAVE_PUBLICA || '',
    integridad: process.env.WOMPI_INTEGRIDAD || '',
    eventos: process.env.WOMPI_EVENTOS || '',
    redirect: process.env.WOMPI_REDIRECT || '',
    checkout: process.env.WOMPI_CHECKOUT || 'https://checkout.wompi.co/p/',
    moneda: 'COP'
};

const configurado = () => !!(CFG.publica && CFG.integridad);

const sha256 = (txt) => crypto.createHash('sha256').update(txt, 'utf8').digest('hex');

/* Firma de integridad: SHA256 de referencia + monto en centavos + moneda + secreto */
function firmaIntegridad(referencia, centavos, moneda) {
    return sha256(`${referencia}${centavos}${moneda || CFG.moneda}${CFG.integridad}`);
}

/* Datos para mandar al jugador al checkout */
function checkout(referencia, pesos, datosCliente) {
    if (!configurado()) return null;
    const centavos = Math.round(pesos) * 100;
    const firma = firmaIntegridad(referencia, centavos, CFG.moneda);

    const params = new URLSearchParams({
        'public-key': CFG.publica,
        'currency': CFG.moneda,
        'amount-in-cents': String(centavos),
        'reference': referencia,
        'signature:integrity': firma
    });
    if (CFG.redirect) params.set('redirect-url', CFG.redirect);
    if (datosCliente && datosCliente.email) params.set('customer-data:email', datosCliente.email);
    if (datosCliente && datosCliente.telefono) {
        params.set('customer-data:phone-number', datosCliente.telefono);
        params.set('customer-data:phone-number-prefix', '+57');
    }
    if (datosCliente && datosCliente.nombre) params.set('customer-data:full-name', datosCliente.nombre);

    return {
        url: CFG.checkout + '?' + params.toString(),
        referencia, centavos, moneda: CFG.moneda,
        llavePublica: CFG.publica, firma
    };
}

/* Comprobación del evento que manda Wompi.

   El cuerpo trae signature.properties (qué campos se firmaron, en orden),
   signature.checksum y timestamp. El checksum es el SHA256 de los valores
   de esos campos, concatenados, más el timestamp y el secreto de eventos. */
function eventoValido(cuerpo) {
    if (!CFG.eventos) return { ok: false, razon: 'El servidor no tiene configurado WOMPI_EVENTOS.' };
    if (!cuerpo || !cuerpo.signature || !Array.isArray(cuerpo.signature.properties)) {
        return { ok: false, razon: 'El evento no trae firma.' };
    }

    const valores = cuerpo.signature.properties.map((ruta) =>
        String(ruta.split('.').reduce((o, k) => (o == null ? o : o[k]), cuerpo.data) ?? ''));

    const calculado = sha256(valores.join('') + String(cuerpo.timestamp ?? '') + CFG.eventos);
    const recibido = String(cuerpo.signature.checksum || '').toLowerCase();

    // Comparación en tiempo constante: comparar con === deja filtrar el
    // secreto midiendo cuánto tarda en fallar.
    const a = Buffer.from(calculado, 'utf8');
    const b = Buffer.from(recibido, 'utf8');
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

    return ok ? { ok: true } : { ok: false, razon: 'La firma del evento no coincide.' };
}

/* Referencia única y reconocible en el panel de Wompi */
const referenciaDe = (movimientoId) => 'TFF-' + movimientoId;

module.exports = { CFG, configurado, checkout, eventoValido, firmaIntegridad, referenciaDe, sha256 };
