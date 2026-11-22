# GuardiaMI

Para la versión compartida, consulta [Despliegue](DESPLIEGUE.md).
Aplicación local para digitalizar un cuadrante existente y gestionar cambios de Medicina Interna. La demostración usa exclusivamente perfiles ficticios.

## Abrir la demostración
En una terminal de esta carpeta, con Node.js 24 o posterior:

```powershell
pnpm install --frozen-lockfile
node prepare-ocr.mjs
node server.mjs --demo
```

Abre http://127.0.0.1:4317/. La demo guarda sus datos en data/demo.sqlite. Para detener el servidor, pulsa Ctrl+C.

1. Entra como **Coordinación**. Abre **Importar** y pulsa **Cargar ejemplo ficticio**.
2. Revisa las 12 casillas, confirma la revisión y publica. El ejemplo tiene dos días de noviembre de 2026.
3. Sal y entra como **Facultativo 01**. Selecciona el 23 de noviembre y pide un intercambio con HUNSC 1ª del 24 de noviembre.
4. Entra como **Facultativo 02**, abre **Solicitudes** y acepta.
5. Vuelve a **Coordinación** y aprueba. Comprueba los titulares y los salientes en **Mi calendario** tras volver a la cuenta correspondiente.

Las pantallas se sincronizan consultando el servidor cada cinco segundos. Para usar dos sesiones al mismo tiempo, abre una en una ventana privada o en otro perfil del navegador. Los cambios de la demo quedan en la base local.

## Importación
En **Importar → Importar desde una foto**, elige una imagen de frente, las fechas del primer y último renglón y las dos esquinas del recorte, sin encabezados. La tabla debe tener una fila por día y columnas de fecha y seis puestos. Puedes ajustar el ancho y orden de las columnas. La foto se lee en el dispositivo. Revisa todas las casillas y corrige las que queden sin identificar, incluida cualquier sigla que no coincida con un nombre de cuenta.

El formato sigue el ejemplo en la carpeta de traspaso. Usa la zona Atlantic/Canary, versión 1.0 y serviceId servicio-demo para esta instancia local. Coordinación puede consultar los identificadores de los perfiles en **Invitaciones**. Las casillas omitidas o sin identificar deben corregirse antes de publicar. Los cambios ya acordados quedan protegidos si se reimporta un cuadrante anterior.

En **Invitaciones** se puede generar un enlace de alta compartido que dura siete días. Cada persona crea una cuenta de facultativo e indica su nombre visible. Comparte el enlace solo con tu servicio. Coordinación puede desactivarlo o sustituirlo. Usa la invitación individual si necesitas vincular una cuenta a un perfil que ya figura en un cuadrante.

## Pruebas
```powershell
node --test
```

El conjunto comprueba salientes y límites de fechas, invitaciones de un solo uso, permisos, revisión obligatoria, intercambio y cobertura con consentimiento, conflicto concurrente sobre el mismo turno, protección frente a reimportación y avisos. Requiere conexión al servidor temporal por loopback. En el navegador se verificó el recorrido de coordinación desde la carga ficticia hasta el calendario publicado.

## Alcance de esta versión
- Una instancia para un servicio, con SQLite local y cuentas separadas. La vista compartida y los salientes se recalculan a partir de los mismos turnos.
- Se admite JSON y la lectura de fotografías de tablas. Ambas entradas requieren revisión humana antes de publicar.
- Los avisos están dentro de la aplicación. Correo, push y verificación automática del correo de invitación quedan pendientes. La coordinación comparte manualmente el enlace de un solo uso.
- La interfaz incluye manifiesto y caché de recursos estáticos. Queda por verificar la instalación y el comportamiento en dispositivos iPhone y Android.
- La aprobación por coordinación es la política provisional. Quedan pendientes festivos, descansos adicionales y habilitaciones específicas por puesto.
- El servidor escucha en loopback. Para un piloto compartido quedan pendientes alojamiento HTTPS, gestión de cuentas y sesiones, copias y restauración, y revisión de seguridad antes de cargar datos del servicio.
- El código se creó a partir del traspaso de requisitos. El ZIP v0.5 sigue sin estar disponible.

