// =====================================
// Hormiguero — tablero del mes.
//
// Se carga después de formato.js, calculos.js, datos.js y los lectores.
// =====================================

(function (H) {

    const C = H.calculos;
    const $ = id => document.getElementById(id);

    const MOVIMIENTOS_VISIBLES = 8;

    const estado = {
        gastos: [],
        mes: null,          // "2026-09"
        sinAlacranes: false,
        filtro: "todos",    // todos | ants | tarjeta | fijo
        verTodos: false,
    };

    let graficoSemanas = null;
    let graficoReparto = null;

    // ---------- Utilidades ----------

    function escapar(texto) {
        return String(texto).replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
    }

    function mesActual() {
        const hoy = new Date();
        return hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    }

    function mesesConDatos() {
        return new Set(estado.gastos.map(g => g.mes));
    }

    function ultimoMesConDatos() {
        return [...mesesConDatos()].sort().pop() || null;
    }

    function nombreFuente(g) {
        if (g.fuente === "ants") return "Ants";
        if (g.fuente === "tarjeta") return g.tarjeta || "Tarjeta";
        return g.plantillaFija ? "Fijo manual" : "Manual";
    }

    let temporizadorAviso = null;

    function avisar(texto, tipo) {
        const aviso = $("aviso");
        aviso.textContent = texto;
        aviso.className = "aviso" + (tipo ? " " + tipo : "");
        aviso.hidden = false;
        clearTimeout(temporizadorAviso);
        temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 6000);
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

    // ---------- Tarjetas ----------

    function dibujarPrincipales(r, anterior) {
        $("totalHormigas").textContent = H.plata(r.hormigas);
        $("detalleHormigas").innerHTML = r.hormigas > 0
            ? `De eso, <b>${H.plata(r.evitables)} (${H.porcentaje(r.evitables / r.hormigas, true)})</b> se podía evitar`
            : "Sin gastos hormiga este mes";

        $("totalMes").textContent = H.plata(r.total);
        const mesPrevio = H.nombreMes(anterior.mes);
        if (anterior.total > 0) {
            const cambio = (r.total - anterior.total) / anterior.total;
            const sube = cambio > 0;
            const flecha = sube ? "↑" : "↓";
            const clase = cambio === 0 ? "" : (sube ? "sube" : "baja");
            $("detalleMes").innerHTML =
                `<span class="variacion ${clase}">${flecha} ${H.porcentaje(Math.abs(cambio), true)}</span> contra ${mesPrevio} (${H.plata(anterior.total)})`;
        } else {
            $("detalleMes").textContent = `Sin datos de ${mesPrevio} para comparar`;
        }

        const alacranes = r.porCategoria.alacran;
        $("totalAlacranes").textContent = H.plata(alacranes.total);
        if (estado.sinAlacranes) {
            $("detalleAlacranes").textContent = "Ocultos: estás viendo el mes sin alacranes";
        } else if (alacranes.cantidad === 0) {
            $("detalleAlacranes").textContent = "Ninguno apareció este mes";
        } else {
            $("detalleAlacranes").textContent = alacranes.cantidad === 1 ? "1 alacrán este mes" : `${alacranes.cantidad} alacranes este mes`;
        }
    }

    function cantidadGastos(n) {
        return n === 1 ? "1 gasto" : n + " gastos";
    }

    function dibujarCategorias(r) {
        const pc = r.porCategoria;

        const tarjeta = (clave, detalle) => {
            const c = H.categoria(clave);
            $("cat-" + clave).innerHTML =
                `<div class="cat-nombre">${c.nombre.toUpperCase()}</div>` +
                `<div class="cat-monto">${H.plata(pc[clave].total)}</div>` +
                `<div class="cat-detalle">${detalle}</div>`;
        };

        tarjeta("fijo", pc.fijo.cantidad
            ? `${H.porcentaje(pc.fijo.total / r.total)} del mes · ${cantidadGastos(pc.fijo.cantidad)}`
            : "Sin fijos cargados");

        $("tituloGrupoHormiga").textContent = "GASTOS HORMIGA · " + H.plata(r.hormigas);
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
        const categorias = H.CATEGORIAS;
        $("porcentajeHormigas").textContent = H.porcentaje(r.total ? r.hormigas / r.total : 0, true);

        $("repartoLista").innerHTML = categorias.map(c => {
            const total = r.porCategoria[c.clave].total;
            return `<div><span class="nombre"><span class="cuadradito" style="background: ${c.color}"></span>${c.nombre}</span>` +
                `<span><b>${H.porcentaje(r.total ? total / r.total : 0)}</b> · ${H.plata(total)}</span></div>`;
        }).join("");

        const vacio = r.total === 0;
        const datos = {
            labels: categorias.map(c => c.nombre),
            datasets: [{
                data: vacio ? [1] : categorias.map(c => r.porCategoria[c.clave].total),
                backgroundColor: vacio ? ["#E6DDB8"] : categorias.map(c => c.color),
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
                    `<span class="derecha"><span class="texto-cat" style="color: ${colorTexto}">${c.singular}</span><b>${H.plata(g.montoARS)}</b></span></li>`;
            }).join("")
            : `<li class="vacio-texto" style="border: 0">Nada evitable ni innecesario este mes. ¡Bien!</li>`;
    }

    function dibujarMovimientos(r) {
        let lista = C.ordenarMovimientos(r.gastos);
        if (estado.filtro === "ants" || estado.filtro === "tarjeta") {
            lista = lista.filter(g => g.fuente === estado.filtro);
        } else if (estado.filtro === "fijo") {
            lista = lista.filter(g => g.categoria === "fijo");
        }

        const total = lista.length;
        if (!estado.verTodos) lista = lista.slice(0, MOVIMIENTOS_VISIBLES);

        $("tituloMovimientos").textContent = estado.verTodos ? `Movimientos del mes (${total})` : "Últimos movimientos";

        $("cuerpoMovimientos").innerHTML = lista.map(g => {
            const c = H.categoria(g.categoria);
            return `<tr><td>${H.diaMes(g.fecha)}</td><td class="concepto">${escapar(g.concepto)}</td>` +
                `<td>${escapar(nombreFuente(g))}</td>` +
                `<td><span class="etiqueta etq-${g.categoria}">${c.singular}</span></td>` +
                `<td class="monto">${H.plata(g.montoARS)}</td></tr>`;
        }).join("");

        $("movimientosVacio").hidden = total > 0;

        for (const b of $("filtrosMovimientos").querySelectorAll("button")) {
            b.setAttribute("aria-pressed", String(b.dataset.filtro === estado.filtro));
        }

        const boton = $("verTodos");
        boton.hidden = !estado.verTodos && total <= MOVIMIENTOS_VISIBLES;
        boton.textContent = estado.verTodos ? "Ver solo los últimos" : `Ver todos los movimientos (${total})`;
    }

    // ---------- Todo junto ----------

    function dibujar() {
        const hayDatos = estado.gastos.length > 0;
        $("bienvenida").hidden = hayDatos;
        $("tablero").hidden = !hayDatos;
        if (!hayDatos) return;

        const opciones = { sinAlacranes: estado.sinAlacranes };
        const r = C.resumenMes(estado.gastos, estado.mes, opciones);
        const anterior = C.resumenMes(estado.gastos, H.mesAnterior(estado.mes), opciones);

        dibujarPeriodo();
        dibujarPrincipales(r, anterior);
        dibujarCategorias(r);
        dibujarSemanas(r);
        dibujarReparto(r);
        dibujarListas(r);
        dibujarMovimientos(r);
    }

    async function recargar(mesPreferido) {
        estado.gastos = await H.datos.todosLosGastos();
        estado.mes = mesPreferido || estado.mes || ultimoMesConDatos() || mesActual();
        dibujar();
    }

    // ---------- Carga de documentos ----------

    async function cargarArchivo(archivo) {
        const nombre = archivo.name.toLowerCase();

        if (nombre.endsWith(".pdf")) {
            avisar("Los resúmenes de tarjeta en PDF llegan en la fase 2. Por ahora, cargá el Excel de Ants.");
            return;
        }

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

    // ---------- Ajustes ----------

    function abrirAjustes() {
        const meses = mesesConDatos().size;
        const n = estado.gastos.length;
        $("resumenDatos").textContent = n
            ? `Hay ${cantidadGastos(n)} guardados en este dispositivo, en ${meses === 1 ? "1 mes" : meses + " meses"}.`
            : "No hay gastos guardados en este dispositivo.";
        $("confirmarBorrado").hidden = true;
        $("botonBorrar").textContent = "Borrar todos los datos";
        $("botonBorrar").disabled = n === 0;
        $("dialogoAjustes").showModal();
    }

    async function borrarDatos() {
        if ($("confirmarBorrado").hidden) {
            $("confirmarBorrado").hidden = false;
            $("botonBorrar").textContent = "Sí, borrar todo";
            return;
        }
        await H.datos.borrarTodo();
        $("dialogoAjustes").close();
        estado.mes = null;
        await recargar();
        avisar("Se borraron todos los gastos de este dispositivo.");
    }

    // ---------- Eventos ----------

    function conectar() {
        document.addEventListener("click", e => {
            const boton = e.target.closest("button");
            if (!boton) return;

            if (boton.dataset.accion === "cargar-documento") {
                $("archivo").click();
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
            }
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

        $("botonManual").addEventListener("click", () => {
            avisar("La carga manual (fijos, alacranes, gastos sueltos) llega en la fase 3.");
        });

        $("botonAjustes").addEventListener("click", abrirAjustes);
        $("cerrarAjustes").addEventListener("click", () => $("dialogoAjustes").close());
        $("botonBorrar").addEventListener("click", borrarDatos);
    }

    // ---------- Arranque ----------

    if (window.Chart) {
        Chart.defaults.font.family = "Manrope, system-ui, sans-serif";
        Chart.defaults.color = "#6B5D2E";
    }

    conectar();
    recargar().catch(e => {
        avisar("No pude abrir el guardado local del navegador: " + (e.message || e), "error");
        $("bienvenida").hidden = false;
    });

})(globalThis.Hormiguero ||= {});
