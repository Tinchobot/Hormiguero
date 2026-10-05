// =====================================
// Tipo de cambio por mes (pesos por dólar).
//
// tipos: { "2026-08": { valor: 1530, origen: "manual" | "pago" | "sugerido" } }
//
// - manual: lo cargó el usuario en Ajustes. Nunca se pisa.
// - pago: sale del "Su pago en pesos ... tc1530,000" del resumen
//   siguiente, que es el cambio al que efectivamente se pagaron esos
//   dólares. Es el dato más fiel que hay.
// - sugerido: mientras no llega el resumen siguiente, se usa el último
//   tipo de cambio de pago conocido.
// =====================================

(function (H) {

    function valor(tipos, mes) {
        return tipos[mes] ? tipos[mes].valor : null;
    }

    // Al importar un resumen asignado a `mes` cuyo pago anterior se hizo
    // con tipo de cambio tcPago. Devuelve los tipos actualizados y la
    // lista de meses que cambiaron (para recalcular sus gastos).
    function alImportar(tipos, mes, tcPago) {
        const nuevos = { ...tipos };
        const cambiados = [];
        if (!tcPago) return { tipos: nuevos, cambiados };

        // El pago que figura en este resumen es el del resumen anterior.
        const anterior = H.mesAnterior(mes);
        if (!nuevos[anterior] || nuevos[anterior].origen !== "manual") {
            if (valor(nuevos, anterior) !== tcPago || (nuevos[anterior] && nuevos[anterior].origen !== "pago")) {
                nuevos[anterior] = { valor: tcPago, origen: "pago" };
                cambiados.push(anterior);
            }
        }

        if (!nuevos[mes]) {
            nuevos[mes] = { valor: tcPago, origen: "sugerido" };
            cambiados.push(mes);
        }

        return { tipos: nuevos, cambiados };
    }

    // Recalcula montoARS de los gastos en dólares del mes. Devuelve solo
    // los que cambiaron.
    function recalcular(gastos, mes, tc, ahora) {
        const actualizado = (ahora || new Date()).toISOString();
        const cambiados = [];
        for (const g of gastos) {
            if (g.mes !== mes || g.moneda !== "USD") continue;
            const montoARS = H.aPesos(g.monto, "USD", tc);
            if (montoARS !== g.montoARS) cambiados.push({ ...g, montoARS, actualizado });
        }
        return cambiados;
    }

    H.cambio = { valor, alImportar, recalcular };

})(globalThis.Hormiguero ||= {});
