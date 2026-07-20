// ============================================================
// Click Mates — Función: click.js
// ============================================================
// Ruta pública: https://tusitio.netlify.app/r/{contenidoId}
// Verifica la IP real del visitante y aplica el filtro antifraude
// antes de descontar de la billetera prepago de la marca:
//   1) Geolocalización: solo cuenta si la IP es de Chile.
//   2) VPN / proxy / hosting / IP dedicada: se bloquea.
//   3) 1 IP por enlace: si la misma IP ya generó un clic válido en
//      este mismo enlace, los siguientes clics quedan anulados.
// La IP nunca se guarda en texto plano: se guarda un hash (SHA-256
// con sal) suficiente para comparar "misma IP", sin exponer el dato.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hashIp(ip) {
  const sal = process.env.IP_HASH_SALT || 'clickmates-sal-por-defecto';
  return crypto.createHash('sha256').update(sal + '|' + ip).digest('hex');
}

function enmascararIp(ip) {
  if (!ip) return null;
  if (ip.includes(':')) {
    const partes = ip.split(':').filter(Boolean);
    return partes.slice(0, 2).join(':') + ':xxxx:xxxx:xxxx';
  }
  const partes = ip.split('.');
  if (partes.length === 4) {
    return `${partes[0]}.${partes[1]}.${partes[2]}.xxx`;
  }
  return 'oculta';
}

const PATRON_BOT = /bot|crawl|spider|slurp|curl|wget|python-requests|python-urllib|scrapy|headless|phantomjs|puppeteer|playwright|go-http-client|okhttp|axios\/|node-fetch|libwww-perl|httpclient/i;

function esUserAgentSospechoso(userAgent) {
  if (!userAgent || userAgent.trim() === '') return true;
  return PATRON_BOT.test(userAgent);
}

exports.handler = async (event) => {
  const contenidoId = event.queryStringParameters && event.queryStringParameters.enlace;

  if (!contenidoId) {
    return { statusCode: 400, body: 'Falta el identificador del contenido.' };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];

  let pais = 'DESCONOCIDO';
  let esProxy = false;

  try {
    if (ip) {
      const resp = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,countryCode,proxy,hosting`
      );
      if (resp.ok) {
        const info = await resp.json();
        if (info.status === 'success') {
          pais = info.countryCode || 'DESCONOCIDO';
          esProxy = Boolean(info.proxy) || Boolean(info.hosting);
        }
      }
    }
  } catch (err) {
    console.error('Error consultando geolocalización/antifraude de IP:', err);
  }

  const ipHash = ip ? hashIp(ip) : null;
  const ipMostrar = enmascararIp(ip);
  const esBot = esUserAgentSospechoso(event.headers['user-agent']);

  const { data, error } = await supabase.rpc('registrar_clic', {
    p_contenido_id: contenidoId,
    p_pais: pais,
    p_ip_hash: ipHash,
    p_es_proxy: esProxy,
    p_ip_mostrar: ipMostrar,
    p_es_bot: esBot,
  });

  if (error || !data || !data[0] || !data[0].ok) {
    console.error('Error registrando el clic:', error);
    return { statusCode: 404, body: 'Enlace no encontrado.' };
  }

  return {
    statusCode: 302,
    headers: { Location: data[0].campana_url },
  };
};
