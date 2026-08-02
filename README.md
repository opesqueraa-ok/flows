# 𝖿𝗅𝗈𝗐𝗌 — Asistente de rutina y sueño

Asistente personal (PWA) que aprende tu rutina diaria y tus ciclos de sueño para reducir la cantidad de decisiones que tomas cada mañana. Todo se registra con un solo toque; nada se escribe a mano.

## Qué incluye esta primera versión

- **Rutinas personalizables** — crea, edita y reordena las actividades de cada rutina (Universidad, Trabajo, Gimnasio, etc.).
- **Registro de un toque** — la app guarda la hora exacta al presionar cada actividad; nunca escribes horas.
- **Cálculo automático de duraciones** entre cada paso.
- **Aprendizaje de hábitos** — los tiempos promedio se recalculan solos con cada rutina completada (sin valores predeterminados falsos).
- **Objetivo de llegada (Módulo 2)** — defines la hora en la que quieres completar el último paso y la app calcula hacia atrás, con tus promedios reales, la hora ideal de cada actividad y de despertar.
- **Ciclos de sueño (Módulo 3)** — Modo A (hora fija de despertar → mejores horas para dormir) y Modo B (te duermes ahora → mejores horas de alarma), con un indicador en vivo de cuántos ciclos completos aún alcanzas.
- **"Lo veo mañana"** — notas rápidas para soltar pendientes antes de dormir.
- **Panel diario** — solo muestra el siguiente paso, nunca la lista completa.
- **Resumen** — duración total, comparación contra tu promedio, patrones simples por día de la semana y resumen de sueño.
- **Funciona sin conexión** una vez instalada (Service Worker + almacenamiento 100% local en `localStorage`, no se envía nada a ningún servidor).

## Estructura de archivos

```
index.html       Estructura de la app
style.css        Estilos (paleta Ocean Breeze)
app.js           Toda la lógica: estado, rutinas, sueño, notas, resumen
manifest.json    Metadatos de instalación (PWA)
sw.js            Service worker para uso sin conexión
icon.svg         Ícono de la app
.gitignore
README.md
```

## Probarla localmente

No necesitas build ni dependencias. Basta con servir la carpeta:

```bash
cd fluye
python3 -m http.server 8000
# abre http://localhost:8000
```

(Abrir `index.html` directamente con doble clic también funciona, aunque el Service Worker solo se activa correctamente al servirse por http/https.)

## Publicarla en GitHub Pages

1. Sube estos archivos a un repositorio (instrucciones abajo).
2. En el repositorio, ve a **Settings → Pages**.
3. En **Build and deployment → Source**, elige **Deploy from a branch**.
4. Selecciona la rama `main` y la carpeta `/root` (o `/docs` si prefieres esa convención).
5. Guarda. GitHub te dará una URL tipo `https://tuusuario.github.io/nombre-repo/`.
6. Abre esa URL desde el iPhone en Safari → botón compartir → **"Agregar a pantalla de inicio"**. Quedará instalada como una app nativa, usando `manifest.json` e `icon.svg`.

### Comandos para subir el proyecto por primera vez

```bash
cd fluye
git init
git add .
git commit -m "Primera versión de Fluye"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/NOMBRE-REPO.git
git push -u origin main
```

## Qué llenar en el formulario "Create a new repository" de GitHub

Con base en el formulario que compartiste:

- **Repository owner**: tu usuario o la organización donde quieras alojarlo (déjalo como está si es tu cuenta personal).
- **Repository name**: un nombre corto y memorable, por ejemplo `fluye` o `fluye-rutina`. Evita espacios; usa guiones si necesitas separar palabras.
- **Description** (opcional): algo como *"Asistente personal de rutina diaria y ciclos de sueño (PWA)"*.
- **Visibility**: **Public** si no te importa que el código sea visible (necesario para el plan gratuito de GitHub Pages en cuentas personales; también puedes usar **Private** y Pages seguirá funcionando en cuentas Pro/Team/Enterprise). Como esta app no maneja datos de otras personas ni credenciales, público es una opción razonable.
- **Add a README**: dejarlo en **Off** está bien — ya incluyes el README.md de este proyecto al subir los archivos. Si prefieres crear el repo vacío primero y subir después, actívalo para tener el primer commit listo y luego reemplázalo con este README.
- **Add .gitignore**: no hace falta elegir una plantilla aquí; este proyecto ya trae su propio `.gitignore`. Si de todos modos quieres elegir una en el formulario, la plantilla **"Node"** no aplica (no usamos Node); puedes dejarlo en **None**.
- **Add a license**: opcional. Si algún día quieres que otras personas puedan reutilizar el código libremente, **MIT License** es la opción más simple y permisiva. Si prefieres mantenerlo privado/sin reuso, déjalo en **None**.

No necesitas nada adicional en el formulario: no hay build step, no hay dependencias de npm, no hay variables de entorno ni secretos que configurar. Es HTML/CSS/JS puro pensado para GitHub Pages.

## Próximos pasos sugeridos

- Añadir más patrones estadísticos (correlación hora de dormir ↔ tiempo para levantarte) conforme se acumulen más noches registradas.
- Exportar/importar el estado en JSON como respaldo manual.
- Sincronización opcional (por ejemplo, con un Gist privado) cuando quieras usar la app en más de un dispositivo.
