// =====================================
// Sincronización: fusión de datos locales y de Google Drive.
//
// Todo lo que se sincroniza es una lista de elementos con `id` y
// `actualizado` (fecha y hora ISO). Al fusionar, por cada id gana el
// cambio más reciente. Un borrado es una lápida: { id, borrado: true,
// actualizado, mes? }, así un dispositivo no revive lo que otro borró.
//
// Archivos en la carpeta "Hormiguero" del Drive del usuario:
//   meses/2026-09.json  gastos de ese mes (y sus lápidas)
//   documentos.json     resúmenes de tarjeta importados
//   reglas.json         reglas por comercio
//   fijos.json          plantillas de gastos que se repiten
//   config.json         tipos de cambio por mes y nombre del usuario
//
// Cada archivo: { formato: "hormiguero", version: 1, elementos: [...] }
//
// Funciones puras; drive.js hace los pedidos y app.js aplica el resultado.
// =====================================

(function (H) {

    const FORMATO = "hormiguero";
    const VERSION = 1;
    const COLECCIONES = ["gastos", "documentos", "reglas", "fijos", "tipos"];
    const ARCHIVO_DE = { documentos: "documentos.json", reglas: "reglas.json", fijos: "fijos.json", tipos: "config.json" };

    // ---------- Fusión ----------

    function masNuevo(a, b) {
        return (a.actualizado || "") >= (b.actualizado || "") ? a : b;
    }

    // Por id, gana el más reciente. A igual fecha, gana el local (así un
    // empate no provoca escrituras de ida y vuelta).
    function fusionar(locales, remotos) {
        const porId = new Map();
        for (const r of remotos) porId.set(r.id, r);
        for (const l of locales) {
            const r = porId.get(l.id);
            porId.set(l.id, r ? masNuevo(l, r) : l);
        }
        return [...porId.values()];
    }

    // JSON con las claves ordenadas: dos objetos iguales dan el mismo
    // texto aunque sus propiedades estén en otro orden.
    function canonico(valor) {
        if (Array.isArray(valor)) return "[" + valor.map(canonico).join(",") + "]";
        if (valor && typeof valor === "object") {
            return "{" + Object.keys(valor).sort()
                .filter(k => valor[k] !== undefined)
                .map(k => JSON.stringify(k) + ":" + canonico(valor[k])).join(",") + "}";
        }
        return JSON.stringify(valor);
    }

    function iguales(a, b) {
        return canonico(a) === canonico(b);
    }

    // ---------- Tipos de cambio ↔ elementos ----------

    // El mapa { "2026-08": { valor, origen, actualizado } } se sincroniza
    // como elementos { id: "tc-2026-08", mes, valor, origen, actualizado }.
    function tiposAElementos(tipos) {
        return Object.entries(tipos).map(([mes, t]) => ({ id: "tc-" + mes, mes, ...t }));
    }

    function elementosATipos(elementos) {
        const tipos = {};
        for (const e of elementos) {
            if (!e.id.startsWith("tc-")) continue; // el nombre viaja en el mismo archivo
            const { id, mes, ...resto } = e;
            tipos[mes] = resto;
        }
        return tipos;
    }

    // Pone fecha a los tipos de cambio que cambiaron respecto de los anteriores.
    function sellarTipos(anteriores, nuevos, ahora) {
        const actualizado = (ahora || new Date()).toISOString();
        const sellados = {};
        for (const mes of new Set([...Object.keys(anteriores), ...Object.keys(nuevos)])) {
            const a = anteriores[mes], n = nuevos[mes];
            if (!n) {
                // Se quitó: queda como lápida para que no vuelva de Drive.
                sellados[mes] = a && a.valor != null ? { valor: null, origen: "borrado", actualizado } : a;
            } else if (!a || a.valor !== n.valor || a.origen !== n.origen) {
                sellados[mes] = { ...n, actualizado };
            } else {
                sellados[mes] = { ...n, actualizado: a.actualizado || n.actualizado };
            }
        }
        return sellados;
    }

    // El nombre del usuario ("El Hormiguero de Tincho") viaja en config.json
    // como el elemento { id: "nombre", valor, actualizado }.
    const ID_NOMBRE = "nombre";

    function nombreAElemento(nombre) {
        return nombre ? { id: ID_NOMBRE, ...nombre } : null;
    }

    function elementoANombre(elementos) {
        const e = elementos.find(x => x.id === ID_NOMBRE);
        return e ? { valor: e.valor, actualizado: e.actualizado } : null;
    }

    // ---------- Archivos ↔ colecciones ----------

    function archivo(elementos) {
        return { formato: FORMATO, version: VERSION, elementos: [...elementos].sort((a, b) => a.id < b.id ? -1 : 1) };
    }

    // remotos: { "meses/2026-09.json": contenido, "reglas.json": contenido, ... }
    // Devuelve las colecciones con los elementos de Drive. Ignora archivos
    // que no son de Hormiguero o de una versión más nueva.
    function leerArchivos(remotos) {
        const colecciones = Object.fromEntries(COLECCIONES.map(c => [c, []]));
        const ignorados = [];
        for (const [nombre, contenido] of Object.entries(remotos)) {
            if (!contenido || contenido.formato !== FORMATO || !Array.isArray(contenido.elementos) || contenido.version > VERSION) {
                ignorados.push(nombre);
                continue;
            }
            if (/^meses\/\d{4}-\d{2}\.json$/.test(nombre)) {
                colecciones.gastos.push(...contenido.elementos);
            } else {
                const coleccion = Object.keys(ARCHIVO_DE).find(c => ARCHIVO_DE[c] === nombre);
                if (coleccion) colecciones[coleccion].push(...contenido.elementos);
                else ignorados.push(nombre);
            }
        }
        return { colecciones, ignorados };
    }

    // Arma el contenido que tiene que tener cada archivo en Drive. Los
    // gastos van al archivo de su mes; un mes que quedó sin nada igual
    // se escribe (vacío) si ya existía, para sacar lo que se movió.
    function armarArchivos(colecciones, nombresExistentes) {
        const archivos = {};
        const porMes = new Map();
        for (const g of colecciones.gastos) {
            if (!g.mes) continue;
            if (!porMes.has(g.mes)) porMes.set(g.mes, []);
            porMes.get(g.mes).push(g);
        }
        for (const [mes, lista] of porMes) archivos[`meses/${mes}.json`] = archivo(lista);
        for (const nombre of nombresExistentes || []) {
            if (/^meses\//.test(nombre) && !archivos[nombre]) archivos[nombre] = archivo([]);
        }
        for (const [coleccion, nombre] of Object.entries(ARCHIVO_DE)) {
            archivos[nombre] = archivo(colecciones[coleccion]);
        }
        return archivos;
    }

    // ---------- Un ciclo completo ----------

    // locales y remotos: { gastos: [...], documentos: [...], ... } con lápidas.
    // Devuelve:
    //   colecciones: el resultado fusionado (lo que debería haber en los dos lados)
    //   cambiosLocales: { coleccion: { guardar: [...], borrar: [lápidas] } }
    //   subir: { nombreArchivo: contenido } solo los que cambiaron en Drive
    function planificar(locales, remotosPorArchivo) {
        const { colecciones: remotos, ignorados } = leerArchivos(remotosPorArchivo);
        const colecciones = {};
        const cambiosLocales = {};

        for (const c of COLECCIONES) {
            const fusion = fusionar(locales[c] || [], remotos[c]);
            colecciones[c] = fusion;

            const localPorId = new Map((locales[c] || []).map(e => [e.id, e]));
            const guardar = [], borrar = [];
            for (const e of fusion) {
                const l = localPorId.get(e.id);
                if (l && iguales(l, e)) continue;
                if (e.borrado) borrar.push(e);
                else guardar.push(e);
            }
            cambiosLocales[c] = { guardar, borrar };
        }

        const deseados = armarArchivos(colecciones, Object.keys(remotosPorArchivo));
        const subir = {};
        for (const [nombre, contenido] of Object.entries(deseados)) {
            if (ignorados.includes(nombre)) continue; // no pisar algo que no entendemos
            const actual = remotosPorArchivo[nombre];
            if (!actual || !iguales(actual.elementos, contenido.elementos)) subir[nombre] = contenido;
        }

        return { colecciones, cambiosLocales, subir, ignorados };
    }

    H.sincronizar = {
        COLECCIONES, fusionar, canonico, iguales, tiposAElementos, elementosATipos,
        sellarTipos, nombreAElemento, elementoANombre, leerArchivos, armarArchivos, planificar,
    };

})(globalThis.Hormiguero ||= {});
