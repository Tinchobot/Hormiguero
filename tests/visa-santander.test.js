// Tests de la fase 2: lector del resumen Visa Santander, reglas por
// comercio y tipo de cambio.
// Los datos son inventados, con la misma estructura y posiciones que el
// PDF real. Si hay resúmenes reales en muestras/ (que no se suben), se
// prueban también, pero sin mostrar su contenido.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
require(path.join(raiz, "js/formato.js"));
require(path.join(raiz, "js/calculos.js"));
require(path.join(raiz, "js/reglas.js"));
require(path.join(raiz, "js/cambio.js"));
require(path.join(raiz, "js/lectores/visa-santander.js"));

const H = globalThis.Hormiguero;
const L = H.lectorVisaSantander;
const AHORA = new Date("2026-10-01T09:00:00Z");

// Cada línea: [pagina, y, [[x, texto], ...]]
const FRAGMENTOS = [
    [1, 93, [[40, "Resumen Visa"]]],
    [1, 129, [[40, "Persona Inventada"], [427, "Cuenta Nº 0000001234"]]],
    [1, 206, [[42, "Total a pagar"]]],
    [1, 263, [[50, "$ 141.651,25"], [230, "U$S 30,00"]]],
    [1, 398, [[67, "Cierre"], [140, "Vencimiento"], [241, "Cierre"], [313, "Vencimiento"], [407, "Próximo"], [482, "Próximo"]]],
    [1, 430, [[60, "30/07/26"], [148, "10/08/26"], [234, "27/08/26"], [320, "07/09/26"], [406, "01/10/26"], [481, "09/10/26"]]],
    [1, 698, [[42, "Próximas cuotas a vencer"]]],
    [1, 736, [[50, "Setiembre 2026"], [150, "Octubre 2026"], [250, "Noviembre 2026"]]],
    [1, 751, [[50, "$10.000,00"], [150, "$10.000,00"], [250, "$0,00"]]],
    [1, 821, [[40, "Copia fiel de carácter informativo"], [526, "1 de 3"]]],

    [2, 260, [[40, "Pago anterior y devoluciones"]]],
    [2, 293, [[45, "Fecha"], [104, "Descripción"], [375, "Monto en pesos"], [467, "Monto en dólares"]]],
    [2, 321, [[45, "10/08/26"], [104, "Saldo anterior"], [396, "$ 90.000,00"], [503, "U$S 5,00"]]],
    [2, 347, [[104, "Su pago en pesos 97.500,00 tc1500,000"], [392, "-$ 90.000,00"], [499, "-U$S 5,00"]]],
    [2, 381, [[53, "Saldo del resumen anterior"], [428, "$ 0,00"], [509, "U$S 0,00"]]],
    [2, 437, [[42, "Movimientos"]]],
    [2, 453, [[42, "Visa crédito terminada en 1111"]]],
    [2, 487, [[45, "Fecha"], [104, "Descripción"], [253, "Cuota"], [300, "Comprobante"], [380, "Monto en pesos"], [470, "Monto en dólares"]]],
    [2, 515, [[45, "12/05/25"], [104, "Muebleria inventada"], [250, "3 de 6"], [300, "004726"], [404, "$ 10.000,00"]]],
    [2, 544, [[103, "Subtotal"], [404, "$ 10.000,00"], [509, "U$S 0,00"]]],
    [2, 588, [[42, "Movimientos de Persona Inventada"]]],
    [2, 604, [[42, "Visa crédito terminada en 2222"]]],
    [2, 638, [[45, "Fecha"], [104, "Descripción"], [253, "Cuota"], [300, "Comprobante"], [380, "Monto en pesos"], [470, "Monto en dólares"]]],
    [2, 666, [[45, "31/07/26"], [104, "Gasnor- gas 11112222"], [300, "937374"], [404, "$ 50.000,00"]]],
    [2, 717, [[45, "05/08/26"], [104, "Aguas del pueblo"], [300, "000001"], [404, "$ 30.000,50"]]],
    [2, 733, [[104, "0000999888"]]],
    [2, 821, [[40, "Copia fiel de carácter informativo"], [526, "2 de 3"]]],

    [3, 89, [[45, "Fecha"], [104, "Descripción"], [253, "Cuota"], [300, "Comprobante"], [380, "Monto en pesos"], [470, "Monto en dólares"]]],
    [3, 115, [[45, "15/08/26"], [104, "Streaming in1u4omub"], [300, "529606"], [504, "U$S 20,00"]]],
    [3, 140, [[104, "Streaming* plus in1u5zfhb"], [300, "569459"], [509, "U$S 10,00"]]],
    [3, 166, [[45, "20/08/26"], [104, "Kiosco del barrio"], [300, "000123"], [409, "$ 2.000,00"]]],
    [3, 200, [[103, "Subtotal de Persona Inventada"], [398, "$ 82.000,50"], [497, "U$S 30,00"]]],
    [3, 460, [[42, "Impuestos, intereses y percepciones"]]],
    [3, 494, [[45, "Fecha"], [104, "Descripción"], [377, "Monto en pesos"], [469, "Monto en dólares"]]],
    [3, 522, [[45, "27/08/26"], [104, "Impuesto de sellos $"], [409, "$ 1.650,75"]]],
    [3, 547, [[104, "Db.rg 5617 30% ( 160000,00 )"], [403, "$ 48.000,00"]]],
    [3, 600, [[54, "Total a pagar"], [400, "$ 141.651,25"], [498, "U$S 30,00"]]],
    [3, 640, [[66, "Términos y condiciones: 3 cuotas de $ 1000,00"], [400, "$ 999,99"]]],
];

function lineasDePrueba(cambios) {
    const paginas = [[], [], []];
    for (const [p, y, celdas] of cambios ? cambios(structuredClone(FRAGMENTOS)) : FRAGMENTOS) {
        for (const [x, s] of celdas) paginas[p - 1].push({ x, y, s });
    }
    return L.extraerLineas(paginas);
}

// ---------- Lector ----------

test("lee fechas, mes asignado y total", () => {
    const { documento: d, validacion } = L.leerLineas(lineasDePrueba());
    assert.equal(d.vencimiento, "2026-09-07");
    assert.equal(d.cierre, "2026-08-27");
    assert.equal(d.mesSugerido, "2026-08", "mes anterior al vencimiento");
    assert.deepEqual(d.total, { ARS: 141651.25, USD: 30 });
    assert.equal(d.tcPago, 1500);
    assert.equal(d.cuenta, "1234");
    assert.equal(d.id, "visa-santander-1234-2026-09-07");
    assert.deepEqual(validacion, { ok: true, problemas: [] });
});

test("separa tarjetas con sus subtotales", () => {
    const { documento: d } = L.leerLineas(lineasDePrueba());
    assert.deepEqual(d.tarjetas, [
        { terminacion: "1111", subtotal: { ARS: 10000, USD: 0 } },
        { terminacion: "2222", subtotal: { ARS: 82000.5, USD: 30 } },
    ]);
});

test("lee movimientos: cuotas, dólares, fechas heredadas y segunda línea", () => {
    const { movimientos } = L.leerLineas(lineasDePrueba());
    const consumos = movimientos.filter(m => !m.esImpuesto);
    assert.equal(consumos.length, 6);

    const [cuota, gas, aguas, s1, s2, kiosco] = consumos;
    assert.deepEqual(cuota.cuota, { numero: 3, total: 6 });
    assert.equal(cuota.fecha, "2025-05-12");
    assert.equal(cuota.tarjeta, "1111");

    assert.equal(gas.descripcion, "Gasnor- gas 11112222");
    assert.equal(gas.comprobante, "937374");

    assert.equal(aguas.monto, 30000.5);
    assert.equal(aguas.detalle, "0000999888", "la segunda línea pasa al detalle");

    assert.equal(s1.moneda, "USD");
    assert.equal(s1.monto, 20);
    assert.equal(s2.fecha, "2026-08-15", "sin fecha: hereda la de arriba");
    assert.equal(s2.monto, 10);
    assert.equal(kiosco.tarjeta, "2222");
});

test("impuestos aparte y nada de lo que sigue al total", () => {
    const { movimientos, documento } = L.leerLineas(lineasDePrueba());
    const impuestos = movimientos.filter(m => m.esImpuesto);
    assert.deepEqual(impuestos.map(m => [m.fecha, m.monto, m.tarjeta]), [
        ["2026-08-27", 1650.75, null],
        ["2026-08-27", 48000, null],
    ]);
    assert.equal(documento.impuestos.ARS, 49650.75);
    assert.ok(!movimientos.some(m => m.monto === 999.99), "ignora términos y condiciones");
    assert.ok(!movimientos.some(m => /Saldo anterior|Su pago/.test(m.descripcion)), "ignora el pago anterior");
});

test("próximas cuotas: solo las que tienen monto", () => {
    const { documento } = L.leerLineas(lineasDePrueba());
    assert.deepEqual(documento.proximasCuotas, [
        { mes: "2026-09", monto: 10000 },
        { mes: "2026-10", monto: 10000 },
    ]);
});

test("avisa si un subtotal no coincide", () => {
    const lineas = lineasDePrueba(f => {
        f.find(l => l[2][1] && l[2][1][1] === "Kiosco del barrio")[2][3][1] = "$ 2.500,00";
        return f;
    });
    const { validacion } = L.leerLineas(lineas);
    assert.equal(validacion.ok, false);
    assert.equal(validacion.problemas.length, 1, "falla la tarjeta; el total se arma con los subtotales y cierra");
    assert.match(validacion.problemas[0], /Tarjeta 2222.*\$82\.500,50.*\$82\.000,50/);
});

test("un PDF que no es resumen tira un error claro", () => {
    const lineas = L.extraerLineas([[{ x: 10, y: 10, s: "Factura de luz" }]]);
    assert.throws(() => L.leerLineas(lineas), /fechas de cierre y vencimiento/);
});

// ---------- Gastos ----------

test("aGastos: mes asignado, dólares convertidos e impuestos como fijos", () => {
    const r = L.leerLineas(lineasDePrueba());
    const gastos = L.aGastos(r, "2026-08", 1500, AHORA);
    assert.equal(gastos.length, 8);
    assert.ok(gastos.every(g => g.mes === "2026-08" && g.fuente === "tarjeta" && g.documento === r.documento.id));

    const usd = gastos.find(g => g.concepto === "Streaming in1u4omub");
    assert.equal(usd.moneda, "USD");
    assert.equal(usd.monto, 20);
    assert.equal(usd.montoARS, 30000);
    assert.equal(usd.categoria, null, "sin regla queda por clasificar");
    assert.equal(usd.tarjeta, "Visa 2222");

    const imp = gastos.filter(g => g.esImpuesto);
    assert.ok(imp.every(g => g.categoria === "fijo"));
});

test("aGastos: ids estables (no duplica al volver a subir) y únicos", () => {
    const r = L.leerLineas(lineasDePrueba());
    const a = L.aGastos(r, "2026-08", 1500).map(g => g.id);
    const b = L.aGastos(L.leerLineas(lineasDePrueba()), "2026-09", 1600).map(g => g.id);
    assert.deepEqual(a, b, "el mes y el tipo de cambio no cambian el id");
    assert.equal(new Set(a).size, a.length);
});

test("aGastos sin tipo de cambio deja los dólares en null", () => {
    const gastos = L.aGastos(L.leerLineas(lineasDePrueba()), "2026-08", null);
    const usd = gastos.filter(g => g.moneda === "USD");
    assert.ok(usd.every(g => g.montoARS === null));
    const r = H.calculos.resumenMes(gastos, "2026-08");
    assert.equal(r.sinCambio, 2);
});

// ---------- Reglas ----------

test("claveComercio saca códigos, números y signos", () => {
    const k = H.reglas.claveComercio;
    assert.equal(k("Anthropic in1u4omub"), "anthropic");
    assert.equal(k("Anthropic* claud in1u5zfhb"), "anthropic claud");
    assert.equal(k("Ecogas- gas cent 22224483"), "ecogas gas cent");
    assert.equal(k("E.p.e.c deb.aut."), "epec debaut");
    assert.equal(k("Google *youtubepremium"), "google youtubepremium");
    assert.equal(k("Netflix.com i5fpyfx9t"), "netflixcom");
});

test("una regla corta agarra todas las variantes; gana la más larga", () => {
    const reglas = [
        H.reglas.nuevaRegla("Anthropic", "fijo"),
        H.reglas.nuevaRegla("google", "evitable"),
        H.reglas.nuevaRegla("google youtubep", "fijo"),
    ];
    assert.equal(H.reglas.buscarRegla(reglas, "Anthropic* claud in1u5zfhb").categoria, "fijo");
    assert.equal(H.reglas.buscarRegla(reglas, "Google *youtubepremium").categoria, "fijo");
    assert.equal(H.reglas.buscarRegla(reglas, "Google*play").categoria, "evitable");
    assert.equal(H.reglas.buscarRegla(reglas, "Kiosco"), null);
});

test("aplicar respeta lo clasificado a mano y los impuestos", () => {
    const gastos = L.aGastos(L.leerLineas(lineasDePrueba()), "2026-08", 1500);
    const kiosco = gastos.find(g => g.concepto === "Kiosco del barrio");
    kiosco.categoria = "necesario";
    kiosco.clasificadoPor = "manual";

    const reglas = [H.reglas.nuevaRegla("kiosco", "innecesario"), H.reglas.nuevaRegla("streaming", "fijo"), H.reglas.nuevaRegla("impuesto", "ahorro")];
    const cambiados = H.reglas.aplicar(reglas, gastos, AHORA);

    assert.deepEqual(cambiados.map(g => g.concepto).sort(), ["Streaming in1u4omub", "Streaming* plus in1u5zfhb"]);
    assert.ok(cambiados.every(g => g.categoria === "fijo" && g.clasificadoPor === "regla"));
});

test("quitar una regla devuelve los gastos a por clasificar", () => {
    let gastos = L.aGastos(L.leerLineas(lineasDePrueba()), "2026-08", 1500);
    const reglas = [H.reglas.nuevaRegla("streaming", "fijo")];
    const aplicados = new Map(H.reglas.aplicar(reglas, gastos).map(g => [g.id, g]));
    gastos = gastos.map(g => aplicados.get(g.id) || g);

    const deshechos = H.reglas.aplicar([], gastos);
    assert.equal(deshechos.length, 2);
    assert.ok(deshechos.every(g => g.categoria === null));
});

test("porClasificar agrupa por comercio", () => {
    const gastos = L.aGastos(L.leerLineas(lineasDePrueba()), "2026-08", 1500);
    const grupos = H.reglas.porClasificar(gastos);
    assert.ok(grupos.every(gr => gr.gastos.every(g => !g.esImpuesto)));
    const total = grupos.reduce((t, gr) => t + gr.gastos.length, 0);
    assert.equal(total, 6);
});

// ---------- Tipo de cambio ----------

test("el pago de un resumen fija el tipo de cambio del mes anterior", () => {
    let { tipos, cambiados } = H.cambio.alImportar({}, "2026-08", 1520);
    assert.deepEqual(tipos, {
        "2026-07": { valor: 1520, origen: "pago" },
        "2026-08": { valor: 1520, origen: "sugerido" },
    });
    assert.deepEqual(cambiados, ["2026-07", "2026-08"]);

    // Llega el resumen siguiente: agosto pasa de sugerido al valor real.
    ({ tipos, cambiados } = H.cambio.alImportar(tipos, "2026-09", 1530));
    assert.deepEqual(tipos["2026-08"], { valor: 1530, origen: "pago" });
    assert.deepEqual(tipos["2026-09"], { valor: 1530, origen: "sugerido" });
    assert.deepEqual(tipos["2026-07"], { valor: 1520, origen: "pago" });
});

test("un tipo de cambio cargado a mano no se pisa", () => {
    const { tipos, cambiados } = H.cambio.alImportar({ "2026-08": { valor: 1600, origen: "manual" } }, "2026-09", 1530);
    assert.deepEqual(tipos["2026-08"], { valor: 1600, origen: "manual" });
    assert.ok(!cambiados.includes("2026-08"));
});

test("recalcular cambia solo los dólares del mes", () => {
    const gastos = L.aGastos(L.leerLineas(lineasDePrueba()), "2026-08", 1500);
    const cambiados = H.cambio.recalcular(gastos, "2026-08", 1600);
    assert.equal(cambiados.length, 2);
    assert.deepEqual(cambiados.map(g => g.montoARS).sort(), [16000, 32000]);
    assert.equal(H.cambio.recalcular(gastos, "2026-07", 1600).length, 0);
});

// ---------- Semanas con fechas fuera del mes ----------

test("gastos de tarjeta con fecha de otro mes caen en la primera o la última semana", () => {
    const g = (fecha, montoARS) => ({ fecha, montoARS, categoria: "evitable", mes: "2026-08" });
    const s = H.calculos.hormigasPorSemana([g("2026-07-31", 100), g("2025-05-12", 50), g("2026-08-10", 7), g("2026-09-02", 3)], "2026-08");
    assert.equal(s[0].evitable, 150);
    assert.equal(s[1].evitable, 7);
    assert.equal(s[s.length - 1].evitable, 3);
});

// ---------- Resúmenes reales (solo si están en muestras/) ----------

const muestras = path.join(raiz, "muestras");
const pdfs = fs.existsSync(muestras) ? fs.readdirSync(muestras).filter(f => f.toLowerCase().endsWith(".pdf")) : [];
const pdfjsRuta = path.join(raiz, "node_modules/pdfjs-dist/legacy/build/pdf.mjs");

test("los resúmenes reales de muestras/ cierran con su total", { skip: !pdfs.length || !fs.existsSync(pdfjsRuta) ? "no hay PDFs en muestras/" : false }, async () => {
    const pdfjs = await import("file:///" + pdfjsRuta.replace(/\\/g, "/"));
    for (const f of pdfs) {
        const r = await L.leer(new Uint8Array(fs.readFileSync(path.join(muestras, f))), pdfjs);
        assert.ok(r, `${f}: no se reconoció como resumen Visa Santander`);
        assert.deepEqual(r.validacion.problemas, [], f);
        assert.ok(r.movimientos.length > 0, f);
    }
});
