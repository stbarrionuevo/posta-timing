-- 2026-09-30: administración de usuarios desde la app (con la Edge Function
-- admin-users). Correr en el SQL Editor.

-- ---------------------------------------------------------------------------
-- Usuarios de la organización
-- ---------------------------------------------------------------------------
-- Crear usuarios y cambiar contraseñas requiere la clave de servicio: lo hace
-- la Edge Function admin-users (supabase/functions). Las membresías las
-- escribe el propio administrador (RLS "admin manages members"), así quedan
-- auditadas con su nombre.

-- Solo para la Edge Function (service_role): busca un usuario por email.
create or replace function auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

-- Miembros de la organización con su email y último ingreso (solo admin).
create or replace function list_org_members(p_org uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role member_role,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  perform require_org_role(p_org, array['admin']::member_role[]);
  return query
    select m.user_id, u.email::text, m.display_name, m.role, m.created_at, u.last_sign_in_at
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org
    order by m.role, coalesce(m.display_name, u.email::text);
end;
$$;

-- Nunca dejar una organización sin administrador.
create or replace function protect_last_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from memberships
       where organization_id = old.organization_id and role = 'admin' and user_id <> old.user_id
     ) then
    raise exception 'LAST_ADMIN: la organización tiene que tener al menos un administrador';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_memberships_last_admin on memberships;
create trigger trg_memberships_last_admin
  before update or delete on memberships
  for each row execute function protect_last_admin();

revoke update on memberships from authenticated;
grant update (role, display_name) on memberships to authenticated;

revoke execute on function auth_user_id_by_email(text), list_org_members(uuid), protect_last_admin()
  from public, anon, authenticated;
grant execute on function list_org_members(uuid) to authenticated;
grant execute on function auth_user_id_by_email(text) to service_role;
