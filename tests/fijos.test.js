// Tests de la fase 3: carga manual y fijos que se repiten.
// Datos inventados.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const raiz = path.join(__dirname, "..");
require(path.join(raiz, "js/formato.js"));
require(path.join(raiz, "js/calculos.js"));
require(path.join(raiz, "js/cambio.js"));
require(path.join(raiz, "js/fijos.js"));

const H = globalThis.Hormiguero;
const F = H.fijos;
const AHORA = new Date("2026-10-01T09:00:00Z");
const TIPOS = { "2026-09": { valor: 1500, origen: "manual" } };

const HIPOTECA = { fecha: "2026-08-31", concepto: " Hipoteca ", monto: 560000, moneda: "ARS", categoria: "fijo" };

test("leerMonto entiende el formato argentino", () => {
    assert.equal(F.leerMonto("560.000"), 560000);
    assert.equal(F.leerMonto("$ 1.234,56"), 1234.56);
    assert.equal(F.leerMonto("12,5"), 12.5);
    assert.equal(F.leerMonto("1500"), 1500);
    assert.equal(F.leerMonto("1500.75"), 1500.75);
    assert.equal(F.leerMonto("U$S 20"), 20);
    assert.equal(F.leerMonto(""), null);
    assert.equal(F.leerMonto("abc"), null);
});

test("mesesEntre cruza el año", () => {
    assert.deepEqual(F.mesesEntre("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
    assert.deepEqual(F.mesesEntre("2026-10", "2026-09"), []);
});

test("gasto manual: mes de la fecha, concepto limpio y dólares convertidos", () => {
    const g = F.gastoManual({ ...HIPOTECA, moneda: "USD", monto: 100, fecha: "2026-09-10" }, TIPOS, AHORA);
    assert.equal(g.mes, "2026-09");
    assert.equal(g.concepto, "Hipoteca");
    assert.equal(g.montoARS, 150000);
    assert.equal(g.fuente, "manual");
    assert.equal(g.clasificadoPor, "manual");
    assert.match(g.id, /^manual-/);

    const sinCambio = F.gastoManual({ ...HIPOTECA, moneda: "USD", monto: 100 }, TIPOS, AHORA);
    assert.equal(sinCambio.montoARS, null, "agosto no tiene tipo de cambio");
});

test("plantilla: día y mes de inicio salen de la fecha", () => {
    const p = F.nuevaPlantilla(HIPOTECA, AHORA);
    assert.equal(p.dia, 31);
    assert.equal(p.desde, "2026-08");
    assert.deepEqual(p.pausados, []);
    assert.equal(p.concepto, "Hipoteca");
});

test("la copia del 31 cae el 30 en septiembre y queda a confirmar", () => {
    const p = F.nuevaPlantilla(HIPOTECA, AHORA);
    const c = F.copiaDelMes(p, "2026-09", TIPOS, AHORA);
    assert.equal(c.fecha, "2026-09-30");
    assert.equal(c.mes, "2026-09");
    assert.equal(c.pendiente, true);
    assert.equal(c.plantillaFija, p.id);
    assert.equal(c.id, "fijo-" + p.id + "-2026-09");
    assert.equal(F.copiaDelMes(p, "2027-02", TIPOS).fecha, "2027-02-28");
});

test("copiasQueFaltan: una por mes hasta el actual, sin repetir ni pausados", () => {
    const p = F.nuevaPlantilla(HIPOTECA, AHORA);
    const primero = { ...F.copiaDelMes(p, "2026-08", TIPOS), pendiente: false };

    let nuevas = F.copiasQueFaltan([p], [primero], "2026-10", TIPOS, AHORA);
    assert.deepEqual(nuevas.map(g => g.mes), ["2026-09", "2026-10"]);

    // Generar otra vez no duplica.
    assert.equal(F.copiasQueFaltan([p], [primero, ...nuevas], "2026-10", TIPOS).length, 0);

    // Un mes pausado no se copia.
    const pausada = { ...p, pausados: ["2026-09"] };
    nuevas = F.copiasQueFaltan([pausada], [primero], "2026-10", TIPOS);
    assert.deepEqual(nuevas.map(g => g.mes), ["2026-10"]);

    // Nunca se copia a meses futuros.
    assert.equal(F.copiasQueFaltan([p], [primero], "2026-08", TIPOS).length, 0);
});

test("un mes cubierto por un gasto editado (otro id) no se vuelve a copiar", () => {
    const p = F.nuevaPlantilla(HIPOTECA, AHORA);
    const editado = { id: "manual-x", plantillaFija: p.id, mes: "2026-09" };
    const nuevas = F.copiasQueFaltan([p], [editado], "2026-09", TIPOS);
    assert.deepEqual(nuevas.map(g => g.mes), ["2026-08"]);
});

test("cambiar el monto del fijo actualiza solo las copias sin confirmar", () => {
    const p = F.nuevaPlantilla(HIPOTECA, AHORA);
    const confirmada = { ...F.copiaDelMes(p, "2026-08", TIPOS), pendiente: false };
    const pendiente = F.copiaDelMes(p, "2026-09", TIPOS);
    const otro = { id: "otro", plantillaFija: "otra-plantilla", pendiente: true, mes: "2026-09" };

    const nueva = { ...p, monto: 600000 };
    const cambiadas = F.actualizarPendientes(nueva, [confirmada, pendiente, otro], TIPOS, AHORA);
    assert.equal(cambiadas.length, 1);
    assert.equal(cambiadas[0].id, pendiente.id);
    assert.equal(cambiadas[0].monto, 600000);
    assert.equal(cambiadas[0].montoARS, 600000);
});

test("las copias a confirmar ya suman al mes y se cuentan aparte", () => {
    const p = F.nuevaPlantilla(HIPOTECA, AHORA);
    const gastos = [
        F.copiaDelMes(p, "2026-09", TIPOS),
        F.gastoManual({ fecha: "2026-09-05", concepto: "Heladera", monto: 900000, moneda: "ARS", categoria: "alacran" }, TIPOS),
    ];
    const r = H.calculos.resumenMes(gastos, "2026-09");
    assert.equal(r.total, 1460000);
    assert.equal(r.porCategoria.fijo.total, 560000);
    assert.equal(r.porCategoria.alacran.cantidad, 1);
    assert.equal(r.pendientes.cantidad, 1);
    assert.equal(r.pendientes.total, 560000);
});
