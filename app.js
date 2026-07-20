// ============================================================
// Click Mates — Lógica de la aplicación (v3: billetera + RUT + contenidos)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------- CONFIGURA AQUÍ tus credenciales de Supabase ----------
const SUPABASE_URL = 'https://erimnjgoejepyzopjrmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyaW1uamdvZWplcHl6b3Bqcm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MDY5NDYsImV4cCI6MjEwMDA4Mjk0Nn0.J_ye59gqX9Sud957hQmCPFhvZWyMgYoB8jEeIsZcE10';
// -------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CPC_MARCA = 150;
const CPC_CREADOR = 120;
const UMBRAL_LIBERACION = 150;

const TEXTO_MOTIVO = {
  valido: 'Válido',
  pais_no_cl: 'Anulado — fuera de Chile',
  vpn_o_ip_dedicada: 'Anulado — VPN / IP dedicada',
  bot_detectado: 'Anulado — bot o script automatizado',
  duplicado: 'Anulado — IP repetida en este enlace',
  velocidad_sospechosa: 'Anulado — velocidad de clics sospechosa',
  sin_saldo: 'Anulado — sin saldo en la billetera',
  otro: 'Anulado — otro motivo',
};

let sesion = null;
let perfil = null;
let rutVerificadoMarca = false;
let rutVerificadoCreador = false;

// ============================================================
// VALIDACIÓN REAL DE RUT CHILENO (algoritmo de módulo 11)
// ============================================================
// Esto valida que el dígito verificador sea matemáticamente
// correcto para ese número — NO confirma que el RUT pertenezca
// a una persona o empresa real registrada en el SII. Para eso
// se necesitaría una integración paga con el Registro Civil o
// el SII, que queda fuera del alcance de este proyecto por ahora.

function calcularDigitoVerificador(cuerpo) {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function validarRut(rutCompleto) {
  const limpio = (rutCompleto || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return calcularDigitoVerificador(cuerpo) === dv;
}

function formatearRut(rutCompleto) {
  const limpio = (rutCompleto || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const cuerpoFormateado = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpoFormateado}-${dv}`;
}

function inicializarVerificacionRut() {
  const configs = [
    { input: 'marca-rut', boton: 'btn-verificar-rut-marca', mensaje: 'marca-rut-mensaje', set: (v) => { rutVerificadoMarca = v; } },
    { input: 'creador-rut', boton: 'btn-verificar-rut-creador', mensaje: 'creador-rut-mensaje', set: (v) => { rutVerificadoCreador = v; } },
  ];

  configs.forEach(({ input, boton, mensaje, set }) => {
    const inputEl = document.getElementById(input);
    const botonEl = document.getElementById(boton);
    const mensajeEl = document.getElementById(mensaje);

    inputEl.addEventListener('input', () => {
      set(false);
      botonEl.classList.remove('verificado');
      botonEl.textContent = 'Verificar';
      mensajeEl.textContent = 'Se valida el dígito verificador antes de crear la cuenta.';
      mensajeEl.style.color = '';
    });

    botonEl.addEventListener('click', () => {
      if (!inputEl.value.trim()) return;
      botonEl.disabled = true;
      botonEl.textContent = 'Verificando…';

      setTimeout(() => {
        botonEl.disabled = false;
        const esValido = validarRut(inputEl.value);
        set(esValido);

        if (esValido) {
          inputEl.value = formatearRut(inputEl.value);
          botonEl.textContent = '✓ Verificado';
          botonEl.classList.add('verificado');
          mensajeEl.textContent = 'Dígito verificador correcto.';
          mensajeEl.style.color = '#3FAE7E';
        } else {
          botonEl.textContent = 'Verificar';
          mensajeEl.textContent = 'RUT inválido: revisa el número y el dígito verificador.';
          mensajeEl.style.color = '#E58363';
        }
      }, 400);
    });
  });
}

// ============================================================
// UTILIDADES
// ============================================================

function formatoCLP(numero) {
  return '$' + Math.round(numero).toLocaleString('es-CL');
}

function formatoFecha(fechaIso) {
  return new Date(fechaIso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function mostrarToast(mensaje) {
  const toast = document.getElementById('toast');
  toast.textContent = mensaje;
  toast.classList.remove('hidden');
  clearTimeout(mostrarToast._timeout);
  mostrarToast._timeout = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function mostrarError(err, contexto) {
  console.error(contexto, err);
  mostrarToast(err && err.message ? `Error: ${err.message}` : `Ocurrió un error (${contexto})`);
}

function pintarPerforacion(idContenedor) {
  const el = document.getElementById(idContenedor);
  if (!el || el.childElementCount > 0) return;
  for (let i = 0; i < 28; i++) {
    const span = document.createElement('span');
    el.appendChild(span);
  }
}

// ============================================================
// NAVEGACIÓN
// ============================================================

function cambiarVista(nombreVista, scrollId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${nombreVista}`).classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (nombreVista === 'dashboard-marca') { pintarPerforacion('perforacion-marca'); renderDashboardMarca(); }
  if (nombreVista === 'dashboard-afiliado') { pintarPerforacion('perforacion-creador'); renderDashboardAfiliado(); }

  if (scrollId) {
    requestAnimationFrame(() => {
      const el = document.getElementById(scrollId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

function inicializarNavegacion() {
  document.querySelectorAll('[data-view-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      cambiarVista(btn.dataset.viewTarget, btn.dataset.scroll || null);
    });
  });
}

// ============================================================
// AUTENTICACIÓN
// ============================================================

async function crearCuentaOIniciarSesion(email, password) {
  const { data: dataSignUp, error: errSignUp } = await supabase.auth.signUp({ email, password });
  if (!errSignUp) return dataSignUp;

  const msg = (errSignUp.message || '').toLowerCase();
  if (msg.includes('already registered') || msg.includes('already exists')) {
    const { data: dataSignIn, error: errSignIn } = await supabase.auth.signInWithPassword({ email, password });
    if (errSignIn) throw errSignIn;
    return dataSignIn;
  }
  throw errSignUp;
}

async function obtenerOCrearPerfil(userId, datosPerfil) {
  const { data: existente } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (existente) return existente;

  const { data: nuevo, error } = await supabase.from('profiles').insert({ id: userId, ...datosPerfil }).select().single();
  if (error) throw error;
  return nuevo;
}

async function cargarSesionActual() {
  const { data } = await supabase.auth.getSession();
  sesion = data.session;

  if (sesion) {
    const { data: fila } = await supabase.from('profiles').select('*').eq('id', sesion.user.id).maybeSingle();
    perfil = fila || null;
  } else {
    perfil = null;
  }
  actualizarNavSesion();
}

function actualizarNavSesion() {
  const etiqueta = document.getElementById('nav-sesion');
  const btnCerrar = document.getElementById('btn-cerrar-sesion');
  if (sesion && perfil) {
    etiqueta.textContent = `${perfil.nombre} · ${perfil.tipo === 'marca' ? 'Marca' : 'Creador'}`;
    etiqueta.classList.remove('hidden');
    btnCerrar.classList.remove('hidden');
  } else {
    etiqueta.classList.add('hidden');
    btnCerrar.classList.add('hidden');
  }
}

function inicializarCierreSesion() {
  document.getElementById('btn-cerrar-sesion').addEventListener('click', async () => {
    await supabase.auth.signOut();
    sesion = null;
    perfil = null;
    actualizarNavSesion();
    mostrarToast('Sesión cerrada');
    cambiarVista('landing');
  });
}

// ============================================================
// FORMULARIO: CREAR CUENTA DE MARCA + PRIMERA CAMPAÑA
// ============================================================

function inicializarFormMarca() {
  const form = document.getElementById('form-marca');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');

    if (!rutVerificadoMarca) {
      mostrarToast('Verifica el RUT antes de continuar.');
      return;
    }

    boton.disabled = true;
    try {
      const email = document.getElementById('marca-email').value.trim();
      const password = document.getElementById('marca-password').value;
      const nombre = document.getElementById('marca-nombre').value.trim();
      const rut = document.getElementById('marca-rut').value.trim();
      const url = document.getElementById('marca-url').value.trim();
      const clicsObjetivo = Number(document.getElementById('marca-clics-objetivo').value);

      const resultado = await crearCuentaOIniciarSesion(email, password);
      if (!resultado.session) {
        mostrarToast('Revisa tu correo para confirmar la cuenta antes de continuar.');
        return;
      }
      sesion = resultado.session;

      perfil = await obtenerOCrearPerfil(resultado.user.id, { tipo: 'marca', nombre, rut });

      const { error } = await supabase.from('campanas').insert({
        marca_id: resultado.user.id,
        nombre_marca: nombre,
        url,
        clics_objetivo: Math.max(150, clicsObjetivo || 150),
      });
      if (error) throw error;

      actualizarNavSesion();
      form.reset();
      rutVerificadoMarca = false;
      mostrarToast('Cuenta creada y campaña publicada. Recarga tu billetera para empezar a recibir clics.');
      cambiarVista('dashboard-marca');
    } catch (err) {
      mostrarError(err, 'crear cuenta de marca');
    } finally {
      boton.disabled = false;
    }
  });
}

// ============================================================
// FORMULARIO: REGISTRO DE CREADOR
// ============================================================

function inicializarFormCreador() {
  const form = document.getElementById('form-creador');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');

    if (!rutVerificadoCreador) {
      mostrarToast('Verifica el RUT antes de continuar.');
      return;
    }

    boton.disabled = true;
    try {
      const email = document.getElementById('creador-email').value.trim();
      const password = document.getElementById('creador-password').value;
      const nombre = document.getElementById('creador-nombre').value.trim();
      const rut = document.getElementById('creador-rut').value.trim();
      const red = document.getElementById('creador-red').value;
      const cuenta = document.getElementById('creador-cuenta').value.trim();

      const resultado = await crearCuentaOIniciarSesion(email, password);
      if (!resultado.session) {
        mostrarToast('Revisa tu correo para confirmar la cuenta antes de continuar.');
        return;
      }
      sesion = resultado.session;

      perfil = await obtenerOCrearPerfil(resultado.user.id, {
        tipo: 'creador', nombre, rut, red_social: red, cuenta_transferencia: cuenta,
      });

      actualizarNavSesion();
      form.reset();
      rutVerificadoCreador = false;
      mostrarToast('Cuenta de creador creada con éxito');
      cambiarVista('dashboard-afiliado');
    } catch (err) {
      mostrarError(err, 'registro de creador');
    } finally {
      boton.disabled = false;
    }
  });
}

// ============================================================
// DASHBOARD MARCA
// ============================================================

async function renderDashboardMarca() {
  const sinCampanas = document.getElementById('marca-sin-campanas');
  const contenido = document.getElementById('marca-contenido');
  const titulo = document.getElementById('marca-sin-campanas-titulo');
  const texto = document.getElementById('marca-sin-campanas-texto');

  if (!sesion || !perfil || perfil.tipo !== 'marca') {
    sinCampanas.classList.remove('hidden');
    contenido.classList.add('hidden');
    titulo.textContent = 'Necesitas iniciar sesión como marca';
    texto.textContent = 'Crea tu cuenta desde la sección "Para marcas" en el inicio.';
    return;
  }

  const { data: perfilFresco, error: errPerfil } = await supabase.from('profiles').select('*').eq('id', sesion.user.id).single();
  if (errPerfil) return mostrarError(errPerfil, 'cargar perfil de marca');
  perfil = perfilFresco;

  sinCampanas.classList.add('hidden');
  contenido.classList.remove('hidden');

  document.getElementById('stat-saldo-billetera').textContent = formatoCLP(perfil.saldo_billetera);

  const { data: campanas, error } = await supabase
    .from('campanas')
    .select('id, nombre_marca, url, clics_objetivo, clics_validos, clics_invalidos')
    .eq('marca_id', sesion.user.id)
    .order('created_at', { ascending: false });

  if (error) return mostrarError(error, 'cargar campañas');

  const clicsTotales = (campanas || []).reduce((s, c) => s + c.clics_validos, 0);
  document.getElementById('stat-clics-validos-total').textContent = clicsTotales;
  document.getElementById('stat-costo-total').textContent = formatoCLP(clicsTotales * CPC_MARCA);

  const lista = document.getElementById('lista-campanas-marca');
  if (!campanas || campanas.length === 0) {
    lista.innerHTML = `<p class="text-sm" style="color:#6B6252">Aún no tienes campañas. Crea una desde "Nueva campaña".</p>`;
    return;
  }

  const bloques = await Promise.all(campanas.map(async (c) => {
    const { data: contenidos } = await supabase
      .from('contenidos')
      .select('id, nombre, clics_validos, clics_invalidos, url_unica, public_profiles:creador_id(nombre)')
      .eq('campana_id', c.id);

    const pct = c.clics_objetivo > 0 ? Math.min(100, Math.round((c.clics_validos / c.clics_objetivo) * 100)) : 0;

    const filasContenidos = (contenidos || []).length === 0
      ? `<p class="text-xs font-sans mt-2" style="color:#6B6252">Ningún creador se ha unido todavía.</p>`
      : contenidos.map(ct => `
          <div class="flex items-center justify-between text-xs mt-2 font-sans">
            <div class="min-w-0">
              <span class="font-medium" style="color:#0E1416">${(ct.public_profiles && ct.public_profiles.nombre) || 'Creador'}</span>
              <span style="color:#6B6252"> · ${ct.nombre}</span>
            </div>
            <span class="font-mono shrink-0" style="color:#2E7D5B">${ct.clics_validos} válidos</span>
          </div>
        `).join('');

    return `
      <div class="receipt-item">
        <div class="flex items-center justify-between mb-1">
          <p class="text-sm font-sans font-semibold" style="color:#0E1416">${c.nombre_marca}</p>
          <span class="badge badge-emerald">${c.clics_objetivo} clics meta</span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs mb-2">
          <div><p style="color:#6B6252">Clics válidos</p><p class="font-semibold" style="color:#2E7D5B">${c.clics_validos} / ${c.clics_objetivo}</p></div>
          <div><p style="color:#6B6252">Gastado</p><p class="font-semibold" style="color:#0E1416">${formatoCLP(c.clics_validos * CPC_MARCA)}</p></div>
          <div><p style="color:#6B6252">Transferido a creadores</p><p class="font-semibold" style="color:#0E1416">${formatoCLP(c.clics_validos * CPC_CREADOR)}</p></div>
        </div>
        <div class="progreso-track" style="background:#E4DECB"><div class="progreso-fill" style="width:${pct}%; background:#2E7D5B"></div></div>
        ${filasContenidos}
      </div>
    `;
  }));

  lista.innerHTML = bloques.join('');

  await renderDetalleAntifraudeMarca();
}

// ------------------------------------------------------------
// Detalle antifraude — MARCA
// ------------------------------------------------------------
function renderResumenClics(contenedorId, filas) {
  const cont = document.getElementById(contenedorId);
  const totales = { valido: 0, pais_no_cl: 0, vpn_o_ip_dedicada: 0, bot_detectado: 0, duplicado: 0, velocidad_sospechosa: 0, sin_saldo: 0, otro: 0 };
  (filas || []).forEach(f => {
    if (totales[f.estado] === undefined) totales.otro += Number(f.cantidad);
    else totales[f.estado] += Number(f.cantidad);
  });

  const chips = [
    { clave: 'valido', label: 'Válidos' },
    { clave: 'vpn_o_ip_dedicada', label: 'Por VPN' },
    { clave: 'bot_detectado', label: 'Por bot/script' },
    { clave: 'duplicado', label: 'Por IP repetida' },
    { clave: 'velocidad_sospechosa', label: 'Por velocidad' },
    { clave: 'pais_no_cl', label: 'Fuera de Chile' },
    { clave: 'sin_saldo', label: 'Sin saldo' },
  ];

  cont.innerHTML = chips.map(c => `
    <div class="chip-resumen">
      <p>${c.label}</p>
      <p style="color:${c.clave === 'valido' ? '#3FAE7E' : '#E0765C'}">${totales[c.clave]}</p>
    </div>
  `).join('');
}

function filaTablaClics({ creado_en, otraColumna, contenido_nombre, ip, pais, es_proxy, es_valido, motivo_invalido }) {
  const estado = es_valido ? 'valido' : (motivo_invalido || 'otro');
  return `
    <tr>
      <td>${formatoFecha(creado_en)}</td>
      <td>${otraColumna || '—'}</td>
      <td>${contenido_nombre || '—'}</td>
      <td>${ip || '—'}</td>
      <td>${pais || '—'}</td>
      <td class="${es_proxy ? 'vpn-si' : 'vpn-no'}">${es_proxy ? 'Sí' : 'No'}</td>
      <td class="${es_valido ? 'estado-valido' : 'estado-anulado'}">${TEXTO_MOTIVO[estado] || TEXTO_MOTIVO.otro}</td>
    </tr>
  `;
}

async function renderDetalleAntifraudeMarca() {
  const [{ data: resumen, error: errResumen }, { data: detalle, error: errDetalle }] = await Promise.all([
    supabase.rpc('resumen_clics_marca'),
    supabase.rpc('obtener_clics_marca', { p_limite: 200 }),
  ]);

  if (errResumen || errDetalle) return mostrarError(errResumen || errDetalle, 'cargar detalle antifraude');

  renderResumenClics('resumen-clics-marca', resumen);

  const cuerpo = document.getElementById('tabla-clics-marca');
  cuerpo.innerHTML = (detalle && detalle.length)
    ? detalle.map(d => filaTablaClics({ ...d, otraColumna: d.creador_nombre })).join('')
    : `<tr><td colspan="7" class="text-center" style="color:#93A299">Aún no hay clics registrados.</td></tr>`;
}

function inicializarRecargaWebpay() {
  document.getElementById('form-recarga').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sesion) return;

    const monto = Number(document.getElementById('recarga-monto').value);
    const flash = document.getElementById('marca-flash');

    if (!monto || monto < CPC_MARCA) {
      flash.textContent = `El monto mínimo es ${formatoCLP(CPC_MARCA)}`;
      flash.classList.remove('hidden');
      return;
    }

    try {
      const resp = await fetch('/.netlify/functions/crear-pago-marca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marcaId: sesion.user.id, monto }),
      });
      const datos = await resp.json();
      if (!resp.ok) throw new Error(datos.error || 'No se pudo iniciar el pago');

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = datos.url;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'token_ws';
      input.value = datos.token;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      mostrarError(err, 'recargar billetera');
    }
  });
}

function inicializarNuevaCampana() {
  document.getElementById('form-nueva-campana').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sesion || !perfil) return;

    try {
      const nombre = document.getElementById('nueva-campana-nombre').value.trim();
      const url = document.getElementById('nueva-campana-url').value.trim();
      const clicsObjetivo = Number(document.getElementById('nueva-campana-clics').value);

      const { error } = await supabase.from('campanas').insert({
        marca_id: sesion.user.id,
        nombre_marca: nombre,
        url,
        clics_objetivo: Math.max(150, clicsObjetivo || 150),
      });
      if (error) throw error;

      e.target.reset();
      document.getElementById('nueva-campana-clics').value = 150;
      mostrarToast('Campaña activada');
      renderDashboardMarca();
    } catch (err) {
      mostrarError(err, 'activar campaña');
    }
  });
}

function revisarResultadoPago() {
  const params = new URLSearchParams(window.location.search);
  const pago = params.get('pago');
  if (!pago) return;

  const mensajes = {
    exitoso: 'Pago autorizado: billetera recargada 🎉',
    fallido: 'El pago no fue autorizado por Webpay.',
    cancelado: 'Cancelaste el pago en Webpay.',
  };
  mostrarToast(mensajes[pago] || 'Resultado de pago desconocido');

  const url = new URL(window.location.href);
  url.searchParams.delete('pago');
  window.history.replaceState({}, '', url);
}

// ============================================================
// DASHBOARD CREADOR
// ============================================================

async function renderDashboardAfiliado() {
  const sinCuenta = document.getElementById('afiliado-sin-cuenta');
  const contenido = document.getElementById('afiliado-contenido');

  if (!sesion || !perfil || perfil.tipo !== 'creador') {
    sinCuenta.classList.remove('hidden');
    contenido.classList.add('hidden');
    return;
  }

  const { data: perfilFresco, error: errPerfil } = await supabase.from('profiles').select('*').eq('id', sesion.user.id).single();
  if (errPerfil) return mostrarError(errPerfil, 'cargar perfil de creador');
  perfil = perfilFresco;

  sinCuenta.classList.add('hidden');
  contenido.classList.remove('hidden');

  const pendientes = perfil.clics_chile - perfil.clics_liberados;
  const montoPendiente = pendientes * CPC_CREADOR;
  const puedeLiberar = pendientes >= UMBRAL_LIBERACION;
  const pct = Math.min(100, Math.round((pendientes / UMBRAL_LIBERACION) * 100));

  document.getElementById('stat-saldo-disponible').textContent = formatoCLP(perfil.saldo_disponible);
  document.getElementById('stat-saldo-pendiente').textContent = formatoCLP(montoPendiente);
  document.getElementById('stat-clics-pendientes').textContent = pendientes;
  document.getElementById('progreso-liberacion').style.width = `${pct}%`;
  document.getElementById('progreso-liberacion').style.background = puedeLiberar ? '#3FAE7E' : '#C9A227';
  document.getElementById('texto-liberacion').textContent = puedeLiberar
    ? `Puedes liberar ${Math.floor(pendientes / UMBRAL_LIBERACION) * UMBRAL_LIBERACION} clics ahora.`
    : `Faltan ${UMBRAL_LIBERACION - pendientes} clics para liberar (mínimo ${UMBRAL_LIBERACION}).`;
  document.getElementById('btn-liberar-saldo').disabled = !puedeLiberar;

  document.getElementById('stat-clics-chile-creador').textContent = perfil.clics_chile;

  const estado = document.getElementById('stat-estado-pago');
  if (perfil.saldo_disponible === 0 && perfil.saldo_transferido > 0) {
    estado.textContent = 'Transferido';
    estado.className = 'badge-transferido mt-1';
  } else {
    estado.textContent = 'Pendiente';
    estado.className = 'badge-pendiente mt-1';
  }

  const { data: campanas } = await supabase
    .from('campanas')
    .select('id, nombre_marca, url, clics_objetivo, clics_validos')
    .order('created_at', { ascending: false });

  const listaDisponibles = document.getElementById('lista-campanas-disponibles');
  if (!campanas || campanas.length === 0) {
    listaDisponibles.innerHTML = `<p class="text-sm text-muted">No hay campañas activas en este momento.</p>`;
  } else {
    listaDisponibles.innerHTML = campanas.map(c => `
      <div class="campana-item">
        <p class="font-medium text-arena/90 truncate">${c.nombre_marca}</p>
        <p class="text-xs text-muted font-mono truncate">${c.url}</p>
        <form class="flex gap-2 mt-2.5" data-crear-contenido="${c.id}">
          <input required type="text" placeholder="Nombre del video o post" class="form-input flex-1 text-xs py-1.5">
          <button type="submit" class="btn-secondary shrink-0">+ Contenido</button>
        </form>
      </div>
    `).join('');

    listaDisponibles.querySelectorAll('[data-crear-contenido]').forEach(formulario => {
      formulario.addEventListener('submit', (e) => {
        e.preventDefault();
        const nombre = formulario.querySelector('input').value.trim();
        crearContenido(formulario.dataset.crearContenido, nombre, formulario);
      });
    });
  }

  const { data: misContenidos } = await supabase
    .from('contenidos')
    .select('id, nombre, url_unica, clics_validos, clics_invalidos, campanas:campana_id(nombre_marca)')
    .eq('creador_id', sesion.user.id)
    .order('created_at', { ascending: false });

  const listaContenidos = document.getElementById('lista-mis-contenidos');
  if (!misContenidos || misContenidos.length === 0) {
    listaContenidos.innerHTML = `<p class="text-sm" style="color:#6B6252">Aún no has creado ningún contenido. Únete a una campaña para generar tu primer enlace.</p>`;
  } else {
    listaContenidos.innerHTML = misContenidos.map(ct => `
      <div class="receipt-item">
        <p class="text-sm font-sans font-semibold mb-2" style="color:#0E1416">${ct.nombre}</p>
        <p class="text-xs font-sans mb-2" style="color:#6B6252">${(ct.campanas && ct.campanas.nombre_marca) || 'Campaña'}</p>
        <div class="grid grid-cols-2 gap-2 text-xs mb-3">
          <div><p style="color:#6B6252">Válidos</p><p class="font-semibold" style="color:#2E7D5B">${ct.clics_validos}</p></div>
          <div><p style="color:#6B6252">Descartados</p><p class="font-semibold" style="color:#D6603F">${ct.clics_invalidos}</p></div>
        </div>
        <div class="flex items-center justify-between gap-2 font-sans">
          <p class="enlace-url text-xs" style="color:#8A6B1F">${ct.url_unica}</p>
          <button class="btn-secondary shrink-0" data-copiar="${ct.url_unica}">Copiar</button>
        </div>
      </div>
    `).join('');

    listaContenidos.querySelectorAll('[data-copiar]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(btn.dataset.copiar);
        mostrarToast('Enlace copiado al portapapeles');
      });
    });
  }

  await renderDetalleAntifraudeCreador();
}

// ------------------------------------------------------------
// Detalle antifraude — CREADOR
// ------------------------------------------------------------
async function renderDetalleAntifraudeCreador() {
  const [{ data: resumen, error: errResumen }, { data: detalle, error: errDetalle }] = await Promise.all([
    supabase.rpc('resumen_clics_creador'),
    supabase.rpc('obtener_clics_creador', { p_limite: 200 }),
  ]);

  if (errResumen || errDetalle) return mostrarError(errResumen || errDetalle, 'cargar detalle antifraude');

  renderResumenClics('resumen-clics-creador', resumen);

  const cuerpo = document.getElementById('tabla-clics-creador');
  cuerpo.innerHTML = (detalle && detalle.length)
    ? detalle.map(d => filaTablaClics({ ...d, otraColumna: d.nombre_marca })).join('')
    : `<tr><td colspan="7" class="text-center" style="color:#93A299">Aún no hay clics registrados.</td></tr>`;
}

async function crearContenido(campanaId, nombre, formulario) {
  try {
    const { error } = await supabase.from('contenidos').insert({
      campana_id: campanaId,
      creador_id: sesion.user.id,
      nombre,
    });
    if (error) throw error;

    formulario.reset();
    mostrarToast('Contenido creado. Ya puedes compartir tu enlace.');
    renderDashboardAfiliado();
  } catch (err) {
    mostrarError(err, 'crear contenido');
  }
}

function inicializarLiberarSaldo() {
  document.getElementById('btn-liberar-saldo').addEventListener('click', async () => {
    if (!sesion) return;
    try {
      const { data, error } = await supabase.rpc('liberar_saldo_creador', { p_creador_id: sesion.user.id });
      if (error) throw error;

      const resultado = data && data[0];
      const flash = document.getElementById('creador-flash');

      if (resultado && resultado.bloques_liberados > 0) {
        flash.textContent = `Liberaste ${formatoCLP(resultado.monto_liberado)} (${resultado.bloques_liberados * UMBRAL_LIBERACION} clics) a tu billetera.`;
        flash.classList.remove('hidden');
        setTimeout(() => flash.classList.add('hidden'), 3500);
      }

      renderDashboardAfiliado();
    } catch (err) {
      mostrarError(err, 'liberar saldo');
    }
  });
}

// ============================================================
// PUNTO DE ENTRADA
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  inicializarNavegacion();
  inicializarVerificacionRut();
  inicializarFormMarca();
  inicializarFormCreador();
  inicializarRecargaWebpay();
  inicializarNuevaCampana();
  inicializarLiberarSaldo();
  inicializarCierreSesion();

  await cargarSesionActual();
  revisarResultadoPago();
  cambiarVista('landing');
});

// ============================================================
// PREGUNTAS FRECUENTES (contenido tomado del documento maestro)
// ============================================================

const FAQ_MARCAS = [
  {
    p: '¿Cuánto cuesta cada clic y cómo se reparte el dinero?',
    r: `El costo fijo es de <strong>$150 CLP</strong> por cada clic verificado y calificado que llegue a tu sitio web (más IVA, según cláusula del servicio). De ese monto, <strong>$120 CLP</strong> van directo al creador que generó el clic y <strong>$30 CLP</strong> corresponden a la comisión de la plataforma por intermediación, auditoría antifraude y soporte.`,
  },
  {
    p: '¿Cómo aseguran que los clics sean reales y no de bots, auto-clics o VPN?',
    r: `Cada clic pasa por un sistema de auditoría en tiempo real antes de redirigir al usuario a tu sitio:
      <ul>
        <li><strong>Filtro anti-autoclic:</strong> solo se contabiliza un clic válido por usuario único cada 24 horas.</li>
        <li><strong>Bloqueo de VPN y bots:</strong> se detecta tráfico de centros de datos, proxys o VPN, y se marca como inválido sin costo para ti.</li>
        <li><strong>Geolocalización estricta:</strong> solo se validan clics desde proveedores residenciales y móviles reales dentro de Chile.</li>
      </ul>`,
  },
  {
    p: '¿Por qué pagar por clics en vez de invertir en Meta Ads?',
    r: `Meta Ads es excelente para alcance masivo, pero nuestro modelo ofrece algo distinto: <strong>tráfico pre-calificado</strong> (la gente compra por recomendación, no por un anuncio frío), <strong>cero ceguera de anuncios</strong> (tus videos aparecen como contenido orgánico, no como publicidad que la gente bloquea) y <strong>ahorro en producción</strong>, porque el creador se encarga del guion, actuación y edición — tú solo pagas por el resultado: el clic.`,
  },
  {
    p: '¿Mi campaña la toma un solo creador o participan varios a la vez?',
    r: `Participan muchos creadores en paralelo. Al abrir una campaña creas una "bolsa de clics" disponible para toda la red: decenas de creadores pueden generar contenido para tu producto al mismo tiempo, pero tú solo pagas por los clics reales que efectivamente lleguen a tu sitio. Al agotarse el presupuesto contratado, la campaña se cierra automáticamente.`,
  },
  {
    p: '¿Cuál es la ventaja de este modelo multicreador para mi negocio?',
    r: `<ul>
        <li><strong>Mayor alcance gratuito:</strong> obtienes el impacto de 10, 20 o más videos, pero tu inversión va directo al resultado (visitas).</li>
        <li><strong>Velocidad:</strong> la fuerza de la red completa consigue resultados más rápido que esperar a un solo creador.</li>
        <li><strong>Diversificación del riesgo:</strong> si el video de un creador no rinde, no te afecta — otros aportarán los clics.</li>
      </ul>`,
  },
  {
    p: '¿Cómo se aseguran los fondos y que no haya atrasos en el pago a creadores?',
    r: `Operamos bajo <strong>prepago obligatorio</strong>: ninguna campaña se activa ni se distribuye a los creadores si no cargaste antes el 100% del presupuesto. Una vez confirmado el pago, se emite la Factura Electrónica al Contado y los fondos quedan custodiados, liberándose peso por peso solo cuando se registran clics válidos.`,
  },
  {
    p: '¿Qué medidas toman contra el tráfico engañoso o "clickbait"?',
    r: `Prohibimos que los creadores usen promesas falsas o engaños para forzar el clic. El sistema analiza la <strong>tasa de rebote en tiempo real</strong>: si los usuarios entran y salen del enlace en menos de 2 segundos de forma masiva, la campaña de ese creador se pausa automáticamente y sus saldos quedan congelados bajo investigación.`,
  },
  {
    p: '¿Cómo garantizan que no me cobrarán por clics repetidos de una misma persona?',
    r: `Con un <strong>filtro de clic único diario por IP</strong>. Si la misma persona (o un grupo de conocidos) presiona el enlace varias veces en 24 horas, solo se valida y descuenta el primer clic del día; el resto se redirige a tu sitio a costo $0.`,
  },
  {
    p: '¿Puedo pedir devolución si cancelo una campaña antes de tiempo?',
    r: `Sí, con reglas ligadas al mes calendario por normativa del SII. Si pides la devolución dentro del mismo mes de la factura, se emite una Nota de Crédito y se transfiere el dinero (menos un 3% por gestión). Si es en meses posteriores, el saldo no se devuelve en efectivo — queda disponible de forma permanente como saldo a favor en tu billetera para futuras campañas.`,
  },
  {
    p: '¿Qué seguridad tengo con mis pagos con tarjeta de crédito?',
    r: `Todas las cargas se procesan con autenticación bancaria de dos pasos (Webpay). Al registrarte, se valida la identidad de tu empresa y aceptas digitalmente una cláusula de no devolución una vez prestado el servicio — esa firma sirve como respaldo legal ante Transbank frente a cualquier disputa de cargo no reconocido.`,
  },
  {
    p: '¿Cómo protegen mi inversión de clics falsos o fraudulentos?',
    r: `Con un sistema de auditoría en múltiples capas que cruza datos técnicos (IP, tipo de conexión, ubicación), datos de comportamiento (tiempo en tu sitio, interacción real) y datos de origen (views verificadas del video versus clics recibidos) antes de descontar cualquier clic de tu presupuesto.`,
  },
  {
    p: '¿Qué patrones analiza el sistema para detectar fraude?',
    r: `Sin revelar el detalle técnico exacto (para no facilitar que se evadan), auditamos en general:
      <ul>
        <li>Proporción entre vistas reales del video y clics recibidos.</li>
        <li>Concentración geográfica anómala (muchos clics desde muy pocas comunas o el mismo proveedor).</li>
        <li>Comportamiento posterior al clic (tiempo de permanencia real en tu sitio).</li>
        <li>Patrones de tiempo (llegada gradual y orgánica versus picos artificiales).</li>
        <li>Redes ocultas y automatización (VPNs comerciales, datacenters, bots conocidos).</li>
      </ul>`,
  },
  {
    p: '¿Qué pasa si, aun con los filtros, se cuela tráfico fraudulento?',
    r: `Ningún sistema del mundo llega al 100% de precisión. Por eso existe el <strong>Fondo de Garantía "Click Shield"</strong>: si detectamos o nos reportas tráfico irregular después del pago, te devolvemos ese dinero automáticamente, sin trámites ni disputas prolongadas. Nunca pagas por un clic que no fue real.`,
  },
  {
    p: '¿Puedo reportar yo mismo un lote de clics que me parece sospechoso?',
    r: `Sí. Desde tu panel tienes un botón de "Reportar tráfico sospechoso" disponible hasta 15 días después de finalizada tu campaña. El equipo audita el lote reportado y, si se confirma la irregularidad, el reembolso se aplica automáticamente desde el Fondo de Garantía.`,
  },
  {
    p: '¿Qué pasa con el creador si se confirma que generó tráfico fraudulento?',
    r: `Se aplican sanciones graduales: desde la anulación simple de los clics sospechosos sin pago, hasta la suspensión temporal o expulsión definitiva en casos de reincidencia comprobada. Todo creador tiene derecho a presentar sus antecedentes antes de cualquier sanción severa.`,
  },
];

const FAQ_CREADORES = [
  {
    p: '¿Cuánto voy a ganar por cada clic?',
    r: `Recibes un pago neto de <strong>$120 CLP</strong> por cada clic válido que consigas enviar a través de tu enlace personalizado. Los $30 CLP restantes (de los $150 que paga la marca) corresponden a la comisión de la plataforma.`,
  },
  {
    p: '¿En qué redes puedo publicar mi enlace y de dónde deben venir los clics?',
    r: `Puedes compartir tu enlace en biografía de Instagram, stickers de historias, descripción de YouTube, TikTok, Twitch o cualquier otra plataforma. El servicio está optimizado 100% para Chile: aunque tu video se vuelva viral internacionalmente, solo se procesan, cobran y pagan los clics de usuarios reales dentro del territorio chileno.`,
  },
  {
    p: '¿Cómo retiro mis ganancias y qué pasa con los impuestos?',
    r: `Para retirar tus ganancias netas acumuladas debes emitir una <strong>Boleta de Honorarios Electrónica (BHE)</strong> a través del portal del SII a nombre de la plataforma. El pago se procesa considerando la retención legal vigente, así que tus ingresos quedan completamente declarados y en regla.`,
  },
  {
    p: '¿Qué requisitos debo cumplir para postular como creador?',
    r: `<ul>
        <li><strong>Residencia en Chile:</strong> tu cuenta y contenido deben estar enfocados en público chileno.</li>
        <li><strong>Cuenta pública:</strong> no se aceptan perfiles privados ni cuentas sin contenido previo.</li>
        <li><strong>Mínimo de seguidores:</strong> al menos 1.000 en la red donde vayas a publicar.</li>
        <li><strong>Contenido original:</strong> nada de resubidas masivas ni contenido protegido por copyright.</li>
        <li><strong>Compromiso antifraude:</strong> prohibido el uso de bots o intercambio de clics — la sanción es expulsión inmediata y pérdida de fondos acumulados.</li>
      </ul>`,
  },
  {
    p: '¿Puedo tomar una campaña si otros creadores ya la están haciendo?',
    r: `Sí. Las campañas son colaborativas, bajo libre competencia. Cuando una marca publica una campaña con un presupuesto total (por ejemplo, una bolsa de 1.000 clics), cualquier creador que cumpla los requisitos puede sumarse, descargar el material y crear su propio contenido.`,
  },
  {
    p: '¿Cómo se reparte el dinero de una campaña con varios creadores?',
    r: `Es 100% meritocrático: el dinero de la bolsa se distribuye en tiempo real según los clics válidos que consiga tu enlace único. Ejemplo: si una campaña ofrece una bolsa de 1.000 clics y tu video logra 700 antes de que se agote el presupuesto, te llevas el pago de esos 700 — el resto se reparte entre los demás creadores participantes.`,
  },
  {
    p: '¿Qué pasa si la campaña se agota mientras mi video sigue subido?',
    r: `En el instante en que la suma de clics de todos los creadores alcanza el total contratado por la marca, la campaña se cierra automáticamente y el enlace deja de contabilizar nuevos pagos. Conviene publicar rápido para asegurar la mayor cantidad de clics antes de que el presupuesto se agote.`,
  },
  {
    p: '¿Cómo sé que la plataforma está registrando todos los clics de mis videos?',
    r: `Tu panel muestra un contador en tiempo real con el <strong>100%</strong> de las interacciones que recibe tu enlace, no solo las que te pagan. Si alguien presiona tu link en Instagram, TikTok o YouTube, lo ves reflejado de inmediato.`,
  },
  {
    p: '¿Por qué mi saldo no coincide con los clics totales de mi panel?',
    r: `El sistema divide tus estadísticas en tres categorías: <strong>Clics totales</strong> (cada interacción, sin filtrar), <strong>Clics válidos</strong> (los que cumplen los requisitos de la marca y suman $120 CLP de inmediato) y <strong>Clics descartados</strong> (visitas reales que no califican para pago por normativa o filtros de seguridad).`,
  },
  {
    p: '¿Cuáles son las razones por las que se descarta un clic?',
    r: `<ul>
        <li><strong>Filtro geográfico:</strong> clics fuera de Chile — marcado como "Fuera del territorio nacional".</li>
        <li><strong>Filtro de duplicidad:</strong> si el mismo usuario hace clic varias veces seguidas, solo se valida el primero del día.</li>
        <li><strong>Filtros de seguridad:</strong> tráfico de VPN, incógnito automatizado o perfiles falsos se bloquea de inmediato.</li>
      </ul>`,
  },
  {
    p: '¿Cómo compruebo que me descontaron un clic de forma justa?',
    r: `Tienes acceso a una pestaña de "Auditoría de Tráfico" con el detalle de cada visita descartada: día, hora exacta, red social de origen y la razón técnica (por ejemplo: "IP de Santiago, Chile — Clic duplicado" o "IP de Lima, Perú — Fuera de Chile").`,
  },
  {
    p: 'Mi video es muy viral pero tengo pocos clics válidos, ¿qué está pasando?',
    r: `Es normal: cuando un video se vuelve muy viral, los algoritmos de TikTok o YouTube Shorts lo muestran a audiencias de toda Latinoamérica, y esos clics internacionales quedan descartados. Tu saldo crece según cuánto público chileno interactúe. Consejo: menciona en tu video o descripción que el beneficio es "válido solo para Chile" para filtrar a tu audiencia desde el inicio.`,
  },
  {
    p: 'Soy menor de edad, ¿puedo participar y retirar mis ganancias?',
    r: `Sí, puedes crear contenido entre los 14 y 17 años. Para tu primer retiro, el sistema exige los datos (RUT, nombre y CuentaRUT) de tu padre, madre o tutor legal — la boleta se emite a nombre del adulto responsable y el dinero se transfiere directamente a su cuenta.`,
  },
  {
    p: '¿Qué documentos legales respaldan el dinero que gano?',
    r: `Si no tienes inicio de actividades, la plataforma genera automáticamente una Boleta de Prestación de Servicios de Terceros ante el SII por cada retiro. Si eres creador formal o empresa, se pausa tu pago hasta que subas tu propia Factura Electrónica de Servicios Digitales por el monto exacto.`,
  },
  {
    p: '¿Mis datos personales y bancarios están seguros?',
    r: `Toda la información sensible (RUT, nombre completo, datos de transferencia) se almacena encriptada bajo estándar AES-256. Ningún administrador puede ver tus datos bancarios en texto plano, y los flujos de cobro están tokenizados para evitar filtraciones.`,
  },
  {
    p: '¿Por qué los pagos son solo en días específicos y con montos mínimos?',
    r: `Para procesar los pagos de forma segura sin que los bancos bloqueen las cuentas de la empresa, se usan sistemas de dispersión masiva (pagos en lote) programados para días fijos de la semana. Solo puedes retirar si alcanzas el monto mínimo establecido — las transferencias manuales directas no están disponibles.`,
  },
  {
    p: '¿Qué pasa si pongo el link directo en mi bio y me bloquean por spam?',
    r: `Está prohibido poner el enlace de redirección directo en la biografía principal de Instagram o TikTok — las redes lo detectan como spam masivo y pueden aplicarte un shadowban. Usa un agregador de enlaces (como Linktree o Beacons) y coloca el botón de la campaña dentro de esa micro-landing.`,
  },
  {
    p: '¿Cómo le hago llegar el link a mi audiencia si no puedo ponerlo en la descripción?',
    r: `Usamos un sistema de "Comentario a Mensaje Directo": invitas a tu audiencia a comentar una palabra clave (ej. "QUIERO") en tu video. El sistema detecta ese comentario y envía automáticamente un DM con tu link único de campaña.`,
  },
  {
    p: '¿Cómo elijo la palabra clave para mi video?',
    r: `Al activar una campaña en tu panel defines la palabra clave de ese video específico (o usas una sugerida por defecto). Cada palabra queda asociada únicamente a ese video, para que el sistema nunca mezcle el tráfico de una publicación con otra.`,
  },
  {
    p: '¿El sistema de DM funciona igual en Instagram y en TikTok?',
    r: `No exactamente. En Instagram el envío del DM es 100% automático vía integración oficial. En TikTok, por restricciones actuales de su API, el sistema detecta el comentario y te alerta para que respondas el DM manualmente con un clic — así se protege tu cuenta de bloqueos por automatización no oficial.`,
  },
  {
    p: '¿Qué pasa si alguien comenta la palabra clave pero nunca hace clic?',
    r: `No hay ningún problema ni penalización. El comentario y el envío del DM no generan pago por sí solos — solo se contabiliza y paga cuando la persona efectivamente hace clic y el sistema lo valida como real.`,
  },
  {
    p: '¿Puedo usar la misma palabra clave para varios videos a la vez?',
    r: `No se recomienda. Cada campaña activa debería usar una palabra clave distinta ligada a un video específico, para que tanto tú como la marca puedan ver con exactitud cuántas views y clics generó cada publicación por separado.`,
  },
  {
    p: '¿Necesito un tipo de cuenta especial en Instagram o TikTok?',
    r: `Sí, en Instagram necesitas una cuenta Business o Creator (gratuita) para que la integración pueda detectar comentarios y enviar DMs en tu nombre. En TikTok no se requiere una cuenta especial, ya que el proceso de respuesta es manual desde tu propia app.`,
  },
];

function crearItemFaq({ p, r }) {
  const item = document.createElement('div');
  item.className = 'faq-item';
  item.innerHTML = `
    <button type="button" class="faq-pregunta">
      <span>${p}</span>
      <span class="faq-icono">+</span>
    </button>
    <div class="faq-respuesta">
      <div class="faq-respuesta-inner">${r}</div>
    </div>
  `;
  item.querySelector('.faq-pregunta').addEventListener('click', () => {
    item.classList.toggle('abierto');
  });
  return item;
}

function renderFaq(tipo) {
  const contenedor = document.getElementById('faq-lista');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  const datos = tipo === 'creadores' ? FAQ_CREADORES : FAQ_MARCAS;
  datos.forEach(entrada => contenedor.appendChild(crearItemFaq(entrada)));
}

function inicializarFaq() {
  const tabs = document.querySelectorAll('.faq-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderFaq(tab.dataset.faqTab);
    });
  });
  renderFaq('marcas');
}

document.addEventListener('DOMContentLoaded', inicializarFaq);
