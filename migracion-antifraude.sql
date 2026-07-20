-- ============================================================
-- Click Mates — Migración: filtro antifraude (VPN + 1 IP por enlace)
-- ============================================================
-- Solo necesitas correr este archivo si YA tenías el proyecto de
-- Supabase funcionando con el schema.sql anterior (sin estas
-- columnas). Si vas a crear el proyecto desde cero, NO uses este
-- archivo: solo corre schema.sql completo, ya lo incluye.
--
-- Cómo usar: Supabase → SQL Editor → New query → pega todo → Run.
-- ============================================================

alter table clics add column if not exists ip_hash text;
alter table clics add column if not exists es_proxy boolean not null default false;
alter table clics add column if not exists motivo_invalido text;
alter table clics add column if not exists ip text;

create unique index if not exists uniq_ip_por_enlace_valido
  on clics (contenido_id, ip_hash)
  where es_valido = true and ip_hash is not null;

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
  v_limite_velocidad int := 20;
  v_ventana_velocidad interval := interval '10 minutes';
begin
  select c.campana_id, c.creador_id into v_campana_id, v_creador_id
  from contenidos c where c.id = p_contenido_id;

  if v_campana_id is null then
    return query select null::text, false;
    return;
  end if;

  select ca.url, ca.marca_id into v_url, v_marca_id
  from campanas ca where ca.id = v_campana_id;

  perform pg_advisory_xact_lock(hashtextextended(p_contenido_id::text || '|' || coalesce(p_ip_hash, ''), 0));

  if p_pais is distinct from 'CL' then
    v_valido := false;
    v_motivo := 'pais_no_cl';
  end if;

  if v_valido and p_es_proxy then
    v_valido := false;
    v_motivo := 'vpn_o_ip_dedicada';
  end if;

  if v_valido and p_es_bot then
    v_valido := false;
    v_motivo := 'bot_detectado';
  end if;

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
  for update;

  if v_valido and v_saldo_billetera >= v_cpc_marca then
    update profiles set saldo_billetera = saldo_billetera - v_cpc_marca where id = v_marca_id;

    update contenidos set clics_validos = clics_validos + 1 where id = p_contenido_id;
    update campanas set clics_validos = clics_validos + 1 where id = v_campana_id;

    update profiles set clics_chile = clics_chile + 1 where id = v_creador_id;
  else
    if v_valido then
      v_motivo := 'sin_saldo';
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

-- ------------------------------------------------------------
-- Nuevas funciones para las tablas de fraude en los paneles
-- ------------------------------------------------------------

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
