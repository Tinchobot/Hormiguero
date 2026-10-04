// =====================================
// Lector del Excel exportado de Ants.
//
// Hoja "Gastos" con columnas Fecha (dd/mm/aaaa), Hora, Concepto, Tipo,
// Monto. Ants exporta en el idioma del celular, así que se aceptan los
// encabezados y nombres de tipo de todos sus idiomas.
//
// La Hora no se muestra en ningún lado; solo se usa para armar el id,
// así volver a importar el mismo Excel (o uno que se superpone) no
// duplica gastos.
// =====================================

(function (H) {

    const ENCABEZADOS = {
        fecha:    ["fecha", "date", "data"],
        hora:     ["hora", "time", "ora"],
        concepto: ["concepto", "item", "voce"],
        tipo:     ["tipo", "type"],
        monto:    ["monto", "amount", "valor", "importo"],
    };

    const TIPOS = {
        necesario:   ["necesario", "necessary", "necessario", "necessaria"],
        evitable:    ["evitable", "avoidable", "evitavel", "evitabile"],
        innecesario: ["innecesario", "unnecessary", "desnecessario", "superflua"],
    };

    function tipoAnts(texto) {
        const t = H.normalizar(texto);
        return Object.keys(TIPOS).find(clave => TIPOS[clave].includes(t)) || null;
    }

    // "29/09/2026" → "2026-09-29". También acepta fechas que Excel haya
    // convertido a número de serie o a Date.
    function fechaISO(valor) {
        if (valor instanceof Date && !isNaN(valor)) {
            return isoDe(valor.getFullYear(), valor.getMonth() + 1, valor.getDate());
        }
        if (typeof valor === "number" && valor > 0) {
            const d = new Date(Math.round((valor - 25569) * 86400000));
            return isoDe(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        }
        const m = String(valor ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        const dia = Number(m[1]), mes = Number(m[2]), anio = Number(m[3]);
        const prueba = new Date(anio, mes - 1, dia);
        if (prueba.getMonth() !== mes - 1 || prueba.getDate() !== dia) return null;
        return isoDe(anio, mes, dia);
    }

    function isoDe(anio, mes, dia) {
        return anio + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
    }

    // "$ 1.500" o "1500,50" → número. Ants exporta número, pero por las
    // dudas se tolera texto con formato argentino.
    function montoDe(valor) {
        if (typeof valor === "number") return valor;
        const limpio = String(valor ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
        const n = parseFloat(limpio);
        return isNaN(n) ? null : n;
    }

    // FNV-1a de 32 bits, dos pasadas con distinta semilla → 16 hex.
    function hash(texto) {
        let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
        for (let i = 0; i < texto.length; i++) {
            const c = texto.charCodeAt(i);
            a = Math.imul(a ^ c, 0x01000193);
            b = Math.imul(b ^ c, 0x5bd1e995);
        }
        return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
    }

    // Busca qué columna es cada cosa a partir de la fila de encabezados.
    function columnas(encabezados) {
        const normal = encabezados.map(H.normalizar);
        const idx = {};
        for (const campo of Object.keys(ENCABEZADOS)) {
            idx[campo] = normal.findIndex(e => ENCABEZADOS[campo].includes(e));
        }
        return idx;
    }

    // filas: arreglo de arreglos (la primera es el encabezado).
    // Devuelve { gastos, omitidas } donde omitidas explica qué no se pudo leer.
    function leerFilas(filas, ahora) {
        if (!filas.length) throw new Error("El archivo está vacío.");

        const col = columnas(filas[0]);
        const faltan = ["fecha", "concepto", "tipo", "monto"].filter(c => col[c] < 0);
        if (faltan.length) {
            throw new Error("No parece un Excel de Ants: faltan las columnas " + faltan.join(", ") + ".");
        }

        const actualizado = (ahora || new Date()).toISOString();
        const gastos = [];
        const omitidas = { sinTipo: 0, invalidas: 0 };
        const repetidas = new Map();

        for (let i = 1; i < filas.length; i++) {
            const fila = filas[i];
            if (!fila || fila.every(v => v === "" || v == null)) continue;

            const fecha = fechaISO(fila[col.fecha]);
            const monto = montoDe(fila[col.monto]);
            const concepto = String(fila[col.concepto] ?? "").trim();
            const categoria = tipoAnts(fila[col.tipo]);

            if (!fecha || monto == null) { omitidas.invalidas++; continue; }
            if (!categoria) { omitidas.sinTipo++; continue; }

            const hora = col.hora >= 0 ? String(fila[col.hora] ?? "") : "";
            const base = [fecha, hora, concepto, categoria, monto].join("|");
            const vez = (repetidas.get(base) || 0) + 1;
            repetidas.set(base, vez);

            gastos.push({
                id: "ants-" + hash(base + "|" + vez),
                fecha,
                concepto,
                monto,
                moneda: "ARS",
                montoARS: monto,
                categoria,
                fuente: "ants",
                mes: fecha.slice(0, 7),
                tarjeta: null,
                cuota: null,
                esImpuesto: false,
                plantillaFija: null,
                documento: null,
                actualizado,
            });
        }

        return { gastos, omitidas };
    }

    // Recibe el ArrayBuffer del archivo. Necesita XLSX (SheetJS).
    // Devuelve null si el libro no tiene forma de Excel de Ants, para que
    // quien llama pruebe con otro lector.
    function leer(buffer, XLSXlib, ahora) {
        const libro = XLSXlib.read(buffer, { type: "array" });
        for (const nombre of libro.SheetNames) {
            const filas = XLSXlib.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: "" });
            if (!filas.length) continue;
            const col = columnas(filas[0]);
            if (col.fecha >= 0 && col.concepto >= 0 && col.tipo >= 0 && col.monto >= 0) {
                return leerFilas(filas, ahora);
            }
        }
        return null;
    }

    H.lectorAnts = { leer, leerFilas, fechaISO, tipoAnts };

})(globalThis.Hormiguero ||= {});
