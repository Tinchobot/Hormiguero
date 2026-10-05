// =====================================
// Hormiguero — tablero del mes.
//
// Se carga después de formato.js, calculos.js, datos.js, reglas.js,
// cambio.js, fijos.js y los lectores.
//
// Dos vistas en la misma página: el tablero y la carga manual (#carga).
// =====================================

(function (H) {

    const C = H.calculos;
    const $ = id => document.getElementById(id);

    const MOVIMIENTOS_VISIBLES = 8;
    const COLOR_SIN_CATEGORIA = "#CFC4A0";

    const estado = {
        gastos: [],
        documentos: [],
        reglas: [],
        fijos: [],          // plantillas de gastos que se repiten (ver fijos.js)
        tipos: {},          // tipos de cambio por mes (ver cambio.js)
        nombre: "",         // para el título: "El Hormiguero de Tincho"
        vista: "tablero",   // tablero | carga
        mes: null,          // "2026-09"
        sinAlacranes: false,
        filtro: "todos",    // todos | ants | tarjeta | fijo
        verTodos: false,
        pendiente: null,    // resumen leído esperando confirmación
    };

    let graficoSemanas = null;
    let graficoReparto = null;

    // ---------- Utilidades ----------

    function escapar(texto) {
        return String(texto ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
    }

    function mesActual() {
        const hoy = new Date();
        return hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    }

    function mesConAnio(mes) {
        return H.nombreMes(mes) + " " + mes.slice(0, 4);
    }

    // "2026-09-07" → "07/09/2026"
    function fechaLarga(iso) {
        return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
    }

    function mesesConDatos() {
        return new Set(estado.gastos.map(g => g.mes));
    }

    function ultimoMesConDatos() {
        return [...mesesConDatos()].sort().pop() || null;
    }

    function nombreFuente(g) {
        if (g.fuente === "ants") return "Ants";
        if (g.fuente === "tarjeta") return g.esImpuesto ? "Impuesto tarjeta" : (g.tarjeta || "Tarjeta");
        return g.plantillaFija ? "Fijo manual" : "Manual";
    }

    function cantidadGastos(n) {
        return n === 1 ? "1 gasto" : n + " gastos";
    }

    function cantidadMovimientos(n) {
        return n === 1 ? "1 movimiento" : n + " movimientos";
    }

    const ORIGEN_CAMBIO = {
        manual: "cargado a mano",
        pago: "al que pagaste el resumen",
        sugerido: "sugerido: el último pago conocido",
    };

    let temporizadorAviso = null;

    function avisar(texto, tipo) {
        const aviso = $("aviso");
        aviso.textContent = texto;
        aviso.className = "aviso" + (tipo ? " " + tipo : "");
        aviso.hidden = false;
        clearTimeout(temporizadorAviso);
        temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 7000);
    }

    function botonesCategoria(actual, sinContenedor) {
        const botones = H.CATEGORIAS.map(c =>
            `<button type="button" class="boton-cat" data-categoria="${c.clave}" aria-pressed="${c.clave === actual}">${c.singular}</button>`
        ).join("");
        return sinContenedor ? botones : `<div class="botones-cat">${botones}</div>`;
    }

    function montoConMoneda(monto, moneda) {
        return moneda === "USD" ? H.dolares(monto) : H.plata(monto);
    }

    // Reemplaza en estado.gastos los que vienen en la lista (por id).
    function reemplazarGastos(lista) {
        const porId = new Map(lista.map(g => [g.id, g]));
        estado.gastos = estado.gastos.map(g => porId.get(g.id) || g);
    }

    // Vuelve a aplicar las reglas a todos los gastos de tarjeta y guarda
    // los que cambiaron.
    async function aplicarReglas() {
        const cambiados = H.reglas.aplicar(estado.reglas, estado.gastos);
        await H.datos.guardarGastos(cambiados);
        reemplazarGastos(cambiados);
        return cambiados;
    }

    // ---------- Selector de período ----------

    function dibujarPeriodo() {
        const conDatos = mesesConDatos();
        const anioElegido = estado.mes.slice(0, 4);

        const anios = new Set([...conDatos].map(m => m.slice(0, 4)));
        anios.add(anioElegido);

        $("anios").innerHTML = [...anios].sort().map(a =>
            `<button type="button" class="boton" data-anio="${a}" aria-pressed="${a === anioElegido}">${a}</button>`
        ).join("");

        $("meses").innerHTML = H.MESES.map((nombre, i) => {
            const mes = anioElegido + "-" + String(i + 1).padStart(2, "0");
            const vacio = conDatos.has(mes) ? "" : " vacio";
            const etiqueta = nombre.slice(0, 3);
            return `<button type="button" class="boton boton-mes${vacio}" data-mes="${mes}" aria-pressed="${mes === estado.mes}" aria-label="${nombre}${vacio ? ", sin datos" : ""}">${etiqueta}</button>`;
        }).join("");
    }

    // ---------- Llamados ----------

    function dibujarLlamados(r) {
        const pc = r.porClasificar;
        $("llamadoClasificar").hidden = pc.cantidad === 0;
        if (pc.cantidad) {
            $("llamadoClasificarTitulo").textContent =
                `${pc.cantidad === 1 ? "Hay 1 movimiento" : `Hay ${pc.cantidad} movimientos`} de tarjeta por clasificar (${H.plataRedonda(pc.total)})`;
        }

        const pend = r.pendientes;
        $("llamadoPendientes").hidden = pend.cantidad === 0;
        if (pend.cantidad) {
            $("llamadoPendientesTitulo").textContent =
                `${pend.cantidad === 1 ? "Hay 1 fijo" : `Hay ${pend.cantidad} fijos`} de ${H.nombreMes(r.mes)} para confirmar (${H.plataRedonda(pend.total)})`;
        }

        $("llamadoCambio").hidden = r.sinCambio === 0;
        if (r.sinCambio) {
            $("llamadoCambioTitulo").textContent =
                `Falta el tipo de cambio de ${H.nombreMes(r.mes)}: ${r.sinCambio === 1 ? "1 gasto en dólares" : r.sinCambio + " gastos en dólares"} sin convertir`;
        }
    }

    // ---------- Tarjetas ----------

    function dibujarPrincipales(r, anterior) {
        $("totalHormigas").textContent = H.plataRedonda(r.hormigas);
        $("detalleHormigas").innerHTML = r.hormigas > 0
            ? `De eso, <b>${H.plataRedonda(r.evitables)} (${H.porcentaje(r.evitables / r.hormigas, true)})</b> se podía evitar`
            : "Sin gastos hormiga este mes";

        $("totalMes").textContent = H.plataRedonda(r.total);
        const mesPrevio = H.nombreMes(anterior.mes);
        if (anterior.total > 0) {
            const cambio = (r.total - anterior.total) / anterior.total;
            const sube = cambio > 0;
            const flecha = sube ? "↑" : "↓";
            const clase = cambio === 0 ? "" : (sube ? "sube" : "baja");
            $("detalleMes").innerHTML =
                `<span class="variacion ${clase}">${flecha} ${H.porcentaje(Math.abs(cambio), true)}</span> contra ${mesPrevio} (${H.plataRedonda(anterior.total)})`;
        } else {
            $("detalleMes").textContent = `Sin datos de ${mesPrevio} para comparar`;
        }

        const alacranes = r.porCategoria.alacran;
        $("totalAlacranes").textContent = H.plataRedonda(alacranes.total);
        if (estado.sinAlacranes) {
            $("detalleAlacranes").textContent = "Ocultos: estás viendo el mes sin alacranes";
        } else if (alacranes.cantidad === 0) {
            $("detalleAlacranes").textContent = "Ninguno apareció este mes";
        } else {
            $("detalleAlacranes").textContent = alacranes.cantidad === 1 ? "1 alacrán este mes" : `${alacranes.cantidad} alacranes este mes`;
        }
    }

    function dibujarCategorias(r) {
        const pc = r.porCategoria;

        const tarjeta = (clave, detalle) => {
            const c = H.categoria(clave);
            $("cat-" + clave).innerHTML =
                `<div class="cat-nombre">${c.nombre.toUpperCase()}</div>` +
                `<div class="cat-monto">${H.plataRedonda(pc[clave].total)}</div>` +
                `<div class="cat-detalle">${detalle}</div>`;
        };

        let detalleFijos = pc.fijo.cantidad
            ? `${H.porcentaje(pc.fijo.total / r.total)} del mes · ${cantidadGastos(pc.fijo.cantidad)}`
            : "Sin fijos cargados";
        if (r.impuestos.total > 0) detalleFijos += ` · incluye ${H.plataRedonda(r.impuestos.total)} de impuestos`;
        tarjeta("fijo", detalleFijos);

        $("tituloGrupoHormiga").textContent = "GASTOS HORMIGA · " + H.plataRedonda(r.hormigas);
        for (const clave of H.HORMIGAS) {
            const { total, cantidad } = pc[clave];
            tarjeta(clave, r.hormigas > 0
                ? `${H.porcentaje(total / r.hormigas, true)} de hormigas · ${cantidadGastos(cantidad)}`
                : cantidadGastos(cantidad));
        }

        tarjeta("ahorro", pc.ahorro.cantidad
            ? `${H.porcentaje(pc.ahorro.total / r.total)} del mes · ${cantidadGastos(pc.ahorro.cantidad)}`
            : "Sin ahorro cargado");
    }

    // ---------- Gráficos ----------

    // Escribe el total arriba de cada barra apilada.
    const totalesArriba = {
        id: "totalesArriba",
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const ultimo = chart.getDatasetMeta(chart.data.datasets.length - 1);
            ctx.save();
            ctx.font = "700 12px Manrope, system-ui, sans-serif";
            ctx.fillStyle = "#2B2410";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            chart.data.labels.forEach((_, i) => {
                const total = chart.data.datasets.reduce((t, d) => t + (d.data[i] || 0), 0);
                if (!total) return;
                const barra = ultimo.data[i];
                ctx.fillText(H.plataCorta(total), barra.x, barra.y - 6);
            });
            ctx.restore();
        },
    };

    function dibujarSemanas(r) {
        $("subtituloSemanas").textContent =
            H.nombreMes(r.mes).replace(/^./, l => l.toUpperCase()) + " " + r.mes.slice(0, 4) + ", sin fijos";

        const filas = C.hormigasPorSemana(r.gastos, r.mes);
        const datos = {
            labels: filas.map(f => f.etiqueta),
            datasets: H.HORMIGAS.map(clave => ({
                label: H.categoria(clave).nombre,
                data: filas.map(f => f[clave]),
                backgroundColor: H.categoria(clave).color,
                borderRadius: 6,
                borderSkipped: false,
                maxBarThickness: 56,
            })),
        };

        if (graficoSemanas) {
            graficoSemanas.data = datos;
            graficoSemanas.update();
            return;
        }

        graficoSemanas = new Chart($("graficoSemanas"), {
            type: "bar",
            data: datos,
            plugins: [totalesArriba],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 24 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${H.plata(c.parsed.y)}` } },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: "#6B5D2E" }, border: { color: "#E6DDB8" } },
                    y: { stacked: true, display: false, beginAtZero: true },
                },
            },
        });
    }

    function dibujarReparto(r) {
        const filas = H.CATEGORIAS.map(c => ({ nombre: c.nombre, color: c.color, total: r.porCategoria[c.clave].total }));
        if (r.porClasificar.cantidad) {
            filas.push({ nombre: "Por clasificar", color: COLOR_SIN_CATEGORIA, total: r.porClasificar.total });
        }

        $("porcentajeHormigas").textContent = H.porcentaje(r.total ? r.hormigas / r.total : 0, true);

        $("repartoLista").innerHTML = filas.map(f =>
            `<div><span class="nombre"><span class="cuadradito" style="background: ${f.color}"></span>${f.nombre}</span>` +
            `<span><b>${H.porcentaje(r.total ? f.total / r.total : 0)}</b> · ${H.plataRedonda(f.total)}</span></div>`
        ).join("");

        const vacio = r.total === 0;
        const datos = {
            labels: filas.map(f => f.nombre),
            datasets: [{
                data: vacio ? [1] : filas.map(f => f.total),
                backgroundColor: vacio ? ["#E6DDB8"] : filas.map(f => f.color),
                borderColor: "#FFFDF2",
                borderWidth: 2,
            }],
        };

        if (graficoReparto) {
            graficoReparto.data = datos;
            graficoReparto.options.plugins.tooltip.enabled = !vacio;
            graficoReparto.update();
            return;
        }

        graficoReparto = new Chart($("graficoReparto"), {
            type: "doughnut",
            data: datos,
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: "62%",
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: !vacio,
                        callbacks: { label: c => ` ${H.plata(c.parsed)}` },
                    },
                },
            },
        });
    }

    // ---------- Listas ----------

    function dibujarListas(r) {
        const pican = C.hormigasQueMasPican(r.gastos);
        $("listaPican").innerHTML = pican.length
            ? pican.map(p =>
                `<li><span><b>${escapar(p.concepto)}</b> · ${p.veces === 1 ? "1 vez" : p.veces + " veces"}</span><b>${H.plata(p.total)}</b></li>`
            ).join("")
            : `<li class="vacio-texto" style="border: 0">Todavía no hay gastos de Ants este mes.</li>`;

        const dolieron = C.picadurasQueMasDolieron(r.gastos);
        $("listaDolieron").innerHTML = dolieron.length
            ? dolieron.map(g => {
                const c = H.categoria(g.categoria);
                const colorTexto = g.categoria === "evitable" ? "#B54F00" : c.color;
                return `<li><span><b>${escapar(g.concepto)}</b> · ${H.diaMes(g.fecha)}</span>` +
                    `<span class="derecha"><span class="texto-cat" style="color: ${colorTexto}">${c.singular}</span><b>${H.plata(g.montoARS || 0)}</b></span></li>`;
            }).join("")
            : `<li class="vacio-texto" style="border: 0">Nada evitable ni innecesario este mes. ¡Bien!</li>`;
    }

    // ---------- Bloque de tarjeta ----------

    function dibujarTarjeta(r) {
        const deTarjeta = r.gastos.filter(g => g.fuente === "tarjeta");
        $("bloqueTarjeta").hidden = deTarjeta.length === 0;
        if (!deTarjeta.length) return;

        const docs = estado.documentos.filter(d => d.mes === r.mes);
        $("subtituloTarjeta").textContent = docs.length
            ? docs.map(d => `Resumen Visa que vence el ${fechaLarga(d.vencimiento)}`).join(" · ")
            : "";

        $("totalImpuestos").textContent = H.plataRedonda(r.impuestos.total);
        $("listaImpuestos").innerHTML = r.impuestos.gastos.map(g =>
            `<li><span>${escapar(g.concepto)}</span><b>${H.plata(g.montoARS || 0)}</b></li>`
        ).join("") || `<li class="vacio-texto" style="border: 0">Sin impuestos este mes.</li>`;

        const enDolares = deTarjeta.filter(g => g.moneda === "USD");
        const usd = enDolares.reduce((t, g) => t + g.monto, 0);
        $("totalDolares").textContent = H.dolares(usd);
        const tipo = H.cambio.tipo(estado.tipos, r.mes);
        if (!enDolares.length) {
            $("detalleDolares").textContent = "Sin consumos en dólares este mes.";
        } else if (tipo) {
            const pesos = enDolares.reduce((t, g) => t + (g.montoARS || 0), 0);
            $("detalleDolares").textContent =
                `${cantidadMovimientos(enDolares.length)} a ${H.plata(tipo.valor)} por dólar (${ORIGEN_CAMBIO[tipo.origen]}) = ${H.plata(pesos)}`;
        } else {
            $("detalleDolares").textContent = "Falta cargar el tipo de cambio en Ajustes.";
        }

        const cuotasDelMes = deTarjeta.filter(g => g.cuota);
        const proximas = docs.flatMap(d => d.proximasCuotas || []);
        const items = cuotasDelMes.map(g =>
            `<li><span>${escapar(g.concepto)} <span class="sub">cuota ${g.cuota.numero} de ${g.cuota.total} (este mes)</span></span><b>${H.plata(g.montoARS || 0)}</b></li>`
        ).concat(proximas.map(p =>
            `<li><span>Vencimiento de ${mesConAnio(p.mes)}</span><b>${H.plata(p.monto)}</b></li>`
        ));
        $("listaCuotas").innerHTML = items.join("") || `<li class="vacio-texto" style="border: 0">Sin cuotas pendientes.</li>`;
    }

    // ---------- Movimientos ----------

    function celdaMonto(g) {
        if (g.moneda !== "USD") return H.plata(g.montoARS);
        if (g.montoARS == null) return `${H.dolares(g.monto)}<small>sin tipo de cambio</small>`;
        return `${H.plata(g.montoARS)}<small>${H.dolares(g.monto)}</small>`;
    }

    // Filtros: Todos y las seis categorías, cada una con su cantidad.
    function dibujarFiltros(gastos) {
        const pildora = (filtro, nombre, cantidad) =>
            `<button type="button" class="pildora" data-filtro="${filtro}" aria-pressed="${filtro === estado.filtro}"` +
            `${cantidad === 0 ? ` data-vacio="si"` : ""}>${nombre} (${cantidad})</button>`;
        $("filtrosMovimientos").innerHTML =
            pildora("todos", "Todos", gastos.length) +
            H.CATEGORIAS.map(c => pildora(c.clave, c.nombre, gastos.filter(g => g.categoria === c.clave).length)).join("");
    }

    function dibujarMovimientos(r) {
        // Un filtro que ya no existe (de una versión anterior) vuelve a Todos.
        if (estado.filtro !== "todos" && !H.categoria(estado.filtro)) estado.filtro = "todos";
        dibujarFiltros(r.gastos);

        let lista = C.ordenarMovimientos(r.gastos);
        if (estado.filtro !== "todos") lista = lista.filter(g => g.categoria === estado.filtro);

        const total = lista.length;
        const suma = lista.reduce((t, g) => t + (g.montoARS || 0), 0);
        const sinConvertir = lista.filter(g => g.montoARS == null).length;
        if (!estado.verTodos) lista = lista.slice(0, MOVIMIENTOS_VISIBLES);

        $("tituloMovimientos").textContent = `Movimientos del mes (${total})`;

        $("pieMovimientos").hidden = total === 0;
        $("pieMovimientosTexto").textContent = (estado.filtro === "todos" ? "Total" : "Total " + H.categoria(estado.filtro).nombre.toLowerCase()) +
            ` · ${cantidadMovimientos(total)}` +
            (sinConvertir ? ` (sin ${sinConvertir === 1 ? "1 gasto" : sinConvertir + " gastos"} en dólares sin tipo de cambio)` : "");
        $("pieMovimientosSuma").textContent = H.plata(suma);

        $("cuerpoMovimientos").innerHTML = lista.map(g => {
            const c = g.categoria ? H.categoria(g.categoria) : null;
            const etiqueta = c
                ? `<span class="etiqueta etq-${g.categoria}">${c.singular}</span>`
                : `<span class="etiqueta etq-pendiente">Por clasificar</span>`;
            const cuota = g.cuota ? `<span class="cuota-tag">${g.cuota.numero} de ${g.cuota.total}</span>` : "";
            const aConfirmar = g.pendiente ? `<span class="etiqueta etq-aconfirmar">a confirmar</span>` : "";
            return `<tr class="clicable" tabindex="0" data-gasto="${escapar(g.id)}" title="Cambiar categoría">` +
                `<td>${H.diaMes(g.fecha)}</td><td class="concepto">${escapar(g.concepto)}${cuota}</td>` +
                `<td>${escapar(nombreFuente(g))}</td><td>${etiqueta}${aConfirmar}</td>` +
                `<td class="monto">${celdaMonto(g)}</td></tr>`;
        }).join("");

        $("movimientosVacio").hidden = total > 0;

        const boton = $("verTodos");
        boton.hidden = !estado.verTodos && total <= MOVIMIENTOS_VISIBLES;
        boton.textContent = estado.verTodos ? "Ver solo los últimos" : `Ver todos los movimientos (${total})`;
    }

    // ---------- Historial ----------

    let graficoEvolucion = null;
    let graficoAnual = null;
    let mesesEvolucion = [];

    function mesCorto(mes) {
        return H.nombreMes(mes).slice(0, 3) + " " + mes.slice(2, 4);
    }

    // "↑ 23%" en rojo si subió (en gastos, subir es malo); al revés si
    // `subirEsBueno` (el ahorro).
    function variacion(fraccion, subirEsBueno) {
        if (fraccion == null || !isFinite(fraccion)) return `<span class="tenue">—</span>`;
        if (Math.abs(fraccion) < 0.005) return `<span class="tenue">igual</span>`;
        const sube = fraccion > 0;
        const clase = sube === !!subirEsBueno ? "baja" : "sube";
        return `<span class="variacion ${clase}">${sube ? "↑" : "↓"} ${H.porcentaje(Math.abs(fraccion), true)}</span>`;
    }

    function dibujarHistorial() {
        const opciones = { sinAlacranes: estado.sinAlacranes };
        const hayHistoria = C.mesesConDatos(estado.gastos).filter(m => m <= estado.mes).length >= 2;
        $("conEvolucion").hidden = !hayHistoria;
        $("sinEvolucion").hidden = hayHistoria;
        $("filaComparaciones").hidden = !hayHistoria;
        $("subtituloEvolucion").textContent = hayHistoria
            ? `Hasta ${mesConAnio(estado.mes)}${estado.sinAlacranes ? ", sin alacranes" : ""}. Tocá una barra para ver ese mes.`
            : "";
        if (!hayHistoria) return;

        dibujarEvolucion(opciones);
        dibujarAnual(opciones);
        dibujarComparacionMes(opciones);
    }

    function dibujarEvolucion(opciones) {
        const serie = C.evolucion(estado.gastos, estado.mes, opciones);
        mesesEvolucion = serie.map(r => r.mes);
        const elegido = mesesEvolucion.indexOf(estado.mes);

        const capas = H.CATEGORIAS.map(c => ({ nombre: c.nombre, color: c.color, valor: r => r.porCategoria[c.clave].total }));
        if (serie.some(r => r.porClasificar.total > 0)) {
            capas.push({ nombre: "Por clasificar", color: COLOR_SIN_CATEGORIA, valor: r => r.porClasificar.total });
        }

        $("leyendaEvolucion").innerHTML = capas.map(c =>
            `<span><span class="cuadradito" style="background: ${c.color}"></span>${c.nombre}</span>`).join("");

        // El mes elegido, con color pleno; los demás, un poco transparentes.
        const datos = {
            labels: serie.map(r => mesCorto(r.mes)),
            datasets: capas.map(c => ({
                label: c.nombre,
                data: serie.map(c.valor),
                backgroundColor: serie.map((_, i) => i === elegido ? c.color : c.color + "99"),
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 44,
            })),
        };

        if (graficoEvolucion) {
            graficoEvolucion.data = datos;
            graficoEvolucion.update();
            return;
        }

        graficoEvolucion = new Chart($("graficoEvolucion"), {
            type: "bar",
            data: datos,
            plugins: [totalesArriba],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 24 } },
                onClick: (_, elementos) => {
                    if (!elementos.length) return;
                    estado.mes = mesesEvolucion[elementos[0].index];
                    estado.verTodos = false;
                    dibujar();
                },
                onHover: (evento, elementos) => {
                    evento.native.target.style.cursor = elementos.length ? "pointer" : "default";
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        filter: item => item.parsed.y > 0,
                        callbacks: {
                            label: c => ` ${c.dataset.label}: ${H.plata(c.parsed.y)}`,
                            footer: items => items.length
                                ? "Total: " + H.plata(items[0].chart.data.datasets.reduce((t, d) => t + d.data[items[0].dataIndex], 0))
                                : "",
                        },
                    },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: "#6B5D2E" }, border: { color: "#E6DDB8" } },
                    y: { stacked: true, display: false, beginAtZero: true },
                },
            },
        });
    }

    function dibujarAnual(opciones) {
        const anio = Number(estado.mes.slice(0, 4));
        const a = C.comparacionAnual(estado.gastos, anio, opciones, mesActual());

        $("tituloAnual").textContent = `${anio} contra ${anio - 1}`;
        if (a.comparables.length) {
            const n = a.comparables;
            const seguidos = n[n.length - 1] - n[0] === n.length - 1;
            const periodo = n.length === 1 ? `En ${H.MESES[n[0] - 1]}`
                : seguidos ? `De ${H.MESES[n[0] - 1]} a ${H.MESES[n[n.length - 1] - 1]}`
                : `En los ${n.length} meses con datos de los dos años`;
            const cambio = a.acumuladoAnterior ? (a.acumuladoActual - a.acumuladoAnterior) / a.acumuladoAnterior : null;
            $("resumenAnual").innerHTML = `${periodo}: <b>${H.plataRedonda(a.acumuladoActual)}</b> en ${anio} contra ` +
                `<b>${H.plataRedonda(a.acumuladoAnterior)}</b> en ${anio - 1} ${variacion(cambio)}`;
        } else if (a.hayAnterior) {
            $("resumenAnual").textContent = `Todavía no hay meses terminados con datos en ${anio} y en ${anio - 1} para comparar.`;
        } else {
            $("resumenAnual").innerHTML = `En ${anio}: <b>${H.plataRedonda(a.totalActual)}</b>. Sin datos de ${anio - 1} para comparar.`;
        }

        const colorAnterior = "#CDBF8E", colorActual = "#6E4BEA";
        $("leyendaAnual").innerHTML =
            `<span><span class="cuadradito" style="background: ${colorAnterior}"></span>${anio - 1}</span>` +
            `<span><span class="cuadradito" style="background: ${colorActual}"></span>${anio}</span>`;

        const datos = {
            labels: H.MESES.map(m => m.slice(0, 3)),
            datasets: [
                { label: String(anio - 1), data: a.meses.map(m => m.anterior), backgroundColor: colorAnterior, borderRadius: 4, maxBarThickness: 18 },
                { label: String(anio), data: a.meses.map(m => m.actual), backgroundColor: colorActual, borderRadius: 4, maxBarThickness: 18 },
            ],
        };

        if (graficoAnual) {
            graficoAnual.data = datos;
            graficoAnual.update();
            return;
        }

        graficoAnual = new Chart($("graficoAnual"), {
            type: "bar",
            data: datos,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${H.plata(c.parsed.y)}` } },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: "#6B5D2E" }, border: { color: "#E6DDB8" } },
                    y: { display: false, beginAtZero: true },
                },
            },
        });
    }

    function dibujarComparacionMes(opciones) {
        const c = C.comparacionMes(estado.gastos, estado.mes, opciones);
        const nombre = H.nombreMes(estado.mes);
        $("tituloComparacionMes").textContent = `${nombre.replace(/^./, l => l.toUpperCase())} contra su historia`;
        $("subtituloComparacionMes").textContent = c.mesesPromedio
            ? `Promedio de ${c.mesesPromedio === 1 ? "el mes anterior con datos" : `los ${c.mesesPromedio} meses anteriores con datos`} (hasta 12)${estado.sinAlacranes ? ", sin alacranes" : ""}.`
            : "Todavía no hay meses anteriores para comparar.";

        const celda = valor => valor == null ? `<span class="tenue">—</span>` : H.plataRedonda(valor);
        $("cuerpoComparacion").innerHTML = c.filas.map(f => {
            const cat = H.categoria(f.clave);
            const marca = cat ? `<span class="cuadradito" style="background: ${cat.color}"></span>` : "";
            const resumen = f.clave === "hormigas" || f.clave === "total";
            return `<tr class="${resumen ? "resumen" : ""}">` +
                `<td><span class="nombre-cat">${marca}${f.nombre}</span></td>` +
                `<td class="monto">${celda(f.actual)}</td>` +
                `<td class="monto">${celda(f.anterior)}</td>` +
                `<td class="monto">${celda(f.promedio)}</td>` +
                `<td class="monto">${variacion(f.contraPromedio, f.clave === "ahorro")}</td></tr>`;
        }).join("");
    }

    // ---------- Todo junto ----------

    function tituloApp() {
        return estado.nombre ? `El Hormiguero de ${estado.nombre}` : "Hormiguero";
    }

    function dibujar() {
        const enCarga = estado.vista === "carga";
        document.title = tituloApp();
        $("tituloPagina").textContent = enCarga ? "Carga manual" : tituloApp();
        $("subtituloPagina").textContent = enCarga ? "Fijos, gastos sueltos y alacranes" : "Tus gastos del mes, todos juntos";
        $("accionesCarga").hidden = !enCarga;
        $("accionesTablero").hidden = enCarga;
        $("vistaCarga").hidden = !enCarga;

        if (enCarga) {
            $("bienvenida").hidden = true;
            $("tablero").hidden = true;
            dibujarCarga();
            return;
        }

        const hayDatos = estado.gastos.length > 0;
        $("bienvenida").hidden = hayDatos;
        $("tablero").hidden = !hayDatos;
        if (!hayDatos) return;

        const opciones = { sinAlacranes: estado.sinAlacranes };
        const r = C.resumenMes(estado.gastos, estado.mes, opciones);
        const anterior = C.resumenMes(estado.gastos, H.mesAnterior(estado.mes), opciones);

        dibujarPeriodo();
        dibujarLlamados(r);
        dibujarPrincipales(r, anterior);
        dibujarCategorias(r);
        dibujarSemanas(r);
        dibujarReparto(r);
        dibujarListas(r);
        dibujarHistorial();
        dibujarTarjeta(r);
        dibujarMovimientos(r);
    }

    async function recargar(mesPreferido) {
        const [gastos, documentos, reglas, fijos, tipos, nombre] = await Promise.all([
            H.datos.todosLosGastos(),
            H.datos.todosLosDocumentos(),
            H.datos.todasLasReglas(),
            H.datos.todosLosFijos(),
            H.datos.leerConfig("tiposDeCambio", {}),
            H.datos.leerNombre(),
        ]);
        Object.assign(estado, { gastos, documentos, reglas, fijos, tipos, nombre });
        await copiarFijos();
        estado.mes = mesPreferido || estado.mes || ultimoMesConDatos() || mesActual();
        dibujar();
    }

    // Crea las copias de los fijos que falten hasta el mes actual.
    async function copiarFijos() {
        const nuevas = H.fijos.copiasQueFaltan(estado.fijos, estado.gastos, mesActual(), estado.tipos);
        if (!nuevas.length) return;
        await H.datos.guardarGastos(nuevas);
        estado.gastos = estado.gastos.concat(nuevas);
    }

    // ---------- Carga de documentos ----------

    let pdfjs = null;

    async function cargarPdfjs() {
        if (!pdfjs) {
            pdfjs = await import(new URL("lib/pdfjs/pdf.min.mjs", document.baseURI).href);
            pdfjs.GlobalWorkerOptions.workerSrc = new URL("lib/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
        }
        return pdfjs;
    }

    async function cargarArchivo(archivo) {
        const nombre = archivo.name.toLowerCase();
        if (nombre.endsWith(".pdf")) return cargarPdf(archivo);

        let resultado;
        try {
            const buffer = await archivo.arrayBuffer();
            resultado = H.lectorAnts.leer(buffer, XLSX);
        } catch (e) {
            avisar("No pude leer el archivo: " + (e.message || e), "error");
            return;
        }

        if (!resultado) {
            avisar("Este archivo no parece un Excel exportado de Ants (no encontré las columnas Fecha, Concepto, Tipo y Monto).", "error");
            return;
        }

        const { gastos, omitidas } = resultado;
        if (!gastos.length) {
            avisar("El Excel no tiene gastos para importar.", "error");
            return;
        }

        const { nuevos, repetidos } = await H.datos.agregarNuevos(gastos);

        const partes = [];
        if (nuevos === 0) partes.push("No había gastos nuevos");
        else partes.push(nuevos === 1 ? "Se agregó 1 gasto de Ants" : `Se agregaron ${nuevos} gastos de Ants`);
        if (repetidos) partes.push(repetidos === 1 ? "1 ya estaba cargado" : `${repetidos} ya estaban cargados`);
        if (omitidas.sinTipo) partes.push(`${omitidas.sinTipo} sin clasificar en Ants no se importaron`);
        if (omitidas.invalidas) partes.push(`${omitidas.invalidas} filas con fecha o monto ilegible se saltearon`);
        avisar(partes.join(". ") + ".", nuevos ? "ok" : "");

        // Mostrar el mes más reciente del archivo.
        const ultimo = gastos.map(g => g.mes).sort().pop();
        estado.verTodos = false;
        await recargar(ultimo);
    }

    async function cargarPdf(archivo) {
        avisar("Leyendo el resumen…");
        let resultado;
        try {
            const lib = await cargarPdfjs();
            resultado = await H.lectorVisaSantander.leer(new Uint8Array(await archivo.arrayBuffer()), lib);
        } catch (e) {
            avisar("No pude leer el PDF: " + (e.message || e), "error");
            return;
        }
        if (!resultado) {
            avisar("Por ahora solo se pueden leer resúmenes Visa Santander. Este PDF no parece uno.", "error");
            return;
        }
        $("aviso").hidden = true;
        estado.pendiente = { resultado, archivo: archivo.name, yaCargado: await H.datos.existeDocumento(resultado.documento.id) };
        abrirResumen();
    }

    function abrirResumen() {
        const { resultado, yaCargado } = estado.pendiente;
        const d = resultado.documento;
        const v = resultado.validacion;

        // Mes sugerido y dos para cada lado, por si hay que corregirlo.
        let opciones = [d.mesSugerido];
        for (let i = 0; i < 2; i++) opciones.unshift(H.mesAnterior(opciones[0]));
        for (let i = 0; i < 2; i++) opciones.push(H.mesSiguiente(opciones[opciones.length - 1]));

        const tipo = H.cambio.tipo(estado.tipos, d.mesSugerido);
        const tcInicial = tipo ? tipo.valor : d.tcPago;
        const tcNota = tipo
            ? `Ya cargado (${ORIGEN_CAMBIO[tipo.origen]}).`
            : d.tcPago ? `Sugerido: el tipo de cambio del pago que figura en este resumen.` : "";

        const tarjetas = d.tarjetas.map(t => {
            const partes = [H.plata(t.subtotal ? t.subtotal.ARS : 0)];
            if (t.subtotal && t.subtotal.USD) partes.push(H.dolares(t.subtotal.USD));
            return `<div class="fila-ajuste"><span>Visa terminada en ${t.terminacion}</span><b>${partes.join(" + ")}</b></div>`;
        }).join("");

        const movimientos = resultado.movimientos.filter(m => !m.esImpuesto).length;

        $("cuerpoResumen").innerHTML = `
            <div class="datos-resumen">
                ${yaCargado ? `<div class="validacion mal"><b>Este resumen ya está cargado.</b> Si lo importás de nuevo, se reemplaza (por ejemplo, para cambiarle el mes). Las reglas por comercio se mantienen.</div>` : ""}
                <div class="fila-ajuste"><span>Vence el ${fechaLarga(d.vencimiento)} · ${cantidadMovimientos(movimientos)}</span>
                    <label class="controles">Va a <select class="campo" id="mesResumen">${opciones.map(m =>
                        `<option value="${m}"${m === d.mesSugerido ? " selected" : ""}>${mesConAnio(m)}</option>`).join("")}</select></label></div>
                ${tarjetas}
                <div class="fila-ajuste"><span>Impuestos y percepciones (cuentan como fijos)</span><b>${H.plata(d.impuestos.ARS)}</b></div>
                <div class="fila-ajuste"><span>Total a pagar</span><b>${H.plata(d.total.ARS)}${d.total.USD ? " + " + H.dolares(d.total.USD) : ""}</b></div>
                ${v.ok
                    ? `<div class="validacion ok">✓ Los movimientos cierran con los subtotales y con el total del resumen.</div>`
                    : `<div class="validacion mal"><b>Los números no cierran.</b> Podés importarlo igual, pero revisá el resumen:<ul>${v.problemas.map(p => `<li>${escapar(p)}</li>`).join("")}</ul></div>`}
                ${d.total.USD || resultado.movimientos.some(m => m.moneda === "USD") ? `
                <div class="fila-ajuste"><span>Tipo de cambio (pesos por dólar)<span class="sub">${escapar(tcNota)}</span></span>
                    <input class="campo" type="number" id="tcResumen" min="0" step="0.01" inputmode="decimal" value="${tcInicial || ""}"></div>` : ""}
            </div>`;

        $("botonImportarResumen").textContent = yaCargado ? "Reemplazar" : "Importar";
        $("dialogoResumen").showModal();
    }

    async function importarResumen() {
        const { resultado, archivo, yaCargado } = estado.pendiente;
        const d = resultado.documento;
        const mes = $("mesResumen").value;

        // Tipos de cambio: primero lo que se deduce del pago, después lo
        // que haya escrito el usuario (si cambió el valor propuesto).
        let { tipos, cambiados } = H.cambio.alImportar(estado.tipos, mes, d.tcPago);
        const campo = $("tcResumen");
        if (campo) {
            const escrito = Number(campo.value);
            if (escrito > 0 && escrito !== H.cambio.valor(tipos, mes)) {
                tipos = { ...tipos, [mes]: { valor: escrito, origen: "manual" } };
                cambiados.push(mes);
            }
        }

        if (yaCargado) await H.datos.quitarDocumento(d.id);

        let gastos = H.lectorVisaSantander.aGastos(resultado, mes, H.cambio.valor(tipos, mes));
        const clasificados = new Map(H.reglas.aplicar(estado.reglas, gastos).map(g => [g.id, g]));
        gastos = gastos.map(g => clasificados.get(g.id) || g);

        const documento = {
            ...d,
            mes,
            archivo,
            importado: new Date().toISOString(),
            validacion: resultado.validacion,
        };
        await H.datos.guardarDocumento(documento, gastos);
        tipos = await H.datos.guardarTipos(tipos);

        // Si cambió el tipo de cambio de otros meses, recalcular sus dólares.
        const todos = await H.datos.todosLosGastos();
        for (const m of new Set(cambiados)) {
            await H.datos.guardarGastos(H.cambio.recalcular(todos, m, H.cambio.valor(tipos, m)));
        }

        $("dialogoResumen").close();
        estado.pendiente = null;
        estado.verTodos = false;
        await recargar(mes);

        const sinClasificar = gastos.filter(g => !g.categoria).length;
        const movimientos = gastos.filter(g => !g.esImpuesto).length;
        avisar(`Se importaron ${cantidadMovimientos(movimientos)} y ${gastos.length - movimientos} impuestos del resumen a ${mesConAnio(mes)}.` +
            (sinClasificar ? ` ${sinClasificar} quedaron por clasificar.` : ""), "ok");

        if (sinClasificar) abrirClasificar();
    }

    // ---------- Bandeja "Por clasificar" ----------

    function abrirClasificar() {
        dibujarClasificar();
        if (!$("dialogoClasificar").open) $("dialogoClasificar").showModal();
    }

    function dibujarClasificar() {
        const grupos = H.reglas.porClasificar(estado.gastos);
        $("listaClasificar").innerHTML = grupos.length ? grupos.map(gr => {
            const meses = [...new Set(gr.gastos.map(g => g.mes))].sort().map(H.nombreMes).join(", ");
            return `<div class="item-clasificar" data-clave="${escapar(gr.clave)}">
                <div class="cabeza"><b>${escapar(gr.ejemplo)}</b><span>${cantidadMovimientos(gr.gastos.length)} · ${H.plata(gr.total)} · ${meses}</span></div>
                <label>Regla: si contiene <input class="campo" type="text" value="${escapar(gr.clave)}" aria-label="Texto de la regla para ${escapar(gr.ejemplo)}"></label>
                ${botonesCategoria(null)}
            </div>`;
        }).join("") : `<p class="vacio-texto">No queda nada por clasificar.</p>`;
    }

    async function clasificarComercio(item, categoria) {
        const clave = item.dataset.clave;
        const patron = item.querySelector("input").value.trim() || clave;
        const regla = H.reglas.nuevaRegla(patron, categoria);
        if (!regla.patron) return;

        await H.datos.guardarReglas([regla]);
        estado.reglas = estado.reglas.filter(r => r.id !== regla.id).concat(regla);
        await aplicarReglas();

        const quedan = H.reglas.porClasificar(estado.gastos);
        if (quedan.some(gr => gr.clave === clave)) {
            avisar(`La regla "${regla.patron}" no coincide con "${clave}". Probá con un texto que esté contenido en el nombre.`, "error");
        }

        dibujar();
        dibujarClasificar();
        if (!quedan.length) {
            $("dialogoClasificar").close();
            avisar("¡Listo! Todos los movimientos tienen categoría.", "ok");
        }
    }

    // ---------- Cambiar la categoría de un gasto ----------

    let gastoEnEdicion = null;

    function abrirCategoria(id) {
        const g = estado.gastos.find(x => x.id === id);
        if (!g) return;
        gastoEnEdicion = g;

        const conRegla = g.fuente === "tarjeta" && !g.esImpuesto;
        const monto = g.moneda === "USD" ? H.dolares(g.monto) : H.plata(g.monto);
        $("cuerpoCategoria").innerHTML = `
            <p><b>${escapar(g.concepto)}</b><br><span class="secundario">${fechaLarga(g.fecha)} · ${escapar(nombreFuente(g))} · ${monto}</span></p>
            ${conRegla ? `
            <label class="casilla" style="margin: 0"><input type="checkbox" id="usarRegla"${g.categoria && g.clasificadoPor === "manual" ? "" : " checked"}>
                Guardar como regla para este comercio</label>
            <label class="secundario" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px">Si contiene
                <input class="campo" type="text" id="patronRegla" style="flex: 1 1 160px" value="${escapar(H.reglas.claveComercio(g.concepto))}"></label>` : ""}
            ${botonesCategoria(g.categoria)}
            ${g.fuente === "manual" ? `
            <div class="dialogo-botones" style="justify-content: flex-start">
                <button type="button" class="boton boton-chico" data-editar-gasto="${escapar(g.id)}">Editar</button>
                <button type="button" class="boton boton-chico" data-borrar-gasto="${escapar(g.id)}">${g.plantillaFija ? "No se paga este mes" : "Borrar"}</button>
            </div>` : ""}`;
        $("dialogoCategoria").showModal();
    }

    async function elegirCategoria(categoria) {
        const g = gastoEnEdicion;
        const usarRegla = $("usarRegla") && $("usarRegla").checked;

        if (usarRegla) {
            const regla = H.reglas.nuevaRegla($("patronRegla").value.trim() || g.concepto, categoria);
            await H.datos.guardarReglas([regla]);
            estado.reglas = estado.reglas.filter(r => r.id !== regla.id).concat(regla);
            // Si el gasto estaba fijado a mano, liberarlo para que lo tome la regla.
            if (g.clasificadoPor === "manual") {
                const libre = { ...g, clasificadoPor: null };
                await H.datos.guardarGastos([libre]);
                reemplazarGastos([libre]);
            }
            await aplicarReglas();
        }

        const actual = estado.gastos.find(x => x.id === g.id);
        if (actual.categoria !== categoria) {
            const editado = { ...actual, categoria, clasificadoPor: "manual", actualizado: new Date().toISOString() };
            await H.datos.guardarGastos([editado]);
            reemplazarGastos([editado]);
        }

        $("dialogoCategoria").close();
        gastoEnEdicion = null;
        dibujar();
    }

    // ---------- Carga manual ----------

    // Lo que está cargado en el formulario.
    const form = {
        modo: "nuevo",       // nuevo | gasto (editar un gasto) | fijo (editar una plantilla)
        id: null,            // id del gasto o de la plantilla que se edita
        moneda: "ARS",
        categoria: null,
        repetirTocado: false,
    };

    // 560000 → "560.000" · 1500.5 → "1.500,50" (lo que entiende leerMonto)
    function montoEditable(monto) {
        return H.plata(monto).replace("$", "");
    }

    function hoyISO() {
        const hoy = new Date();
        return hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    }

    // Hoy si se está mirando el mes actual; si no, el primero del mes.
    function fechaPorDefecto() {
        const hoy = hoyISO();
        return hoy.slice(0, 7) === estado.mes ? hoy : estado.mes + "-01";
    }

    function elegirMoneda(moneda) {
        form.moneda = moneda;
        for (const b of document.querySelectorAll("[data-moneda]")) {
            b.setAttribute("aria-pressed", String(b.dataset.moneda === moneda));
        }
    }

    function elegirCategoriaForm(categoria) {
        form.categoria = categoria;
        for (const b of $("categoriasForm").querySelectorAll("[data-categoria]")) {
            b.setAttribute("aria-pressed", String(b.dataset.categoria === categoria));
        }
        // Un fijo casi siempre se repite: marcarlo, salvo que ya lo hayan tocado.
        if (form.modo === "nuevo" && !form.repetirTocado) $("campoRepetir").checked = categoria === "fijo";
    }

    function limpiarErrores() {
        $("errorForm").hidden = true;
        for (const c of $("formGasto").querySelectorAll("[aria-invalid]")) c.removeAttribute("aria-invalid");
    }

    function mostrarError(texto) {
        $("errorForm").textContent = texto;
        $("errorForm").hidden = false;
    }

    // datos: { fecha, concepto, monto, moneda, categoria, repetir, esCopia, actualizarFijo }
    function prepararForm(modo, id, datos = {}) {
        Object.assign(form, { modo, id, repetirTocado: false });
        limpiarErrores();
        $("campoFecha").value = datos.fecha || fechaPorDefecto();
        $("campoConcepto").value = datos.concepto || "";
        $("campoMonto").value = datos.monto != null ? montoEditable(datos.monto) : "";
        elegirMoneda(datos.moneda || "ARS");
        elegirCategoriaForm(datos.categoria || null);
        $("campoRepetir").checked = datos.repetir ?? datos.categoria === "fijo";

        const titulos = { nuevo: "Nuevo gasto", gasto: "Editar gasto", fijo: "Editar fijo" };
        const botones = { nuevo: "Guardar gasto", gasto: "Guardar cambios", fijo: "Guardar fijo" };
        $("tituloFormulario").textContent = titulos[modo];
        $("botonGuardar").textContent = botones[modo];
        $("cancelarEdicion").hidden = modo === "nuevo";
        $("filaRepetir").hidden = modo === "fijo" || !!datos.esCopia;
        $("filaActualizarFijo").hidden = !datos.esCopia;
        $("campoActualizarFijo").checked = datos.actualizarFijo ?? true;
    }

    function enfocarForm() {
        $("formGasto").scrollIntoView({ behavior: "smooth", block: "start" });
        $("campoConcepto").focus({ preventScroll: true });
    }

    function enumerar(lista) {
        return lista.length > 1 ? lista.slice(0, -1).join(", ") + " y " + lista[lista.length - 1] : lista[0];
    }

    function leerForm() {
        limpiarErrores();
        const fecha = $("campoFecha").value;
        const concepto = $("campoConcepto").value.trim();
        const monto = H.fijos.leerMonto($("campoMonto").value);
        const faltan = [];
        if (!fecha) { faltan.push("la fecha"); $("campoFecha").setAttribute("aria-invalid", "true"); }
        if (!concepto) { faltan.push("el concepto"); $("campoConcepto").setAttribute("aria-invalid", "true"); }
        if (!(monto > 0)) { faltan.push("un monto mayor a cero"); $("campoMonto").setAttribute("aria-invalid", "true"); }
        if (!form.categoria) faltan.push("la categoría");
        if (faltan.length) {
            mostrarError("Falta " + enumerar(faltan) + ".");
            return null;
        }
        return { fecha, concepto, monto, moneda: form.moneda, categoria: form.categoria };
    }

    async function guardarGastos(lista) {
        await H.datos.guardarGastos(lista);
        const nuevos = lista.filter(g => !estado.gastos.some(x => x.id === g.id));
        reemplazarGastos(lista);
        estado.gastos = estado.gastos.concat(nuevos);
    }

    async function crearPlantilla(datos, ahora) {
        const plantilla = H.fijos.nuevaPlantilla(datos, ahora);
        await H.datos.guardarFijos([plantilla]);
        estado.fijos.push(plantilla);
        return plantilla;
    }

    // Guarda la plantilla y lleva el cambio a las copias sin confirmar.
    async function actualizarPlantilla(plantilla) {
        await H.datos.guardarFijos([plantilla]);
        estado.fijos = estado.fijos.map(f => f.id === plantilla.id ? plantilla : f);
        await guardarGastos(H.fijos.actualizarPendientes(plantilla, estado.gastos, estado.tipos));
    }

    async function guardarForm() {
        const datos = leerForm();
        if (!datos) return;
        const ahora = new Date();
        const mes = datos.fecha.slice(0, 7);
        let mensaje;

        if (form.modo === "nuevo") {
            if ($("campoRepetir").checked) {
                const plantilla = await crearPlantilla(datos, ahora);
                const primero = { ...H.fijos.copiaDelMes(plantilla, mes, estado.tipos, ahora), fecha: datos.fecha, pendiente: false };
                await guardarGastos([primero]);
                await copiarFijos();
                mensaje = `Se guardó "${datos.concepto}" y se va a copiar todos los meses.`;
            } else {
                await guardarGastos([H.fijos.gastoManual(datos, estado.tipos, ahora)]);
                mensaje = `Se guardó "${datos.concepto}".`;
            }
        } else if (form.modo === "gasto") {
            const viejo = estado.gastos.find(g => g.id === form.id);
            if (viejo.plantillaFija && mes !== viejo.mes) {
                mostrarError(`Un fijo no se puede pasar a otro mes. Si en ${H.nombreMes(viejo.mes)} no se paga, usá "No se paga este mes".`);
                return;
            }
            const editado = {
                ...viejo, ...datos, mes,
                montoARS: H.aPesos(datos.monto, datos.moneda, H.cambio.valor(estado.tipos, mes)),
                clasificadoPor: "manual",
                pendiente: false,
                actualizado: ahora.toISOString(),
            };
            if (viejo.plantillaFija && $("campoActualizarFijo").checked) {
                await guardarGastos([editado]);
                const p = estado.fijos.find(f => f.id === viejo.plantillaFija);
                if (p) {
                    await actualizarPlantilla({
                        ...p, concepto: datos.concepto, monto: datos.monto, moneda: datos.moneda,
                        categoria: datos.categoria, actualizado: ahora.toISOString(),
                    });
                }
            } else if (!viejo.plantillaFija && $("campoRepetir").checked) {
                const plantilla = await crearPlantilla(datos, ahora);
                editado.plantillaFija = plantilla.id;
                await guardarGastos([editado]);
                await copiarFijos();
            } else {
                await guardarGastos([editado]);
            }
            mensaje = "Se guardaron los cambios.";
        } else {
            const p = estado.fijos.find(f => f.id === form.id);
            await actualizarPlantilla({
                ...p, concepto: datos.concepto, monto: datos.monto, moneda: datos.moneda,
                categoria: datos.categoria, dia: Number(datos.fecha.slice(8, 10)), actualizado: ahora.toISOString(),
            });
            mensaje = `Se actualizó el fijo "${datos.concepto}". Los meses ya confirmados no cambian.`;
        }

        if (form.modo !== "fijo") estado.mes = mes;
        prepararForm("nuevo", null, { fecha: datos.fecha, moneda: datos.moneda });
        dibujar();
        avisar(mensaje, "ok");
    }

    function editarGasto(id) {
        const g = estado.gastos.find(x => x.id === id);
        if (!g) return;
        if ($("dialogoCategoria").open) $("dialogoCategoria").close();
        gastoEnEdicion = null;
        estado.mes = g.mes;
        // Al editar un mes viejo de un fijo, no pisar el monto de meses
        // posteriores que ya se confirmaron.
        const hayPosteriores = estado.gastos.some(x =>
            x.plantillaFija && x.plantillaFija === g.plantillaFija && x.mes > g.mes && !x.pendiente);
        prepararForm("gasto", id, { ...g, repetir: false, esCopia: !!g.plantillaFija, actualizarFijo: !hayPosteriores });
        estado.vista = "carga";
        if (location.hash !== "#carga") location.hash = "carga";
        dibujar();
        enfocarForm();
    }

    function editarFijo(id) {
        const p = estado.fijos.find(f => f.id === id);
        if (!p) return;
        const dia = Math.min(p.dia, H.diasDelMes(estado.mes));
        prepararForm("fijo", id, { ...p, fecha: estado.mes + "-" + String(dia).padStart(2, "0") });
        enfocarForm();
    }

    // Dos clics para lo que borra: el primero pide confirmación.
    function confirmarAntes(boton, texto) {
        if (boton.dataset.confirmar === "si") return true;
        boton.dataset.confirmar = "si";
        boton.textContent = texto;
        boton.classList.add("boton-peligro");
        return false;
    }

    async function pausarFijo(id, mes) {
        const p = estado.fijos.find(f => f.id === id);
        if (p && !p.pausados.includes(mes)) {
            const editada = { ...p, pausados: p.pausados.concat(mes).sort(), actualizado: new Date().toISOString() };
            await H.datos.guardarFijos([editada]);
            estado.fijos = estado.fijos.map(f => f.id === id ? editada : f);
        }
        const copias = estado.gastos.filter(g => g.plantillaFija === id && g.mes === mes);
        await H.datos.borrarGastos(copias.map(g => g.id));
        estado.gastos = estado.gastos.filter(g => !copias.includes(g));
    }

    async function reanudarFijo(id, mes) {
        const p = estado.fijos.find(f => f.id === id);
        const editada = { ...p, pausados: p.pausados.filter(m => m !== mes), actualizado: new Date().toISOString() };
        await H.datos.guardarFijos([editada]);
        estado.fijos = estado.fijos.map(f => f.id === id ? editada : f);
        await copiarFijos();
    }

    async function quitarFijo(boton) {
        if (!confirmarAntes(boton, "¿Seguro? Dejar de repetir")) return;
        const id = boton.dataset.quitarFijo;
        const p = estado.fijos.find(f => f.id === id);
        await H.datos.borrarFijo(id);
        estado.fijos = estado.fijos.filter(f => f.id !== id);
        // Las copias sin confirmar se van; las confirmadas quedan como gastos.
        const pendientes = estado.gastos.filter(g => g.plantillaFija === id && g.pendiente);
        await H.datos.borrarGastos(pendientes.map(g => g.id));
        estado.gastos = estado.gastos.filter(g => !pendientes.includes(g));
        if (form.modo === "fijo" && form.id === id) prepararForm("nuevo", null);
        dibujar();
        avisar(`"${p.concepto}" ya no se repite. Lo que ya estaba cargado se mantiene.`);
    }

    async function borrarGasto(boton) {
        const g = estado.gastos.find(x => x.id === boton.dataset.borrarGasto);
        if (!g) return;
        if (!confirmarAntes(boton, g.plantillaFija ? "¿Seguro? No se paga" : "¿Seguro? Borrar")) return;

        if (g.plantillaFija) {
            await pausarFijo(g.plantillaFija, g.mes);
            avisar(`"${g.concepto}" no se paga en ${H.nombreMes(g.mes)}. Los demás meses siguen igual.`);
        } else {
            await H.datos.borrarGastos([g.id]);
            estado.gastos = estado.gastos.filter(x => x.id !== g.id);
            avisar(`Se borró "${g.concepto}".`);
        }
        if ($("dialogoCategoria").open) $("dialogoCategoria").close();
        gastoEnEdicion = null;
        if (form.id === g.id) prepararForm("nuevo", null);
        dibujar();
        if ($("dialogoPendientes").open) dibujarPendientes();
    }

    function dibujarCarga() {
        const mes = estado.mes;
        const nombre = H.nombreMes(mes);

        if (!$("categoriasForm").children.length) {
            $("categoriasForm").innerHTML = botonesCategoria(form.categoria, true);
        }

        $("tituloManuales").textContent = `Cargados a mano en ${mesConAnio(mes)}`;
        const manuales = C.ordenarMovimientos(estado.gastos.filter(g => g.mes === mes && g.fuente === "manual"));
        $("listaManuales").innerHTML = manuales.length ? manuales.map(g => {
            const c = H.categoria(g.categoria);
            const notas = [c.singular, g.plantillaFija ? "se repite" : "", g.pendiente ? "a confirmar" : ""].filter(Boolean).join(" · ");
            return `<li><span><b>${escapar(g.concepto)}</b> · ${H.diaMes(g.fecha)}<span class="sub">${notas}</span></span>` +
                `<span class="derecha"><b>${montoConMoneda(g.monto, g.moneda)}</b>` +
                `<button type="button" class="boton boton-chico" data-editar-gasto="${escapar(g.id)}">Editar</button></span></li>`;
        }).join("") : `<li class="vacio-texto" style="border: 0">Todavía no cargaste nada a mano en ${nombre}.</li>`;

        const fijos = [...estado.fijos].sort((a, b) => a.concepto.localeCompare(b.concepto));
        $("listaFijos").innerHTML = fijos.length ? fijos.map(p => {
            const pausado = p.pausados.includes(mes);
            const c = H.categoria(p.categoria);
            return `<div class="item-fijo${pausado ? " pausado" : ""}">
                <div class="cabeza">
                    <div><div class="nombre">${escapar(p.concepto)}</div>
                        <div class="detalle">Todos los meses · día ${p.dia}${p.categoria !== "fijo" ? " · " + c.singular : ""}${pausado ? ` · no se paga en ${nombre}` : ""}</div></div>
                    <div class="importe">${montoConMoneda(p.monto, p.moneda)}</div>
                </div>
                <div class="acciones">
                    <button type="button" class="boton boton-chico" data-editar-fijo="${p.id}">Editar</button>
                    ${pausado
                        ? `<button type="button" class="boton boton-chico" data-reanudar-fijo="${p.id}">Se paga en ${nombre}</button>`
                        : `<button type="button" class="boton boton-chico" data-pausar-fijo="${p.id}">No se paga en ${nombre}</button>`}
                    <button type="button" class="boton boton-chico" data-quitar-fijo="${p.id}">Dejar de repetir</button>
                </div>
            </div>`;
        }).join("") : `<p class="vacio-texto" style="margin: 0">Todavía no hay fijos. Cargá un gasto con "Se repite todos los meses".</p>`;

        $("tituloAlacranes").textContent = `Alacranes de ${nombre}`;
        const alacranes = C.ordenarMovimientos(estado.gastos.filter(g => g.mes === mes && g.categoria === "alacran"));
        const total = alacranes.reduce((t, g) => t + (g.montoARS || 0), 0);
        $("listaAlacranes").innerHTML = alacranes.length
            ? `<ul class="lista" style="margin: 0">${alacranes.map(g =>
                `<li><span><b>${escapar(g.concepto)}</b> · ${H.diaMes(g.fecha)}</span><b>${montoConMoneda(g.monto, g.moneda)}</b></li>`
            ).join("")}</ul><p>Total: <b>${H.plataRedonda(total)}</b></p>`
            : `<p>Ninguno apareció este mes.</p>`;
    }

    // ---------- Fijos para confirmar ----------

    function abrirPendientes() {
        dibujarPendientes();
        $("dialogoPendientes").showModal();
    }

    function dibujarPendientes() {
        const lista = C.resumenMes(estado.gastos, estado.mes).pendientes.gastos
            .sort((a, b) => a.fecha.localeCompare(b.fecha));
        $("tituloPendientes").textContent = `Fijos de ${H.nombreMes(estado.mes)} para confirmar`;
        $("listaPendientes").innerHTML = lista.length ? lista.map(g => `
            <div class="fila-ajuste" data-pendiente="${escapar(g.id)}">
                <span><b>${escapar(g.concepto)}</b><span class="sub">${fechaLarga(g.fecha)} · ${H.categoria(g.categoria).singular}</span></span>
                <span class="controles">
                    <span>${g.moneda === "USD" ? "U$S" : "$"}</span>
                    <input class="campo" type="text" inputmode="decimal" style="width: 130px" value="${montoEditable(g.monto)}" aria-label="Monto de ${escapar(g.concepto)}">
                    <button type="button" class="boton boton-chico" data-confirmar-pendiente="${escapar(g.id)}">Confirmar</button>
                    <button type="button" class="boton boton-chico" data-borrar-gasto="${escapar(g.id)}">No se paga</button>
                </span>
            </div>`).join("") : `<p class="vacio-texto" style="margin: 0">No queda nada por confirmar.</p>`;
        $("confirmarTodos").hidden = lista.length === 0;
    }

    // Confirma la copia con el monto escrito. Si cambió, el fijo pasa a
    // usar ese monto de ahora en adelante.
    async function confirmarPendiente(id) {
        const g = estado.gastos.find(x => x.id === id);
        const fila = $("listaPendientes").querySelector(`[data-pendiente="${CSS.escape(id)}"]`);
        const campo = fila.querySelector("input");
        const monto = H.fijos.leerMonto(campo.value);
        if (!(monto > 0)) {
            campo.setAttribute("aria-invalid", "true");
            avisar(`Escribí un monto válido para "${g.concepto}".`, "error");
            return false;
        }
        const ahora = new Date().toISOString();
        await guardarGastos([{
            ...g, monto, pendiente: false, actualizado: ahora,
            montoARS: H.aPesos(monto, g.moneda, H.cambio.valor(estado.tipos, g.mes)),
        }]);
        const p = estado.fijos.find(f => f.id === g.plantillaFija);
        if (p && monto !== p.monto) await actualizarPlantilla({ ...p, monto, actualizado: ahora });
        return true;
    }

    async function confirmarTodos() {
        const ids = [...$("listaPendientes").querySelectorAll("[data-pendiente]")].map(f => f.dataset.pendiente);
        let confirmados = 0;
        for (const id of ids) if (await confirmarPendiente(id)) confirmados++;
        dibujar();
        if (confirmados === ids.length) {
            $("dialogoPendientes").close();
            avisar(confirmados === 1 ? "Se confirmó 1 fijo." : `Se confirmaron ${confirmados} fijos.`, "ok");
        } else {
            dibujarPendientes();
        }
    }

    // ---------- Vistas ----------

    function mostrarVista() {
        estado.vista = location.hash === "#carga" ? "carga" : "tablero";
        if (estado.vista === "carga" && form.modo === "nuevo" && !$("campoConcepto").value) prepararForm("nuevo", null);
        dibujar();
        window.scrollTo(0, 0);
    }

    // ---------- Ajustes ----------

    function abrirAjustes() {
        dibujarAjustes();
        $("confirmarBorrado").hidden = true;
        $("botonBorrar").textContent = "Borrar los datos de este dispositivo";
        $("dialogoAjustes").showModal();
    }

    function dibujarAjustes() {
        dibujarDrive();
        if (document.activeElement !== $("campoNombre")) $("campoNombre").value = estado.nombre;

        // Tipo de cambio: un renglón por cada mes con consumos en dólares.
        const usdPorMes = {};
        for (const g of estado.gastos) {
            if (g.moneda === "USD") usdPorMes[g.mes] = (usdPorMes[g.mes] || 0) + g.monto;
        }
        const meses = Object.keys(usdPorMes).sort().reverse();
        $("ajusteCambio").innerHTML = meses.length ? meses.map(m => {
            const t = H.cambio.tipo(estado.tipos, m);
            return `<div class="fila-ajuste"><span><b>${mesConAnio(m)}</b> · ${H.dolares(usdPorMes[m])}
                <span class="sub">${t ? ORIGEN_CAMBIO[t.origen] : "sin cargar"}</span></span>
                <span class="controles"><input class="campo" type="number" min="0" step="0.01" inputmode="decimal" data-cambio="${m}" value="${t ? t.valor : ""}" aria-label="Tipo de cambio de ${mesConAnio(m)}"></span></div>`;
        }).join("") : `<p class="vacio-texto" style="margin: 0">No hay consumos en dólares cargados.</p>`;

        // Reglas.
        const reglas = [...estado.reglas].sort((a, b) => a.patron.localeCompare(b.patron));
        $("ajusteReglas").innerHTML = reglas.length ? reglas.map(r =>
            `<div class="fila-ajuste"><span>Si contiene <b>${escapar(r.patron)}</b></span>
                <span class="controles">
                    <select class="campo" data-regla="${escapar(r.id)}" aria-label="Categoría para ${escapar(r.patron)}">${H.CATEGORIAS.map(c =>
                        `<option value="${c.clave}"${c.clave === r.categoria ? " selected" : ""}>${c.singular}</option>`).join("")}</select>
                    <button type="button" class="boton boton-chico" data-quitar-regla="${escapar(r.id)}">Quitar</button>
                </span></div>`
        ).join("") : `<p class="vacio-texto" style="margin: 0">Todavía no hay reglas. Se crean al clasificar movimientos de tarjeta.</p>`;

        // Documentos.
        const docs = [...estado.documentos].sort((a, b) => b.vencimiento.localeCompare(a.vencimiento));
        $("ajusteDocumentos").innerHTML = docs.length ? docs.map(d => {
            const n = estado.gastos.filter(g => g.documento === d.id).length;
            return `<div class="fila-ajuste"><span>Visa Santander · vence ${fechaLarga(d.vencimiento)}
                <span class="sub">${mesConAnio(d.mes)} · ${cantidadGastos(n)}${d.validacion && !d.validacion.ok ? " · los números no cerraban" : ""}</span></span>
                <button type="button" class="boton boton-chico" data-quitar-documento="${escapar(d.id)}">Quitar</button></div>`;
        }).join("") : `<p class="vacio-texto" style="margin: 0">Ningún resumen cargado.</p>`;

        const n = estado.gastos.length;
        const cantMeses = mesesConDatos().size;
        $("resumenDatos").textContent = n
            ? `Hay ${cantidadGastos(n)} guardados en este dispositivo, en ${cantMeses === 1 ? "1 mes" : cantMeses + " meses"}.`
            : "No hay gastos guardados en este dispositivo.";
        $("botonBorrar").disabled = n === 0 && !estado.reglas.length;
    }

    async function cambiarNombre(texto) {
        const nombre = texto.trim().replace(/\s+/g, " ");
        if (nombre === estado.nombre) return;
        estado.nombre = nombre; // antes de esperar: Guardar y salir del campo no lo guardan dos veces
        await H.datos.guardarNombre(nombre);
        dibujar();
        avisar(nombre ? `Listo: ahora es ${tituloApp()}.` : "Listo: vuelve a decir Hormiguero.", "ok");
    }

    async function cambiarTipoDeCambio(mes, texto) {
        const valor = Number(texto);
        const tipos = { ...estado.tipos };
        if (valor > 0) tipos[mes] = { valor, origen: "manual" };
        else delete tipos[mes];

        estado.tipos = await H.datos.guardarTipos(tipos);
        const cambiados = H.cambio.recalcular(estado.gastos, mes, H.cambio.valor(estado.tipos, mes));
        await H.datos.guardarGastos(cambiados);
        reemplazarGastos(cambiados);
        dibujar();
        dibujarAjustes();
    }

    async function cambiarRegla(id, categoria) {
        const regla = estado.reglas.find(r => r.id === id);
        const editada = { ...regla, categoria, actualizado: new Date().toISOString() };
        await H.datos.guardarReglas([editada]);
        estado.reglas = estado.reglas.map(r => r.id === id ? editada : r);
        await aplicarReglas();
        dibujar();
        dibujarAjustes();
    }

    async function quitarRegla(id) {
        await H.datos.borrarRegla(id);
        estado.reglas = estado.reglas.filter(r => r.id !== id);
        await aplicarReglas();
        dibujar();
        dibujarAjustes();
    }

    async function quitarDocumento(boton) {
        if (boton.dataset.confirmar !== "si") {
            boton.dataset.confirmar = "si";
            boton.textContent = "¿Seguro? Quitar";
            boton.classList.add("boton-peligro");
            return;
        }
        await H.datos.quitarDocumento(boton.dataset.quitarDocumento);
        await recargar();
        dibujarAjustes();
        avisar("Se quitó el resumen y sus movimientos. Lo podés volver a cargar cuando quieras.");
    }

    async function borrarDatos() {
        if ($("confirmarBorrado").hidden) {
            $("textoBorrado").innerHTML = sync.conectado
                ? "<b>¿Borrar los datos de este dispositivo?</b> Se desconecta Google Drive, pero tus datos siguen ahí: si volvés a conectar, se recuperan. Lo que tengas en Ants no se toca."
                : "<b>¿Borrar todos los gastos, reglas y resúmenes de este dispositivo?</b> No se puede deshacer (si querés una copia, exportá primero). Lo que tengas en Ants no se toca.";
            $("confirmarBorrado").hidden = false;
            $("botonBorrar").textContent = "Sí, borrar";
            return;
        }
        // Desconectar antes, así la sincronización no vuelve a bajar todo.
        if (sync.conectado) desconectarDrive();
        await H.datos.borrarTodo();
        $("dialogoAjustes").close();
        estado.mes = null;
        await recargar();
        avisar("Se borraron los datos de este dispositivo.");
    }

    // Un archivo JSON con todo, para tener una copia propia.
    async function exportar() {
        const todo = await H.datos.leerParaSincronizar();
        const sinLapidas = lista => lista.filter(e => !e.borrado);
        const datos = {
            formato: "hormiguero-exportacion",
            version: 1,
            exportado: new Date().toISOString(),
            gastos: sinLapidas(todo.gastos),
            documentos: sinLapidas(todo.documentos),
            reglas: sinLapidas(todo.reglas),
            fijos: sinLapidas(todo.fijos),
            tiposDeCambio: H.sincronizar.elementosATipos(todo.tipos.filter(t => t.valor != null)),
        };
        const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
        const enlace = document.createElement("a");
        enlace.href = URL.createObjectURL(blob);
        enlace.download = `hormiguero-${hoyISO()}.json`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(enlace.href), 10000);
        avisar(`Se exportaron ${cantidadGastos(datos.gastos.length)}.`, "ok");
    }

    // ---------- Google Drive ----------

    const CLAVE_CONECTADO = "hormiguero.drive";

    function leerPreferencia(clave) {
        try { return localStorage.getItem(clave); } catch (e) { return null; }
    }

    function guardarPreferencia(clave, valor) {
        try {
            if (valor == null) localStorage.removeItem(clave);
            else localStorage.setItem(clave, valor);
        } catch (e) { /* sin almacenamiento: solo dura esta sesión */ }
    }

    const sync = {
        conectado: leerPreferencia(CLAVE_CONECTADO) === "1",
        estado: "inactivo",   // inactivo | sincronizando | ok | pendiente | error
        error: "",
        ultima: null,         // Date de la última sincronización buena
        hayCambios: false,    // cambios locales sin subir
        enCurso: null,        // promesa del ciclo en curso
        otraVez: false,       // pidieron sincronizar durante un ciclo
        temporizador: null,
    };

    function horaCorta(fecha) {
        return fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    }

    function dibujarEstado() {
        const boton = $("estadoSync");
        let texto, estadoVisual, titulo = "";
        if (!H.drive.configurado() || !sync.conectado) {
            texto = "Guardado en este dispositivo";
            estadoVisual = "local";
            titulo = H.drive.configurado() ? "Tocá para conectar con Google Drive" : "";
        } else if (sync.estado === "sincronizando") {
            texto = "Sincronizando…";
            estadoVisual = "sincronizando";
        } else if (sync.estado === "error") {
            texto = "No se pudo sincronizar";
            estadoVisual = "error";
            titulo = sync.error + " Tocá para reintentar.";
        } else if (!H.drive.tieneToken() || sync.hayCambios) {
            texto = sync.hayCambios ? "Cambios sin sincronizar" : "Tocá para sincronizar";
            estadoVisual = "pendiente";
            titulo = "Tocá para sincronizar con Google Drive";
        } else {
            texto = "Sincronizado con Google Drive";
            estadoVisual = "ok";
            titulo = sync.ultima ? "Última vez: " + horaCorta(sync.ultima) : "";
        }
        $("estadoTexto").textContent = texto;
        boton.dataset.estado = estadoVisual;
        boton.title = titulo;
        if ($("dialogoAjustes").open) dibujarDrive();
    }

    function dibujarDrive() {
        const configurado = H.drive.configurado();
        let detalle;
        if (!configurado) detalle = "Falta configurar el ID de cliente de Google en js/config.js.";
        else if (!sync.conectado) detalle = "No está conectado: los datos quedan solo en este navegador.";
        else if (sync.estado === "error") detalle = "Último intento: " + sync.error;
        else if (sync.ultima) detalle = "Conectado. Última sincronización: " + horaCorta(sync.ultima) + ".";
        else detalle = "Conectado.";
        $("driveDetalle").textContent = detalle;
        $("driveConectar").hidden = !configurado || sync.conectado;
        $("driveSincronizar").hidden = !sync.conectado;
        $("driveDesconectar").hidden = !sync.conectado;
    }

    // Sincroniza una vez (o encola otra vuelta si ya hay una en curso).
    // interactivo: viene de un clic, así que puede abrir la ventana de Google.
    async function sincronizarAhora(interactivo) {
        if (!sync.conectado || !H.drive.configurado()) return;
        if (sync.enCurso) { sync.otraVez = true; return sync.enCurso; }

        sync.enCurso = (async () => {
            try {
                if (!H.drive.tieneToken()) {
                    try {
                        await H.drive.conectar(interactivo);
                    } catch (e) {
                        // Sin clic, el navegador puede no dejar pedir el permiso: queda pendiente.
                        if (!interactivo) { sync.estado = "pendiente"; return; }
                        throw e;
                    }
                }
                sync.estado = "sincronizando";
                dibujarEstado();
                do {
                    sync.otraVez = false;
                    sync.hayCambios = false;
                    const r = await H.drive.sincronizar();
                    if (r.recibidos) await recargar();
                    if (r.ignorados.length) {
                        avisar(`En la carpeta de Drive hay archivos que no reconozco (${r.ignorados.join(", ")}); no los toqué.`, "error");
                    }
                } while (sync.otraVez);
                sync.estado = "ok";
                sync.error = "";
                sync.ultima = new Date();
            } catch (e) {
                sync.estado = e.sinPermiso ? "pendiente" : "error";
                sync.error = e.message || String(e);
                sync.hayCambios = true;
            } finally {
                sync.enCurso = null;
                dibujarEstado();
            }
        })();
        return sync.enCurso;
    }

    // Después de un cambio local, sincronizar en unos segundos (si hay
    // permiso vigente; si no, queda marcado como pendiente).
    function programarSincronizacion() {
        if (!sync.conectado) return;
        sync.hayCambios = true;
        clearTimeout(sync.temporizador);
        if (H.drive.tieneToken()) sync.temporizador = setTimeout(() => sincronizarAhora(false), 2500);
        dibujarEstado();
    }

    async function conectarDrive() {
        try {
            await H.drive.conectar(true);
        } catch (e) {
            avisar(e.message || String(e), "error");
            return;
        }
        sync.conectado = true;
        guardarPreferencia(CLAVE_CONECTADO, "1");
        sync.hayCambios = true;
        await sincronizarAhora(true);
        if (sync.estado === "ok") avisar("Listo: Hormiguero quedó conectado con tu Google Drive.", "ok");
    }

    function desconectarDrive() {
        H.drive.desconectar();
        clearTimeout(sync.temporizador);
        sync.conectado = false;
        sync.estado = "inactivo";
        sync.hayCambios = false;
        guardarPreferencia(CLAVE_CONECTADO, null);
        dibujarEstado();
    }

    // ---------- Eventos ----------

    function conectar() {
        document.addEventListener("click", e => {
            const boton = e.target.closest("button");

            if (!boton) {
                const fila = e.target.closest("tr[data-gasto]");
                if (fila) abrirCategoria(fila.dataset.gasto);
                return;
            }

            if (boton.dataset.accion === "cargar-documento") {
                $("archivo").click();
            } else if (boton.dataset.accion === "ajustes") {
                abrirAjustes();
            } else if (boton.hasAttribute("data-cerrar")) {
                boton.closest("dialog").close();
            } else if (boton.dataset.mes) {
                estado.mes = boton.dataset.mes;
                estado.verTodos = false;
                dibujar();
            } else if (boton.dataset.anio) {
                // Al cambiar de año, ir al último mes con datos de ese año
                // o, si no hay, al mismo mes.
                const anio = boton.dataset.anio;
                const delAnio = [...mesesConDatos()].filter(m => m.startsWith(anio)).sort();
                estado.mes = delAnio.pop() || anio + estado.mes.slice(4);
                estado.verTodos = false;
                dibujar();
            } else if (boton.dataset.filtro) {
                estado.filtro = boton.dataset.filtro;
                dibujar();
            } else if (boton.dataset.categoria) {
                const item = boton.closest(".item-clasificar");
                if (boton.closest("#categoriasForm")) elegirCategoriaForm(boton.dataset.categoria);
                else if (item) clasificarComercio(item, boton.dataset.categoria);
                else if (gastoEnEdicion) elegirCategoria(boton.dataset.categoria);
            } else if (boton.dataset.moneda) {
                elegirMoneda(boton.dataset.moneda);
            } else if (boton.dataset.quitarRegla) {
                quitarRegla(boton.dataset.quitarRegla);
            } else if (boton.dataset.quitarDocumento) {
                quitarDocumento(boton);
            } else if (boton.dataset.editarGasto) {
                editarGasto(boton.dataset.editarGasto);
            } else if (boton.dataset.borrarGasto) {
                borrarGasto(boton);
            } else if (boton.dataset.editarFijo) {
                editarFijo(boton.dataset.editarFijo);
            } else if (boton.dataset.pausarFijo) {
                pausarFijo(boton.dataset.pausarFijo, estado.mes).then(dibujar);
            } else if (boton.dataset.reanudarFijo) {
                reanudarFijo(boton.dataset.reanudarFijo, estado.mes).then(dibujar);
            } else if (boton.dataset.quitarFijo) {
                quitarFijo(boton);
            } else if (boton.dataset.confirmarPendiente) {
                confirmarPendiente(boton.dataset.confirmarPendiente).then(ok => {
                    if (!ok) return;
                    dibujar();
                    dibujarPendientes();
                });
            }
        });

        // Enter o espacio sobre una fila de movimientos.
        $("cuerpoMovimientos").addEventListener("keydown", e => {
            const fila = e.target.closest("tr[data-gasto]");
            if (fila && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                abrirCategoria(fila.dataset.gasto);
            }
        });

        $("formNombre").addEventListener("submit", e => {
            e.preventDefault();
            $("campoNombre").blur();
            cambiarNombre($("campoNombre").value);
        });

        $("dialogoAjustes").addEventListener("change", e => {
            if (e.target.id === "campoNombre") cambiarNombre(e.target.value);
            else if (e.target.dataset.cambio) cambiarTipoDeCambio(e.target.dataset.cambio, e.target.value);
            else if (e.target.dataset.regla) cambiarRegla(e.target.dataset.regla, e.target.value);
        });

        $("archivo").addEventListener("change", async e => {
            const archivo = e.target.files[0];
            e.target.value = "";
            if (archivo) await cargarArchivo(archivo);
        });

        $("sinAlacranes").addEventListener("change", e => {
            estado.sinAlacranes = e.target.checked;
            dibujar();
        });

        $("verTodos").addEventListener("click", () => {
            estado.verTodos = !estado.verTodos;
            dibujar();
        });

        // Carga manual.
        window.addEventListener("hashchange", mostrarVista);
        $("formGasto").addEventListener("submit", e => {
            e.preventDefault();
            guardarForm().catch(err => mostrarError("No pude guardar: " + (err.message || err)));
        });
        $("campoRepetir").addEventListener("change", () => { form.repetirTocado = true; });
        $("cancelarEdicion").addEventListener("click", () => prepararForm("nuevo", null));
        const moverMesCarga = mes => {
            estado.mes = mes;
            // Si el formulario está vacío, que la fecha siga al mes elegido.
            if (form.modo === "nuevo" && !$("campoConcepto").value) $("campoFecha").value = fechaPorDefecto();
            dibujar();
        };
        $("mesAnteriorCarga").addEventListener("click", () => moverMesCarga(H.mesAnterior(estado.mes)));
        $("mesSiguienteCarga").addEventListener("click", () => moverMesCarga(H.mesSiguiente(estado.mes)));
        $("agregarFijo").addEventListener("click", () => {
            prepararForm("nuevo", null, { categoria: "fijo", repetir: true });
            enfocarForm();
        });
        $("registrarAlacran").addEventListener("click", () => {
            prepararForm("nuevo", null, { categoria: "alacran", repetir: false });
            enfocarForm();
        });
        $("botonPendientes").addEventListener("click", abrirPendientes);
        $("confirmarTodos").addEventListener("click", () => {
            confirmarTodos().catch(err => avisar("No pude confirmar: " + (err.message || err), "error"));
        });

        $("botonClasificar").addEventListener("click", abrirClasificar);
        $("botonImportarResumen").addEventListener("click", () => {
            importarResumen().catch(e => avisar("No pude importar el resumen: " + (e.message || e), "error"));
        });
        $("botonAjustes").addEventListener("click", abrirAjustes);
        $("botonBorrar").addEventListener("click", borrarDatos);
        $("botonExportar").addEventListener("click", () => exportar().catch(e => avisar("No pude exportar: " + (e.message || e), "error")));

        // Google Drive.
        $("estadoSync").addEventListener("click", () => {
            if (sync.conectado) sincronizarAhora(true);
            else abrirAjustes();
        });
        $("driveConectar").addEventListener("click", conectarDrive);
        $("driveSincronizar").addEventListener("click", () => sincronizarAhora(true));
        $("driveDesconectar").addEventListener("click", () => {
            desconectarDrive();
            avisar("Se desconectó Google Drive. Tus datos siguen en este dispositivo y en Drive.");
        });
        H.datos.alCambiar = programarSincronizacion;
        // Al volver a la pestaña, traer lo que se haya cambiado en otro dispositivo.
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible" || !sync.conectado || !H.drive.tieneToken()) return;
            if (!sync.ultima || Date.now() - sync.ultima > 60000) sincronizarAhora(false);
        });
    }

    // ---------- Arranque ----------

    if (window.Chart) {
        Chart.defaults.font.family = "Manrope, system-ui, sans-serif";
        Chart.defaults.color = "#6B5D2E";
    }

    conectar();
    dibujarEstado();
    recargar().then(() => {
        if (location.hash === "#carga") mostrarVista();
        if (sync.conectado) sincronizarAhora(false);
    }).catch(e => {
        avisar("No pude abrir el guardado local del navegador: " + (e.message || e), "error");
        $("bienvenida").hidden = false;
    });

})(globalThis.Hormiguero ||= {});
