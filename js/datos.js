// =====================================
// Guardado local en IndexedDB.
//
// Base "hormiguero":
//   gastos      clave id, índice por mes
//   documentos  clave id (resúmenes de tarjeta importados)
//   reglas      clave id (clasificación por comercio)
//   config      clave "clave" (tipos de cambio, preferencias)
//   fijos       clave id (plantillas de gastos que se repiten)
//
// En la fase 4 esto pasa a ser la caché de lo que vive en Google Drive.
// =====================================

(function (H) {

    const BASE = "hormiguero";
    const VERSION = 3;
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

    async function todos(almacen) {
        const db = await abrir();
        return esperar(db.transaction(almacen).objectStore(almacen).getAll());
    }

    // Reemplaza (o crea) cada elemento.
    async function guardar(almacen, lista) {
        if (!lista.length) return;
        const db = await abrir();
        const tx = db.transaction(almacen, "readwrite");
        const store = tx.objectStore(almacen);
        for (const x of lista) store.put(x);
        await fin(tx);
    }

    async function borrar(almacen, ids) {
        const db = await abrir();
        const tx = db.transaction(almacen, "readwrite");
        for (const id of [].concat(ids)) tx.objectStore(almacen).delete(id);
        await fin(tx);
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
        const tx = db.transaction(["documentos", "gastos"], "readwrite");
        tx.objectStore("documentos").put(documento);
        const store = tx.objectStore("gastos");
        for (const g of gastos) store.put(g);
        await fin(tx);
    }

    // Saca el documento y todos los gastos que vinieron de él.
    async function quitarDocumento(id) {
        const db = await abrir();
        const tx = db.transaction(["documentos", "gastos"], "readwrite");
        tx.objectStore("documentos").delete(id);
        const store = tx.objectStore("gastos");
        const gastos = await esperar(store.getAll());
        for (const g of gastos) if (g.documento === id) store.delete(g.id);
        await fin(tx);
    }

    async function leerConfig(clave, porDefecto) {
        const db = await abrir();
        const fila = await esperar(db.transaction("config").objectStore("config").get(clave));
        return fila ? fila.valor : porDefecto;
    }

    async function guardarConfig(clave, valor) {
        await guardar("config", [{ clave, valor }]);
    }

    async function borrarTodo() {
        const db = await abrir();
        const almacenes = ["gastos", "documentos", "reglas", "config", "fijos"];
        const tx = db.transaction(almacenes, "readwrite");
        for (const a of almacenes) tx.objectStore(a).clear();
        await fin(tx);
    }

    H.datos = {
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
        borrarTodo,
    };

})(globalThis.Hormiguero ||= {});
