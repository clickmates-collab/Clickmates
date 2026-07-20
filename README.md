## 🛡️ Filtro antifraude (nuevo)

Cada clic pasa por 3 filtros antes de contar como válido y pagar:

1. **Geolocalización**: solo cuenta si la IP es de Chile.
2. **VPN / proxy / hosting / IP dedicada**: se detecta con
   [ip-api.com](https://ip-api.com) (gratis, sin llave) y se bloquea.
3. **1 IP por enlace**: si la misma IP entra dos o más veces al mismo
   enlace, solo el primer clic cuenta — los siguientes quedan
   anulados con motivo `duplicado`. Así, si un creador manda a un
   conocido a hacer clic sin interés real, ese clic solo suma una vez
   (y si lo repite, ni siquiera eso).

La IP nunca se guarda en texto plano: se guarda un hash (con una
sal secreta que tú defines en `IP_HASH_SALT`) que solo sirve para
comparar "es la misma IP", no para recuperar la IP original.

Cada clic anulado queda registrado en la tabla `clics` con su
`motivo_invalido` (`pais_no_cl`, `vpn_o_ip_dedicada`, `duplicado` o
`sin_saldo`), por si más adelante quieres mostrar esas estadísticas
en el dashboard.

Si tu proyecto de Supabase ya estaba corriendo con el schema
anterior, corre `supabase/migracion-antifraude.sql` en vez de
`schema.sql` completo (que es solo para proyectos nuevos).

---

# Click Mates — Puesta en marcha (versión funcional)

Esta versión ya NO usa LocalStorage: los datos viven en una base de
datos real (Supabase) y los clics se validan en un servidor
(Netlify Functions), con IP real y cobro/pago real vía Webpay Plus.


## ⚠️ Cambios en esta versión (v3)

Esta versión reemplaza el modelo anterior (presupuesto por campaña)
por uno de **billetera prepago**:

- La marca recarga una billetera general (no por campaña) y cada
  clic válido descuenta $150 CLP de ahí, sin importar a qué campaña
  pertenezca.
- El creador acumula clics válidos, pero el saldo solo se vuelve
  retirable en **bloques de 150 clics** (botón "Liberar saldo").
- Cada video/post de un creador es un "contenido" con su propio
  enlace y sus propias métricas — un creador puede tener varios
  contenidos por campaña.
- Al crear una cuenta, se pide el RUT y se valida su **dígito
  verificador** con el algoritmo oficial chileno (módulo 11). Esto
  confirma que el número es válido matemáticamente — **no** confirma
  que pertenezca a una persona o empresa real. Verificación de
  identidad real requeriría integrar el Registro Civil o el SII,
  fuera del alcance actual.

Si ya tenías un proyecto de Supabase con el esquema anterior, crea
uno **nuevo** y corre `supabase/schema.sql` ahí — no es una
migración compatible con datos existentes.

---

Sigue estos pasos en orden. Ninguno es opcional.

---

## 1. Crear el proyecto en Supabase (base de datos + login)

1. Ve a https://supabase.com → **New project** (plan gratis alcanza para partir).
2. Cuando esté listo, entra a **SQL Editor** → **New query**.
3. Abre el archivo `supabase/schema.sql` de esta carpeta, copia TODO
   el contenido, pégalo ahí y presiona **Run**.
4. Ve a **Project Settings → API** y copia estos tres valores, los
   necesitarás en los pasos siguientes:
   - `Project URL`
   - `anon public` key
   - `service_role` key (⚠️ es secreta, nunca la pongas en el frontend)
5. Ve a **Authentication → Providers → Email** y confirma que el
   login por email/contraseña esté activado (viene activado por
   defecto). Si quieres partir probando rápido sin configurar envío
   de emails, puedes desactivar temporalmente "Confirm email" en
   **Authentication → Settings**.

## 2. Configurar el frontend con tu proyecto de Supabase

Abre `app.js` y reemplaza estas dos líneas con tus valores reales:

```js
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY-AQUI';
```

La `anon key` es pública a propósito (la usan todos los navegadores);
lo que la protege es la seguridad por fila (RLS) que ya quedó
configurada en `schema.sql`.

## 3. Obtener credenciales de Webpay Plus (Transbank)

- **Para pruebas (sandbox)**: no necesitas hacer nada — el código ya
  usa las credenciales públicas de integración de Transbank
  (`IntegrationCommerceCodes` / `IntegrationApiKeys`), pensadas
  exactamente para este propósito.
- **Para producción (cobrar de verdad)**: debes afiliarte como
  comercio en https://www.transbankdevelopers.cl — Transbank revisa
  y aprueba tu cuenta (puede tomar días) y te entrega un
  `commerce code` y `api key` reales.

## 4. Desplegar en Netlify con funciones de servidor

Esta vez el sitio necesita variables de entorno y funciones — no
basta con arrastrar los archivos.

1. Sube esta carpeta completa a un repositorio de GitHub (o usa
   Netlify CLI / "Deploy manually" con la carpeta completa incluyendo
   `netlify/functions`).
2. En Netlify: **Site settings → Environment variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | tu Project URL de Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | tu service_role key de Supabase |
   | `SITE_URL` | la URL pública de tu sitio, ej. `https://clickmates.netlify.app` (sin barra final) |
   | `TBK_ENVIRONMENT` | `integration` mientras pruebas, `production` cuando Transbank te apruebe |
   | `TBK_COMMERCE_CODE` | solo en producción — te lo entrega Transbank |
   | `TBK_API_KEY` | solo en producción — te lo entrega Transbank |
   | `IP_HASH_SALT` | cualquier texto secreto que inventes (ej. una frase larga random). Se usa para anonimizar las IP antes de guardarlas. |

3. Netlify detectará `netlify.toml` automáticamente e instalará las
   dependencias de `package.json` para las funciones. Si despliegas
   manualmente sin Git, corre `npm install` dentro de esta carpeta
   antes de subirla, para que `node_modules` viaje junto a las
   funciones.
4. Vuelve a desplegar (**Trigger deploy**) después de guardar las
   variables de entorno — no se aplican a builds ya hechos.

## 5. Probar el flujo completo

1. Entra al sitio → sección "Para marcas" → crea una cuenta y publica
   una campaña.
2. En el dashboard de marca, usa "Recargar presupuesto" para probar
   Webpay (en modo integración, Transbank te deja usar una tarjeta de
   prueba — la documentación de Transbank Developers detalla los
   datos exactos de tarjeta a usar en el ambiente de integración).
3. Abre una ventana de incógnito → sección "Para creadores" → crea
   una cuenta de creador → "Participar" en la campaña → copia el
   enlace generado.
4. Abre ese enlace (`/r/xxxx`) desde un navegador o celular real: la
   función `click.js` detectará tu IP real, y si es chilena, sumará
   saldo al creador y descontará presupuesto a la marca. Actualiza el
   dashboard para verlo reflejado.

## Lo que sigue faltando para producción completa

- **Pago automático a creadores**: Webpay solo sirve para *cobrar*
  (a las marcas), no para *pagar* (a los creadores). Para
  transferencias automáticas a CuentaRUT cada domingo necesitas un
  servicio adicional (ej. Fintoc, o la API de transferencias de tu
  banco). Por ahora, el saldo pendiente queda calculado y visible en
  el dashboard del creador; la transferencia se hace manualmente y
  luego se marca en la tabla `pagos_creador`.
- **Verificación de identidad / KYC** de marcas y creadores antes de
  mover dinero real, si decides operar a mayor escala.
- **Boletas/facturas** ante el SII por la comisión de la plataforma
  (diferencia entre los $150 cobrados y los $120 pagados).
- **Confirmación de email** de Supabase Auth: actívala en producción
  para evitar cuentas falsas (quedó mencionada como opcional en el
  paso 1 solo para que puedas probar rápido).
