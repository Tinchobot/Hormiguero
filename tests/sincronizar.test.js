// Tests de la fase 4: fusión para la sincronización con Google Drive.
// Simula dos dispositivos contra un mismo "Drive" en memoria.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const raiz = path.join(__dirname, "..");
require(path.join(raiz, "js/formato.js"));
require(path.join(raiz, "js/cambio.js"));
require(path.join(raiz, "js/sincronizar.js"));

const H = globalThis.Hormiguero;
const S = H.sincronizar;

const vacio = () => ({ gastos: [], documentos: [], reglas: [], fijos: [], tipos: [] });
const g = (id, mes, actualizado, extra = {}) => ({ id, mes, fecha: mes + "-05", concepto: id, montoARS: 100, actualizado, ...extra });
const lapida = (id, mes, actualizado) => ({ id, mes, borrado: true, actualizado });

// Un dispositivo: sus colecciones locales. Sincronizar = planificar contra
// el drive, aplicar los cambios locales y subir lo que cambió.
function sincronizar(local, drive) {
    const plan = S.planificar(local, drive);
    for (const c of S.COLECCIONES) {
        const porId = new Map(local[c].map(e => [e.id, e]));
        for (const e of plan.cambiosLocales[c].guardar) porId.set(e.id, e);
        for (const e of plan.cambiosLocales[c].borrar) porId.set(e.id, e);
        local[c] = [...porId.values()];
    }
    Object.assign(drive, JSON.parse(JSON.stringify(plan.subir)));
    return plan;
}

const vivos = lista => lista.filter(e => !e.borrado).map(e => e.id).sort();

// ---------- Fusión ----------

test("por id gana el más reciente; a igual fecha, el local", () => {
    const r = S.fusionar(
        [g("a", "2026-09", "2026-10-02T00:00:00Z", { concepto: "local" }), g("b", "2026-09", "2026-10-01T00:00:00Z", { concepto: "local" })],
        [g("a", "2026-09", "2026-10-01T00:00:00Z", { concepto: "remoto" }), g("b", "2026-09", "2026-10-01T00:00:00Z", { concepto: "remoto" }), g("c", "2026-09", "x")],
    );
    const porId = Object.fromEntries(r.map(e => [e.id, e.concepto]));
    assert.deepEqual(porId, { a: "local", b: "local", c: "c" });
});

test("canonico no depende del orden de las claves", () => {
    assert.equal(S.canonico({ b: 1, a: [{ y: 2, x: 1 }] }), S.canonico({ a: [{ x: 1, y: 2 }], b: 1 }));
    assert.ok(S.iguales({ a: 1, b: undefined }, { a: 1 }));
});

// ---------- Archivos ----------

test("los gastos van al archivo de su mes y lo demás a su archivo", () => {
    const col = { ...vacio(), gastos: [g("a", "2026-08", "1"), g("b", "2026-09", "1"), lapida("c", "2026-09", "2")], reglas: [{ id: "r", actualizado: "1" }] };
    const archivos = S.armarArchivos(col, []);
    assert.deepEqual(Object.keys(archivos).sort(), ["config.json", "documentos.json", "fijos.json", "meses/2026-08.json", "meses/2026-09.json", "reglas.json"]);
    assert.deepEqual(archivos["meses/2026-09.json"].elementos.map(e => e.id), ["b", "c"]);
    assert.equal(archivos["reglas.json"].formato, "hormiguero");
});

test("archivos ajenos o de una versión más nueva se ignoran y no se pisan", () => {
    const drive = {
        "notas.json": { hola: 1 },
        "reglas.json": { formato: "hormiguero", version: 99, elementos: [{ id: "x", actualizado: "9" }] },
    };
    const plan = S.planificar(vacio(), drive);
    assert.deepEqual(plan.ignorados.sort(), ["notas.json", "reglas.json"]);
    assert.ok(!("reglas.json" in plan.subir));
    assert.equal(plan.colecciones.reglas.length, 0);
});

// ---------- Tipos de cambio ----------

test("tipos de cambio ↔ elementos, ida y vuelta", () => {
    const tipos = { "2026-08": { valor: 1530, origen: "pago", actualizado: "1" } };
    const elementos = S.tiposAElementos(tipos);
    assert.deepEqual(elementos, [{ id: "tc-2026-08", mes: "2026-08", valor: 1530, origen: "pago", actualizado: "1" }]);
    assert.deepEqual(S.elementosATipos(elementos), tipos);
});

test("sellarTipos fecha solo lo que cambió y deja lápida al quitar", () => {
    const ahora = new Date("2026-10-04T12:00:00Z");
    const antes = {
        "2026-07": { valor: 1500, origen: "pago", actualizado: "viejo" },
        "2026-08": { valor: 1520, origen: "sugerido", actualizado: "viejo" },
        "2026-09": { valor: 1530, origen: "manual", actualizado: "viejo" },
    };
    const despues = {
        "2026-07": { valor: 1500, origen: "pago" },
        "2026-08": { valor: 1530, origen: "pago" },
    };
    const s = S.sellarTipos(antes, despues, ahora);
    assert.equal(s["2026-07"].actualizado, "viejo");
    assert.deepEqual(s["2026-08"], { valor: 1530, origen: "pago", actualizado: ahora.toISOString() });
    assert.deepEqual(s["2026-09"], { valor: null, origen: "borrado", actualizado: ahora.toISOString() });
    assert.equal(H.cambio.valor(s, "2026-09"), null, "una lápida cuenta como sin cargar");
});

// ---------- Dos dispositivos ----------

test("primer dispositivo sube todo; el segundo lo recibe sin subir nada", () => {
    const drive = {};
    const pc = { ...vacio(), gastos: [g("a", "2026-09", "1"), g("b", "2026-08", "1")], reglas: [{ id: "r", patron: "x", actualizado: "1" }] };
    const p1 = sincronizar(pc, drive);
    assert.ok(Object.keys(p1.subir).length >= 2);

    const cel = vacio();
    const p2 = sincronizar(cel, drive);
    assert.deepEqual(vivos(cel.gastos), ["a", "b"]);
    assert.equal(cel.reglas.length, 1);
    assert.deepEqual(Object.keys(p2.subir), [], "no hay nada nuevo para subir");

    // Una segunda vuelta no cambia nada en ningún lado.
    const p3 = sincronizar(pc, drive);
    assert.deepEqual(Object.keys(p3.subir), []);
    assert.equal(p3.cambiosLocales.gastos.guardar.length, 0);
});

test("lo que se borra en un dispositivo se borra en el otro (no revive)", () => {
    const drive = {};
    const pc = { ...vacio(), gastos: [g("a", "2026-09", "1"), g("b", "2026-09", "1")] };
    sincronizar(pc, drive);
    const cel = vacio();
    sincronizar(cel, drive);

    // El celular borra "a".
    cel.gastos = cel.gastos.filter(e => e.id !== "a").concat(lapida("a", "2026-09", "2"));
    sincronizar(cel, drive);

    // La PC todavía tiene "a" vivo, pero al sincronizar se le borra.
    const plan = sincronizar(pc, drive);
    assert.deepEqual(plan.cambiosLocales.gastos.borrar.map(e => e.id), ["a"]);
    assert.deepEqual(vivos(pc.gastos), ["b"]);
    assert.deepEqual(vivos(cel.gastos), ["b"]);
});

test("una edición posterior a un borrado gana (se recupera)", () => {
    const drive = {};
    const pc = { ...vacio(), gastos: [g("a", "2026-09", "1")] };
    sincronizar(pc, drive);
    const cel = vacio();
    sincronizar(cel, drive);

    cel.gastos = [lapida("a", "2026-09", "2")];
    pc.gastos = [g("a", "2026-09", "3", { concepto: "editado" })];
    sincronizar(cel, drive);
    sincronizar(pc, drive);
    sincronizar(cel, drive);

    assert.deepEqual(vivos(cel.gastos), ["a"]);
    assert.equal(cel.gastos[0].concepto, "editado");
});

test("ediciones en los dos dispositivos: por gasto gana la más nueva", () => {
    const drive = {};
    const pc = { ...vacio(), gastos: [g("a", "2026-09", "1"), g("b", "2026-09", "1")] };
    sincronizar(pc, drive);
    const cel = vacio();
    sincronizar(cel, drive);

    pc.gastos = pc.gastos.map(e => e.id === "a" ? { ...e, concepto: "a-pc", actualizado: "3" } : { ...e, concepto: "b-pc", actualizado: "2" });
    cel.gastos = cel.gastos.map(e => e.id === "a" ? { ...e, concepto: "a-cel", actualizado: "2" } : { ...e, concepto: "b-cel", actualizado: "4" });
    sincronizar(pc, drive);
    sincronizar(cel, drive);
    sincronizar(pc, drive);

    for (const d of [pc, cel]) {
        const porId = Object.fromEntries(d.gastos.map(e => [e.id, e.concepto]));
        assert.deepEqual(porId, { a: "a-pc", b: "b-cel" });
    }
});

test("un gasto que cambia de mes se saca del archivo del mes viejo", () => {
    const drive = {};
    const pc = { ...vacio(), gastos: [g("a", "2026-08", "1")] };
    sincronizar(pc, drive);
    pc.gastos = [g("a", "2026-09", "2")];
    const plan = sincronizar(pc, drive);
    assert.deepEqual(drive["meses/2026-08.json"].elementos, []);
    assert.deepEqual(drive["meses/2026-09.json"].elementos.map(e => e.id), ["a"]);
    assert.ok("meses/2026-08.json" in plan.subir);

    const cel = vacio();
    sincronizar(cel, drive);
    assert.equal(cel.gastos.length, 1, "no queda duplicado");
    assert.equal(cel.gastos[0].mes, "2026-09");
});

test("el nombre viaja en config.json sin mezclarse con los tipos de cambio", () => {
    const S = H.sincronizar;
    const tipos = { "2026-08": { valor: 1400, origen: "pago", actualizado: "1" } };
    const elementos = [...S.tiposAElementos(tipos), S.nombreAElemento({ valor: "Tincho", actualizado: "2" })];
    assert.deepEqual(S.elementosATipos(elementos), tipos);
    assert.deepEqual(S.elementoANombre(elementos), { valor: "Tincho", actualizado: "2" });
    assert.equal(S.nombreAElemento(null), null);
    assert.equal(S.elementoANombre(S.tiposAElementos(tipos)), null);

    // Gana el nombre cambiado más recientemente.
    const plan = S.planificar({ tipos: [S.nombreAElemento({ valor: "Martín", actualizado: "1" })] },
        { "config.json": { formato: "hormiguero", version: 1, elementos: [S.nombreAElemento({ valor: "Tincho", actualizado: "2" })] } });
    assert.equal(S.elementoANombre(plan.colecciones.tipos).valor, "Tincho");
});
