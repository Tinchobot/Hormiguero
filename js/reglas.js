// =====================================
// Reglas de clasificación por comercio.
//
// Una regla dice "si la descripción contiene X, va a la categoría Y".
// Las descripciones se comparan normalizadas: minúsculas, sin tildes,
// sin signos y sin los códigos que agrega el comercio al final
// ("Anthropic in1u4omub" → "anthropic"). Así una regla "anthropic"
// agarra también "Anthropic* claud in1u5zfhb".
//
// Regla: { id, patron, categoria, actualizado }
// =====================================

(function (H) {

    // Se descarta cualquier palabra con dígitos de 5 o más caracteres
    // (comprobantes, números de cliente, códigos de transacción).
    function claveComercio(descripcion) {
        return H.normalizar(descripcion)
            .replace(/[.]/g, "")
            .replace(/[*\-_/,;:()]/g, " ")
            .split(" ")
            .filter(p => p && !(p.length >= 5 && /\d/.test(p)))
            .join(" ");
    }

    // La regla con el patrón más largo que esté contenido en la descripción.
    function buscarRegla(reglas, descripcion) {
        const clave = claveComercio(descripcion);
        let mejor = null;
        for (const r of reglas) {
            if (r.patron && clave.includes(r.patron) && (!mejor || r.patron.length > mejor.patron.length)) {
                mejor = r;
            }
        }
        return mejor;
    }

    // Aplica las reglas a los gastos de tarjeta que no se clasificaron a
    // mano. Devuelve solo los que cambiaron, para guardarlos.
    function aplicar(reglas, gastos, ahora) {
        const actualizado = (ahora || new Date()).toISOString();
        const cambiados = [];
        for (const g of gastos) {
            if (g.fuente !== "tarjeta" || g.esImpuesto) continue;
            if (g.clasificadoPor === "manual") continue;
            const regla = buscarRegla(reglas, g.concepto);
            const categoria = regla ? regla.categoria : null;
            const por = regla ? "regla" : null;
            if (g.categoria !== categoria || g.clasificadoPor !== por) {
                cambiados.push({ ...g, categoria, clasificadoPor: por, actualizado });
            }
        }
        return cambiados;
    }

    // Gastos de tarjeta sin categoría, agrupados por comercio para la
    // bandeja "Por clasificar". El más repetido primero.
    function porClasificar(gastos) {
        const grupos = new Map();
        for (const g of gastos) {
            if (g.categoria) continue;
            const clave = claveComercio(g.concepto) || H.normalizar(g.concepto);
            const grupo = grupos.get(clave) || { clave, ejemplo: g.concepto, gastos: [], total: 0 };
            grupo.gastos.push(g);
            grupo.total += g.montoARS || 0;
            grupos.set(clave, grupo);
        }
        return [...grupos.values()].sort((a, b) => b.gastos.length - a.gastos.length || b.total - a.total);
    }

    function nuevaRegla(patron, categoria, ahora) {
        const limpio = claveComercio(patron);
        return {
            id: "regla-" + limpio.replace(/ /g, "-"),
            patron: limpio,
            categoria,
            actualizado: (ahora || new Date()).toISOString(),
        };
    }

    H.reglas = { claveComercio, buscarRegla, aplicar, porClasificar, nuevaRegla };

})(globalThis.Hormiguero ||= {});
