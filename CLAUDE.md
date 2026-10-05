# Hormiguero

Tablero web de gastos personales mensuales. Junta en un solo lugar los gastos de varias fuentes, los clasifica y muestra en qué se fue la plata del mes.

Es el "hermano mayor" de **Ants** (app de gastos hormiga del mismo autor, repo `Tinchobot/Ants`, publicada en Play Store y en GitHub Pages). Ants registra el día a día en el celular; Hormiguero muestra el mes completo.

- **Usuario:** uso personal (Martín, Córdoba, Argentina). Moneda principal: pesos argentinos (ARS). Eventualmente se comparte con amigos, cada uno con sus propios datos.
- **Idioma de la interfaz:** español rioplatense.
- **Plataformas:** PC y celular (diseño responsive, una sola página).

---

## Arquitectura

- **Sitio estático** publicado en **GitHub Pages**, igual que Ants.
- **HTML + CSS + JavaScript sin framework** (mismo stack que Ants), con estas librerías:
  - **SheetJS** (`xlsx`) para leer Excel y CSV.
  - **pdf.js** para extraer texto de los resúmenes de tarjeta en PDF.
  - **Chart.js** para los gráficos.
- **Sin servidor propio.** Todo se procesa en el navegador; los datos financieros nunca pasan por terceros.
- **Almacenamiento:**
  - Caché local en **IndexedDB** (funciona sin conexión).
  - **Sincronización con Google Drive** del propio usuario (ver sección "Sincronización").

> ⚠️ Si el repositorio es público, **nunca** subir resúmenes reales, Excel reales ni datos personales. Usar una carpeta `muestras/` incluida en `.gitignore` para probar con archivos reales, y fixtures anonimizados para los tests.

---

## Las seis categorías

Cada gasto pertenece a exactamente una categoría:

| Categoría | Clave | Grupo | Color |
|---|---|---|---|
| Fijos mensuales | `fijo` | — | `#00796B` (verde azulado) |
| Necesario | `necesario` | hormiga | `#2E7D32` (verde) |
| Evitable | `evitable` | hormiga | `#EF6C00` (naranja) |
| Innecesario | `innecesario` | hormiga | `#C62828` (rojo) |
| Ahorro | `ahorro` | — | `#1E5AA8` (azul) |
| Alacrán | `alacran` | — | `#3E2723` (marrón oscuro) |

- **Gastos hormiga** = necesario + evitable + innecesario. Son los gastos chicos del día a día, que no se repiten todos los meses (aunque sean necesarios, como un yogur para la hija en el kiosco).
- **Fijos** = lo que se paga todos los meses: hipoteca, servicios, suscripciones, seguro.
- **Alacranes** = gastos extraordinarios que aparecen de vez en cuando y "destruyen a las hormigas" (una heladera, un arreglo grande). Se muestran aparte y existe un filtro **"Ver sin alacranes"** para comparar meses sin distorsión.
- **Ahorro** = lo que se separa a propósito.

---

## Fuentes de datos

Cada mes junta tres fuentes:

### 1. Excel exportado de Ants

- Hoja `Gastos`, columnas: `Fecha` (dd/mm/aaaa), `Hora`, `Concepto`, `Tipo`, `Monto`.
- `Tipo` ya viene clasificado (`Necesario`, `Evitable`, `Innecesario`): **respetarlo tal cual**.
- **Ignorar `Hora`** por completo (no mostrarla en ningún lado).
- `Concepto` es texto libre que escribe el usuario. No hace falta normalizarlo ni categorizarlo más allá del `Tipo`.
- Montos en pesos, enteros.
- **Fase futura:** en lugar del Excel, leer los gastos directo de Google Drive cuando Ants tenga sincronización (ver `ANTS-cambios.md`).

### 2. Resumen de tarjeta de crédito (PDF o Excel)

Botón **"Cargar documento"**. Primer formato a soportar: **Visa Santander en PDF** (texto extraíble, no escaneado).

Estructura observada del PDF:

- Encabezado con **"Vencimiento actual"** (dd/mm/aa), cierre actual, total a pagar en pesos y en dólares.
- Puede incluir **varias tarjetas** en el mismo resumen, cada una en una sección `Visa crédito terminada en XXXX` con su subtotal.
- Filas de movimientos: `Fecha | Descripción | Cuota | Comprobante | Monto en pesos | Monto en dólares`.
  - Las descripciones a veces ocupan dos líneas (por ejemplo, el nombre del comercio en una línea y un número de cliente en la siguiente).
  - Algunas filas no repiten la fecha (heredan la fecha de la fila anterior).
  - Las cuotas aparecen como `16 de 18`.
  - Cada movimiento está en pesos **o** en dólares.
- Sección **"Impuestos, intereses y percepciones"**: sellos, IIBB, IVA, percepción RG 5617, etc.
- Ignorar: "Pago anterior y devoluciones", "Saldo anterior", "Su pago", y todo lo que viene después de "Total a pagar" (términos y condiciones).
- Validación: la suma de movimientos por tarjeta debe coincidir con el `Subtotal` de cada sección, y el total general con "Total a pagar". Si no coincide, avisar al usuario.

Reglas de negocio:

- **Mes asignado = mes anterior al vencimiento.** Si vence el 07/09, el resumen es de agosto. Se lee del PDF automáticamente, con opción de cambiarlo a mano.
- **Cuotas:** se cuenta solo el monto de la cuota de ese resumen, no la compra total. Mostrar "próximas cuotas" como dato informativo.
- **Impuestos y percepciones:** se suman al mes del resumen y se muestran en un bloque aparte, porque son un costo real (casi todo generado por consumos en dólares).
- **Dólares:** se convierten a pesos con un **tipo de cambio por mes** que el usuario carga en Ajustes. Guardar siempre el monto original y la moneda.
- **No hay duplicados con Ants:** el usuario no anota en Ants lo que paga con tarjeta.
- Volver a subir el mismo documento no debe duplicar movimientos (identificar por archivo y por fila).

El soporte para otros bancos o para Excel de tarjeta se agrega después, cada uno como un lector separado (`lectores/visa-santander.js`, etc.) que devuelve el mismo formato de gasto.

### 3. Carga manual

Botón **"Cargar gasto manual"**, para todo lo que no viene de Ants ni de un resumen: la hipoteca, los gastos que Marcela (la esposa) pasa por WhatsApp, una suscripción nueva, una compra en efectivo, un alacrán.

Formulario:

- Fecha, concepto, monto, moneda (pesos o dólares).
- Categoría: los seis botones de color.
- Interruptor **"Se repite todos los meses"**. Si está activado, el gasto es una plantilla: al abrir un mes nuevo se copia solo y el usuario solo confirma o ajusta el monto. Se puede pausar para un mes puntual.
- Botón "Guardar gasto".

No hay campo de origen.

---

## Clasificación de los movimientos de tarjeta

- Los movimientos de tarjeta no traen categoría. La primera vez, el tablero pregunta a qué categoría corresponde cada comercio y **guarda una regla** (por ejemplo, "Netflix → fijo", "Ecogas → fijo").
- Desde el segundo mes, la mayoría se clasifica sola. Lo que no tiene regla va a una bandeja "Por clasificar".
- Para comparar comercios, normalizar la descripción: minúsculas, sin tildes, sin números de comprobante ni códigos alfanuméricos al final (por ejemplo, `Anthropic in1u4omub` y `Anthropic* claud in1u5zfhb` deberían caer en la misma regla, o permitir reglas por "contiene").
- Las reglas se editan en Ajustes.
- Cualquier gasto se puede reclasificar a mano (incluido marcarlo como alacrán).

---

## Pantallas

Una sola página. **No hay menú lateral.** El acceso a todo es por botones dentro del tablero.

### Tablero (pantalla principal)

De arriba hacia abajo:

1. **Encabezado amarillo:** logo (hormiga con moneda, `icon.png` del repo de Ants), título "Hormiguero", subtítulo "Tus gastos del mes, todos juntos", estado "Sincronizado con Google Drive" y botón **Ajustes** (engranaje).
2. **Selector de período:** botones de año y de meses (los meses sin datos se ven punteados) y la casilla **"Ver sin alacranes"**.
3. **Tres tarjetas principales:**
   - **"Este mes las hormigas se llevaron"** (violeta, destacada): total de necesario + evitable + innecesario. Debajo: "De eso, $X (N%) se podía evitar" (evitable + innecesario).
   - **"Total del mes":** con la variación contra el mes anterior. En gastos, **subir es malo**: flecha hacia arriba en rojo, hacia abajo en verde. Si no hay mes anterior, "Sin datos de [mes] para comparar".
   - **"Alacranes":** total y cantidad del mes.
4. **Fila de categorías:**
   - Tarjeta **Fijos** (verde azulado).
   - Recuadro **"Gastos hormiga"** (lila, mismo estilo 3D), con el total de hormigas y adentro las tres tarjetas: Necesario, Evitable e Innecesario, cada una con su monto, su porcentaje **sobre el total de hormigas** y la cantidad de gastos.
   - Tarjeta **Ahorro** (azul).
5. **Gráfico de barras apiladas** "Gastos hormiga por semana" (semanas 1–7, 8–14, 15–21, 22–28, 29–fin), apilado por necesario, evitable e innecesario.
6. **"Cómo se repartió el mes":** gráfico de anillo con las seis categorías y, al lado, la lista de las seis con su porcentaje **sobre el total del mes** y su monto. En el centro del anillo: "N% fue en hormigas". Debajo, los botones **"Cargar documento"** (violeta) y **"Cargar gasto manual"** (amarillo).
7. **"Hormigas que más pican":** los conceptos de Ants que más se repiten en el mes (cantidad de veces y total). Agrupar variantes simples del texto (mayúsculas, tildes, "kiosco"/"kiosko").
8. **"Picaduras que más dolieron":** los gastos evitables e innecesarios más grandes del mes.
9. **"Últimos movimientos":** tabla con fecha, concepto, fuente, categoría (etiqueta de color) y monto. Filtros en píldoras: Todos, Ants, Tarjetas, Fijos. Enlace **"Ver todos los movimientos"** que abre la lista completa con filtros por categoría y fuente.

Más adelante (cuando haya historial): evolución mensual en barras apiladas por categoría y comparación del año actual contra el anterior.

### Carga manual

Formulario de "Nuevo gasto" (descrito arriba). Al costado: lista de **"Fijos que se repiten"** (con botón "+ Agregar fijo") y el panel oscuro de **"Alacranes del mes"** (con botón "Registrar alacrán").

### Ajustes

Conexión con Google Drive, tipo de cambio por mes, reglas de clasificación por comercio, y opción de exportar todos los datos.

---

## Diseño visual

La referencia visual está en `referencia/tablero.html` y `referencia/carga-manual.html` (bocetos aprobados; los estilos están en línea). Usarlos como guía de estilo, no como código final.

- **Tipografías:** `Bricolage Grotesque` (títulos y números grandes, peso 800) y `Manrope` (texto), desde Google Fonts.
- **Fondo de página:** degradé amarillo suave, de `#FFF3C2` a `#FFE9A3`.
- **Encabezado:** `#FFD54F`, texto `#2B2410` y `#5B4A00`.
- **Texto principal:** `#2B2410`. Texto secundario: `#6B5D2E`.
- **Estilo "gota de agua" 3D** para tarjetas y botones: degradé de claro a color, brillo interior arriba, sombra interior abajo y sombra exterior que hace flotar el elemento. Ejemplo de tarjeta base:

```css
background: linear-gradient(170deg, #FFFEF6 0%, #FFF4C8 60%, #FFE68A 100%);
border: 1px solid rgba(212,165,30,0.5);
border-radius: 24px;
box-shadow:
  inset 0 3px 2px rgba(255,255,255,0.95),
  inset 0 -6px 14px rgba(214,150,0,0.22),
  0 14px 26px rgba(120,85,0,0.22),
  0 3px 6px rgba(120,85,0,0.14);
```

- Cada tarjeta de categoría usa el mismo patrón con su propio color (degradé de muy claro a medio, y sombras teñidas del color de la categoría).
- **Violeta destacado** (tarjeta de hormigas y botón "Cargar documento"): degradé `#A68AFF` → `#6E4BEA` → `#4526B8`.
- **Botones:** píldoras amarillas brillantes; el activo es una gota oscura (`#6B5A2C` → `#221C0A`, texto `#FFD54F`).
- Objetivos táctiles de al menos 44 px. Formato de montos argentino: `$1.234.567` (punto de miles, coma decimal).

---

## Sincronización con Google Drive

- Inicio de sesión con **Google Identity Services** desde el navegador. El usuario ve lo mismo en la PC y en el celular.
- Los datos viven en el **Drive del propio usuario**; cada persona que use Hormiguero tiene sus datos separados.
- Estructura sugerida (JSON):
  - `meses/2026-09.json`: gastos del mes.
  - `reglas.json`: reglas de clasificación por comercio.
  - `fijos.json`: plantillas de gastos que se repiten.
  - `config.json`: tipos de cambio y preferencias.
- Cada gasto lleva `id` único y `actualizado` (fecha y hora) para resolver conflictos entre dispositivos (gana el cambio más reciente por gasto).
- **Hormiguero guarda su propia copia de cada mes.** Lo que se borre después en Ants (por ejemplo, al limpiar la pantalla) no debe borrar el historial de Hormiguero.
- **A verificar:** para que Hormiguero pueda leer en el futuro los datos que sincronice Ants, ambas apps probablemente tengan que usar el **mismo proyecto de Google Cloud**, y hay que elegir bien el alcance de permisos de Drive (`drive.appdata` o `drive.file`), porque ambos limitan el acceso a lo que crea la propia app. Confirmarlo antes de diseñar el formato compartido. Preferir siempre el permiso más limitado que funcione.

---

## Modelo de datos

```js
{
  id: "uuid",
  fecha: "2026-09-29",          // ISO
  concepto: "Súper",
  monto: 116000,                 // en la moneda original
  moneda: "ARS",                 // "ARS" | "USD"
  montoARS: 116000,              // convertido con el tipo de cambio del mes
  categoria: "necesario",        // fijo | necesario | evitable | innecesario | ahorro | alacran
  fuente: "ants",                // ants | tarjeta | manual
  mes: "2026-09",                // mes asignado (para tarjeta: mes anterior al vencimiento)
  tarjeta: null,                 // ej. "Visa 0372" si viene de un resumen
  cuota: null,                   // ej. { numero: 16, total: 18 }
  esImpuesto: false,             // true para la sección de impuestos y percepciones
  plantillaFija: null,           // id de la plantilla si vino de un fijo que se repite
  documento: null,               // id del documento de origen, para evitar duplicados
  actualizado: "2026-10-01T09:12:00Z"
}
```

---

## Plan por fases

1. **Base:** estructura de la página con el diseño aprobado, lector del Excel de Ants, tablero del mes con las tarjetas y los gráficos, guardado local en IndexedDB.
2. **Tarjeta:** lector de PDF Visa Santander, asignación de mes por vencimiento, cuotas, impuestos, dólares con tipo de cambio, reglas de clasificación por comercio y bandeja "Por clasificar".
3. **Carga manual:** formulario, fijos que se repiten y alacranes.
4. **Sincronización** con Google Drive.
5. **Historial:** evolución mensual, comparación entre meses y años, filtro "Ver sin alacranes" aplicado a todo.
6. **Conexión con Ants:** leer los gastos hormiga directo desde Drive, sin pasar por el Excel (requiere los cambios de `ANTS-cambios.md`).

---

## Decisiones pendientes

- Formato del resumen de tarjeta en **Excel** (todavía no hay muestra).
- Si otros bancos se van a soportar más adelante.

## Decisiones tomadas

- **Impuestos y percepciones** cuentan como **fijos** (y se muestran aparte en el bloque "Tarjeta de crédito").
- **Tipo de cambio:** se toma del "Su pago en pesos … tcNNNN" de cada resumen, que es el cambio al que se pagaron los dólares del resumen anterior (origen `pago`). Mientras no llega el resumen siguiente, el mes usa el último pago conocido (origen `sugerido`). Lo que el usuario carga a mano en Ajustes (origen `manual`) nunca se pisa.
