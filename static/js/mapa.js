// mapa.js - Integrado: autocompletado, Nominatim, routing, tarifas automáticas, historial, modo día/noche, resizer, UI robusta.

document.addEventListener('DOMContentLoaded', () => {

    // ---------- CONFIG ----------
    const TRAMOS_KM = { zonal_max: 3.0, tramo_corto_max: 6.0, tramo_largo_max: 10.0 };
    const TARIFAS = {
        diurno: { zonal: 2.50, tramo_corto: 2.80, tramo_largo: 3.30, tramo_extra_largo: 3.50 },
        nocturno: { zonal: 3.00, tramo_corto: 3.30, tramo_largo: 3.50, tramo_extra_largo: 4.00 }
    };

    // velocidad por franjas horarias
    function velocidadPorHora(hour) {
        if (hour >= 6 && hour <= 9) return 25;
        if (hour >= 10 && hour <= 16) return 40;
        if (hour >= 17 && hour <= 20) return 20;
        if (hour >= 21 && hour <= 23) return 45;
        return 50;
    }
    function esNocturno(hour) { return (hour >= 21 && hour <= 23) || (hour >= 0 && hour <= 5); }

    // ---------- HELPERS ----------
    const $ = id => document.getElementById(id);
    function safeText(el) { return el ? el.textContent || el.value || '' : ''; }

    // guardar ancho del panel
    function guardarAnchoPanel(px) { try { localStorage.setItem('panel_ancho_v1', String(px)); } catch(e){} }
    function leerAnchoPanel() { try { return parseInt(localStorage.getItem('panel_ancho_v1')) || null; } catch(e){return null} }

    // historial
    function guardarHistorial(entry) {
        try {
            const key='historial_rutas_v1';
            const raw = JSON.parse(localStorage.getItem(key) || '[]');
            raw.unshift(entry);
            if (raw.length>50) raw.splice(50);
            localStorage.setItem(key, JSON.stringify(raw));
            renderHistorial();
        } catch (err) { console.error('guardarHistorial',err) }
    }
    function obtenerHistorial() {
        try { return JSON.parse(localStorage.getItem('historial_rutas_v1') || '[]'); } catch(e){return []}
    }

    // ---------- MAPA (día/noche tiles) ----------
    const tilesDay = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{ maxZoom:19 });
    const tilesDark = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',{ maxZoom:19 });

    const map = L.map('map', { layers:[tilesDay] }).setView([-16.5, -68.15], 12);
    tilesDay.addTo(map);

    let routingControl = null;
    let markerOrigen = null;
    let markerDestino = null;
    let ultimaDistanciaKm = 0;
    let ultimaTarifa = 0;
    let ultimaTipo = '—';

    // crear iconos SVG
    function createIcon(color, label){
        const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 24 24'><path fill='${color}' d='M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z'/><text x='12' y='14' font-size='8' fill='#fff' text-anchor='middle' font-family='Arial' dy='.3em'>${label||''}</text></svg>`);
        return L.icon({ iconUrl:`data:image/svg+xml;utf8,${svg}`, iconSize:[36,36], iconAnchor:[18,36], popupAnchor:[0,-36] });
    }
    const iconO = createIcon('#11698e','O');
    const iconD = createIcon('#2b7a78','D');

    // ---------- AUTOCOMPLETE Nominatim (mejorado con teclado) ----------
    async function nominatimSearch(q, limit=6) {
        if (!q || !q.trim()) return [];
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&accept-language=es&q=${encodeURIComponent(q)}`;
            const res = await fetch(url, { headers:{ 'Referer': window.location.origin }});
            if (!res.ok) return [];
            return await res.json();
        } catch (err) { console.error('nominatim',err); return [];}
    }

    function hookupAutocomplete(inputId, sugerenciasId) {
        const input = $(inputId), sugg = $(sugerenciasId);
        if (!input || !sugg) return;
        let idx = -1, currentItems = [];
        input.addEventListener('input', () => {
            const q = input.value.trim();
            sugg.innerHTML = ''; idx=-1; currentItems=[];
            if (!q) return;
            setTimeout(async () => {
                const items = await nominatimSearch(q,6);
                currentItems = items;
                sugg.innerHTML = '';
                items.forEach((it,i) => {
                    const li = document.createElement('li');
                    li.textContent = it.display_name;
                    li.tabIndex = -1;
                    li.dataset.lat = it.lat; li.dataset.lon = it.lon;
                    li.addEventListener('click', () => {
                        input.value = it.display_name; sugg.innerHTML=''; input.focus();
                    });
                    sugg.appendChild(li);
                });
            }, 250);
        });

        // keyboard navigation
        input.addEventListener('keydown', (ev) => {
            const lis = sugg.querySelectorAll('li');
            if (!lis.length) return;
            if (ev.key === 'ArrowDown') { ev.preventDefault(); idx = Math.min(idx+1, lis.length-1); highlight(lis, idx); }
            if (ev.key === 'ArrowUp') { ev.preventDefault(); idx = Math.max(idx-1, 0); highlight(lis, idx); }
            if (ev.key === 'Enter') {
                ev.preventDefault();
                if (idx >=0 && lis[idx]) {
                    lis[idx].click();
                } else {
                    // no selection: take first if exists
                    if (lis[0]) lis[0].click();
                }
            }
        });

        function highlight(lis, ii){
            lis.forEach((n)=>n.classList.remove('active'));
            if (ii>=0 && lis[ii]) lis[ii].classList.add('active');
        }

        document.addEventListener('click',(ev)=>{ if (!input.contains(ev.target) && !sugg.contains(ev.target)) sugg.innerHTML=''; });
    }
    hookupAutocomplete('origen','sugerencias-origen');
    hookupAutocomplete('destino','sugerencias-destino');

    // ---------- UTIL: geocodificar 1 resultado ----------
    async function geocodificarPrimero(texto){
        const arr = await nominatimSearch(texto,1);
        if (!arr || arr.length===0) return null;
        return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display: arr[0].display_name };
    }

    // ---------- DETERMINAR TIPO Y TARIFA ----------
    function tipoPorDistancia(km){
        if (km <= TRAMOS_KM.zonal_max) return 'zonal';
        if (km <= TRAMOS_KM.tramo_corto_max) return 'tramo_corto';
        if (km <= TRAMOS_KM.tramo_largo_max) return 'tramo_largo';
        return 'tramo_extra_largo';
    }
    function tarifaPorTipoYHora(tipo, hour){
        const noct = esNocturno(hour) ? 'nocturno' : 'diurno';
        return TARIFAS[noct][tipo];
    }

    // ---------- DIBUJAR RUTA, ACTUALIZAR UI Y GUARDAR HISTORIAL ----------
    function formatoMinutos(totalMin){
        if (!isFinite(totalMin)) return '—';
        const h=Math.floor(totalMin/60), m=Math.round(totalMin%60);
        return h>0? `${h} h ${m} min` : `${m} min`;
    }

    function actualizarUI(tipo, tarifa, km, tiempoMin, precioEstimado){
        if ($('tipoTrufi')) $('tipoTrufi').value = tipo.replace('_',' ');
        if ($('tarifaCalc')) $('tarifaCalc').value = Number(tarifa).toFixed(2);
        if ($('distancia')) $('distancia').value = Number(km).toFixed(2);
        if ($('tiempo')) $('tiempo').value = formatoMinutos(tiempoMin);
        if ($('precio')) $('precio').value = `Bs ${Number(precioEstimado).toFixed(2)}`;
    }

    async function dibujarRutaCoords(orig, dest, fromHist=false){
        try {
            if (routingControl) { map.removeControl(routingControl); routingControl=null; }

            routingControl = L.Routing.control({
                waypoints: [ L.latLng(orig.lat, orig.lon), L.latLng(dest.lat, dest.lon) ],
                createMarker: function(i, wp){
                    return L.marker(wp.latLng, { icon: i===0? iconO : iconD });
                },
                routeWhileDragging:true,
                fitSelectedRoutes:true,
                showAlternatives:false,
                lineOptions:{ styles:[{color:'#11698e', weight:5, opacity:0.9}] }
            })
            .on('routesfound', function(e){
                const route = e.routes[0];
                const distKm = Number((route.summary.totalDistance/1000).toFixed(2));
                ultimaDistanciaKm = distKm;

                // hora local
                const now = new Date(); const hour = now.getHours();
                const tipo = tipoPorDistancia(distKm);
                const tarifa = tarifaPorTipoYHora(tipo, hour);
                const vel = velocidadPorHora(hour);
                const tiempoMin = (distKm / vel) * 60; // minutos
                const precioEst = distKm * tarifa;

                ultimaTarifa = tarifa; ultimaTipo = tipo;

                actualizarUI(tipo, tarifa, distKm, tiempoMin, precioEst);

                // guardar historial
                if (!fromHist) {
                    guardarHistorial({
                        fecha: new Date().toISOString(),
                        origen: { nombre: $('origen') ? $('origen').value || 'Origen' : 'Origen', coord: orig },
                        destino: { nombre: $('destino') ? $('destino').value || 'Destino' : 'Destino', coord: dest },
                        distancia: distKm,
                        tiempo: formatoMinutos(tiempoMin),
                        tipo: tipo,
                        tarifa: Number(tarifa.toFixed(2)),
                        precio: Number(precioEst.toFixed(2))
                    });
                }
            })
            .addTo(map);

            // colocar / actualizar markers visibles
            if (markerOrigen) map.removeLayer(markerOrigen);
            if (markerDestino) map.removeLayer(markerDestino);
            markerOrigen = L.marker([orig.lat, orig.lon], {icon:iconO}).addTo(map).bindPopup('Origen').openPopup();
            markerDestino = L.marker([dest.lat, dest.lon], {icon:iconD}).addTo(map).bindPopup('Destino');

        } catch (err) { console.error('dibujarRutaCoords',err); alert('Error trazando ruta (ver consola).'); }
    }

    // ---------- BOTONES ----------

    async function accionBuscarRuta(){
        const oText = ($('origen') ? $('origen').value.trim() : '');
        const dText = ($('destino') ? $('destino').value.trim() : '');
        if (!oText || !dText) { alert('Ingresa origen y destino'); return; }
        const o = await geocodificarPrimero(oText);
        const d = await geocodificarPrimero(dText);
        if (!o || !d){ alert('No se encontraron las ubicaciones'); return; }
        await dibujarRutaCoords({lat:o.lat, lon:o.lon}, {lat:d.lat, lon:d.lon});
        try { map.invalidateSize(); } catch(e){}
    }

    async function accionCalcularServer(){
        if (!ultimaDistanciaKm || isNaN(ultimaDistanciaKm) || ultimaDistanciaKm<=0){ alert('Primero genere una ruta'); return; }
        // tarifa ya calculada por front (ultimaTarifa)
        const tarifaSend = Number(ultimaTarifa);
        try {
            const resp = await fetch('/api/calcular', {
                method:'POST',
                headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify({ distancia: Number(ultimaDistanciaKm.toFixed(2)), tarifaKm: tarifaSend })
            });
            if (!resp.ok) { alert('Error comunicándose con servidor'); return; }
            const data = await resp.json();
            if ($('precio')) $('precio').value = `Bs ${Number(data.costo).toFixed(2)}`;
            // actualizar última entrada del historial con precio "oficial"
            const hist = obtenerHistorial();
            if (hist && hist.length>0){
                hist[0].precio = Number(data.costo);
                localStorage.setItem('historial_rutas_v1', JSON.stringify(hist));
                renderHistorial();
            }
            alert('Cálculo confirmado y actualizado.');
        } catch (err) { console.error('accionCalcularServer',err); alert('Error al calcular (ver consola)'); }
    }

    function accionReiniciar(){
        if (routingControl) { map.removeControl(routingControl); routingControl=null; }
        if (markerOrigen) { map.removeLayer(markerOrigen); markerOrigen=null; }
        if (markerDestino) { map.removeLayer(markerDestino); markerDestino=null; }
        ultimaDistanciaKm=0; ultimaTarifa=0; ultimaTipo='—';
        if ($('origen')) $('origen').value=''; if ($('destino')) $('destino').value='';
        if ($('tipoTrufi')) $('tipoTrufi').value='—';
        if ($('tarifaCalc')) $('tarifaCalc').value='—';
        if ($('distancia')) $('distancia').value='0';
        if ($('tiempo')) $('tiempo').value='—';
        if ($('precio')) $('precio').value='—';
    }

    function accionClearHistory(){
        if (!confirm('Borrar todo el historial local?')) return;
        localStorage.removeItem('historial_rutas_v1');
        renderHistorial();
    }

    // enlaces botones (si no existen, no rompen)
    if ($('btnBuscarRuta')) $('btnBuscarRuta').addEventListener('click', accionBuscarRuta);
    if ($('btnCalcularServer')) $('btnCalcularServer').addEventListener('click', accionCalcularServer);
    if ($('btnReiniciar')) $('btnReiniciar').addEventListener('click', accionReiniciar);
    if ($('btnClearHistory')) $('btnClearHistory').addEventListener('click', accionClearHistory);

    // soporte teclas Enter para inputs: Enter en origen/destino hará búsqueda
    if ($('origen')) $('origen').addEventListener('keydown', (e)=>{ if (e.key==='Enter') accionBuscarRuta(); });
    if ($('destino')) $('destino').addEventListener('keydown', (e)=>{ if (e.key==='Enter') accionBuscarRuta(); });

    // ---------- HISTORIAL UI ----------
    function renderHistorial(){
        const cont = $('historial'); if (!cont) return;
        const raw = obtenerHistorial();
        cont.innerHTML='';
        raw.forEach((r, idx) => {
            const div = document.createElement('div'); div.className='item';
            div.innerHTML = `<div style="font-weight:700">${r.origen.nombre} → ${r.destino.nombre}</div>
                <div style="font-size:12px;color:#ccc">Dist ${r.distancia} km · ${r.tiempo} · Bs ${Number(r.precio).toFixed(2)}</div>
                <div style="font-size:11px;color:#999">${new Date(r.fecha).toLocaleString()}</div>`;
            div.addEventListener('click', ()=> {
                // redibujar ruta desde historial
                if (r.origen && r.destino && r.origen.coord && r.destino.coord) {
                    dibujarRutaCoords(r.origen.coord, r.destino.coord, true);
                    if ($('origen')) $('origen').value = r.origen.nombre || '';
                    if ($('destino')) $('destino').value = r.destino.nombre || '';
                }
            });
            cont.appendChild(div);
        });
    }
    renderHistorial();

    // ---------- Day / Night toggle (map tiles + panel theme) ----------
    function setTheme(isLight){
        const panel = $('side-panel');
        if (!panel) return;
        if (isLight) panel.classList.remove('dark'), panel.classList.add('light'), map.addLayer(tilesDay), map.removeLayer(tilesDark);
        else panel.classList.remove('light'), panel.classList.add('dark'), map.addLayer(tilesDark), map.removeLayer(tilesDay);
        try { localStorage.setItem('theme_v1', isLight ? 'light' : 'dark'); } catch(e){}
        try { map.invalidateSize(); } catch(e){}
    }
    if ($('btnToggleTheme')) {
        $('btnToggleTheme').addEventListener('click', ()=>{
            const panel = $('side-panel');
            const isNowLight = panel && panel.classList.contains('dark');
            setTheme(isNowLight);
        });
    }
    // aplicar preferencia guardada
    try {
        const pref = localStorage.getItem('theme_v1');
        if (pref === 'light') setTheme(true); else setTheme(false);
    } catch(e){ setTheme(false); }

    // ---------- RESIZER ----------
    (function initResizer(){
        const panel = $('side-panel'), resizer = $('resizer');
        if (!panel || !resizer) return;
        // aplicar ancho guardado
        const ancho = leerAnchoPanel();
        if (ancho) panel.style.width = ancho + 'px';
        let down=false;
        resizer.addEventListener('mousedown',(e)=>{ down=true; document.body.style.cursor='col-resize'; });
        document.addEventListener('mousemove',(e)=>{
            if (!down) return;
            const nx = e.clientX;
            if (nx > 200 && nx < 900) { panel.style.width = nx + 'px'; try{ guardarAnchoPanel(nx); map.invalidateSize(); }catch(e){} }
        });
        document.addEventListener('mouseup',()=>{ down=false; document.body.style.cursor='default'; });
    })();

    // ---------- UTIL: geocodificarPrimero (expuesta arriba pero define aquí) ----------
    async function geocodificarPrimero(texto){
        const arr = await nominatimSearch(texto,1);
        if (!arr || arr.length===0) return null;
        return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display: arr[0].display_name };
    }

    // ---------- Ajuste final del mapa al cargar ----
    try { setTimeout(()=>map.invalidateSize(), 300); } catch(e){}

}); // DOMContentLoaded end
