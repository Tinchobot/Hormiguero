// =====================================
// Categorías, formato de montos y fechas, normalización de texto.
//
// Funciona en el navegador y en Node (para los tests): todo se cuelga
// de globalThis.Hormiguero.
// =====================================

(function (H) {

    const CATEGORIAS = [
        { clave: "fijo",        nombre: "Fijos",       singular: "Fijo",        color: "#00796B", grupo: null },
        { clave: "necesario",   nombre: "Necesario",   singular: "Necesario",   color: "#2E7D32", grupo: "hormiga" },
        { clave: "evitable",    nombre: "Evitable",    singular: "Evitable",    color: "#EF6C00", grupo: "hormiga" },
        { clave: "innecesario", nombre: "Innecesario", singular: "Innecesario", color: "#C62828", grupo: "hormiga" },
        { clave: "ahorro",      nombre: "Ahorro",      singular: "Ahorro",      color: "#1E5AA8", grupo: null },
        { clave: "alacran",     nombre: "Alacranes",   singular: "Alacrán",     color: "#3E2723", grupo: null },
    ];

    const HORMIGAS = ["necesario", "evitable", "innecesario"];

    const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

    function categoria(clave) {
        return CATEGORIAS.find(c => c.clave === clave);
    }

    // $1.234.567 — decimales solo si el monto los tiene.
    function plata(monto) {
        const redondo = Math.round(monto * 100) / 100;
        const conDecimales = !Number.isInteger(redondo);
        const texto = Math.abs(redondo).toLocaleString("es-AR", {
            minimumFractionDigits: conDecimales ? 2 : 0,
            maximumFractionDigits: conDecimales ? 2 : 0,
        });
        return (redondo < 0 ? "-$" : "$") + texto;
    }

    // Para los números grandes del tablero: sin centavos.
    function plataRedonda(monto) {
        return plata(Math.round(monto));
    }

    // U$S 20,00 — siempre con centavos.
    function dolares(monto) {
        const texto = Math.abs(monto).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (monto < 0 ? "-U$S " : "U$S ") + texto;
    }

    // Monto en pesos según la moneda. Sin tipo de cambio, un monto en
    // dólares queda en null (se avisa en el tablero que falta cargarlo).
    function aPesos(monto, moneda, tc) {
        if (moneda !== "USD") return monto;
        return tc ? Math.round(monto * tc * 100) / 100 : null;
    }

    // Versión corta para etiquetas de gráficos: $224 mil, $1,06 mill.
    function plataCorta(monto) {
        if (monto >= 1e6) {
            return "$" + (monto / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " mill.";
        }
        if (monto >= 1e3) {
            return "$" + Math.round(monto / 1e3).toLocaleString("es-AR") + " mil";
        }
        return plata(monto);
    }

    // 0.1704 → "17,0%"; con entero=true → "17%".
    function porcentaje(fraccion, entero) {
        if (!isFinite(fraccion)) fraccion = 0;
        return (fraccion * 100).toLocaleString("es-AR", {
            minimumFractionDigits: entero ? 0 : 1,
            maximumFractionDigits: entero ? 0 : 1,
        }) + "%";
    }

    // "2026-09-29" → "29/09"
    function diaMes(fechaISO) {
        return fechaISO.slice(8, 10) + "/" + fechaISO.slice(5, 7);
    }

    // "2026-09" → "septiembre"
    function nombreMes(mes) {
        return MESES[Number(mes.slice(5, 7)) - 1];
    }

    function mesAnterior(mes) {
        let anio = Number(mes.slice(0, 4));
        let m = Number(mes.slice(5, 7)) - 1;
        if (m === 0) { m = 12; anio--; }
        return anio + "-" + String(m).padStart(2, "0");
    }

    function mesSiguiente(mes) {
        let anio = Number(mes.slice(0, 4));
        let m = Number(mes.slice(5, 7)) + 1;
        if (m === 13) { m = 1; anio++; }
        return anio + "-" + String(m).padStart(2, "0");
    }

    function diasDelMes(mes) {
        return new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
    }

    // Minúsculas, sin tildes, espacios simples.
    function normalizar(texto) {
        return String(texto ?? "")
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    // Clave para agrupar conceptos de Ants: "Kiosko", "kiosco " y "KIOSCO"
    // caen juntos.
    function claveConcepto(concepto) {
        return normalizar(concepto)
            .replace(/[.,;:!?¡¿"']/g, "")
            .replace(/kiosko/g, "kiosco")
            .trim();
    }

    H.CATEGORIAS = CATEGORIAS;
    H.HORMIGAS = HORMIGAS;
    H.MESES = MESES;
    H.categoria = categoria;
    H.plata = plata;
    H.plataCorta = plataCorta;
    H.plataRedonda = plataRedonda;
    H.dolares = dolares;
    H.aPesos = aPesos;
    H.porcentaje = porcentaje;
    H.diaMes = diaMes;
    H.nombreMes = nombreMes;
    H.mesAnterior = mesAnterior;
    H.mesSiguiente = mesSiguiente;
    H.diasDelMes = diasDelMes;
    H.normalizar = normalizar;
    H.claveConcepto = claveConcepto;

})(globalThis.Hormiguero ||= {});
