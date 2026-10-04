// =====================================
// Cálculos del tablero. Funciones puras: reciben gastos, devuelven números.
// =====================================

(function (H) {

    function sumar(gastos) {
        return gastos.reduce((t, g) => t + g.montoARS, 0);
    }

    // Totales y cantidades del mes por categoría.
    // sinAlacranes: deja afuera los alacranes de todos los totales.
    function resumenMes(todos, mes, opciones = {}) {
        let gastos = todos.filter(g => g.mes === mes);
        if (opciones.sinAlacranes) gastos = gastos.filter(g => g.categoria !== "alacran");

        const porCategoria = {};
        for (const c of H.CATEGORIAS) {
            const deCat = gastos.filter(g => g.categoria === c.clave);
            porCategoria[c.clave] = { total: sumar(deCat), cantidad: deCat.length };
        }

        const hormigas = H.HORMIGAS.reduce((t, c) => t + porCategoria[c].total, 0);
        const evitables = porCategoria.evitable.total + porCategoria.innecesario.total;
        const total = sumar(gastos);

        return { mes, gastos, porCategoria, hormigas, evitables, total };
    }

    // Semanas fijas del mes: 1–7, 8–14, 15–21, 22–28, 29–fin.
    function semanas(mes) {
        const fin = H.diasDelMes(mes);
        const lista = [];
        for (let desde = 1; desde <= fin; desde += 7) {
            const hasta = Math.min(desde + 6, fin);
            lista.push({ desde, hasta, etiqueta: desde === hasta ? String(desde) : desde + "–" + hasta });
        }
        return lista;
    }

    // Por semana, el total de cada categoría hormiga.
    function hormigasPorSemana(gastos, mes) {
        return semanas(mes).map(s => {
            const fila = { ...s };
            for (const c of H.HORMIGAS) {
                fila[c] = sumar(gastos.filter(g => {
                    const dia = Number(g.fecha.slice(8, 10));
                    return g.categoria === c && dia >= s.desde && dia <= s.hasta;
                }));
            }
            return fila;
        });
    }

    // Conceptos de Ants que más se repiten. Agrupa variantes simples
    // (mayúsculas, tildes, kiosco/kiosko) y muestra la forma más usada.
    function hormigasQueMasPican(gastos, cuantas = 5) {
        const grupos = new Map();
        for (const g of gastos) {
            if (g.fuente !== "ants") continue;
            const clave = H.claveConcepto(g.concepto);
            if (!clave) continue;
            const grupo = grupos.get(clave) || { veces: 0, total: 0, formas: new Map() };
            grupo.veces++;
            grupo.total += g.montoARS;
            const forma = g.concepto.trim();
            grupo.formas.set(forma, (grupo.formas.get(forma) || 0) + 1);
            grupos.set(clave, grupo);
        }
        return [...grupos.values()]
            .map(gr => {
                const [forma] = [...gr.formas.entries()].sort((a, b) => b[1] - a[1])[0];
                return { concepto: forma.charAt(0).toUpperCase() + forma.slice(1), veces: gr.veces, total: gr.total };
            })
            .sort((a, b) => b.veces - a.veces || b.total - a.total)
            .slice(0, cuantas);
    }

    // Los evitables e innecesarios más caros del mes.
    function picadurasQueMasDolieron(gastos, cuantas = 5) {
        return gastos
            .filter(g => g.categoria === "evitable" || g.categoria === "innecesario")
            .sort((a, b) => b.montoARS - a.montoARS)
            .slice(0, cuantas);
    }

    // Más recientes primero; a igual fecha, el más caro arriba.
    function ordenarMovimientos(gastos) {
        return [...gastos].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.montoARS - a.montoARS);
    }

    H.calculos = { resumenMes, semanas, hormigasPorSemana, hormigasQueMasPican, picadurasQueMasDolieron, ordenarMovimientos };

})(globalThis.Hormiguero ||= {});
