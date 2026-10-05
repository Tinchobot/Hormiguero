// =====================================
// Lector del resumen Visa Santander en PDF.
//
// Trabaja en dos pasos:
//   1. extraerLineas: pdf.js da fragmentos de texto con posición; se juntan
//      en líneas (misma altura) ordenadas de arriba hacia abajo.
//   2. leerLineas: recorre las líneas como una máquina de estados
//      (pago anterior → movimientos por tarjeta → impuestos → total).
//
// leerLineas es pura y es lo que cubren los tests. Devuelve los
// movimientos crudos; convertirlos en gastos (mes, tipo de cambio,
// categoría) es trabajo de aGastos y de reglas.js.
// =====================================

(function (H) {

    const MESES_TEXTO = {
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
        agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    };

    const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{2})$/;
    const RE_PESOS = /^(-?)\$\s*([\d.]+,\d{2})$/;
    const RE_DOLARES = /^(-?)U\$S\s*([\d.]+,\d{2})$/;
    const RE_CUOTA = /^(\d+) de (\d+)$/;

    // "12/05/25" → "2025-05-12"
    function fecha(texto) {
        const m = RE_FECHA.exec(texto.trim());
        return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
    }

    // "1.234,56" → 1234.56
    function numero(texto) {
        return Number(texto.replace(/\./g, "").replace(",", "."));
    }

    function monto(texto) {
        const t = texto.trim();
        let m = RE_PESOS.exec(t);
        if (m) return { moneda: "ARS", valor: (m[1] ? -1 : 1) * numero(m[2]) };
        m = RE_DOLARES.exec(t);
        if (m) return { moneda: "USD", valor: (m[1] ? -1 : 1) * numero(m[2]) };
        return null;
    }

    function centavos(n) {
        return Math.round(n * 100);
    }

    // ---------- Paso 1: fragmentos → líneas ----------

    // paginas: [[{ x, y, s }]] con y medida desde arriba.
    function extraerLineas(paginas) {
        const lineas = [];
        paginas.forEach((items, i) => {
            const delaPagina = [];
            for (const it of items) {
                if (!it.s.trim()) continue;
                let linea = delaPagina.find(l => Math.abs(l.y - it.y) <= 2);
                if (!linea) {
                    linea = { pagina: i + 1, y: it.y, celdas: [] };
                    delaPagina.push(linea);
                }
                linea.celdas.push({ x: it.x, s: it.s.trim() });
            }
            delaPagina.sort((a, b) => a.y - b.y);
            for (const l of delaPagina) {
                l.celdas.sort((a, b) => a.x - b.x);
                l.texto = l.celdas.map(c => c.s).join(" ");
                lineas.push(l);
            }
        });
        return lineas;
    }

    // ---------- Paso 2: líneas → resumen ----------

    function leerEncabezado(lineas, doc) {
        // Fila con las seis fechas: cierre y vencimiento anterior, actual y próximo.
        const iFechas = lineas.findIndex(l => l.celdas.filter(c => RE_FECHA.test(c.s)).length >= 6);
        if (iFechas < 0) throw new Error("No encontré las fechas de cierre y vencimiento.");
        const f = lineas[iFechas].celdas.filter(c => RE_FECHA.test(c.s)).map(c => fecha(c.s));
        doc.cierre = f[2];
        doc.vencimiento = f[3];

        const cuenta = lineas.map(l => /Cuenta N[º°o]\s*(\d+)/.exec(l.texto)).find(Boolean);
        doc.cuenta = cuenta ? cuenta[1].slice(-4) : "";

        // Próximas cuotas: título, fila de meses, fila de montos.
        const iCuotas = lineas.findIndex(l => l.texto.startsWith("Próximas cuotas a vencer"));
        doc.proximasCuotas = [];
        if (iCuotas >= 0 && lineas[iCuotas + 2]) {
            const meses = lineas[iCuotas + 1].celdas.map(c => {
                const m = /^(\p{L}+)\s+(\d{4})$/u.exec(c.s);
                const n = m && MESES_TEXTO[H.normalizar(m[1])];
                return n ? m[2] + "-" + String(n).padStart(2, "0") : null;
            });
            const montos = lineas[iCuotas + 2].celdas.map(c => numero(c.s.replace(/^\$\s*/, "")));
            meses.forEach((mes, i) => {
                if (mes && montos[i] > 0) doc.proximasCuotas.push({ mes, monto: montos[i] });
            });
        }
    }

    function leerLineas(lineas) {
        const doc = {
            tipo: "visa-santander",
            tarjetas: [],
            saldoAnterior: { ARS: 0, USD: 0 },
            tcPago: null,
            total: null,
        };
        leerEncabezado(lineas, doc);

        const movimientos = [];
        let seccion = null;       // pago | movimientos | impuestos
        let tarjeta = null;       // { terminacion, subtotal }
        let columnas = null;      // x de cada columna, según el último encabezado
        let ultimaFecha = null;
        let ultimo = null;

        for (const l of lineas) {
            const t = l.texto;

            if (t === "Pago anterior y devoluciones") { seccion = "pago"; continue; }
            if (t === "Movimientos") { seccion = "movimientos"; continue; }
            if (t.startsWith("Impuestos, intereses y percepciones")) {
                seccion = "impuestos"; tarjeta = null; ultimaFecha = null; ultimo = null;
                continue;
            }
            if (t.startsWith("Copia fiel")) continue;

            if (t.startsWith("Total a pagar")) {
                const montos = l.celdas.map(c => monto(c.s)).filter(Boolean);
                if (montos.length) {
                    doc.total = { ARS: 0, USD: 0 };
                    for (const m of montos) doc.total[m.moneda] = m.valor;
                    break; // lo que sigue son términos y condiciones
                }
                continue;
            }

            if (seccion === "pago") {
                const tc = /tc\s*([\d.]+,\d+)/.exec(t);
                if (tc) doc.tcPago = numero(tc[1]);
                if (t.startsWith("Saldo del resumen anterior")) {
                    for (const c of l.celdas) {
                        const m = monto(c.s);
                        if (m) doc.saldoAnterior[m.moneda] = m.valor;
                    }
                }
                continue;
            }

            if (!seccion) continue;

            const nuevaTarjeta = /^Visa crédito terminada en (\d{4})/.exec(t);
            if (nuevaTarjeta) {
                tarjeta = { terminacion: nuevaTarjeta[1], subtotal: null };
                doc.tarjetas.push(tarjeta);
                ultimaFecha = null; ultimo = null;
                continue;
            }
            if (t.startsWith("Movimientos de ")) continue;

            if (l.celdas[0].s === "Fecha" && l.celdas.some(c => c.s === "Descripción")) {
                columnas = {};
                for (const c of l.celdas) {
                    if (c.s === "Descripción") columnas.descripcion = c.x;
                    if (c.s === "Cuota") columnas.cuota = c.x;
                    if (c.s === "Comprobante") columnas.comprobante = c.x;
                }
                continue;
            }

            if (t.startsWith("Subtotal")) {
                if (tarjeta) {
                    tarjeta.subtotal = { ARS: 0, USD: 0 };
                    for (const c of l.celdas) {
                        const m = monto(c.s);
                        if (m) tarjeta.subtotal[m.moneda] = m.valor;
                    }
                }
                ultimo = null;
                continue;
            }

            if (!columnas) continue;

            // Fila de movimiento: separar cada celda en su columna.
            let fechaFila = null, cuota = null, comprobante = null, importe = null;
            const descripcion = [];
            for (const c of l.celdas) {
                const m = monto(c.s);
                if (m) { importe = m; continue; }
                if (c.x < columnas.descripcion - 5 && RE_FECHA.test(c.s)) { fechaFila = fecha(c.s); continue; }
                const mc = RE_CUOTA.exec(c.s);
                if (mc && columnas.cuota && c.x >= columnas.cuota - 10) {
                    cuota = { numero: Number(mc[1]), total: Number(mc[2]) };
                    continue;
                }
                if (columnas.comprobante && c.x >= columnas.comprobante - 5 && /^\d+$/.test(c.s)) {
                    comprobante = c.s;
                    continue;
                }
                descripcion.push(c.s);
            }

            if (!importe) {
                // Segunda línea de la descripción del movimiento anterior.
                if (ultimo && descripcion.length) {
                    ultimo.detalle = (ultimo.detalle ? ultimo.detalle + " " : "") + descripcion.join(" ");
                }
                continue;
            }

            if (fechaFila) ultimaFecha = fechaFila;
            ultimo = {
                fecha: ultimaFecha,
                descripcion: descripcion.join(" "),
                detalle: "",
                cuota,
                comprobante,
                moneda: importe.moneda,
                monto: importe.valor,
                tarjeta: tarjeta ? tarjeta.terminacion : null,
                esImpuesto: seccion === "impuestos",
            };
            movimientos.push(ultimo);
        }

        if (!doc.total) throw new Error("No encontré el \"Total a pagar\" del resumen.");

        doc.mesSugerido = H.mesAnterior(doc.vencimiento.slice(0, 7));
        doc.id = "visa-santander-" + doc.cuenta + "-" + doc.vencimiento;
        doc.impuestos = { ARS: 0, USD: 0 };
        for (const m of movimientos) if (m.esImpuesto) doc.impuestos[m.moneda] += m.monto;

        return { documento: doc, movimientos, validacion: validar(doc, movimientos) };
    }

    // La suma de cada tarjeta tiene que dar su subtotal, y todo junto el
    // "Total a pagar". Devuelve los problemas en lenguaje claro.
    function validar(doc, movimientos) {
        const problemas = [];
        const sumaTotal = { ARS: centavos(doc.saldoAnterior.ARS), USD: centavos(doc.saldoAnterior.USD) };

        for (const t of doc.tarjetas) {
            const suma = { ARS: 0, USD: 0 };
            for (const m of movimientos) {
                if (m.tarjeta === t.terminacion && !m.esImpuesto) suma[m.moneda] += centavos(m.monto);
            }
            if (!t.subtotal) {
                problemas.push(`No encontré el subtotal de la tarjeta terminada en ${t.terminacion}.`);
                continue;
            }
            for (const moneda of ["ARS", "USD"]) {
                if (suma[moneda] !== centavos(t.subtotal[moneda])) {
                    problemas.push(`Tarjeta ${t.terminacion}: los movimientos suman ${formatear(suma[moneda] / 100, moneda)} pero el subtotal dice ${formatear(t.subtotal[moneda], moneda)}.`);
                }
                sumaTotal[moneda] += centavos(t.subtotal[moneda]);
            }
        }

        sumaTotal.ARS += centavos(doc.impuestos.ARS);
        sumaTotal.USD += centavos(doc.impuestos.USD);
        for (const moneda of ["ARS", "USD"]) {
            if (sumaTotal[moneda] !== centavos(doc.total[moneda])) {
                problemas.push(`El total suma ${formatear(sumaTotal[moneda] / 100, moneda)} pero el resumen dice ${formatear(doc.total[moneda], moneda)}.`);
            }
        }

        return { ok: problemas.length === 0, problemas };
    }

    function formatear(valor, moneda) {
        return moneda === "USD" ? H.dolares(valor) : H.plata(valor);
    }

    // ---------- Movimientos → gastos ----------

    // FNV-1a de 32 bits, dos pasadas → 16 hex (igual que en el lector de Ants).
    function hash(texto) {
        let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
        for (let i = 0; i < texto.length; i++) {
            const c = texto.charCodeAt(i);
            a = Math.imul(a ^ c, 0x01000193);
            b = Math.imul(b ^ c, 0x5bd1e995);
        }
        return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
    }

    // mes: el asignado (el usuario lo puede cambiar antes de importar).
    // tc: pesos por dólar para ese mes, o null si todavía no se sabe.
    function aGastos(resultado, mes, tc, ahora) {
        const { documento, movimientos } = resultado;
        const actualizado = (ahora || new Date()).toISOString();
        const repetidos = new Map();

        return movimientos.map(m => {
            const base = [m.tarjeta, m.fecha, m.comprobante, m.descripcion, m.moneda, m.monto].join("|");
            const vez = (repetidos.get(base) || 0) + 1;
            repetidos.set(base, vez);

            return {
                id: "tarjeta-" + hash(documento.id + "|" + base + "|" + vez),
                fecha: m.fecha,
                concepto: m.descripcion,
                detalle: m.detalle || undefined,
                monto: m.monto,
                moneda: m.moneda,
                montoARS: H.aPesos(m.monto, m.moneda, tc),
                categoria: m.esImpuesto ? "fijo" : null,
                clasificadoPor: m.esImpuesto ? "impuesto" : null,
                fuente: "tarjeta",
                mes,
                tarjeta: m.tarjeta ? "Visa " + m.tarjeta : null,
                cuota: m.cuota,
                esImpuesto: m.esImpuesto,
                plantillaFija: null,
                documento: documento.id,
                actualizado,
            };
        });
    }

    // ---------- PDF → fragmentos (necesita pdf.js) ----------

    async function fragmentos(datos, pdfjs) {
        const pdf = await pdfjs.getDocument({ data: datos, verbosity: 0 }).promise;
        const paginas = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const pagina = await pdf.getPage(p);
            const alto = pagina.getViewport({ scale: 1 }).height;
            const { items } = await pagina.getTextContent();
            paginas.push(items.map(it => ({
                x: Math.round(it.transform[4]),
                y: Math.round(alto - it.transform[5]),
                s: it.str,
            })));
        }
        return paginas;
    }

    // ¿Es un resumen Visa Santander? Se fija antes de intentar leerlo.
    function reconoce(lineas) {
        return lineas.some(l => l.texto === "Resumen Visa") &&
            lineas.some(l => /^Visa crédito terminada en \d{4}/.test(l.texto));
    }

    // Devuelve null si el PDF no es un resumen Visa Santander.
    async function leer(datos, pdfjs) {
        const lineas = extraerLineas(await fragmentos(datos, pdfjs));
        if (!lineas.length) throw new Error("El PDF no tiene texto (¿es una imagen escaneada?).");
        if (!reconoce(lineas)) return null;
        return leerLineas(lineas);
    }

    H.lectorVisaSantander = { leer, leerLineas, extraerLineas, fragmentos, aGastos, validar };

})(globalThis.Hormiguero ||= {});
