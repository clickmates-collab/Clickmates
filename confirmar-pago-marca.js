// ============================================================
// Click Mates — Función: confirmar-pago-marca.js
// ============================================================
// Transbank redirige aquí al terminar el pago. Si fue autorizado,
// abona el monto a la billetera de la marca.
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
  const params = event.httpMethod === 'POST'
    ? new URLSearchParams(event.body || '')
    : new URLSearchParams(event.queryStringParameters || {});

  const token = params.get('token_ws');
  const destino = `${process.env.SITE_URL}/#dashboard-marca`;

  if (!token) {
    return { statusCode: 302, headers: { Location: `${destino}?pago=cancelado` } };
  }

  const { data: pago } = await supabase
    .from('pagos_marca')
    .select('id')
    .eq('webpay_token', token)
    .single();

  try {
    const tx = new WebpayPlus.Transaction(opcionesWebpay());
    const resultado = await tx.commit(token);

    if (resultado.status === 'AUTHORIZED' && pago) {
      await supabase.rpc('aplicar_pago_marca', { p_pago_id: pago.id });
      return { statusCode: 302, headers: { Location: `${destino}?pago=exitoso` } };
    }

    if (pago) {
      await supabase.from('pagos_marca').update({ estado: 'fallido' }).eq('id', pago.id);
    }
    return { statusCode: 302, headers: { Location: `${destino}?pago=fallido` } };
  } catch (err) {
    console.error('Error confirmando transacción Webpay:', err);
    if (pago) {
      await supabase.from('pagos_marca').update({ estado: 'fallido' }).eq('id', pago.id);
    }
    return { statusCode: 302, headers: { Location: `${destino}?pago=fallido` } };
  }
};
