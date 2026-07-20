// ============================================================
// Click Mates — Función: crear-pago-marca.js
// ============================================================
// Inicia una recarga de billetera vía Webpay Plus. El monto se
// abona a la billetera de la marca (no a una campaña específica).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const {
  WebpayPlus,
  Options,
  IntegrationCommerceCodes,
  IntegrationApiKeys,
  Environment,
} = require('transbank-sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function opcionesWebpay() {
  if (process.env.TBK_ENVIRONMENT === 'production') {
    return new Options(process.env.TBK_COMMERCE_CODE, process.env.TBK_API_KEY, Environment.Production);
  }
  return new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { marcaId, monto } = payload;
  if (!marcaId || !monto || Number(monto) < 150) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Datos de pago inválidos' }) };
  }

  const { data: marca, error: errMarca } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', marcaId)
    .eq('tipo', 'marca')
    .single();

  if (errMarca || !marca) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Cuenta de marca no encontrada' }) };
  }

  const buyOrder = `cm-${Date.now()}`;
  const sessionId = marcaId;
  const returnUrl = `${process.env.SITE_URL}/.netlify/functions/confirmar-pago-marca`;

  try {
    const tx = new WebpayPlus.Transaction(opcionesWebpay());
    const respuesta = await tx.create(buyOrder, sessionId, Number(monto), returnUrl);

    await supabase.from('pagos_marca').insert({
      marca_id: marcaId,
      monto: Number(monto),
      estado: 'iniciado',
      webpay_token: respuesta.token,
      webpay_buy_order: buyOrder,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: respuesta.url, token: respuesta.token }),
    };
  } catch (err) {
    console.error('Error creando transacción Webpay:', err);
    return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo iniciar el pago con Webpay' }) };
  }
};
