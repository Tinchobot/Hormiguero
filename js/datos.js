// =====================================
// Guardado local en IndexedDB.
//
// Base "hormiguero":
//   gastos      clave id, índice por mes
//   documentos  clave id (resúmenes de tarjeta importados)
//   reglas      clave id (clasificación por comercio)
//   config      clave "clave" (tipos de cambio, preferencias)
//   fijos       clave id (plantillas de gastos que se repiten)
//   borrados    clave "coleccion|id": lápidas de lo que se borró, para
//               que la sincronización no lo reviva desde Drive
//   drive       clave nombre de archivo: copia de lo último que se leyó
//               de Drive (para no bajar lo que no cambió)
//
// Es la caché local de lo que vive en Google Drive (ver sincronizar.js).
// Cada cambio hecho por el usuario avisa a H.datos.alCambiar, que
// programa una sincronización.
// =====================================

(function (H) {

    const BASE = "hormiguero";
    const VERSION = 4;
    const SINCRONIZADAS = ["gastos", "documentos", "reglas", "fijos"];
    let conexion = null;

    function abrir() {
        if (conexion) return conexion;
        conexion = new Promise((resolver, rechazar) => {
            const pedido = indexedDB.open(BASE, VERSION);
            pedido.onupgradeneeded = () => {
                const db = pedido.result;
                if (!db.objectStoreNames.contains("gastos")) {
                    db.createObjectStore("gastos", { keyPath: "id" }).createIndex("mes", "mes");
                }
                if (!db.objectStoreNames.contains("documentos")) db.createObjectStore("documentos", { keyPath: "id" });
                if (!db.objectStoreNames.contains("reglas")) db.createObjectStore("reglas", { keyPath: "id" });
                if (!db.objectStoreNames.contains("config")) db.createObjectStore("config", { keyPath: "clave" });
                if (!db.objectStoreNames.contains("fijos")) db.createObjectStore("fijos", { keyPath: "id" });
                if (!db.objectStoreNames.contains("borrados")) db.createObjectStore("borrados", { keyPath: "clave" });
                if (!db.objectStoreNames.contains("drive")) db.createObjectStore("drive", { keyPath: "nombre" });
            };
            pedido.onsuccess = () => resolver(pedido.result);
            pedido.onerror = () => rechazar(pedido.error);
        });
        return conexion;
    }

    function esperar(pedido) {
        return new Promise((resolver, rechazar) => {
            pedido.onsuccess = () => resolver(pedido.result);
            pedido.onerror = () => rechazar(pedido.error);
        });
    }

    function fin(tx) {
        return new Promise((resolver, rechazar) => {
            tx.oncomplete = () => resolver();
            tx.onerror = () => rechazar(tx.error);
            tx.onabort = () => rechazar(tx.error);
        });
    }

    function avisarCambio() {
        if (typeof H.datos.alCambiar === "function") H.datos.alCambiar();
    }

    function lapida(coleccion, elemento, ahora) {
        return {
            clave: coleccion + "|" + elemento.id,
            coleccion,
            id: elemento.id,
            borrado: true,
            mes: elemento.mes,
            actualizado: ahora,
        };
    }

    async function todos(almacen) {
        const db = await abrir();
        return esperar(db.transaction(almacen).objectStore(almacen).getAll());
    }

    // Reemplaza (o crea) cada elemento. Si había una lápida, se va.
    async function guardar(almacen, lista) {
        if (!lista.length) return;
        const db = await abrir();
        const tx = db.transaction([almacen, "borrados"], "readwrite");
        const store = tx.objectStore(almacen);
        const borrados = tx.objectStore("borrados");
        for (const x of lista) {
            store.put(x);
            borrados.delete(almacen + "|" + x.id);
        }
        await fin(tx);
        avisarCambio();
    }

    // Borra y deja lápida.
    async function borrar(almacen, ids) {
        ids = [].concat(ids);
        if (!ids.length) return;
        const db = await abrir();
        const tx = db.transaction([almacen, "borrados"], "readwrite");
        const store = tx.objectStore(almacen);
        const borrados = tx.objectStore("borrados");
        const ahora = new Date().toISOString();
        for (const id of ids) {
            const elemento = await esperar(store.get(id));
            if (!elemento) continue;
            store.delete(id);
            borrados.put(lapida(almacen, elemento, ahora));
        }
        await fin(tx);
        avisarCambio();
    }

    // Agrega los gastos que no existen. Los que ya están (mismo id) no se
    // tocan, así no se pisan cambios hechos en Hormiguero (por ejemplo,
    // una reclasificación) al volver a importar el mismo archivo.
    async function agregarNuevos(gastos) {
        const db = await abrir();
        const tx = db.transaction("gastos", "readwrite");
        const almacen = tx.objectStore("gastos");
        let nuevos = 0;
        for (const g of gastos) {
            const existe = await esperar(almacen.getKey(g.id));
            if (existe === undefined) {
                almacen.add(g);
                nuevos++;
            }
        }
        await fin(tx);
        if (nuevos) avisarCambio();
        return { nuevos, repetidos: gastos.length - nuevos };
    }

    async function existeDocumento(id) {
        const db = await abrir();
        const clave = await esperar(db.transaction("documentos").objectStore("documentos").getKey(id));
        return clave !== undefined;
    }

    // Guarda el documento y sus gastos juntos: o entra todo o nada.
    async function guardarDocumento(documento, gastos) {
        const db = await abrir();
        const tx = db.transaction(["documentos", "gastos", "borrados"], "readwrite");
        const borrados = tx.objectStore("borrados");
        tx.objectStore("documentos").put({ ...documento, actualizado: documento.actualizado || new Date().toISOString() });
        borrados.delete("documentos|" + documento.id);
        const store = tx.objectStore("gastos");
        for (const g of gastos) {
            store.put(g);
            borrados.delete("gastos|" + g.id);
        }
        await fin(tx);
        avisarCambio();
    }

    // Saca el documento y todos los gastos que vinieron de él.
    async function quitarDocumento(id) {
        const db = await abrir();
        const tx = db.transaction(["documentos", "gastos", "borrados"], "readwrite");
        const ahora = new Date().toISOString();
        const borrados = tx.objectStore("borrados");
        const docs = tx.objectStore("documentos");
        const doc = await esperar(docs.get(id));
        if (doc) {
            docs.delete(id);
            borrados.put(lapida("documentos", doc, ahora));
        }
        const store = tx.objectStore("gastos");
        const gastos = await esperar(store.getAll());
        for (const g of gastos) {
            if (g.documento !== id) continue;
            store.delete(g.id);
            borrados.put(lapida("gastos", g, ahora));
        }
        await fin(tx);
        avisarCambio();
    }

    async function leerConfig(clave, porDefecto) {
        const db = await abrir();
        const fila = await esperar(db.transaction("config").objectStore("config").get(clave));
        return fila ? fila.valor : porDefecto;
    }

    async function guardarConfig(clave, valor, sinAvisar) {
        const db = await abrir();
        const tx = db.transaction("config", "readwrite");
        tx.objectStore("config").put({ clave, valor });
        await fin(tx);
        if (!sinAvisar) avisarCambio();
    }

    // Guarda los tipos de cambio poniendo fecha a los que cambiaron.
    // Devuelve el mapa sellado (el que hay que usar de ahí en más).
    async function guardarTipos(tipos) {
        const anteriores = await leerConfig("tiposDeCambio", {});
        const sellados = H.sincronizar.sellarTipos(anteriores, tipos);
        await guardarConfig("tiposDeCambio", sellados);
        return sellados;
    }

    // ---------- Para la sincronización ----------

    // Todo lo local, con lápidas, en el formato de sincronizar.planificar.
    async function leerParaSincronizar() {
        const [lapidas, tipos, ...listas] = await Promise.all([
            todos("borrados"),
            leerConfig("tiposDeCambio", {}),
            ...SINCRONIZADAS.map(todos),
        ]);
        const colecciones = {};
        SINCRONIZADAS.forEach((c, i) => {
            const delaColeccion = lapidas.filter(l => l.coleccion === c).map(({ clave, coleccion, ...l }) => l);
            colecciones[c] = listas[i].concat(delaColeccion);
        });
        colecciones.tipos = H.sincronizar.tiposAElementos(tipos);
        return colecciones;
    }

    // Aplica lo que llegó de Drive. No avisa cambios (no hay que volver a subir).
    async function aplicarSincronizacion(cambiosLocales, tiposFusionados) {
        const db = await abrir();
        const tx = db.transaction([...SINCRONIZADAS, "borrados", "config"], "readwrite");
        const borrados = tx.objectStore("borrados");
        for (const c of SINCRONIZADAS) {
            const store = tx.objectStore(c);
            for (const e of cambiosLocales[c].guardar) {
                store.put(e);
                borrados.delete(c + "|" + e.id);
            }
            for (const l of cambiosLocales[c].borrar) {
                store.delete(l.id);
                borrados.put({ ...l, clave: c + "|" + l.id, coleccion: c });
            }
        }
        if (tiposFusionados) {
            tx.objectStore("config").put({ clave: "tiposDeCambio", valor: H.sincronizar.elementosATipos(tiposFusionados) });
        }
        await fin(tx);
    }

    async function leerCacheDrive() {
        return todos("drive");
    }

    async function guardarCacheDrive(filas) {
        if (!filas.length) return;
        const db = await abrir();
        const tx = db.transaction("drive", "readwrite");
        for (const f of filas) tx.objectStore("drive").put(f);
        await fin(tx);
    }

    async function borrarTodo() {
        const db = await abrir();
        const almacenes = ["gastos", "documentos", "reglas", "config", "fijos", "borrados", "drive"];
        const tx = db.transaction(almacenes, "readwrite");
        for (const a of almacenes) tx.objectStore(a).clear();
        await fin(tx);
    }

    H.datos = {
        alCambiar: null,
        todosLosGastos: () => todos("gastos"),
        todosLosDocumentos: () => todos("documentos"),
        todasLasReglas: () => todos("reglas"),
        todosLosFijos: () => todos("fijos"),
        guardarGastos: lista => guardar("gastos", lista),
        guardarReglas: lista => guardar("reglas", lista),
        guardarFijos: lista => guardar("fijos", lista),
        borrarRegla: id => borrar("reglas", id),
        borrarGastos: ids => borrar("gastos", ids),
        borrarFijo: id => borrar("fijos", id),
        agregarNuevos,
        existeDocumento,
        guardarDocumento,
        quitarDocumento,
        leerConfig,
        guardarConfig,
        guardarTipos,
        leerParaSincronizar,
        aplicarSincronizacion,
        leerCacheDrive,
        guardarCacheDrive,
        borrarTodo,
    };

})(globalThis.Hormiguero ||= {});
