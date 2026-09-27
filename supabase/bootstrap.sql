-- Alta de una organización cliente y su primer administrador.
-- Correr en el SQL Editor (con permisos de dueño), una vez por cliente.
--
-- Antes: crear el usuario en Authentication > Users > Add user
-- (email + contraseña, marcar "Auto Confirm User").

insert into organizations (name, slug)
values ('Nombre de la organización', 'slug-de-la-organizacion');

insert into memberships (organization_id, user_id, role, display_name)
select o.id, 'a3138121-3d10-40ae-8e44-620b66fcb34d', 'admin', 'Santiago T Barrionuevo'
from organizations o
where o.slug = 'slug-de-la-organizacion';

-- Jueces y operadores: mismo insert en memberships con role 'judge' u 'operator'.
