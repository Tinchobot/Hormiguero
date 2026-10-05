// =====================================
// Carga manual y fijos que se repiten.
//
// Un gasto manual con "Se repite todos los meses" crea una plantilla:
//   { id, concepto, monto, moneda, categoria, dia, desde, pausados, actualizado }
//
// Desde el mes `desde` hasta el mes actual, cada mes tiene una copia de
// la plantilla. La copia se crea sola con pendiente: true (ya suma al
// total) y el usuario solo la confirma o ajusta el monto. Pausar un mes
// lo agrega a `pausados` y ese mes no se copia.
//
// La copia de cada mes tiene id fijo ("fijo-<plantilla>-<mes>"), así
// generar dos veces (o en dos dispositivos) nunca duplica.
// =====================================

(function (H) {

    function uuid() {
        if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    // "1.234,56" → 1234.56 · "1.500" → 1500 · "12,5" → 12.5 · "1500.75" → 1500.75
    function leerMonto(texto) {
        const t = String(texto ?? "").replace(/[$\s]|U\$S/g, "");
        if (!t) return null;
        let n;
        if (t.includes(",")) n = Number(t.replace(/\./g, "").replace(",", "."));
        else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
        else n = Number(t);
        return isFinite(n) ? n : null;
    }

    // Meses de `desde` a `hasta`, inclusive: ["2026-08", "2026-09", ...]
    function mesesEntre(desde, hasta) {
        const lista = [];
        let [a, m] = desde.split("-").map(Number);
        while (true) {
            const mes = a + "-" + String(m).padStart(2, "0");
            if (mes > hasta) break;
            lista.push(mes);
            m++;
            if (m === 13) { m = 1; a++; }
        }
        return lista;
    }

    // datos: { fecha, concepto, monto, moneda, categoria }
    function gastoManual(datos, tipos, ahora) {
        const mes = datos.fecha.slice(0, 7);
        return {
            id: "manual-" + uuid(),
            fecha: datos.fecha,
            concepto: datos.concepto.trim(),
            monto: datos.monto,
            moneda: datos.moneda,
            montoARS: H.aPesos(datos.monto, datos.moneda, H.cambio.valor(tipos, mes)),
            categoria: datos.categoria,
            clasificadoPor: "manual",
            fuente: "manual",
            mes,
            tarjeta: null,
            cuota: null,
            esImpuesto: false,
            plantillaFija: null,
            documento: null,
            actualizado: (ahora || new Date()).toISOString(),
        };
    }

    function nuevaPlantilla(datos, ahora) {
        return {
            id: uuid(),
            concepto: datos.concepto.trim(),
            monto: datos.monto,
            moneda: datos.moneda,
            categoria: datos.categoria,
            dia: Number(datos.fecha.slice(8, 10)),
            desde: datos.fecha.slice(0, 7),
            pausados: [],
            actualizado: (ahora || new Date()).toISOString(),
        };
    }

    function idCopia(plantilla, mes) {
        return "fijo-" + plantilla.id + "-" + mes;
    }

    // La copia de la plantilla para un mes. El día se ajusta a meses
    // cortos (un fijo del 31 cae el 30 en septiembre).
    function copiaDelMes(plantilla, mes, tipos, ahora) {
        const dia = Math.min(plantilla.dia, H.diasDelMes(mes));
        return {
            id: idCopia(plantilla, mes),
            fecha: mes + "-" + String(dia).padStart(2, "0"),
            concepto: plantilla.concepto,
            monto: plantilla.monto,
            moneda: plantilla.moneda,
            montoARS: H.aPesos(plantilla.monto, plantilla.moneda, H.cambio.valor(tipos, mes)),
            categoria: plantilla.categoria,
            clasificadoPor: "manual",
            fuente: "manual",
            mes,
            tarjeta: null,
            cuota: null,
            esImpuesto: false,
            plantillaFija: plantilla.id,
            pendiente: true,
            documento: null,
            actualizado: (ahora || new Date()).toISOString(),
        };
    }

    // Copias que faltan, desde el inicio de cada plantilla hasta `hasta`
    // (el mes actual). Un mes ya cubierto es uno que tiene algún gasto de
    // esa plantilla, aunque se haya editado.
    function copiasQueFaltan(plantillas, gastos, hasta, tipos, ahora) {
        const cubiertos = new Set(gastos.filter(g => g.plantillaFija).map(g => g.plantillaFija + "|" + g.mes));
        const nuevas = [];
        for (const p of plantillas) {
            for (const mes of mesesEntre(p.desde, hasta)) {
                if (p.pausados.includes(mes) || cubiertos.has(p.id + "|" + mes)) continue;
                nuevas.push(copiaDelMes(p, mes, tipos, ahora));
            }
        }
        return nuevas;
    }

    // Al cambiar el monto de una plantilla, las copias sin confirmar se
    // actualizan; las confirmadas quedan como estaban.
    function actualizarPendientes(plantilla, gastos, tipos, ahora) {
        const actualizado = (ahora || new Date()).toISOString();
        return gastos
            .filter(g => g.plantillaFija === plantilla.id && g.pendiente)
            .map(g => ({
                ...g,
                concepto: plantilla.concepto,
                monto: plantilla.monto,
                moneda: plantilla.moneda,
                montoARS: H.aPesos(plantilla.monto, plantilla.moneda, H.cambio.valor(tipos, g.mes)),
                categoria: plantilla.categoria,
                actualizado,
            }));
    }

    H.fijos = {
        leerMonto, mesesEntre, gastoManual, nuevaPlantilla, idCopia,
        copiaDelMes, copiasQueFaltan, actualizarPendientes,
    };

})(globalThis.Hormiguero ||= {});
