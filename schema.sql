-- ============================================================
-- Click Mates — Esquema de base de datos v3 (billetera prepago)
-- ============================================================
-- ⚠️ ESTE ARCHIVO REEMPLAZA la v2 (presupuesto por campaña).
-- Si ya tenías un proyecto de Supabase con la v2 corriendo,
-- crea un proyecto NUEVO y corre este archivo completo ahí —
-- migrar en caliente cambia la forma de cobrar y no es trivial.
--
-- CÓMO USAR: SQL Editor de Supabase → New query → pega todo →
-- Run. Luego copia Project URL, anon key y service_role key
-- desde Project Settings → API.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- PERFILES
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('marca', 'creador')),
  nombre text not null,
  rut text not null,                -- validado en el navegador (dígito verificador), ver nota en README
  red_social text,                  -- solo creadores
  cuenta_transferencia text,        -- solo creadores — dato sensible

  -- Billetera de la marca (prepago): se recarga vía Webpay y se
  -- descuenta 150 CLP por cada clic válido, sin importar la campaña.
  saldo_billetera numeric(12,0) not null default 0,

  -- Contadores del creador
  clics_chile int not null default 0,        -- total histórico de clics válidos
  clics_liberados int not null default 0,    -- de esos, cuántos ya se liberaron a saldo disponible
  saldo_disponible numeric(12,0) not null default 0, -- liberado, pendiente de transferencia semanal
  saldo_transferido numeric(12,0) not null default 0, -- ya transferido en semanas anteriores

  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "perfil propio: select" on profiles
  for select using (auth.uid() = id);

create policy "perfil propio: insert" on profiles
  for insert with check (auth.uid() = id);

create policy "perfil propio: update" on profiles
  for update using (auth.uid() = id);

-- Vista pública sin datos sensibles (nombre visible para la otra parte)
create or replace view public_profiles as
  select id, tipo, nombre, red_social from profiles;

grant select on public_profiles to anon, authenticated;

-- ------------------------------------------------------------
-- CAMPAÑAS (ahora sin presupuesto propio — cobran de la billetera
-- de la marca; clics_objetivo es solo una meta informativa)
-- ------------------------------------------------------------
create table if not exists campanas (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null references profiles(id) on delete cascade,
  nombre_marca text not null,
  url text not null,
  clics_objetivo int not null default 150 check (clics_objetivo >= 150),
  clics_validos int not null default 0,
  clics_invalidos int not null default 0,
  created_at timestamptz not null default now()
);

alter table campanas enable row level security;

create policy "campanas: select publico" on campanas
  for select using (true);

create policy "campanas: insert propia marca" on campanas
  for insert with check (auth.uid() = marca_id);

create policy "campanas: update propia marca" on campanas
  for update using (auth.uid() = marca_id);

-- ------------------------------------------------------------
-- CONTENIDOS (antes "enlaces"): cada video/post de un creador
-- promocionando una campaña, con su propio enlace único y sus
-- propias métricas — un creador puede tener varios por campaña.
-- ------------------------------------------------------------
create table if not exists contenidos (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references campanas(id) on delete cascade,
  creador_id uuid not null references profiles(id) on delete cascade,
  nombre text not null,             -- ej: "Reel — Set de skincare"
  url_unica text not null unique,
  clics_validos int not null default 0,
  clics_invalidos int not null default 0,
  created_at timestamptz not null default now()
);

alter table contenidos enable row level security;

create policy "contenidos: select publico" on contenidos
  for select using (true);

create policy "contenidos: insert propio creador" on contenidos
  for insert with check (auth.uid() = creador_id);

-- ------------------------------------------------------------
-- CLICS (solo el servidor escribe aquí, vía service_role)
-- ------------------------------------------------------------
create table if not exists clics (
  id uuid primary key default gen_random_uuid(),
  contenido_id uuid not null references contenidos(id) on delete cascade,
  pais text,
  ip text,                   -- IP enmascarada para mostrar en los paneles (ej: 190.100.55.xxx)
  ip_hash text,              -- hash de la IP completa (nunca en texto plano), para el filtro "1 IP por enlace"
  es_proxy boolean not null default false,   -- true si la IP es VPN/proxy/hosting/IP dedicada
  motivo_invalido text,      -- 'duplicado' | 'vpn_o_ip_dedicada' | 'pais_no_cl' | 'sin_saldo' | null si es válido
  es_valido boolean not null,
  creado_en timestamptz not null default now()
);

alter table clics enable row level security;
-- Sin políticas de insert/select para anon/authenticated a propósito.

-- Un mismo IP solo puede generar UN clic válido por enlace/contenido.
-- Si la misma persona (mismo IP) entra varias veces al mismo enlace,
-- solo el primer clic cuenta; el resto queda anulado (motivo_invalido = 'duplicado').
create unique index if not exists uniq_ip_por_enlace_valido
  on clics (contenido_id, ip_hash)
  where es_valido = true and ip_hash is not null;

-- ------------------------------------------------------------
-- PAGOS DE MARCA (recargas de billetera vía Webpay Plus)
-- ------------------------------------------------------------
create table if not exists pagos_marca (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null references profiles(id) on delete cascade,
  monto numeric(12,0) not null,
  estado text not null default 'iniciado' check (estado in ('iniciado', 'pagado', 'fallido')),
  webpay_token text,
  webpay_buy_order text,
  creado_en timestamptz not null default now()
);

alter table pagos_marca enable row level security;

create policy "pagos_marca: select propia marca" on pagos_marca
  for select using (auth.uid() = marca_id);
-- Insert/update solo vía service_role (Netlify Functions).

-- ------------------------------------------------------------
-- PAGOS A CREADORES (ledger de transferencias semanales manuales)
-- ------------------------------------------------------------
create table if not exists pagos_creador (
  id uuid primary key default gen_random_uuid(),
  creador_id uuid not null references profiles(id) on delete cascade,
  monto numeric(12,0) not null,
  semana date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'transferido')),
  creado_en timestamptz not null default now()
);

alter table pagos_creador enable row level security;

create policy "pagos_creador: select propio" on pagos_creador
  for select using (auth.uid() = creador_id);

-- ============================================================
-- FUNCIONES
-- ============================================================

-- Registra un clic sobre un contenido, aplicando el filtro
-- geográfico Y descontando de la billetera prepago de la marca.
create or replace function registrar_clic(
  p_contenido_id uuid,
  p_pais text,
  p_ip_hash text,
  p_es_proxy boolean,
  p_ip_mostrar text,
  p_es_bot boolean default false
)
returns table(campana_url text, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campana_id uuid;
  v_creador_id uuid;
  v_marca_id uuid;
  v_url text;
  v_saldo_billetera numeric;
  v_cpc_marca numeric := 150;
  v_cpc_creador numeric := 120;
  v_valido boolean := true;
  v_motivo text := null;
  v_duplicado boolean;
  v_clics_recientes int;
  v_limite_velocidad int := 20;      -- máx. clics válidos permitidos...
  v_ventana_velocidad interval := interval '10 minutes'; -- ...en esta ventana de tiempo, por creador
begin
  select c.campana_id, c.creador_id into v_campana_id, v_creador_id
  from contenidos c where c.id = p_contenido_id;

  if v_campana_id is null then
    return query select null::text, false;
    return;
  end if;

  select ca.url, ca.marca_id into v_url, v_marca_id
  from campanas ca where ca.id = v_campana_id;

  -- Bloqueo por transacción para que dos clics simultáneos del mismo IP
  -- al mismo enlace no se cuelen ambos como "primer clic válido".
  perform pg_advisory_xact_lock(hashtextextended(p_contenido_id::text || '|' || coalesce(p_ip_hash, ''), 0));

  -- Filtro 1: geolocalización (solo IP chilena)
  if p_pais is distinct from 'CL' then
    v_valido := false;
    v_motivo := 'pais_no_cl';
  end if;

  -- Filtro 2: VPN / proxy / hosting / IP dedicada
  if v_valido and p_es_proxy then
    v_valido := false;
    v_motivo := 'vpn_o_ip_dedicada';
  end if;

  -- Filtro 3: bots / scripts (user-agent no parece un navegador real)
  if v_valido and p_es_bot then
    v_valido := false;
    v_motivo := 'bot_detectado';
  end if;

  -- Filtro 4: solo 1 clic válido por IP y por enlace (evita que el mismo
  -- creador mande a un conocido a hacer clic varias veces al mismo link)
  if v_valido and p_ip_hash is not null then
    select exists(
      select 1 from clics
      where contenido_id = p_contenido_id and ip_hash = p_ip_hash and es_valido = true
    ) into v_duplicado;

    if v_duplicado then
      v_valido := false;
      v_motivo := 'duplicado';
    end if;
  end if;

  -- Filtro 5: velocidad sospechosa — un flujo orgánico y humano de clics
  -- no suele llegar a decenas de clics válidos en pocos minutos para
  -- el mismo creador. Si pasa, se corta el pago automático.
  if v_valido then
    select count(*) into v_clics_recientes
    from clics cl
    join contenidos co on co.id = cl.contenido_id
    where co.creador_id = v_creador_id
      and cl.es_valido = true
      and cl.creado_en > now() - v_ventana_velocidad;

    if v_clics_recientes >= v_limite_velocidad then
      v_valido := false;
      v_motivo := 'velocidad_sospechosa';
    end if;
  end if;

  select p.saldo_billetera into v_saldo_billetera
  from profiles p where p.id = v_marca_id
  for update; -- bloquea la billetera de la marca para evitar condiciones de carrera

  if v_valido and v_saldo_billetera >= v_cpc_marca then
    update profiles set saldo_billetera = saldo_billetera - v_cpc_marca where id = v_marca_id;

    update contenidos set clics_validos = clics_validos + 1 where id = p_contenido_id;
    update campanas set clics_validos = clics_validos + 1 where id = v_campana_id;

    update profiles set clics_chile = clics_chile + 1 where id = v_creador_id;
  else
    if v_valido then
      v_motivo := 'sin_saldo'; -- pasó los filtros antifraude pero la marca no tiene saldo
    end if;
    update contenidos set clics_invalidos = clics_invalidos + 1 where id = p_contenido_id;
    update campanas set clics_invalidos = clics_invalidos + 1 where id = v_campana_id;
    v_valido := false;
  end if;

  insert into clics (contenido_id, pais, ip, ip_hash, es_proxy, motivo_invalido, es_valido)
  values (p_contenido_id, p_pais, p_ip_mostrar, p_ip_hash, p_es_proxy, v_motivo, v_valido);

  return query select v_url, true;
end;
$$;

-- Abona un pago de Webpay ya autorizado a la billetera de la marca.
-- Idempotente: si Transbank reintenta la confirmación, no duplica el abono.
create or replace function aplicar_pago_marca(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca_id uuid;
  v_monto numeric;
  v_estado text;
begin
  select marca_id, monto, estado into v_marca_id, v_monto, v_estado
  from pagos_marca where id = p_pago_id
  for update;

  if v_estado = 'pagado' then
    return;
  end if;

  update pagos_marca set estado = 'pagado' where id = p_pago_id;
  update profiles set saldo_billetera = saldo_billetera + v_monto where id = v_marca_id;
end;
$$;

-- Libera a saldo disponible los clics del creador que ya completaron
-- un bloque de 150. Solo el propio creador (o el servidor) puede llamarla.
create or replace function liberar_saldo_creador(p_creador_id uuid)
returns table(bloques_liberados int, monto_liberado numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_umbral int := 150;
  v_pago_por_clic numeric := 120;
  v_clics_chile int;
  v_clics_liberados int;
  v_pendientes int;
  v_bloques int;
begin
  if auth.uid() is distinct from p_creador_id then
    raise exception 'No autorizado';
  end if;

  select clics_chile, clics_liberados into v_clics_chile, v_clics_liberados
  from profiles where id = p_creador_id
  for update;

  v_pendientes := v_clics_chile - v_clics_liberados;
  v_bloques := floor(v_pendientes::numeric / v_umbral);

  if v_bloques <= 0 then
    return query select 0, 0::numeric;
    return;
  end if;

  update profiles
    set clics_liberados = clics_liberados + (v_bloques * v_umbral),
        saldo_disponible = saldo_disponible + (v_bloques * v_umbral * v_pago_por_clic)
    where id = p_creador_id;

  return query select v_bloques, (v_bloques * v_umbral * v_pago_por_clic)::numeric;
end;
$$;

-- Genera automáticamente la URL única de cada contenido/enlace.
create or replace function generar_url_contenido()
returns trigger
language plpgsql
as $$
begin
  if new.url_unica is null then
    new.url_unica := 'https://clickmates.cl/r/' || replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generar_url_contenido on contenidos;
create trigger trg_generar_url_contenido
  before insert on contenidos
  for each row execute function generar_url_contenido();

-- ------------------------------------------------------------
-- DETALLE Y RESUMEN DE CLICS (para las tablas de fraude en los paneles)
-- ------------------------------------------------------------
-- La tabla `clics` no tiene políticas de SELECT para anon/authenticated
-- a propósito (ver más arriba). Solo se puede leer a través de estas
-- funciones, que filtran SIEMPRE por el usuario que está llamando
-- (auth.uid()), así una marca nunca ve clics de otra marca y un
-- creador nunca ve clics de otro creador.

-- Detalle de clics de TODAS las campañas de la marca que llama la función.
create or replace function obtener_clics_marca(p_limite int default 200)
returns table(
  creado_en timestamptz,
  creador_nombre text,
  contenido_nombre text,
  ip text,
  pais text,
  es_proxy boolean,
  es_valido boolean,
  motivo_invalido text
)
language sql
security definer
set search_path = public
as $$
  select cl.creado_en, pr.nombre, co.nombre, cl.ip, cl.pais, cl.es_proxy, cl.es_valido, cl.motivo_invalido
  from clics cl
  join contenidos co on co.id = cl.contenido_id
  join campanas ca on ca.id = co.campana_id
  join profiles pr on pr.id = co.creador_id
  where ca.marca_id = auth.uid()
  order by cl.creado_en desc
  limit p_limite;
$$;

-- Resumen (cuántos válidos vs. anulados y por qué motivo) para la marca.
create or replace function resumen_clics_marca()
returns table(estado text, cantidad bigint)
language sql
security definer
set search_path = public
as $$
  select
    case when cl.es_valido then 'valido' else coalesce(cl.motivo_invalido, 'otro') end as estado,
    count(*) as cantidad
  from clics cl
  join contenidos co on co.id = cl.contenido_id
  join campanas ca on ca.id = co.campana_id
  where ca.marca_id = auth.uid()
  group by 1;
$$;

-- Detalle de clics de TODOS los contenidos del creador que llama la función.
create or replace function obtener_clics_creador(p_limite int default 200)
returns table(
  creado_en timestamptz,
  contenido_nombre text,
  nombre_marca text,
  ip text,
  pais text,
  es_proxy boolean,
  es_valido boolean,
  motivo_invalido text
)
language sql
security definer
set search_path = public
as $$
  select cl.creado_en, co.nombre, ca.nombre_marca, cl.ip, cl.pais, cl.es_proxy, cl.es_valido, cl.motivo_invalido
  from clics cl
  join contenidos co on co.id = cl.contenido_id
  join campanas ca on ca.id = co.campana_id
  where co.creador_id = auth.uid()
  order by cl.creado_en desc
  limit p_limite;
$$;

-- Resumen (cuántos válidos vs. anulados y por qué motivo) para el creador.
create or replace function resumen_clics_creador()
returns table(estado text, cantidad bigint)
language sql
security definer
set search_path = public
as $$
  select
    case when cl.es_valido then 'valido' else coalesce(cl.motivo_invalido, 'otro') end as estado,
    count(*) as cantidad
  from clics cl
  join contenidos co on co.id = cl.contenido_id
  where co.creador_id = auth.uid()
  group by 1;
$$;

grant execute on function obtener_clics_marca(int) to authenticated;
grant execute on function resumen_clics_marca() to authenticated;
grant execute on function obtener_clics_creador(int) to authenticated;
grant execute on function resumen_clics_creador() to authenticated;
