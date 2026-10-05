// Tests de la fase 5: historial (evolución, año contra año, mes contra su promedio).
// Datos inventados.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const raiz = path.join(__dirname, "..");
require(path.join(raiz, "js/formato.js"));
require(path.join(raiz, "js/calculos.js"));

const H = globalThis.Hormiguero;
const C = H.calculos;

let n = 0;
const g = (mes, categoria, montoARS) => ({ id: "g" + (++n), mes, fecha: mes + "-10", categoria, montoARS, fuente: "manual" });

const GASTOS = [
    g("2025-09", "necesario", 100),
    g("2025-10", "necesario", 200),
    g("2026-07", "fijo", 1000), g("2026-07", "evitable", 300),
    g("2026-08", "fijo", 1000), g("2026-08", "evitable", 500), g("2026-08", "alacran", 5000),
    g("2026-09", "fijo", 1200), g("2026-09", "evitable", 700), g("2026-09", "innecesario", 100),
];

test("evolución: hasta 12 meses, sin los vacíos del principio", () => {
    const e = C.evolucion(GASTOS, "2026-09");
    assert.equal(e.length, 12);
    assert.equal(e[0].mes, "2025-10");
    assert.equal(e[e.length - 1].mes, "2026-09");
    assert.equal(e.find(r => r.mes === "2026-08").total, 6500);
    assert.equal(e.find(r => r.mes === "2026-01").total, 0, "un mes del medio sin datos queda en cero");

    const corta = C.evolucion(GASTOS.filter(x => x.mes >= "2026-07"), "2026-09");
    assert.deepEqual(corta.map(r => r.mes), ["2026-07", "2026-08", "2026-09"]);
});

test("evolución sin alacranes", () => {
    const e = C.evolucion(GASTOS, "2026-09", { sinAlacranes: true });
    assert.equal(e.find(r => r.mes === "2026-08").total, 1500);
});

test("evolución de un mes anterior a todos los datos queda vacía", () => {
    assert.deepEqual(C.evolucion(GASTOS, "2024-01"), []);
});

test("año contra año: meses sin datos en null y total del año", () => {
    const a = C.comparacionAnual(GASTOS, 2026);
    assert.equal(a.meses[6].actual, 1300);
    assert.equal(a.meses[0].actual, null);
    assert.equal(a.meses[8].anterior, 100);
    assert.equal(a.meses[9].anterior, 200);
    assert.equal(a.totalActual, 1300 + 6500 + 2000);
    assert.equal(a.hayAnterior, true);
});

test("el acumulado compara solo meses con datos en los dos años", () => {
    // 2026 tiene jul, ago y sep; 2025 solo sep y oct: el único comparable es septiembre.
    const a = C.comparacionAnual(GASTOS, 2026);
    assert.deepEqual(a.comparables, [9]);
    assert.equal(a.acumuladoActual, 2000);
    assert.equal(a.acumuladoAnterior, 100);
});

test("el mes en curso no entra en el acumulado", () => {
    const a = C.comparacionAnual(GASTOS, 2026, {}, "2026-09");
    assert.deepEqual(a.comparables, []);
    assert.equal(a.acumuladoActual, 0);
    assert.equal(a.meses[8].actual, 2000, "igual se muestra en el gráfico");
});

test("año contra año sin datos del año anterior", () => {
    const a = C.comparacionAnual(GASTOS.filter(x => x.mes >= "2026-01"), 2026);
    assert.equal(a.hayAnterior, false);
    assert.deepEqual(a.comparables, []);
    assert.equal(a.acumuladoAnterior, 0);
});

test("mes contra el anterior y el promedio de los meses con datos", () => {
    const c = C.comparacionMes(GASTOS, "2026-09");
    assert.equal(c.mesesPromedio, 4, "sep y oct de 2025, jul y ago de 2026");
    const evitable = c.filas.find(f => f.clave === "evitable");
    assert.equal(evitable.actual, 700);
    assert.equal(evitable.anterior, 500);
    assert.equal(evitable.promedio, (300 + 500) / 4);
    assert.ok(Math.abs(evitable.contraPromedio - (700 - 200) / 200) < 1e-9);

    const total = c.filas.find(f => f.clave === "total");
    assert.equal(total.actual, 2000);
    assert.equal(total.promedio, (100 + 200 + 1300 + 6500) / 4);
    assert.deepEqual(c.filas.map(f => f.clave), ["fijo", "necesario", "evitable", "innecesario", "ahorro", "alacran", "hormigas", "total"]);
});

test("mes contra su historia sin alacranes", () => {
    const c = C.comparacionMes(GASTOS, "2026-09", { sinAlacranes: true });
    const total = c.filas.find(f => f.clave === "total");
    assert.equal(total.promedio, (100 + 200 + 1300 + 1500) / 4);
    assert.equal(c.filas.find(f => f.clave === "alacran").promedio, 0);
    assert.equal(c.filas.find(f => f.clave === "alacran").contraPromedio, null, "sin promedio no hay comparación");
});

test("primer mes con datos: sin anterior ni promedio", () => {
    const c = C.comparacionMes(GASTOS, "2025-09");
    assert.equal(c.mesesPromedio, 0);
    const total = c.filas.find(f => f.clave === "total");
    assert.equal(total.anterior, null);
    assert.equal(total.promedio, null);
    assert.equal(total.contraPromedio, null);
});
