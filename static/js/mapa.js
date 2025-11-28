// ----- CONFIGURACIÓN BÁSICA -----
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Tarifa base general si no hay otra lógica
const TARIFA_KM_GENERAL = 1.8; // Bs/km

// ---- CATÁLOGO DE LÍNEAS DE TRUFIS (INICIALES, PUEDES CAMBIAR) ----
let TRUFIS = [
  {
    id: "T1",
    nombre: "T1 Ceja – Plaza San Francisco",
    tipo: "Trufi urbano",
    color: "#00bcd4",
    tarifaKm: 1.8,
    paradas: [
      { nombre: "Ceja El Alto", lat: -16.4989, lng: -68.1616 },
      { nombre: "Puente Víacha", lat: -16.5085, lng: -68.1535 },
      { nombre: "Cementerio", lat: -16.5054, lng: -68.144 },
      { nombre: "Plaza San Francisco", lat: -16.4958, lng: -68.1342 }
    ]
  },
  {
    id: "T2",
    nombre: "T2 Villa Adela – Ceja – Centro La Paz",
    tipo: "Trufi urbano",
    color: "#ff9800",
    tarifaKm: 2.0,
    paradas: [
      { nombre: "Villa Adela", lat: -16.5342, lng: -68.1835 },
      { nombre: "12 de Octubre", lat: -16.5105, lng: -68.172 },
      { nombre: "Ceja El Alto", lat: -16.4989, lng: -68.1616 },
      { nombre: "Plaza del Estudiante", lat: -16.505, lng: -68.125 }
    ]
  }
];

// ----- VARIABLES GLOBALES -----
let map;
let baseDark, baseLight;
let currentTheme = "dark";

let routeLayer = null;
let originMarker = null;
let destMarker = null;

let trufiPolylines = new Map();
let trufiStopMarkers = [];

let currentDistanceKm = 0;
let currentDurationMin = 0;
let currentOriginLatLng = null;
let currentDestLatLng = null;

let mostrarTodasRutas = false;

// gestión de líneas
let lineaSeleccionadaId = null;
let modoParadas = false;

// resaltar línea elegida
let markerSubeHighlight = null;
let markerBajaHighlight = null;

// ----- INICIO -----
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initUI();
  renderLineaSelect();
});

// ----- MAPA -----
function initMap() {
  map = L.map("map").setView([-16.5, -68.15], 12);

  baseDark = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OpenStreetMap, &copy; CartoDB"
    }
  ).addTo(map);

  baseLight = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "&copy; OpenStreetMap" }
  );

  map.attributionControl.setPrefix("");

  // CLICK EN EL MAPA PARA AGREGAR PARADAS (si modoParadas está activo)
  map.on("click", (e) => {
    if (!modoParadas || !lineaSeleccionadaId) return;

    const linea = TRUFIS.find((l) => l.id === lineaSeleccionadaId);
    if (!linea) return;

    const idx = linea.paradas.length + 1;

    linea.paradas.push({
      nombre: "Parada " + idx,
      lat: e.latlng.lat,
      lng: e.latlng.lng
    });

    renderParadasLineaActual();
    // mientras editamos, solo vemos la línea actual + sus paradas
    drawLineaActualForEditing();
  });
}

// ----- LIMPIAR / DIBUJAR LÍNEAS -----
function clearTrufiLayers() {
  trufiPolylines.forEach((pl) => pl.removeFrom(map));
  trufiPolylines.clear();
  trufiStopMarkers.forEach((m) => m.removeFrom(map));
  trufiStopMarkers = [];
  limpiarMarcadoresHighlight();
}

/**
 * Dibuja un conjunto de líneas de trufi.
 * @param {Array} lineasArr - arreglo de líneas (objetos TRUFIS)
 * @param {boolean} showStops - si true, dibuja paradas como puntos
 * @param {number} weight - grosor de la línea
 * @param {number} opacity - opacidad de la línea
 */
function drawLinesForLineasObj(lineasArr, showStops = false, weight = 2, opacity = 0.7) {
  clearTrufiLayers();

  lineasArr.forEach((linea) => {
    const latlngs = linea.paradas.map((p) => [p.lat, p.lng]);
    if (!latlngs.length) return;

    const poly = L.polyline(latlngs, {
      color: linea.color,
      weight,
      opacity,
      dashArray: weight > 2 ? null : "4,4"
    })
      .addTo(map)
      .bindPopup(`<b>${linea.nombre}</b>`);

    trufiPolylines.set(linea.id, poly);

    if (showStops) {
      linea.paradas.forEach((p) => {
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: 4,
          color: linea.color,
          weight: 1,
          fillOpacity: 0.9
        })
          .bindPopup(`<b>${linea.nombre}</b><br>${p.nombre}`)
          .addTo(map);
        trufiStopMarkers.push(marker);
      });
    }
  });
}

// Modo "mostrar todas las rutas" -> solo líneas, sin paradas
function drawAllTrufiLines() {
  drawLinesForLineasObj(TRUFIS, false, 2, 0.7);
}

// Modo edición de paradas -> solo línea seleccionada + puntos
function drawLineaActualForEditing() {
  const linea = TRUFIS.find((l) => l.id === lineaSeleccionadaId);
  if (!linea) {
    clearTrufiLayers();
    return;
  }
  drawLinesForLineasObj([linea], true, 4, 0.9);
}

// ----- UI Y EVENTOS -----
function initUI() {
  const btnBuscarRuta = document.getElementById("btnBuscarRuta");
  const btnCalcularServer = document.getElementById("btnCalcularServer");
  const btnReiniciar = document.getElementById("btnReiniciar");
  const btnToggleTheme = document.getElementById("btnToggleTheme");
  const btnToggleTodasRutas = document.getElementById("btnToggleTodasRutas");
  const resizer = document.getElementById("resizer");

  // gestión de líneas
  const lineaSelect = document.getElementById("lineaSelect");
  const btnNuevaLinea = document.getElementById("btnNuevaLinea");
  const btnToggleParadas = document.getElementById("btnToggleParadas");
  const btnGuardarLinea = document.getElementById("btnGuardarLinea");

  btnBuscarRuta.addEventListener("click", buscarYMarcarRuta);
  btnCalcularServer.addEventListener("click", confirmarYCalcular);
  btnReiniciar.addEventListener("click", reiniciarTodo);
  btnToggleTheme.addEventListener("click", toggleTheme);

  // Mostrar / ocultar todas las rutas
  btnToggleTodasRutas.addEventListener("click", () => {
    mostrarTodasRutas = !mostrarTodasRutas;
    btnToggleTodasRutas.textContent = mostrarTodasRutas
      ? "Ocultar todas las rutas"
      : "Mostrar todas las rutas";

    // si entra en mostrar todas, desactiva modo paradas
    if (mostrarTodasRutas) {
      modoParadas = false;
      btnToggleParadas.textContent = "Modo paradas: OFF";
      drawAllTrufiLines();
    } else {
      clearTrufiLayers();
      if (currentOriginLatLng && currentDestLatLng && currentDistanceKm) {
        // redibuja solo sugeridas, sin mostrar paradas extra
        actualizarLineasTrufi(
          currentOriginLatLng,
          currentDestLatLng,
          currentDistanceKm
        );
      }
    }
  });

  setupAutocomplete(
    "origen",
    "sugerencias-origen",
    (latlng) => (currentOriginLatLng = latlng)
  );
  setupAutocomplete(
    "destino",
    "sugerencias-destino",
    (latlng) => (currentDestLatLng = latlng)
  );

  setupResizer(resizer);

  // gestión de líneas
  lineaSelect.addEventListener("change", () => {
    lineaSeleccionadaId = lineaSelect.value || null;
    cargarDatosLineaEnFormulario();
    renderParadasLineaActual();
    if (modoParadas) {
      drawLineaActualForEditing();
    } else if (mostrarTodasRutas) {
      drawAllTrufiLines();
    }
  });

  btnNuevaLinea.addEventListener("click", crearNuevaLinea);

  // MODO PARADAS ON/OFF
  btnToggleParadas.addEventListener("click", () => {
    modoParadas = !modoParadas;
    btnToggleParadas.textContent = `Modo paradas: ${modoParadas ? "ON" : "OFF"}`;

    if (modoParadas) {
      // al entrar a modo paradas, apagamos "mostrar todas"
      mostrarTodasRutas = false;
      btnToggleTodasRutas.textContent = "Mostrar todas las rutas";
      drawLineaActualForEditing();
    } else {
      // al salir de modo paradas, escondemos paradas
      clearTrufiLayers();

      if (mostrarTodasRutas) {
        drawAllTrufiLines();
      } else if (currentOriginLatLng && currentDestLatLng && currentDistanceKm) {
        actualizarLineasTrufi(
          currentOriginLatLng,
          currentDestLatLng,
          currentDistanceKm
        );
      }
    }
  });

  btnGuardarLinea.addEventListener("click", guardarLineaDesdeFormulario);
}

// ----- AUTOCOMPLETADO CON NOMINATIM (FILTRADO POR PAÍS) -----
function setupAutocomplete(inputId, listId, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);

  let timeout = null;

  input.addEventListener("input", () => {
    const q = input.value.trim();
    list.innerHTML = "";
    if (q.length < 3) return;

    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      const results = await geocodeText(q);
      list.innerHTML = "";

      results.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r.display_name;
        li.tabIndex = 0;
        li.addEventListener("click", () => {
          input.value = r.display_name;
          list.innerHTML = "";
          const latlng = L.latLng(r.lat, r.lon);
          onSelect(latlng);
        });
        list.appendChild(li);
      });
    }, 400);
  });
}

async function geocodeText(texto) {
  try {
    const countrySelect = document.getElementById("countrySelect");
    const country = countrySelect ? countrySelect.value : "bo";

    let url =
      `${NOMINATIM_URL}?format=json&limit=5&addressdetails=0&q=` +
      encodeURIComponent(texto);

    if (country && country !== "all") {
      url += `&countrycodes=${country}`;
    }

    const resp = await fetch(url, {
      headers: { "Accept-Language": "es" }
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch (e) {
    console.error("Error geocodificando:", e);
    return [];
  }
}

// ----- BUSCAR Y MARCAR RUTA -----
async function buscarYMarcarRuta() {
  const origenTxt = document.getElementById("origen").value.trim();
  const destinoTxt = document.getElementById("destino").value.trim();

  if (!origenTxt || !destinoTxt) {
    alert("Ingresa origen y destino.");
    return;
  }

  if (!currentOriginLatLng) {
    const r = await geocodeText(origenTxt);
    if (r[0]) currentOriginLatLng = L.latLng(r[0].lat, r[0].lon);
  }
  if (!currentDestLatLng) {
    const r = await geocodeText(destinoTxt);
    if (r[0]) currentDestLatLng = L.latLng(r[0].lat, r[0].lon);
  }

  if (!currentOriginLatLng || !currentDestLatLng) {
    alert("No se pudo localizar el origen o el destino.");
    return;
  }

  trazarRutaOSRM(currentOriginLatLng, currentDestLatLng);
}

async function trazarRutaOSRM(origen, destino) {
  try {
    const url =
      `${OSRM_URL}${origen.lng},${origen.lat};${destino.lng},${destino.lat}` +
      "?overview=full&geometries=geojson&alternatives=false&steps=false";

    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.routes || !data.routes.length) {
      alert("No se encontró ruta.");
      return;
    }

    const route = data.routes[0];
    const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);

    if (routeLayer) routeLayer.removeFrom(map);
    if (originMarker) originMarker.removeFrom(map);
    if (destMarker) destMarker.removeFrom(map);

    routeLayer = L.polyline(coords, {
      color: "#00e5ff",
      weight: 4,
      opacity: 0.9
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

    originMarker = L.marker(origen).addTo(map);
    destMarker = L.marker(destino).addTo(map);

    const distanciaKm = route.distance / 1000;
    const duracionMin = route.duration / 60;

    currentDistanceKm = distanciaKm;
    currentDurationMin = duracionMin;

    document.getElementById("distancia").value = distanciaKm.toFixed(2);
    document.getElementById("tiempo").value = Math.round(duracionMin) + " min";

    document.getElementById("tipoTrufi").value =
      distanciaKm < 5 ? "Corto" : distanciaKm < 15 ? "Medio" : "Largo";

    // Actualizar sugerencias de trufi
    actualizarLineasTrufi(origen, destino, distanciaKm);
  } catch (e) {
    console.error(e);
    alert("Error al calcular la ruta.");
  }
}

// ----- CONFIRMAR / CALCULAR COSTO GENERAL -----
async function confirmarYCalcular() {
  if (!currentDistanceKm) {
    alert("Primero busca una ruta.");
    return;
  }

  const tarifaKm = TARIFA_KM_GENERAL;
  document.getElementById("tarifaCalc").value = tarifaKm.toFixed(2);

  try {
    const resp = await fetch("/api/calcular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        distancia: currentDistanceKm,
        tarifaKm: tarifaKm
      })
    });

    const data = await resp.json();
    document.getElementById("precio").value = data.costo.toFixed(2);
  } catch (e) {
    console.error(e);
    alert("Error al comunicarse con el servidor.");
  }
}

// ----- LÓGICA "GOOGLE" PARA RECOMENDAR LÍNEAS -----
function actualizarLineasTrufi(origen, destino, distanciaKm) {
  const maxDistParada = 600; // metros
  const lineasCoinciden = [];

  TRUFIS.forEach((linea) => {
    const paradas = linea.paradas.map((p) => L.latLng(p.lat, p.lng));

    let minO = Infinity;
    let minD = Infinity;
    let idxSube = -1;
    let idxBaja = -1;

    paradas.forEach((pt, idx) => {
      const dO = map.distance(origen, pt);
      const dD = map.distance(destino, pt);
      if (dO < minO) {
        minO = dO;
        idxSube = idx;
      }
      if (dD < minD) {
        minD = dD;
        idxBaja = idx;
      }
    });

    if (
      minO <= maxDistParada &&
      minD <= maxDistParada &&
      idxSube !== -1 &&
      idxBaja !== -1 &&
      idxSube <= idxBaja
    ) {
      const costoLinea = distanciaKm * linea.tarifaKm;
      const walkTotal = minO + minD;

      lineasCoinciden.push({
        linea,
        costo: costoLinea,
        minO,
        minD,
        idxSube,
        idxBaja,
        walkTotal
      });
    }
  });

  // Si NO estamos mostrando todas ni en modo paradas, dibujamos solo sugeridas (con paradas)
  if (!mostrarTodasRutas && !modoParadas) {
    drawLinesForLineasObj(
      lineasCoinciden.map((x) => x.linea),
      true,
      2,
      0.7
    );
  }

  mostrarLineasTrufiEnPanel(lineasCoinciden, distanciaKm);
}

function mostrarLineasTrufiEnPanel(lineasCoinciden, distanciaKm) {
  const cont = document.getElementById("lineasTrufiInfo");
  cont.innerHTML = "";

  if (!lineasCoinciden.length) {
    cont.innerHTML =
      "<p>No hay líneas de trufi registradas que pasen cerca del origen y destino de esta ruta.</p>";
    return;
  }

  lineasCoinciden.sort((a, b) => {
    if (a.costo !== b.costo) return a.costo - b.costo;
    return a.walkTotal - b.walkTotal;
  });

  const maxCosto = Math.max(...lineasCoinciden.map((x) => x.costo));

  lineasCoinciden.forEach((item) => {
    const { linea, costo, minO, minD, idxSube, idxBaja } = item;

    const paradaSube = linea.paradas[idxSube];
    const paradaBaja = linea.paradas[idxBaja];

    const card = document.createElement("div");
    card.className = "linea-card";

    const titulo = document.createElement("div");
    titulo.className = "linea-titulo";
    titulo.innerHTML = `<span class="linea-color" style="background:${linea.color}"></span>
                        <strong>${linea.nombre}</strong> <small>(${linea.tipo})</small>`;
    card.appendChild(titulo);

    const detalles = document.createElement("div");
    detalles.className = "linea-detalles";
    detalles.innerHTML = `
      <p><strong>Tarifa línea:</strong> ${linea.tarifaKm.toFixed(2)} Bs/km</p>
      <p><strong>Costo estimado para este tramo:</strong> ${costo.toFixed(
        2
      )} Bs</p>
      <p><strong>Subes en:</strong> ${paradaSube.nombre} 
         <small>(~ ${(minO / 1000).toFixed(2)} km caminando)</small></p>
      <p><strong>Bajas en:</strong> ${paradaBaja.nombre} 
         <small>(~ ${(minD / 1000).toFixed(2)} km caminando al destino)</small></p>
      <p><strong>Paradas de la línea:</strong> 
        ${linea.paradas.map((p) => p.nombre).join(" → ")}
      </p>
    `;
    card.appendChild(detalles);

    const barWrap = document.createElement("div");
    barWrap.className = "linea-bar-wrap";

    const bar = document.createElement("div");
    bar.className = "linea-bar";
    const porcentaje = (costo / maxCosto) * 100;
    bar.style.width = `${porcentaje}%`;
    barWrap.appendChild(bar);

    card.appendChild(barWrap);

    card.addEventListener("click", () => {
      resaltarLineaSeleccionada(linea, idxSube, idxBaja);
    });

    cont.appendChild(card);
  });
}

function limpiarMarcadoresHighlight() {
  if (markerSubeHighlight) {
    markerSubeHighlight.removeFrom(map);
    markerSubeHighlight = null;
  }
  if (markerBajaHighlight) {
    markerBajaHighlight.removeFrom(map);
    markerBajaHighlight = null;
  }
}

function resaltarLineaSeleccionada(linea, idxSube, idxBaja) {
  trufiPolylines.forEach((poly, id) => {
    const isThis = id === linea.id;
    poly.setStyle({
      weight: isThis ? 5 : 2,
      opacity: isThis ? 1 : 0.3,
      dashArray: isThis ? null : "4,4"
    });
  });

  limpiarMarcadoresHighlight();

  const paradaSube = linea.paradas[idxSube];
  const paradaBaja = linea.paradas[idxBaja];

  markerSubeHighlight = L.circleMarker([paradaSube.lat, paradaSube.lng], {
    radius: 8,
    color: linea.color,
    weight: 2,
    fillOpacity: 0.9
  })
    .bindPopup(`<b>Subir aquí</b><br>${linea.nombre}<br>${paradaSube.nombre}`)
    .addTo(map);

  markerBajaHighlight = L.circleMarker([paradaBaja.lat, paradaBaja.lng], {
    radius: 8,
    color: linea.color,
    weight: 2,
    fillOpacity: 0.9
  })
    .bindPopup(`<b>Bajar aquí</b><br>${linea.nombre}<br>${paradaBaja.nombre}`)
    .addTo(map);

  const bounds = L.latLngBounds(
    [paradaSube.lat, paradaSube.lng],
    [paradaBaja.lat, paradaBaja.lng]
  );
  map.fitBounds(bounds, { padding: [50, 50] });
}

// ----- GESTIÓN DE LÍNEAS: SELECT Y FORMULARIO -----
function renderLineaSelect() {
  const select = document.getElementById("lineaSelect");
  if (!select) return;

  select.innerHTML = "";
  TRUFIS.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.nombre;
    select.appendChild(opt);
  });

  if (!lineaSeleccionadaId && TRUFIS.length) {
    lineaSeleccionadaId = TRUFIS[0].id;
  }
  select.value = lineaSeleccionadaId || "";

  cargarDatosLineaEnFormulario();
  renderParadasLineaActual();
}

function crearNuevaLinea() {
  const nuevoId = "L" + (TRUFIS.length + 1);
  const nueva = {
    id: nuevoId,
    nombre: "Nuevo trufi " + nuevoId,
    tipo: "Trufi",
    color: "#3f51b5",
    tarifaKm: 1.8,
    paradas: []
  };
  TRUFIS.push(nueva);
  lineaSeleccionadaId = nuevoId;
  renderLineaSelect();
  if (modoParadas) {
    drawLineaActualForEditing();
  } else if (mostrarTodasRutas) {
    drawAllTrufiLines();
  }
}

function cargarDatosLineaEnFormulario() {
  const linea = TRUFIS.find((l) => l.id === lineaSeleccionadaId);
  if (!linea) return;

  document.getElementById("lineaNombre").value = linea.nombre;
  document.getElementById("lineaTipo").value = linea.tipo;
  document.getElementById("lineaTarifa").value = linea.tarifaKm;
  document.getElementById("lineaColor").value = linea.color;
}

function guardarLineaDesdeFormulario() {
  const linea = TRUFIS.find((l) => l.id === lineaSeleccionadaId);
  if (!linea) return;

  linea.nombre = document.getElementById("lineaNombre").value || linea.nombre;
  linea.tipo = document.getElementById("lineaTipo").value || linea.tipo;
  const tarifa = parseFloat(document.getElementById("lineaTarifa").value);
  if (!isNaN(tarifa)) linea.tarifaKm = tarifa;
  linea.color = document.getElementById("lineaColor").value || linea.color;

  renderLineaSelect();

  if (modoParadas) {
    drawLineaActualForEditing();
  } else if (mostrarTodasRutas) {
    drawAllTrufiLines();
  } else if (currentOriginLatLng && currentDestLatLng && currentDistanceKm) {
    actualizarLineasTrufi(
      currentOriginLatLng,
      currentDestLatLng,
      currentDistanceKm
    );
  }
}

/*  RENDER PARADAS + EDITAR + ELIMINAR  */
function renderParadasLineaActual() {
  const cont = document.getElementById("paradasLineaActual");
  const linea = TRUFIS.find((l) => l.id === lineaSeleccionadaId);
  if (!cont || !linea) return;

  cont.innerHTML = "";

  if (!linea.paradas.length) {
    cont.innerHTML =
      "<p class='texto-ayuda'>Esta línea aún no tiene paradas. Activa 'Modo paradas' y haz clic en el mapa para agregarlas.</p>";
    return;
  }

  linea.paradas.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "parada-item";
    div.innerHTML = `
      <div class="parada-header">
        <strong>${idx + 1}.</strong>
        <button type="button" class="btn-parada-delete" data-idx="${idx}">✕</button>
      </div>
      <input type="text" value="${p.nombre}" data-idx="${idx}" class="parada-nombre">
      <small>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</small>
    `;
    cont.appendChild(div);
  });

  cont.querySelectorAll(".parada-nombre").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const idx = parseInt(e.target.getAttribute("data-idx"), 10);
      linea.paradas[idx].nombre = e.target.value;
      if (modoParadas) {
        drawLineaActualForEditing();
      } else if (mostrarTodasRutas) {
        drawAllTrufiLines();
      } else if (currentOriginLatLng && currentDestLatLng && currentDistanceKm) {
        actualizarLineasTrufi(
          currentOriginLatLng,
          currentDestLatLng,
          currentDistanceKm
        );
      }
    });
  });

  cont.querySelectorAll(".btn-parada-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      linea.paradas.splice(idx, 1);
      renderParadasLineaActual();
      if (modoParadas) {
        drawLineaActualForEditing();
      } else if (mostrarTodasRutas) {
        drawAllTrufiLines();
      } else if (currentOriginLatLng && currentDestLatLng && currentDistanceKm) {
        actualizarLineasTrufi(
          currentOriginLatLng,
          currentDestLatLng,
          currentDistanceKm
        );
      }
    });
  });
}

// ----- REINICIAR -----
function reiniciarTodo() {
  document.getElementById("origen").value = "";
  document.getElementById("destino").value = "";
  document.getElementById("distancia").value = "0";
  document.getElementById("tiempo").value = "—";
  document.getElementById("precio").value = "—";
  document.getElementById("tarifaCalc").value = "—";
  document.getElementById("tipoTrufi").value = "—";

  currentDistanceKm = 0;
  currentDurationMin = 0;
  currentOriginLatLng = null;
  currentDestLatLng = null;

  if (routeLayer) routeLayer.removeFrom(map);
  if (originMarker) originMarker.removeFrom(map);
  if (destMarker) destMarker.removeFrom(map);

  document.getElementById("lineasTrufiInfo").innerHTML =
    '<p class="texto-ayuda">Busca una ruta y aquí verás qué líneas de trufi pasan cerca del origen y destino, con su costo aproximado.</p>';

  if (modoParadas) {
    drawLineaActualForEditing();
  } else if (mostrarTodasRutas) {
    drawAllTrufiLines();
  } else {
    clearTrufiLayers();
  }
}

// ----- TEMA OSCURO / CLARO -----
function toggleTheme() {
  const panel = document.getElementById("side-panel");

  if (currentTheme === "dark") {
    currentTheme = "light";
    panel.classList.remove("dark");
    map.removeLayer(baseDark);
    baseLight.addTo(map);
  } else {
    currentTheme = "dark";
    panel.classList.add("dark");
    map.removeLayer(baseLight);
    baseDark.addTo(map);
  }
}

// ----- RESIZER LATERAL -----
function setupResizer(resizer) {
  const sidePanel = document.getElementById("side-panel");
  let isResizing = false;

  resizer.addEventListener("mousedown", () => {
    isResizing = true;
    document.body.style.cursor = "col-resize";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth > 220 && newWidth < window.innerWidth - 200) {
      sidePanel.style.width = newWidth + "px";
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "default";
    }
  });
}
