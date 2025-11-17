// =============================
// MAPA CENTRADO EN EL ALTO / LA PAZ
// =============================
let map = L.map("map").setView([-16.5, -68.15], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
}).addTo(map);

let controlRuta = null;
let distanciaKm = 0;

// =============================
// FUNCION DE GEOCODING (Nominatim)
// =============================
async function geocodificar(texto) {
    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}`;

    let res = await fetch(url);
    let datos = await res.json();

    if (datos.length === 0) return null;

    return {
        lat: parseFloat(datos[0].lat),
        lon: parseFloat(datos[0].lon)
    };
}

// =============================
// DIBUJAR RUTA AUTOMÁTICAMENTE
// =============================
function dibujarRuta(origen, destino) {

    if (controlRuta) {
        map.removeControl(controlRuta);
    }

    controlRuta = L.Routing.control({
        waypoints: [
            L.latLng(origen.lat, origen.lon),
            L.latLng(destino.lat, destino.lon)
        ],
        language: "es",
        draggableWaypoints: true,
        routeWhileDragging: true
    })
    .on("routesfound", function(e) {
        distanciaKm = (e.routes[0].summary.totalDistance / 1000).toFixed(2);
        console.log("Distancia:", distanciaKm);
    })
    .addTo(map);
}

// =============================
// BUSCAR RUTA DESDE LOS INPUTS
// =============================
document.getElementById("btnBuscarRuta").addEventListener("click", async () => {
    let origenTexto = document.getElementById("origen").value.trim();
    let destinoTexto = document.getElementById("destino").value.trim();

    if (!origenTexto || !destinoTexto) {
        alert("Ingrese origen y destino.");
        return;
    }

    let origen = await geocodificar(origenTexto);
    let destino = await geocodificar(destinoTexto);

    if (!origen || !destino) {
        alert("No se pudo encontrar una ubicación. Intente con otro nombre.");
        return;
    }

    dibujarRuta(origen, destino);
});

// =============================
// CALCULAR COSTO
// =============================
document.getElementById("btnCalcular").addEventListener("click", async () => {

    if (distanciaKm == 0) {
        alert("Debe buscar una ruta primero.");
        return;
    }

    let tarifa = parseFloat(document.getElementById("tarifa").value);

    const res = await fetch("/api/calcular", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            distancia: distanciaKm,
            tarifaKm: tarifa
        })
    });

    const data = await res.json();

    document.getElementById("resultado").innerHTML = `
        <h3>Resultados:</h3>
        Distancia: <b>${data.distancia} km</b><br>
        Costo: <b>${data.costo} Bs</b>
    `;
});

// =============================
// REINICIAR
// =============================
document.getElementById("btnReiniciar").addEventListener("click", () => {
    if (controlRuta) map.removeControl(controlRuta);

    distanciaKm = 0;
    document.getElementById("resultado").innerHTML = "";
    document.getElementById("origen").value = "";
    document.getElementById("destino").value = "";
});
