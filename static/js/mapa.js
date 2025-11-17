// mapa.js - versión profesional con autocompletado, marcadores personalizados, historial y cálculo automático

// ---------------------------
// Configuración de tarifas y velocidades
// ---------------------------
const TARIFAS = {
    diurno: {
        zonal: 2.50,
        tramo_corto: 2.80,
        tramo_largo: 3.30,
        tramo_extra_largo: 3.50
    },
    nocturno: {
        zonal: 3.00,
        tramo_corto: 3.30,
        tramo_largo: 3.50,
        tramo_extra_largo: 4.00
    }
};

const TRAMOS_KM = {
    zonal_max: 3.0,
    tramo_corto_max: 6.0,
    tramo_largo_max: 10.0
    // >10 = extra largo
};

// velocidad en km/h por franjas horarias (basado en tu requerimiento)
function velocidadPorHora(hour) {
    // hour en 0-23
    if (hour >= 6 && hour <= 9) return 25;     // pico mañana
    if (hour >= 10 && hour <= 16) return 40;   // normal
    if (hour >= 17 && hour <= 20) return 20;   // pico tarde
    if (hour >= 21 && hour <= 23) return 45;   // fluido nocturno
    // madrugada
    return 50;
}

// si es nocturno: 21:00 - 05:59
function esNocturno(hour) {
    return (hour >= 21 && hour <= 23) || (hour >= 0 && hour <= 5);
}

// ---------------------------
// Helper UI, storage
// ---------------------------
const $ = id => document.getElementById(id);

function guardarHistorial(entry) {
    let h = JSON.parse(localStorage.getItem('historial_rutas_v1') || '[]');
    h.unshift(entry);
    if (h.length > 30) h = h.slice(0,30);
    localStorage.setItem('historial_rutas_v1', JSON.stringify(h));
    renderHistorial();
}

function renderHistorial() {
    const cont = $('historial');
    const raw = JSON.parse(localStorage.getItem('historial_rutas_v1') || '[]');
    cont.innerHTML = '';
    raw.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'item';
        div.innerHTML = `<div class="title">${r.origen.nombre} → ${r.destino.nombre}</div>
            <div class="meta">Dist: ${r.distancia} km · Tiempo: ${r.tiempo} · Precio: Bs ${r.precio} · ${new Date(r.fecha).toLocaleString()}</div>`;
        div.addEventListener('click', () => {
            // redibujar
            dibujarRuta(r.origen.coord, r.destino.coord, true);
        });
        cont.appendChild(div);
    });
}
renderHistorial();

// ---------------------------
// Inicializar mapa
// ---------------------------
const map = L.map('map').setView([-16.5, -68.15], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

let controlRuta = null;
let distanciaKm = 0;
let ultimaOrigen = null;
let ultimaDestino = null;

// crear iconos personalizados (SVG en dataURI)
function createIcon(color, label) {
    const svg = encodeURIComponent(`
        <svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 24 24'>
            <path fill='${color}' d='M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z'/>
            <text x='12' y='14' font-size='8' fill='#fff' text-anchor='middle' font-family='Arial' dy='.3em'>${label||''}</text>
        </svg>`);
    return L.icon({
        iconUrl: `data:image/svg+xml;utf8,${svg}`,
        iconSize: [36,36],
        iconAnchor: [18,36],
        popupAnchor: [0,-36]
    });
}

const iconOrigen = createIcon('#11698e','O');
const iconDestino = createIcon('#2b7a78','D');

// ---------------------------
// Geocoding / Autocomplete (Nominatim)
// ---------------------------
// Nota: Nominatim pide identificar la aplicación. Aquí hacemos fetch desde cliente.
// Agregar &limit=5 para sugerencias, &accept-language=es
async function nominatimSearch(q, limit=6) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&accept-language=es&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
        headers: {
            // no podemos forzar User-Agent en navegador, pero incluiré un header personal identificador opcional
            // algunas implementaciones de Nominatim ignoran este header en CORS context.
            'Referer': window.location.origin
        }
    });
    if (!res.ok) return [];
    return res.json();
}

function hookupAutocomplete(inputId, sugerenciasId) {
    const input = $(inputId);
    const sugerencias = $(sugerenciasId);
    let timeout = null;

    input.addEventListener('input', () => {
        const val = input.value.trim();
        sugerencias.innerHTML = '';
        if (timeout) clearTimeout(timeout);
        if (!val) return;
        timeout = setTimeout(async () => {
            const items = await nominatimSearch(val, 6);
            sugerencias.innerHTML = '';
            items.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item.display_name;
                li.dataset.lat = item.lat;
                li.dataset.lon = item.lon;
                li.dataset.display = item.display_name;
                li.addEventListener('click', () => {
                    input.value = item.display_name;
                    sugerencias.innerHTML = '';
                });
                sugerencias.appendChild(li);
            });
        }, 300);
    });

    // close on outside click
    document.addEventListener('click', (ev) => {
        if (!input.contains(ev.target) && !sugerencias.contains(ev.target)) {
            sugerencias.innerHTML = '';
        }
    });
}
hookupAutocomplete('origen','sugerencias-origen');
hookupAutocomplete('destino','sugerencias-destino');

// ---------------------------
// Dibujar ruta y actualizar UI
// ---------------------------
function determinarTipoPorDistancia(km) {
    if (km <= TRAMOS_KM.zonal_max) return 'zonal';
    if (km <= TRAMOS_KM.tramo_corto_max) return 'tramo_corto';
    if (km <= TRAMOS_KM.tramo_largo_max) return 'tramo_largo';
    return 'tramo_extra_largo';
}

function formatoMinutos(totalMin) {
    if (!isFinite(totalMin)) return '—';
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function actualizarUI(origenNombre, destinoNombre, km, tiempoMin, tipo, tarifa) {
    $('tipoTrufi').value = tipo.replace('_',' ');
    $('tarifaCalc').value = tarifa.toFixed(2);
    $('distancia').value = km;
    $('tiempo').value = formatoMinutos(tiempoMin);
    $('precio').value = `Bs ${ ( (parseFloat(km) * tarifa) ).toFixed(2) }`;
}

// dibujar ruta, si fromHist true no guarda nuevo historial (cuando viene del historial)
async function dibujarRuta(origenCoord, destinoCoord, fromHist=false) {
    if (controlRuta) {
        map.removeControl(controlRuta);
        controlRuta = null;
    }

    controlRuta = L.Routing.control({
        waypoints: [
            L.latLng(origenCoord.lat, origenCoord.lon),
            L.latLng(destinoCoord.lat, destinoCoord.lon)
        ],
        lineOptions: { styles: [{ color: '#11698e', opacity: 0.8, weight: 5 }] },
        createMarker: function(i, wp){
            if (i === 0) return L.marker(wp.latLng, {icon: iconOrigen}).bindPopup('Origen');
            return L.marker(wp.latLng, {icon: iconDestino}).bindPopup('Destino');
        },
        routeWhileDragging: true,
        fitSelectedRoutes: true,
        showAlternatives: false
    })
    .on('routesfound', function(e){
        const route = e.routes[0];
        distanciaKm = (route.summary.totalDistance / 1000);
        const kmRounded = Number(distanciaKm.toFixed(2));

        // determinar hora actual local y nocturno
        const now = new Date();
        const hour = now.getHours();
        const noct = esNocturno(hour) ? 'nocturno' : 'diurno';

        // tipo de tramo automático
        const tipo = determinarTipoPorDistancia(kmRounded);

        // tarifa por km aplicada
        const tarifa = TARIFAS[noct][tipo];

        // velocidad según hora (km/h)
        const vel = velocidadPorHora(hour);
        const tiempoHoras = kmRounded / vel;
        const tiempoMinutos = tiempoHoras * 60;

        // actualizar UI
        actualizarUI(null, null, kmRounded, tiempoMinutos, tipo, tarifa);

        // guardar coordenadas en variables globales para usar en cálculo/guardar
        ultimaOrigen = { lat: origenCoord.lat, lon: origenCoord.lon, nombre: $('origen').value || 'Origen' };
        ultimaDestino = { lat: destinoCoord.lat, lon: destinoCoord.lon, nombre: $('destino').value || 'Destino' };

        // guardar en historial (si no viene desde historial)
        if (!fromHist) {
            const entry = {
                fecha: new Date().toISOString(),
                origen: { nombre: ultimaOrigen.nombre, coord: ultimaOrigen },
                destino: { nombre: ultimaDestino.nombre, coord: ultimaDestino },
                distancia: kmRounded,
                tiempo: formatoMinutos(tiempoMinutos),
                tipo: tipo,
                tarifa: tarifa,
                precio: Number((kmRounded * tarifa).toFixed(2))
            };
            guardarHistorial(entry);
        }
    })
    .addTo(map);
}

// ---------------------------
// Obtener coordenadas desde la caja de texto (usa Nominatim, toma primer resultado)
// ---------------------------
async function buscarCoordenadaDeTexto(texto) {
    if (!texto || texto.trim() === '') return null;
    const items = await nominatimSearch(texto, 1);
    if (!items || items.length === 0) return null;
    return {
        lat: parseFloat(items[0].lat),
        lon: parseFloat(items[0].lon),
        nombre: items[0].display_name
    };
}

// ---------------------------
// Eventos botones
// ---------------------------

$('btnBuscarRuta').addEventListener('click', async () => {
    const origenText = $('origen').value.trim();
    const destinoText = $('destino').value.trim();
    if (!origenText || !destinoText) {
        alert('Ingrese origen y destino');
        return;
    }

    // primero obtener coordenadas
    const origen = await buscarCoordenadaDeTexto(origenText);
    const destino = await buscarCoordenadaDeTexto(destinoText);

    if (!origen || !destino) {
        alert('No se encontraron las ubicaciones. Intente con otra descripción.');
        return;
    }

    // dibujar ruta
    dibujarRuta({lat: origen.lat, lon: origen.lon}, {lat: destino.lat, lon: destino.lon});
});

$('btnCalcularServer').addEventListener('click', async () => {
    // envia distancia y tarifa al servidor /api/calcular (tu app.py ya admite esto)
    if (!distanciaKm || isNaN(distanciaKm) || distanciaKm <= 0) {
        alert('Primero genere una ruta para calcular.');
        return;
    }

    // tarifa que se muestra en UI
    const tarifaTxt = $('tarifaCalc').value;
    const tarifaNum = parseFloat(tarifaTxt);
    if (isNaN(tarifaNum)) {
        alert('Tarifa inválida.');
        return;
    }

    const response = await fetch('/api/calcular', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ distancia: Number(distanciaKm.toFixed(2)), tarifaKm: tarifaNum })
    });
    if (!response.ok) {
        alert('Error al comunicarse con el servidor.');
        return;
    }
    const data = await response.json();
    // actualizar precio con lo que retorne el servidor
    $('precio').value = `Bs ${data.costo}`;
    // también actualizar historial para reflejar precio "oficial"
    if (ultimaOrigen && ultimaDestino) {
        const entry = {
            fecha: new Date().toISOString(),
            origen: { nombre: ultimaOrigen.nombre, coord: ultimaOrigen },
            destino: { nombre: ultimaDestino.nombre, coord: ultimaDestino },
            distancia: Number(distanciaKm.toFixed(2)),
            tiempo: $('tiempo').value,
            tipo: $('tipoTrufi').value,
            tarifa: tarifaNum,
            precio: Number(data.costo)
        };
        guardarHistorial(entry);
    }
});

$('btnReiniciar').addEventListener('click', () => {
    if (controlRuta) { map.removeControl(controlRuta); controlRuta = null; }
    distanciaKm = 0;
    ultimaOrigen = null;
    ultimaDestino = null;
    $('origen').value = '';
    $('destino').value = '';
    $('tipoTrufi').value = '—';
    $('tarifaCalc').value = '—';
    $('distancia').value = '0';
    $('tiempo').value = '—';
    $('precio').value = '—';
});

// ---------------------------
// Al cargar, si existe historial, mostrarlo
// ---------------------------
renderHistorial();

// ========== PANEL AJUSTABLE ==========
const panel = document.getElementById("panel");
const resizer = document.getElementById("resizer");

let mouseDown = false;

resizer.addEventListener("mousedown", function(e) {
    mouseDown = true;
});

document.addEventListener("mousemove", function(e) {
    if (!mouseDown) return;

    const newWidth = e.clientX;

    if (newWidth > 250 && newWidth < 500) {
        panel.style.width = newWidth + "px";
    }
});

document.addEventListener("mouseup", function() {
    mouseDown = false;
});
