// =====================================
// Google Drive: inicio de sesión y sincronización.
//
// - Inicio de sesión con Google Identity Services (modelo de token): da
//   un token de acceso de una hora. Al vencer se pide otro; si el
//   navegador no deja abrir la ventana de Google sin un clic, el tablero
//   muestra "Tocá para sincronizar".
// - Permiso drive.file: Hormiguero solo ve los archivos que crea. Todo va
//   a una carpeta visible "Hormiguero" (con una subcarpeta "meses").
// - La fusión es de sincronizar.js; acá solo se leen y escriben archivos.
// =====================================

(function (H) {

    const ALCANCE = "https://www.googleapis.com/auth/drive.file";
    const API = "https://www.googleapis.com/drive/v3";
    const SUBIDA = "https://www.googleapis.com/upload/drive/v3";
    const CARPETA = "application/vnd.google-apps.folder";
    const NOMBRE_CARPETA = "Hormiguero";

    let token = null;
    let vence = 0;
    let gis = null;

    class SinPermiso extends Error {
        constructor() { super("Hay que volver a conectar con Google."); this.sinPermiso = true; }
    }

    function configurado() {
        return Boolean(H.config && H.config.googleClientId);
    }

    function tieneToken() {
        return Boolean(token) && Date.now() < vence;
    }

    // ---------- Google Identity Services ----------

    function cargarGis() {
        if (gis) return gis;
        gis = new Promise((resolver, rechazar) => {
            if (window.google && google.accounts && google.accounts.oauth2) return resolver();
            const s = document.createElement("script");
            s.src = "https://accounts.google.com/gsi/client";
            s.async = true;
            s.onload = () => resolver();
            s.onerror = () => { gis = null; rechazar(new Error("No se pudo cargar el inicio de sesión de Google. ¿Hay conexión?")); };
            document.head.appendChild(s);
        });
        return gis;
    }

    // interactivo: true cuando viene de un clic (puede mostrar la ventana
    // de Google). false: intenta sin mostrar nada; si hace falta, falla.
    async function conectar(interactivo) {
        if (!configurado()) throw new Error("Falta configurar el ID de cliente de Google (js/config.js).");
        await cargarGis();
        return new Promise((resolver, rechazar) => {
            const cliente = google.accounts.oauth2.initTokenClient({
                client_id: H.config.googleClientId,
                scope: ALCANCE,
                prompt: interactivo ? "" : "none",
                callback: r => {
                    if (r.error) return rechazar(new Error(r.error_description || r.error));
                    if (!google.accounts.oauth2.hasGrantedAllScopes(r, ALCANCE)) {
                        return rechazar(new Error("Hace falta permitir el acceso a los archivos de Hormiguero en Drive."));
                    }
                    token = r.access_token;
                    vence = Date.now() + (Number(r.expires_in) - 60) * 1000;
                    resolver();
                },
                error_callback: e => {
                    const mensajes = {
                        popup_closed: "Se cerró la ventana de Google antes de terminar.",
                        popup_failed_to_open: "El navegador bloqueó la ventana de Google.",
                    };
                    rechazar(new Error(mensajes[e.type] || e.message || "No se pudo conectar con Google."));
                },
            });
            cliente.requestAccessToken();
        });
    }

    function desconectar() {
        if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, () => {});
        token = null;
        vence = 0;
    }

    // ---------- API de Drive ----------

    async function pedido(url, opciones = {}) {
        if (!tieneToken()) throw new SinPermiso();
        const r = await fetch(url, { ...opciones, headers: { Authorization: "Bearer " + token, ...(opciones.headers || {}) } });
        if (r.status === 401) { token = null; throw new SinPermiso(); }
        if (!r.ok) {
            let detalle = "";
            try { detalle = (await r.json()).error.message; } catch (e) { /* sin detalle */ }
            throw new Error(`Google Drive respondió ${r.status}${detalle ? ": " + detalle : ""}`);
        }
        return r;
    }

    function comillas(texto) {
        return "'" + texto.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    }

    async function buscar(q) {
        const archivos = [];
        let pagina = "";
        do {
            const url = `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,modifiedTime,parents)&pageSize=1000&spaces=drive` +
                (pagina ? "&pageToken=" + pagina : "");
            const datos = await (await pedido(url)).json();
            archivos.push(...datos.files);
            pagina = datos.nextPageToken;
        } while (pagina);
        return archivos;
    }

    async function crearCarpeta(nombre, padre) {
        const r = await pedido(`${API}/files?fields=id`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: nombre, mimeType: CARPETA, parents: padre ? [padre] : undefined }),
        });
        return (await r.json()).id;
    }

    // La carpeta con ese nombre (la más vieja si hay varias) o una nueva.
    async function carpeta(nombre, padre) {
        let q = `mimeType='${CARPETA}' and name=${comillas(nombre)} and trashed=false`;
        if (padre) q += ` and ${comillas(padre)} in parents`;
        const encontradas = await buscar(q);
        if (encontradas.length) return encontradas.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime))[0].id;
        return crearCarpeta(nombre, padre);
    }

    async function bajar(id) {
        const r = await pedido(`${API}/files/${id}?alt=media`);
        try {
            return await r.json();
        } catch (e) {
            return null; // no es JSON: sincronizar.js lo ignora
        }
    }

    async function crearArchivo(nombre, padre, contenido) {
        const limite = "hormiguero" + Math.random().toString(36).slice(2);
        const cuerpo =
            `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify({ name: nombre, parents: [padre], mimeType: "application/json" }) +
            `\r\n--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify(contenido) +
            `\r\n--${limite}--`;
        const r = await pedido(`${SUBIDA}/files?uploadType=multipart&fields=id,modifiedTime`, {
            method: "POST",
            headers: { "Content-Type": "multipart/related; boundary=" + limite },
            body: cuerpo,
        });
        return r.json();
    }

    async function actualizarArchivo(id, contenido) {
        const r = await pedido(`${SUBIDA}/files/${id}?uploadType=media&fields=id,modifiedTime`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify(contenido),
        });
        return r.json();
    }

    // ---------- Un ciclo de sincronización ----------

    // Devuelve { recibidos, subidos, ignorados }.
    async function sincronizar() {
        const raiz = await carpeta(NOMBRE_CARPETA);
        const meses = await carpeta("meses", raiz);

        // Qué hay en Drive. Si hay dos archivos con el mismo nombre, vale
        // el modificado más recientemente.
        const enDrive = {};
        const anotar = (nombre, f) => {
            if (!enDrive[nombre] || enDrive[nombre].modifiedTime < f.modifiedTime) enDrive[nombre] = f;
        };
        for (const f of await buscar(`${comillas(raiz)} in parents and trashed=false and mimeType!='${CARPETA}'`)) anotar(f.name, f);
        for (const f of await buscar(`${comillas(meses)} in parents and trashed=false and mimeType!='${CARPETA}'`)) anotar("meses/" + f.name, f);

        // Bajar solo lo que cambió desde la última vez.
        const cache = new Map((await H.datos.leerCacheDrive()).map(c => [c.nombre, c]));
        const remotos = {};
        const nuevaCache = [];
        for (const [nombre, f] of Object.entries(enDrive)) {
            const c = cache.get(nombre);
            if (c && c.id === f.id && c.modifiedTime === f.modifiedTime) {
                remotos[nombre] = c.contenido;
            } else {
                remotos[nombre] = await bajar(f.id);
                nuevaCache.push({ nombre, id: f.id, modifiedTime: f.modifiedTime, contenido: remotos[nombre] });
            }
        }

        const locales = await H.datos.leerParaSincronizar();
        const plan = H.sincronizar.planificar(locales, remotos);

        const recibidos = H.sincronizar.COLECCIONES
            .filter(c => c !== "tipos")
            .reduce((n, c) => n + plan.cambiosLocales[c].guardar.length + plan.cambiosLocales[c].borrar.length, 0);
        const cambiaronTipos = plan.cambiosLocales.tipos.guardar.length + plan.cambiosLocales.tipos.borrar.length > 0;
        if (recibidos || cambiaronTipos) {
            await H.datos.aplicarSincronizacion(plan.cambiosLocales, cambiaronTipos ? plan.colecciones.tipos : null);
        }

        for (const [nombre, contenido] of Object.entries(plan.subir)) {
            const existente = enDrive[nombre];
            const padre = nombre.startsWith("meses/") ? meses : raiz;
            const nombreArchivo = nombre.replace(/^meses\//, "");
            const f = existente ? await actualizarArchivo(existente.id, contenido) : await crearArchivo(nombreArchivo, padre, contenido);
            nuevaCache.push({ nombre, id: f.id, modifiedTime: f.modifiedTime, contenido });
        }
        await H.datos.guardarCacheDrive(nuevaCache);

        return {
            recibidos: recibidos + (cambiaronTipos ? 1 : 0),
            subidos: Object.keys(plan.subir).length,
            ignorados: plan.ignorados,
        };
    }

    H.drive = { configurado, tieneToken, conectar, desconectar, sincronizar };

})(globalThis.Hormiguero ||= {});
