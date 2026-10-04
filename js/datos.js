// =====================================
// Guardado local en IndexedDB.
//
// Base "hormiguero", almacén "gastos" (clave: id, índice por mes).
// En la fase 4 esto pasa a ser la caché de lo que vive en Google Drive.
// =====================================

(function (H) {

    const BASE = "hormiguero";
    const VERSION = 1;
    let conexion = null;

    function abrir() {
        if (conexion) return conexion;
        conexion = new Promise((resolver, rechazar) => {
            const pedido = indexedDB.open(BASE, VERSION);
            pedido.onupgradeneeded = () => {
                const db = pedido.result;
                if (!db.objectStoreNames.contains("gastos")) {
                    const gastos = db.createObjectStore("gastos", { keyPath: "id" });
                    gastos.createIndex("mes", "mes");
                }
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

    async function todosLosGastos() {
        const db = await abrir();
        return esperar(db.transaction("gastos").objectStore("gastos").getAll());
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

    async function borrarTodo() {
        const db = await abrir();
        const tx = db.transaction("gastos", "readwrite");
        tx.objectStore("gastos").clear();
        await fin(tx);
    }

    H.datos = { todosLosGastos, agregarNuevos, borrarTodo };

})(globalThis.Hormiguero ||= {});
