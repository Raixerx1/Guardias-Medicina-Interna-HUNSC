# Alojamiento de GuardiaMI

El proyecto creado en Vercel es raixer/guardia-mi, en Frankfurt. La dirección estable es https://guardia-mi.vercel.app/. El despliegue inicial contiene código, sin la base local ni datos de personas.

## Conectar el almacenamiento

1. Desde el proyecto en Vercel, crear un Blob privado dedicado en Frankfurt y conectarlo solo al entorno Production. La integración debe proporcionar BLOB_STORE_ID con OIDC o BLOB_READ_WRITE_TOKEN como secreto del servidor.
2. Crear un token aleatorio de activación para coordinación. Guardar solo su SHA-256 en GUARDIAMI_SETUP_SHA256, como variable de entorno de producción. Conservar el token original de forma privada para entregárselo a la persona que activará coordinación.
3. Volver a desplegar y comprobar GET /api/session. Antes de la activación, debe devolver 200 con demo false, me null y setup true. GET /api/state sin sesión debe devolver 401. Mientras falte el almacenamiento, la API devuelve 503.
4. Abrir la dirección de producción con el fragmento #setup= seguido del token original. La persona responsable introduce su dirección y elige su contraseña. Tras el primer guardado, el servidor deshabilita la activación inicial. Retirar la variable de activación tras verificar el acceso.
5. Comprobar desde otro perfil de navegador una invitación ficticia, la caducidad y el uso único. Confirmar que la sesión activa y sus datos sobreviven a un nuevo despliegue. La demostración local sigue usando su SQLite separada.

El guardado en Blob privado usa lectura sin caché y verificación del ETag previo. Si otra petición modifica el estado en paralelo, la operación se revalida sobre el estado nuevo. La aplicación usa un único documento de estado y está pensada para un piloto de un solo servicio. Antes de cargar el cuadrante real, configurar y probar copias y restauración del estado privado y revisar el acceso de coordinación.

## Repositorio

El repositorio local contiene código y documentación. data, .env y .vercel están excluidos. Crear un repositorio privado en la cuenta autorizada, publicar main y conectar esa rama al proyecto existente. Si el conector no tiene permiso para crear repositorios, se requiere una sesión de GitHub con ese permiso. El primer despliegue se hizo directamente desde los archivos.
