// Tests de la fase 1: lector del Excel de Ants y cálculos del tablero.
// Correr con: node --test tests/
// Datos inventados; nunca poner gastos reales acá.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const raiz = path.join(__dirname, "..");
const XLSX = require(path.join(raiz, "lib/xlsx.full.min.js"));
require(path.join(raiz, "js/formato.js"));
require(path.join(raiz, "js/calculos.js"));
require(path.join(raiz, "js/lectores/ants-excel.js"));

const H = globalThis.Hormiguero;
const AHORA = new Date("2026-10-01T09:00:00Z");

// Arma un .xlsx en memoria igual al que exporta Ants.
function excelDeAnts(filas, hoja = "Gastos", encabezados = ["Fecha", "Hora", "Concepto", "Tipo", "Monto"]) {
    const datos = filas.map(f => Object.fromEntries(encabezados.map((e, i) => [e, f[i]])));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(datos, { header: encabezados }), hoja);
    return XLSX.write(libro, { bookType: "xlsx", type: "array" });
}

const FILAS = [
    ["01/09/2026", "08:10", "Café", "Evitable", 3500],
    ["02/09/2026", "13:00", "Súper", "Necesario", 116000],
    ["02/09/2026", "17:45", "Kiosko", "Evitable", 4200],
    ["09/09/2026", "11:20", "kiosco", "Evitable", 3800],
    ["15/09/2026", "21:00", "Remeras", "Innecesario", 180000],
    ["29/09/2026", "19:30", "KIOSCO", "Necesario", 2500],
    ["30/09/2026", "10:00", "Café", "Evitable", 3500],
    ["03/08/2026", "10:00", "Café", "Evitable", 3000],
];

// ---------- Formato ----------

test("plata usa punto de miles y coma decimal", () => {
    assert.equal(H.plata(1234567), "$1.234.567");
    assert.equal(H.plata(0), "$0");
    assert.equal(H.plata(1500.5), "$1.500,50");
});

test("plataCorta abrevia miles y millones", () => {
    assert.equal(H.plataCorta(224000), "$224 mil");
    assert.equal(H.plataCorta(1060000), "$1,06 mill.");
});

test("mesAnterior cruza el año", () => {
    assert.equal(H.mesAnterior("2026-01"), "2025-12");
    assert.equal(H.mesAnterior("2026-09"), "2026-08");
});

// ---------- Lector de Ants ----------

test("lee el Excel de Ants y respeta el Tipo", () => {
    const { gastos, omitidas } = H.lectorAnts.leer(excelDeAnts(FILAS), XLSX, AHORA);
    assert.equal(gastos.length, 8);
    assert.deepEqual(omitidas, { sinTipo: 0, invalidas: 0 });

    const super_ = gastos.find(g => g.concepto === "Súper");
    assert.equal(super_.fecha, "2026-09-02");
    assert.equal(super_.mes, "2026-09");
    assert.equal(super_.categoria, "necesario");
    assert.equal(super_.monto, 116000);
    assert.equal(super_.montoARS, 116000);
    assert.equal(super_.moneda, "ARS");
    assert.equal(super_.fuente, "ants");
    assert.equal(super_.actualizado, AHORA.toISOString());
    assert.ok(!("hora" in super_), "la hora no se guarda");
});

test("el mismo Excel da los mismos ids (no duplica al reimportar)", () => {
    const a = H.lectorAnts.leer(excelDeAnts(FILAS), XLSX, AHORA).gastos.map(g => g.id);
    const b = H.lectorAnts.leer(excelDeAnts(FILAS.slice().reverse()), XLSX, AHORA).gastos.map(g => g.id);
    assert.equal(new Set(a).size, a.length, "ids únicos");
    assert.deepEqual([...a].sort(), [...b].sort());
});

test("dos gastos idénticos en el mismo archivo no se pisan", () => {
    const fila = ["05/09/2026", "10:00", "Café", "Evitable", 3500];
    const { gastos } = H.lectorAnts.leer(excelDeAnts([fila, fila]), XLSX, AHORA);
    assert.equal(gastos.length, 2);
    assert.notEqual(gastos[0].id, gastos[1].id);
});

test("acepta Ants exportado en inglés", () => {
    const buffer = excelDeAnts([["02/09/2026", "13:00", "Groceries", "Necessary", 5000]],
        "Expenses", ["Date", "Time", "Item", "Type", "Amount"]);
    const { gastos } = H.lectorAnts.leer(buffer, XLSX, AHORA);
    assert.equal(gastos[0].categoria, "necesario");
});

test("saltea filas sin clasificar o ilegibles y lo informa", () => {
    const { gastos, omitidas } = H.lectorAnts.leer(excelDeAnts([
        ["02/09/2026", "13:00", "Algo", "Sin clasificar", 1000],
        ["31/02/2026", "13:00", "Fecha imposible", "Evitable", 1000],
        ["03/09/2026", "13:00", "Bien", "Evitable", 1000],
    ]), XLSX, AHORA);
    assert.equal(gastos.length, 1);
    assert.deepEqual(omitidas, { sinTipo: 1, invalidas: 1 });
});

test("un Excel que no es de Ants devuelve null", () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["Nombre", "Edad"], ["Ana", 30]]), "Hoja1");
    assert.equal(H.lectorAnts.leer(XLSX.write(libro, { bookType: "xlsx", type: "array" }), XLSX), null);
});

// ---------- Cálculos ----------

const GASTOS = H.lectorAnts.leer(excelDeAnts(FILAS), XLSX, AHORA).gastos.concat([
    { id: "m1", fecha: "2026-09-01", concepto: "Hipoteca", montoARS: 560000, categoria: "fijo", fuente: "manual", mes: "2026-09" },
    { id: "m2", fecha: "2026-09-20", concepto: "Heladera", montoARS: 900000, categoria: "alacran", fuente: "manual", mes: "2026-09" },
]);

test("resumen del mes: hormigas, evitables y total", () => {
    const r = H.calculos.resumenMes(GASTOS, "2026-09");
    assert.equal(r.porCategoria.necesario.total, 118500);
    assert.equal(r.porCategoria.evitable.total, 15000);
    assert.equal(r.porCategoria.evitable.cantidad, 4);
    assert.equal(r.porCategoria.innecesario.total, 180000);
    assert.equal(r.hormigas, 313500);
    assert.equal(r.evitables, 195000);
    assert.equal(r.total, 313500 + 560000 + 900000);
});

test("ver sin alacranes los saca del total", () => {
    const r = H.calculos.resumenMes(GASTOS, "2026-09", { sinAlacranes: true });
    assert.equal(r.porCategoria.alacran.total, 0);
    assert.equal(r.total, 313500 + 560000);
});

test("semanas: 1–7 … 29–fin, y febrero de 28 días tiene cuatro", () => {
    assert.deepEqual(H.calculos.semanas("2026-09").map(s => s.etiqueta), ["1–7", "8–14", "15–21", "22–28", "29–30"]);
    assert.deepEqual(H.calculos.semanas("2026-02").map(s => s.etiqueta), ["1–7", "8–14", "15–21", "22–28"]);
    assert.equal(H.calculos.semanas("2026-03").pop().etiqueta, "29–31");
});

test("hormigas por semana no incluye fijos ni alacranes", () => {
    const r = H.calculos.resumenMes(GASTOS, "2026-09");
    const s = H.calculos.hormigasPorSemana(r.gastos, "2026-09");
    assert.equal(s[0].necesario, 116000);
    assert.equal(s[0].evitable, 7700);
    assert.equal(s[1].evitable, 3800);
    assert.equal(s[2].innecesario, 180000);
    assert.equal(s[4].necesario, 2500);
    assert.equal(s[4].evitable, 3500);
    const sumaSemanas = s.reduce((t, f) => t + f.necesario + f.evitable + f.innecesario, 0);
    assert.equal(sumaSemanas, r.hormigas);
});

test("hormigas que más pican agrupa kiosco/kiosko/KIOSCO", () => {
    const r = H.calculos.resumenMes(GASTOS, "2026-09");
    const [primero, segundo] = H.calculos.hormigasQueMasPican(r.gastos);
    assert.equal(primero.veces, 3);
    assert.equal(primero.total, 4200 + 3800 + 2500);
    assert.match(primero.concepto, /^Kiosc|^Kiosk/);
    assert.equal(segundo.concepto, "Café");
    assert.equal(segundo.veces, 2);
});

test("hormigas que más pican solo mira gastos de Ants", () => {
    const r = H.calculos.resumenMes(GASTOS, "2026-09");
    const conceptos = H.calculos.hormigasQueMasPican(r.gastos, 99).map(p => p.concepto);
    assert.ok(!conceptos.includes("Hipoteca"));
});

test("picaduras que más dolieron: evitables e innecesarios más caros", () => {
    const r = H.calculos.resumenMes(GASTOS, "2026-09");
    const p = H.calculos.picadurasQueMasDolieron(r.gastos, 2);
    assert.deepEqual(p.map(g => g.concepto), ["Remeras", "Kiosko"]);
});
