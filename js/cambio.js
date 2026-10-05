// =====================================
// Tipo de cambio por mes (pesos por dólar).
//
// tipos: { "2026-08": { valor: 1530, origen: "manual" | "pago" | "sugerido", actualizado } }
//
// Un tipo de cambio quitado queda como { valor: null, origen: "borrado" }
// para que la sincronización no lo reviva; para todo lo demás es como si
// no existiera.
//
// - manual: lo cargó el usuario en Ajustes. Nunca se pisa.
// - pago: sale del "Su pago en pesos ... tc1530,000" del resumen
//   siguiente, que es el cambio al que efectivamente se pagaron esos
//   dólares. Es el dato más fiel que hay.
// - sugerido: mientras no llega el resumen siguiente, se usa el último
//   tipo de cambio de pago conocido.
// =====================================

(function (H) {

    // La entrada del mes, o null si no hay (o se quitó).
    function tipo(tipos, mes) {
        return tipos[mes] && tipos[mes].valor != null ? tipos[mes] : null;
    }

    function valor(tipos, mes) {
        const t = tipo(tipos, mes);
        return t ? t.valor : null;
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
        const previo = tipo(nuevos, anterior);
        if (!previo || (previo.origen !== "manual" && (previo.valor !== tcPago || previo.origen !== "pago"))) {
            nuevos[anterior] = { valor: tcPago, origen: "pago" };
            cambiados.push(anterior);
        }

        if (!tipo(nuevos, mes)) {
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

    H.cambio = { tipo, valor, alImportar, recalcular };

})(globalThis.Hormiguero ||= {});
