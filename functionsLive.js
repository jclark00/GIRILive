let groupIcon = null;
let equipmentIcon = null;
let movementTrackIcon = null;
let movementUploadIcon = null;
let slideOutPanel = null;
let iconBar = null;
let expandToggle = null;
let workingCSV = []; // workingCSV variable
let mapMarkers = {}; //  map markers 
let map; //  map variable
let userPolygon = null; //  user-drawn polygon
let addToListButton; 
let breadcrumbSettings = {}; // breadcrumb settings for each emitter
let movementTracks = {}; // movement track settings for each emitter (breadcrumb/trace)
let movementTrackActive = false;
let selectedMovementEmitterId = null;
let pendingTracePath = null; // array of LatLngs from last drawn trace
let pendingTraceLayer = null;
let emitterMovement = {}; // emitter movement data
let playIntervals = {}; // intervals for each emitter
let emitterStates = {}; // the state (Active/Silence) of each emitter

const activeIconPath = './pictures/active.png';
const silenceIconPath = './pictures/icon2.png'; 
const systemOptions = {
	"RU": {
		"SAM": ["S-300", "S-400", "S-500", "Buk-M3", "Tor-M2", "Pantsir-S1"],
		"EW": ["Krasukha", "Murmansk-BN", "Leer-3", "Moskva-1", "Divnomorye"],
		"TBM": ["Iskander-M", "SS-26 Stone", "Tochka-U"],
		"EMW": ["EMW-Alpha", "EMW-Beta", "EMW-Gamma"],
		"MARITIME": ["Admiral Gorshkov", "Admiral Kuznetsov", "Kirov-Class", "Slava-Class"],
		"AIR": ["Su-35", "MiG-31", "Su-57", "Su-30SM", "MiG-29"]
	},
	"CN": {
		"SAM": ["HQ-9", "HQ-22", "HQ-16", "HQ-7", "HQ-6", "TEL"],
		"EW": ["JY-27A", "DF-16 EW", "Type 305B", "Type 309A", "Type 310C"],
		"TBM": ["DF-21D", "DF-26", "DF-31", "DF-41"],
		"EMW": ["EMW-Dragon", "EMW-Tiger", "EMW-Phoenix"],
		"MARITIME": ["Type 055", "Type 052D", "Type 071", "Type 075"],
		"AIR": ["J-20", "J-10C", "J-16", "J-11B", "JH-7A"]
	}
	// Expand with other countries as needed
};
function initializeMap() {
    console.log('initializeMap started');
    if (!map) {
        map = L.map('map').setView([15.0, 100.0], 4);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(map);
        console.log('Tile layer added');
        console.log('Map size:', map.getSize());
        setTimeout(() => { map.invalidateSize(); console.log('Map size invalidated'); }, 500);

        // Right-click to copy coordinates
        map.on("contextmenu", function(e) {
            const latlng = e.latlng;
            const coord = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
            navigator.clipboard.writeText(coord).then(function() {
                alert("Copied the coordinate: " + coord);
            }, function(err) {
                console.error("Could not copy text: ", err);
            });
        });

        // Initialize the draw control and pass it the FeatureGroup of editable layers
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        const drawControl = new L.Control.Draw({
            edit: {
                featureGroup: drawnItems
            },
            draw: {
                polygon: true,
                polyline: false,
                rectangle: false,
                circle: false,
                marker: false,
                circlemarker: false
            }
        });
        map.addControl(drawControl);
		
        // Event handler for when shapes are created (Polygon for AOI, Polyline for Trace paths)
        map.on(L.Draw.Event.CREATED, function(event) {
            const layer = event.layer;
            const layerType = event.layerType;

            // TRACE PATH (polyline)
            if (layerType === 'polyline') {
                // Keep only one pending trace visible at a time
                if (pendingTraceLayer) {
                    try { map.removeLayer(pendingTraceLayer); } catch (e) {}
                }
                pendingTraceLayer = layer;
                pendingTracePath = layer.getLatLngs();

                drawnItems.addLayer(layer);
                updateMovementPanelTracePreview();
                return;
            }

            // AOI (polygon) - existing behavior
            if (layerType === 'polygon') {
                if (userPolygon) {
                    map.removeLayer(userPolygon);
                }

                userPolygon = layer;
                drawnItems.addLayer(layer);

                // Enable the "Add to List" button
                addToListButton.disabled = false;
            }
        });

		plotEmitters();
		startMovementTicker();
	};
}

function plotEmitters() {
    console.log('Plot emitters called');
    clearMapMarkers();
    workingCSV.forEach((row, index) => {
        const [lat, lon] = row.location.split(',').map(Number); // Ensure correct parsing
        const isActive = emitterStates[row.uniqueID] !== 'Silence';

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="custom-icon"><img src="${isActive ? activeIconPath : silenceIconPath}" alt="icon"><span>${row.emitterName}</span></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        const marker = L.marker([lat, lon], { draggable: true, icon: customIcon }).addTo(map);

		
		const popupContent = window.createMarkerPopupContent(index);
        marker.bindPopup(popupContent);

        // If Movement Track mode is active, clicking a marker selects it for movement configuration
        marker.on('click', () => {
            if (movementTrackActive) {
                selectedMovementEmitterId = row.uniqueID;
                updateMovementPanelSelectionDisplay();
            }
        });

        marker.on("dragend", function(e) {
            const latlng = e.target.getLatLng();
            const newLocation = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`; // Ensure no space between lat and lon
            row.location = newLocation;
            row.mgrs = convertLocationToMGRS(newLocation);
            updateLocationBox(newLocation, index);
        });
        mapMarkers[index] = marker;
    });
}

window.createMarkerPopupContent = function(index) {
    const popupContainer = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = workingCSV[index]?.emitterName || 'Emitter';

    const silenceButton = document.createElement('button');
    silenceButton.textContent = 'Silence';
    silenceButton.addEventListener('click', () => {
        toggleEmitterState(workingCSV[index]?.uniqueID, index);
    });

    const selectButton = document.createElement('button');
    selectButton.textContent = 'Select';
    selectButton.style.marginLeft = '5px';
    selectButton.addEventListener('click', () => {
        const tableRows = document.querySelectorAll('#working-csv-preview tr');
        tableRows.forEach(row => row.classList.remove('selected'));
        const targetRow = tableRows[parseInt(index) + 1];
        if (targetRow) {
            targetRow.classList.add('selected');
            targetRow.style.backgroundColor = 'lightcoral';
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    popupContainer.appendChild(title);
    popupContainer.appendChild(document.createElement('br'));
    popupContainer.appendChild(silenceButton);
    popupContainer.appendChild(selectButton);

    return popupContainer;
};


function getEmitterPopupContent(row, index) {
    const isActive = emitterStates[row.uniqueID] !== 'Silence';
    return `
        <div>
            <strong>${row.emitterName}</strong>
            <br>
            <button onclick="toggleEmitterState('${row.uniqueID}', ${index})">${isActive ? 'Silence' : 'Active'}</button>
        </div>
    `;
}

function toggleEmitterState(uniqueID, index) {
    const currentState = emitterStates[uniqueID];
    emitterStates[uniqueID] = currentState === 'Silence' ? 'Active' : 'Silence';

    const marker = mapMarkers[index];
    marker.setPopupContent(getEmitterPopupContent(workingCSV[index], index));
    marker.setIcon(L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="custom-icon"><img src="${emitterStates[uniqueID] === 'Active' ? activeIconPath : silenceIconPath}" alt="icon"><span>${workingCSV[index].emitterName}</span></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    }));
    marker.openPopup();

    if (emitterStates[uniqueID] === 'Silence') {
        clearInterval(playIntervals[uniqueID]);
        delete playIntervals[uniqueID];
    } else {
        startBursting(workingCSV[index]);
    }
}

function updateCSVPreview() {
    const workingCSVPreview = document.getElementById('working-csv-preview');
    if (workingCSV.length === 0) {
        workingCSVPreview.innerHTML = '<p>No data added yet.</p>';
        return;
    }

    const table = document.createElement('table');
    table.style.width = '100%'; // Make table full width
    table.style.tableLayout = 'fixed'; // Ensure consistent column width
    const headerRow = document.createElement('tr');
    const headers = [
        { text: 'Select', width: '5%' },
        { text: 'System Type', width: '10%' },
        { text: 'System Name', width: '10%' },
        { text: 'Emitter Name', width: '10%' },
        { text: 'ELNOT', width: '10%' },
        { text: 'Frequency', width: '10%' },
        { text: 'Maj', width: '5%' },
        { text: 'Min', width: '5%' },
        { text: 'Ori', width: '5%' },
        { text: 'Location', width: '10%' },
        { text: 'Unique ID', width: '10%' },
        { text: 'Breadcrumb', width: '10%' }
    ];
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.text;
        th.style.width = header.width;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    workingCSV.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.addEventListener('click', () => {
            tr.classList.toggle('selected');
        });

        const selectTd = document.createElement('td');
        const selectCheckbox = document.createElement('input');
        selectCheckbox.type = 'checkbox';
        selectTd.appendChild(selectCheckbox);
        tr.appendChild(selectTd);

        // Adjusted to omit the MGRS column
        const keys = Object.keys(row).filter(key => key !== 'mgrs' && key !== 'breadcrumb');
        keys.forEach((key, idx) => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.value = row[key];
            input.style.width = '100%'; // Make input full width
            input.style.boxSizing = 'border-box'; // Include padding and border in element's total width
            if (headers[idx + 1]?.text === 'Location') {
                input.classList.add('location-input');
            }
            input.addEventListener('change', () => {
                workingCSV[index][key] = input.value;
                if (key === 'location') {
                    row.mgrs = convertLocationToMGRS(input.value);
                }
            });
            td.appendChild(input);
            tr.appendChild(td);
        });

        const breadcrumbTd = document.createElement('td');
        breadcrumbTd.textContent = row.breadcrumb === "Yes" ? "Yes" : "No";
        tr.appendChild(breadcrumbTd);

        table.appendChild(tr);
    });

    workingCSVPreview.innerHTML = '';
    workingCSVPreview.appendChild(table);
}




function updateMovementPanelSelectionDisplay() {
    const el = document.getElementById('movement-selected');
    if (!el) return;

    const row = selectedMovementEmitterId ? workingCSV.find(r => r.uniqueID === selectedMovementEmitterId) : null;
    el.textContent = row ? `Selected: ${row.emitterName}` : 'Selected: (none) - click a marker on the map';
}


function updateMovementPanelTracePreview() {
    const el = document.getElementById('movement-trace-preview');
    if (!el) return;

    if (!pendingTracePath || pendingTracePath.length < 2) {
        el.textContent = 'Path: (none)';
        return;
    }

    // Approx length in meters (Leaflet distance)
    let meters = 0;
    for (let i = 1; i < pendingTracePath.length; i++) {
        meters += L.latLng(pendingTracePath[i-1]).distanceTo(pendingTracePath[i]);
    }
    el.textContent = `Path: ${pendingTracePath.length} pts, ~${Math.round(meters)} m`;
}


function startTraceDrawing() {
    if (!map || !L || !L.Draw || !L.Draw.Polyline) {
        alert('Trace drawing is not ready yet.');
        return;
    }
    try {
        const drawer = new L.Draw.Polyline(map, {
            shapeOptions: { weight: 3 }
        });
        drawer.enable();
    } catch (e) {
        console.error('Failed to start trace drawing:', e);
        alert('Failed to start trace drawing.');
    }
}

function clearMapMarkers() {
    Object.values(mapMarkers).forEach(marker => {
        marker.remove();
    });
    mapMarkers = {};
}

function handlePlayData() {
    workingCSV.forEach(startBursting);
}

function handlePauseData() {
    Object.values(playIntervals).forEach(interval => clearInterval(interval));
    playIntervals = {};
}

function handleStopData() {
    handlePauseData();
    workingCSV.forEach(row => {
        clearInterval(playIntervals[row.uniqueID]);
        delete playIntervals[row.uniqueID];
    });
    workingCSV = [];
    clearMapMarkers();
    updateCSVPreview();
}

function deleteSelectedEmitters() {
    const selectedRows = document.querySelectorAll('#working-csv-preview tr.selected');
    const indicesToRemove = Array.from(selectedRows).map(row => Array.from(row.parentElement.children).indexOf(row) - 1);

    indicesToRemove.forEach(index => {
        const row = workingCSV[index];
        clearInterval(playIntervals[row.uniqueID]);
        delete playIntervals[row.uniqueID];
    });

    workingCSV = workingCSV.filter((_, index) => !indicesToRemove.includes(index));
    clearMapMarkers();
    updateCSVPreview();
    plotEmitters();
}

function sendIrcMessage(row) {
    const dateTime = new Date().toISOString(); // Generate the current date-time
    const system = row.systemType;
    const emitterName = row.emitterName;
    const elnot = row.elnot;
    const maj = row.maj;
    const min = row.min;
    const ori = row.ori;
    const fre = row.freq;
    const mgrs = row.mgrs; // Converted MGRS coordinates

    const message = `${dateTime} // ${system} // ${emitterName} // ${elnot} // ${maj} // ${min} // ${ori} // ${fre} // ${mgrs} // ${row.location}`;
    
    fetch('http://localhost:3000/send-message', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: message })
    })
    .then(response => {
        if (response.ok) {
            console.log('Message sent successfully:', message);
        } else {
            console.error('Failed to send message:', message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

function startBursting(row) {
    if (emitterStates[row.uniqueID] === 'Silence') {
        return;
    }

    const burstInterval = getRandomDelay(60, 120);
    playIntervals[row.uniqueID] = setInterval(() => {
        if (emitterStates[row.uniqueID] === 'Silence') {
            clearInterval(playIntervals[row.uniqueID]);
            return;
        }

        const burstCount = Math.floor(Math.random() * 4) + 2; // Random number between 2 and 5

        const minToleranceInput = document.getElementById('min-tolerance').value;
        const maxToleranceInput = document.getElementById('max-tolerance').value;
        const minTolerance = parseFloat(minToleranceInput) || 1.50;
        const maxTolerance = parseFloat(maxToleranceInput) || 15.00;

        // --- Movement update (Movement Track / Breadcrumb) ---
        const track = movementTracks[row.uniqueID] || null;

        let newLocationCoords = null;

        // Movement Track: straight-line breadcrumb
        if (track && track.type === 'breadcrumb') {
            const elapsedHours = (Date.now() - track.startTime) / 3600000;
            const [baseLat, baseLon] = (track.initialLocation || row.location).split(',').map(Number);
            newLocationCoords = calculateNewLocation(baseLat, baseLon, track.headingDeg, track.speedKmh, elapsedHours);
        }

        // Movement Track: trace along drawn path
        if (!newLocationCoords && track && track.type === 'trace') {
            const elapsedSeconds = (Date.now() - track.startTime) / 1000;
            const distanceMeters = elapsedSeconds * (track.speedMps || 0);
            const pt = pointAlongPathMeters(track.pathLatLngs, distanceMeters);
            if (pt) newLocationCoords = pt;
        }

        // Backwards-compat: old breadcrumbSettings
        if (!newLocationCoords && breadcrumbSettings[row.uniqueID]) {
            const { heading, speed, startTime, initialLocation } = breadcrumbSettings[row.uniqueID] || {};
            const elapsedHours = (Date.now() - startTime) / 3600000;
            const [baseLat, baseLon] = (initialLocation || row.location).split(',').map(Number);
            newLocationCoords = calculateNewLocation(baseLat, baseLon, heading, speed, elapsedHours);
        }

        // Default: no movement
        if (!newLocationCoords) {
            newLocationCoords = row.location.split(',').map(Number);
        }

        emitterMovement[row.uniqueID] = { updatedLocation: `${newLocationCoords[0].toFixed(6)},${newLocationCoords[1].toFixed(6)}` };
        row.location = `${newLocationCoords[0].toFixed(6)},${newLocationCoords[1].toFixed(6)}`;
        row.mgrs = convertLocationToMGRS(row.location);
        updateLocationBox(row.location, workingCSV.indexOf(row));
        updateMapMarkerPosition(row.uniqueID, newLocationCoords);

        for (let i = 0; i < burstCount; i++) {
            const maj = (Math.random() * (maxTolerance - minTolerance) + minTolerance).toFixed(3);
            const min = (Math.random() * 0.75 * maj).toFixed(3);
            const ori = (Math.random() * 179 + 1).toFixed(3);

            const burstLocation = generateRandomLatLonNearby(newLocationCoords[0], newLocationCoords[1], 1000);
            row.location = burstLocation;
            row.mgrs = convertLocationToMGRS(burstLocation);
            row.maj = maj;
            row.min = min;
            row.ori = ori;
            sendIrcMessage(row); // Send message with all required fields
        }
    }, burstInterval);
}

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}


function pointAlongPathMeters(pathLatLngs, distanceMeters) {
    if (!Array.isArray(pathLatLngs) || pathLatLngs.length === 0) return null;
    if (pathLatLngs.length === 1) return [pathLatLngs[0].lat, pathLatLngs[0].lng];

    let remaining = distanceMeters;
    for (let i = 1; i < pathLatLngs.length; i++) {
        const a = L.latLng(pathLatLngs[i-1]);
        const b = L.latLng(pathLatLngs[i]);
        const seg = a.distanceTo(b);
        if (seg <= 0) continue;

        if (remaining <= seg) {
            const t = remaining / seg;
            const lat = a.lat + (b.lat - a.lat) * t;
            const lng = a.lng + (b.lng - a.lng) * t;
            return [lat, lng];
        }
        remaining -= seg;
    }

    // Past the end -> clamp to final point
    const last = pathLatLngs[pathLatLngs.length - 1];
    return [last.lat, last.lng];
}


let movementTickerInterval = null;

function startMovementTicker() {
    if (movementTickerInterval) return;
    // Update moving equipment positions every ~15 seconds (independent of burst messaging).
    movementTickerInterval = setInterval(() => {
        try {
            updateAllMovementTracks();
        } catch (e) {
            console.error('Movement ticker error:', e);
        }
    }, 15000);
}

function updateAllMovementTracks() {
    if (!Array.isArray(workingCSV) || workingCSV.length === 0) return;
    if (!movementTracks || Object.keys(movementTracks).length === 0) return;
    if (!map || !mapMarkers) return;

    Object.entries(movementTracks).forEach(([uid, track]) => {
        if (!track) return;
        const row = workingCSV.find(r => r.uniqueID === uid);
        if (!row) return;

        let newLocationCoords = null;

        if (track.type === 'breadcrumb') {
            const elapsedHours = (Date.now() - track.startTime) / 3600000;
            const [baseLat, baseLon] = (track.initialLocation || row.location).split(',').map(Number);
            newLocationCoords = calculateNewLocation(baseLat, baseLon, track.headingDeg, track.speedKmh, elapsedHours);
        }

        if (!newLocationCoords && track.type === 'trace') {
            const elapsedSeconds = (Date.now() - track.startTime) / 1000;
            const distanceMeters = elapsedSeconds * (track.speedMps || 0);
            newLocationCoords = pointAlongPathMeters(track.pathLatLngs || [], distanceMeters);
        }

        if (!newLocationCoords) return;

        row.location = `${newLocationCoords[0].toFixed(6)},${newLocationCoords[1].toFixed(6)}`;
        row.mgrs = convertLocationToMGRS(row.location);

        const rowIndex = workingCSV.indexOf(row);
        const marker = mapMarkers[uid] || mapMarkers[rowIndex];
        if (marker) {
            marker.setLatLng(new L.LatLng(newLocationCoords[0], newLocationCoords[1]));
        }});

    // If the CSV table is visible, refresh it so users see locations update.
    if (typeof updateCSVTable === 'function') {
        try { updateCSVTable(); } catch (_) {}
    }
}

function calculateNewLocation(lat, lon, heading, speed, timeElapsed) {
    const R = 6371; // Radius of the Earth in kilometers
    const distance = (speed * timeElapsed); // speed: km/h, timeElapsed: hours -> distance in km

    const headingRad = (heading * Math.PI) / 180;

    const newLat = lat + (distance / R) * (180 / Math.PI) * Math.cos(headingRad);
    const newLon = lon + (distance / R) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180) * Math.sin(headingRad);

    return [newLat, newLon];
}

function generateRandomLatLonInPolygon(polygon) {
    let point;
    do {
        point = turf.randomPoint(1, { bbox: turf.bbox(polygon.toGeoJSON()) }).features[0].geometry.coordinates;
    } while (!turf.booleanPointInPolygon(point, polygon.toGeoJSON()));
    const latlng = L.latLng(point[1], point[0]);
    return `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
}

function generateRandomLatLonNearby(lat, lon, maxDistanceFeet = 1000) {
    const maxDistanceMeters = maxDistanceFeet * 0.3048;
    const randomDistance = Math.random() * maxDistanceMeters;
    const randomAngle = Math.random() * 2 * Math.PI;
    const deltaLat = randomDistance * Math.cos(randomAngle) / 111320; // Approx conversion from meters to degrees
    const deltaLon = randomDistance * Math.sin(randomAngle) / (111320 * Math.cos(lat * Math.PI / 180));
    return `${(lat + deltaLat).toFixed(6)},${(lon + deltaLon).toFixed(6)}`;
}

function generateUniqueID() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return id;
}

function convertLocationToMGRS(location) {
    const [lat, lon] = location.split(',').map(Number);
    if (typeof mgrs !== 'undefined' && typeof mgrs.forward === 'function') {
        return mgrs.forward([lon, lat]);
    } else {
        console.warn('MGRS library is not loaded. Returning raw coordinates.');
        return location;
    }
}



// ===============================
// Bulk equipment CSV import helpers
// ===============================
function giriGetEquipmentImportTemplateCSV() {
    // NOTE: location contains a comma, so it must be quoted in CSV.
    return [
        'systemType,systemName,emitterName,elnot,freq,maj,min,ori,location,uniqueID',
        'SAM,HQ-9,HQ-9-EXAMPLE,ELN00001,9500,1.000,0.500,90.000,"15.000000,100.000000",AB12cd34',
        'EW,Krasukha,,,,"1.000","0.500","90.000","14.500000,100.250000",'
    ].join('\n');
}

function renderUploadPanel() {
  const panelContent = document.getElementById('slide-out-panel-content');
  if (!panelContent) return;

  panelContent.innerHTML = `
    <h3 style="margin-top:0;">Import Equipment to Map</h3>

    <div style="font-size:12px; opacity:.85; margin-bottom:10px;">
      Upload a CSV to bulk place equipment on the map. Required columns:
      <code>systemType</code>, <code>systemName</code>, and <code>location</code> (<code>lat,lon</code>).
      Optional columns: <code>emitterName</code>, <code>elnot</code>, <code>freq</code>, <code>maj</code>, <code>min</code>, <code>ori</code>, <code>uniqueID</code>.
    </div>

    <button id="download-import-template-btn">Download CSV Template</button>

    <div style="margin-top:12px;">
      <label style="display:block; margin: 8px 0 6px;">Choose CSV file</label>
      <input id="import-csv-file" type="file" accept=".csv,text/csv" />
    </div>

    <div style="margin-top:10px;">
      <label style="display:flex; align-items:center; gap:8px; font-size:12px;">
        <input id="import-clear-existing" type="checkbox" />
        Clear existing equipment before import
      </label>
    </div>

    <div style="display:flex; gap:8px; margin-top:12px;">
      <button id="run-import-btn" class="blue-green">Import</button>
    </div>

    <div id="import-status" style="margin-top:12px; font-size:12px; opacity:.9;"></div>
  `;

  const status = document.getElementById('import-status');

  document.getElementById('download-import-template-btn')?.addEventListener('click', () => {
    giriDownloadTextFile('giri_equipment_import_template.csv', giriGetEquipmentImportTemplateCSV(), 'text/csv');
  });

  document.getElementById('run-import-btn')?.addEventListener('click', () => {
    const fileInput = document.getElementById('import-csv-file');
    const clearExisting = document.getElementById('import-clear-existing')?.checked;

    if (!fileInput?.files?.length) {
      if (status) status.textContent = 'Select a CSV file first.';
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = giriParseCSV(text);

        if (!parsed.rows.length) {
          if (status) status.textContent = 'No data rows found in CSV.';
          return;
        }

        const result = giriApplyImportedEquipmentRows(parsed.rows, { clearExisting: !!clearExisting });

        if (status) {
          if (result.errors.length) {
            status.innerHTML = `
              Imported <b>${result.added}</b> row(s). <b>${result.errors.length}</b> row(s) skipped.<br/>
              <span style="opacity:.85;">First issue: ${result.errors[0]}</span>
            `;
          } else {
            status.innerHTML = `Imported <b>${result.added}</b> row(s).`;
          }
        }
      } catch (e) {
        console.error('Import failed:', e);
        if (status) status.textContent = 'Import failed (see console).';
      }
    };

    reader.onerror = () => {
      if (status) status.textContent = 'Failed to read the file.';
    };

    reader.readAsText(file);
  });
}

// Minimal CSV parser with quoted field support (RFC4180-ish).
function giriParseCSV(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return { headers: [], rows: [] };

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];

    if (inQuotes) {
      if (c === '"') {
        // Escaped quote
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += c;
  }

  // last field
  row.push(field);
  rows.push(row);

  const headers = (rows.shift() || []).map(h => String(h || '').trim());
  const dataRows = rows
    .filter(r => r.some(v => String(v || '').trim() !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { if (h) obj[h] = (r[idx] ?? '').toString().trim(); });
      return obj;
    });

  return { headers, rows: dataRows };
}

function giriApplyImportedEquipmentRows(rows, opts) {
  const errors = [];
  let added = 0;

  if (opts?.clearExisting) {
    workingCSV.length = 0;
    // Best effort: clear marker layers / state if your existing code tracks them.
    try {
      if (typeof emitterMarkers !== 'undefined' && emitterMarkers?.clearLayers) emitterMarkers.clearLayers();
    } catch (_) {}
  }

  rows.forEach((r, idx) => {
    const rowNum = idx + 2; // +1 header, 1-based
    const systemType = (r.systemType || r.type || '').trim();
    const systemName = (r.systemName || r.system || '').trim();

    let location = (r.location || '').trim();
    const lat = (r.lat || r.latitude || '').toString().trim();
    const lon = (r.lon || r.longitude || '').toString().trim();

    if (!location && lat && lon) location = `${lat},${lon}`;

    if (!systemType) { errors.push(`Row ${rowNum}: missing systemType`); return; }
    if (!systemName) { errors.push(`Row ${rowNum}: missing systemName`); return; }
    if (!location) { errors.push(`Row ${rowNum}: missing location (lat,lon)`); return; }

    const parts = location.split(',').map(x => x.trim());
    if (parts.length !== 2) { errors.push(`Row ${rowNum}: invalid location '${location}'`); return; }
    const latNum = parseFloat(parts[0]);
    const lonNum = parseFloat(parts[1]);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) { errors.push(`Row ${rowNum}: invalid lat/lon '${location}'`); return; }

    const normalizedLoc = `${latNum.toFixed(6)},${lonNum.toFixed(6)}`;

    const uniqueID = (r.uniqueID || '').trim() || generateUniqueID();
    const emitterName = (r.emitterName || '').trim() || `${systemName}-${uniqueID}`;
    const elnot = (r.elnot || '').trim() || generateUniqueID();
    const freq = (r.freq || '').trim() || Math.floor(Math.random() * 10000).toString();
    const maj = (r.maj || '').trim() || '1.000';
    const min = (r.min || '').trim() || '0.500';
    const ori = (r.ori || '').trim() || '90.000';

    const emitter = {
      systemType,
      systemName,
      emitterName,
      elnot,
      freq,
      maj,
      min,
      ori,
      location: normalizedLoc,
      uniqueID,
      mgrs: convertLocationToMGRS(normalizedLoc)
    };

    workingCSV.push(emitter);
    if (typeof emitterStates !== 'undefined') emitterStates[uniqueID] = 'Active';
    added++;
  });

  // Refresh UI/map the same way other add flows do.
  try { if (typeof updateCSVPreview === 'function') updateCSVPreview(); } catch (_) {}
  try { if (typeof plotEmitters === 'function') plotEmitters(); } catch (_) {}

  return { added, errors };
}


function giriDownloadTextFile(filename, text, mimeType = 'text/plain') {
    try {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
        console.error('Download failed:', e);
        alert('Download failed (see console).');
    }
}

// Lightweight CSV parsing with quoted-field support.
function giriParseCSV(text) {
    const rows = [];
    const lines = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .filter(l => l.trim().length > 0);

    if (lines.length === 0) return rows;

    const headers = giriParseCSVLine(lines[0]).map(h => h.trim());
    for (let i = 1; i < lines.length; i++) {
        const cols = giriParseCSVLine(lines[i]);
        // Skip fully blank lines
        if (cols.every(c => String(c).trim() === '')) continue;

        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? '').trim(); });
        rows.push(obj);
    }
    return { headers, rows };
}

function giriParseCSVLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '"') {
            // Escaped quote
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
            continue;
        }

        cur += ch;
    }
    out.push(cur);
    return out;
}

function giriNormalizeImportedEmitter(row) {
    // Required fields
    const systemType = (row.systemType || row.type || '').trim();
    const systemName = (row.systemName || row.system || '').trim();

    // Location: allow either a single "lat,lon" field or separate lat/lon columns.
    let location = (row.location || '').trim();
    if (!location && (row.lat || row.lon)) {
        const lat = String(row.lat || '').trim();
        const lon = String(row.lon || '').trim();
        if (lat && lon) location = `${lat},${lon}`;
    }

    if (!systemType || !systemName || !location) {
        return { error: 'Missing required field(s): systemType, systemName, location (or lat+lon).' };
    }

    // Parse location to ensure it is valid
    const parts = location.split(',').map(s => s.trim());
    if (parts.length !== 2) return { error: `Invalid location format: "${location}" (expected "lat,lon")` };

    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: `Invalid numeric lat/lon in "${location}"` };

    const fixedLocation = `${lat.toFixed(6)},${lon.toFixed(6)}`;

    // Optional fields with sensible defaults
    const uniqueID = (row.uniqueID || row.id || '').trim() || generateUniqueID();
    const emitterName = (row.emitterName || row.name || '').trim() || `${systemName}-${generateUniqueID()}`;
    const elnot = (row.elnot || row.elnt || '').trim() || generateUniqueID();
    const freq = (row.freq || row.frequency || '').trim() || Math.floor(Math.random() * 10000).toString();
    const maj = (row.maj || '').trim() || '1.000';
    const min = (row.min || '').trim() || '0.500';
    const ori = (row.ori || row.orient || '').trim() || '90.000';

    const emitter = {
        systemType,
        systemName,
        emitterName,
        elnot,
        freq,
        maj,
        min,
        ori,
        location: fixedLocation,
        uniqueID,
        mgrs: convertLocationToMGRS(fixedLocation)
    };

    return { emitter };
}

function giriClearAllEquipment() {
    try { handlePauseData(); } catch (_) {}
    // Clear any per-emitter intervals & states safely
    try {
        Object.values(playIntervals || {}).forEach(iv => { try { clearInterval(iv); } catch (_) {} });
        playIntervals = {};
    } catch (_) {}

    workingCSV = [];
    emitterStates = {};
    emitterMovement = {};
    movementTracks = {};
    breadcrumbSettings = {};
    pendingTracePath = null;
    pendingTraceLayer = null;

    try { clearMapMarkers(); } catch (_) {}
    try { updateCSVPreview(); } catch (_) {}
    try { plotEmitters(); } catch (_) {}
}

function giriImportEquipmentFromCSVText(csvText, options = {}) {
    const { clearExisting = false } = options || {};
    const parsed = giriParseCSV(csvText);
    const rows = parsed.rows || [];

    if (!rows.length) {
        return { ok: false, message: 'No data rows found in CSV.' };
    }

    if (clearExisting) {
        giriClearAllEquipment();
    }

    const errors = [];
    let added = 0;

    rows.forEach((row, idx) => {
        const norm = giriNormalizeImportedEmitter(row);
        if (norm.error) {
            errors.push(`Row ${idx + 2}: ${norm.error}`);
            return;
        }

        const emitter = norm.emitter;

        workingCSV.push(emitter);
        emitterStates[emitter.uniqueID] = 'Active';
        added++;
    });

    updateCSVPreview();
    plotEmitters();

    return {
        ok: errors.length === 0,
        added,
        errors
    };
}
// ===============================
// End bulk equipment CSV import helpers
// ===============================


function updateLocationBox(newLocation, index) {
    const locationInput = document.querySelector(`#working-csv-preview tr:nth-child(${index + 2}) input.location-input`);
    if (locationInput) {
        locationInput.value = newLocation;
    }
}

function updateMapMarkerPosition(uniqueID, newLocationCoords) {
    const index = workingCSV.findIndex(row => row.uniqueID === uniqueID);
    if (index !== -1) {
        const marker = mapMarkers[index];
        if (marker) {
            marker.setLatLng(new L.LatLng(newLocationCoords[0], newLocationCoords[1]));
        }
    }
}




document.addEventListener('DOMContentLoaded', function() {
    const mapElement = document.getElementById('map');
    if (mapElement) {
        console.log('#map element is present in the DOM.');
        console.log('Map clientWidth:', mapElement.clientWidth);
        console.log('Map clientHeight:', mapElement.clientHeight);

        let parent = mapElement.parentElement;
        let level = 0;
        while (parent) {
            console.log('Parent level', level, ' - tag:', parent.tagName, ' - clientWidth:', parent.clientWidth, ' - clientHeight:', parent.clientHeight);
            parent = parent.parentElement;
            level++;
        }
    } else {
        console.error('#map element is NOT present in the DOM.');
    }

    initializeMap();
});

document.addEventListener('DOMContentLoaded', function() {
  slideOutPanel = document.getElementById('slide-out-panel');
  equipmentIcon = document.getElementById('equipment-icon');
  groupIcon = document.getElementById('group-equipment-icon');
  iconBar = document.getElementById('icon-bar');
  expandToggle = document.getElementById('expand-toggle');

  let panelVisible = false;
  let expanded = false;
  let currentMode = null; // 'equipment' | 'group'

  // --- Group placement helpers ---
  let activeGroupPlacementHandler = null;

  function nmToMeters(nm) { return nm * 1852; }

  // Simple local tangent-plane approximation (good enough for ~tens of nm).
  function offsetLatLng(center, eastMeters, northMeters) {
    const latRad = center.lat * Math.PI / 180;
    const dLat = northMeters / 111320; // meters per degree latitude (approx)
    const dLng = eastMeters / (111320 * Math.cos(latRad));
    return { lat: center.lat + dLat, lng: center.lng + dLng };
  }

  function addEmitterWith(systemType, systemName, latlng) {
    const emitterName = `${systemName}-${generateUniqueID()}`;
    const elnot = generateUniqueID();
    const freq = Math.floor(Math.random() * 10000).toString();
    const location = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;

    const newEmitter = {
      systemType,
      systemName,
      emitterName,
      elnot,
      freq,
      maj: '1.000',
      min: '0.500',
      ori: '90.000',
      location,
      uniqueID: generateUniqueID(),
      mgrs: convertLocationToMGRS(location)
    };

    workingCSV.push(newEmitter);
  }

  function addNavalStrikeGroupAt(centerLatLng) {
    const center = { lat: centerLatLng.lat, lng: centerLatLng.lng };
    const r = nmToMeters(5); // center-to-ship distance
    const corner = r / Math.sqrt(2); // NE/NW/SE/SW so each is ~20nm from center

    // Center: Type 052D
    addEmitterWith('MARITIME', 'Type 052D', center);

    // Surrounding: 2x Type 071 + 2x Type 055 (arranged on corners)
    addEmitterWith('MARITIME', 'Type 071', offsetLatLng(center, -corner,  corner)); // NW
    addEmitterWith('MARITIME', 'Type 071', offsetLatLng(center,  corner, -corner)); // SE
    addEmitterWith('MARITIME', 'Type 055', offsetLatLng(center,  corner,  corner)); // NE
    addEmitterWith('MARITIME', 'Type 055', offsetLatLng(center, -corner, -corner)); // SW

    updateCSVPreview();
    plotEmitters();
  }
  
    function addSamConfigurationAt(centerLatLng) {
    const center = { lat: centerLatLng.lat, lng: centerLatLng.lng };

    // Place the battery center (HQ-9) and 8x TELs as 4 tight pairs around it.
    // Target radius: ~500 meters from the HQ-9, with a small angular/radial spread per pair
    // to resemble realistic "paired" launch positions.
    const radiusMeters = 100;

    // Four pair centers (degrees). 0° = north, clockwise.
    const pairCenterDeg = [45, 135, 225, 315]; // NE, SE, SW, NW

    // How close the two TELs are within each pair.
    const pairAngleSpreadDeg = 3;   // +/- degrees around the pair center
    const pairRadiusSpreadM = 3;   // +/- meters around the target radius

    // Center: HQ-9
    addEmitterWith('SAM', 'HQ-9', center);

    // Pairs: 2 TELs per pair center
    for (const deg of pairCenterDeg) {
      const anglesDeg = [deg - pairAngleSpreadDeg, deg + pairAngleSpreadDeg];
      const radii = [radiusMeters - pairRadiusSpreadM, radiusMeters + pairRadiusSpreadM];

      for (let i = 0; i < 2; i++) {
        const angleRad = (anglesDeg[i] * Math.PI) / 180;
        const east = radii[i] * Math.sin(angleRad);
        const north = radii[i] * Math.cos(angleRad);
        addEmitterWith('SAM', 'TEL', offsetLatLng(center, east, north));
      }
    }

    updateCSVPreview();
    plotEmitters();
  }

  function setPanelVisible(visible) {
    panelVisible = visible;
    slideOutPanel.style.display = visible ? 'block' : 'none';

	  // keep it aligned when opening too
    if (visible) {
    slideOutPanel.style.right = expanded ? '200px' : '50px';
	  }
	}
	function openMode(mode) {
	  // If panel is open and user clicked the same icon again -> close
	  if (panelVisible && currentMode === mode) {
		setPanelVisible(false);
		currentMode = null;
		movementTrackActive = false;
		return;
	  }

	  // Otherwise open (or switch modes)
	  currentMode = mode;
	  setPanelVisible(true);

	  movementTrackActive = (mode === 'movement');

	  if (mode === 'equipment') renderEquipmentPanel();
	  if (mode === 'group') renderGroupPanel();
	  if (mode === 'movement') renderMovementPanel();
  if (mode === 'upload') renderUploadPanel();
	}

	equipmentIcon?.addEventListener('click', () => {
	  console.log('Equipment icon clicked');
	  openMode('equipment');
	});

	groupIcon?.addEventListener('click', () => {
  console.log('Group icon clicked');
  openMode('group');
});

movementUploadIcon = document.getElementById('movement-upload-icon');
movementUploadIcon?.addEventListener('click', () => {
  console.log('Upload icon clicked');
  openMode('upload');
});

movementTrackIcon = document.getElementById('movement-track-icon');
	movementTrackIcon?.addEventListener('click', () => {
	  console.log('Movement Track icon clicked');
	  openMode('movement');
	});
	

  function renderGroupPanel() {
    const panelContent = document.getElementById('slide-out-panel-content');
    if (!panelContent) return;

	  panelContent.innerHTML = `
		<h3 style="margin-top:0;">Add Equipment Group</h3>

		<label style="display:block; margin: 10px 0 6px;">Preset</label>
		<select id="group-preset-select" style="width:100%;">
		  <option value="">Select preset...</option>
		  <option value="naval_strike_group">Naval Strike Group</option>
		  <option value="sam_battery">SAM Battery (example)</option>
		  <option value="ew_site">EW Site (example)</option>
		  <option value="mixed_pkg">Mixed Package (example)</option>
		</select>

		<div style="display:flex; gap:8px; margin-top:10px;">
		  <button id="preview-group-btn">Preview</button>
		  <button id="add-group-btn">Add Group</button>
		</div>

		<div id="group-preview" style="margin-top:10px; font-size:12px; opacity:.85;"></div>
	  `;

	  const sel = document.getElementById('group-preset-select');
	  const preview = document.getElementById('group-preview');

	  function clearActiveGroupPlacement() {
		if (activeGroupPlacementHandler && map) {
		  map.off('click', activeGroupPlacementHandler);
		}
		activeGroupPlacementHandler = null;
	  }

	  document.getElementById('preview-group-btn')?.addEventListener('click', () => {
		if (!sel?.value) { preview.textContent = 'Choose a preset first.'; return; }

		if (sel.value === 'naval_strike_group') {
		  preview.innerHTML = `
			<strong>Naval Strike Group</strong><br/>
			Click <em>Add Group</em>, then click the map to place a 5-ship formation (~20 nm spacing):<br/>
			• Center: Type 052D<br/>
			• Corners: 2× Type 071 + 2× Type 055
		  `;
		  return;
		}
		if (sel.value === 'sam_battery') {
		  preview.innerHTML = `
			<strong>SAM Battery</strong><br/>
			Click <em>Add Group</em>, then click the map to place a SAM formation :<br/>
			• Center: Type 052D<br/>
			• Corners: 2× Type 071 + 2× Type 055
		  `;
		  return;
		}
		preview.textContent = `Preset: ${sel.value}`;
	  });

	  document.getElementById('add-group-btn')?.addEventListener('click', () => {
		if (!sel?.value) { preview.textContent = 'Choose a preset first.'; return; }
		if (!map) { preview.textContent = 'Map not ready yet.'; return; }

		clearActiveGroupPlacement();

		if (sel.value === 'naval_strike_group') {
		  preview.textContent = 'Click on the map to place the Naval Strike Group…';

		  activeGroupPlacementHandler = (e) => {
			try {
			  addNavalStrikeGroupAt(e.latlng);
			  preview.textContent = 'Naval Strike Group placed.';
			} catch (err) {
			  console.error(err);
			  preview.textContent = 'Error placing group (see console).';
			} finally {
			  clearActiveGroupPlacement();
			}
		  };

		  map.on('click', activeGroupPlacementHandler);
		  return;
		}
		if (sel.value === 'sam_battery') {
		  preview.textContent = 'Click on the map to place the SAM Battery…';

		  activeGroupPlacementHandler = (e) => {
			try {
			  addSamConfigurationAt(e.latlng);
			  preview.textContent = 'SAM Battery placed.';
			} catch (err) {
			  console.error(err);
			  preview.textContent = 'Error placing group (see console).';
			} finally {
			  clearActiveGroupPlacement();
			}
		  };

		  map.on('click', activeGroupPlacementHandler);
		  return;
		}
		preview.textContent = `Adding preset: ${sel.value} (hook up real logic next).`;
	  });

	  console.log('Rendered GROUP panel. Found select?', !!document.getElementById('group-preset-select'));
	}

	
  function renderMovementPanel() {
    const panelContent = document.getElementById('slide-out-panel-content');
    if (!panelContent) return;

    panelContent.innerHTML = `
      <h3 style="margin-top:0;">Movement Track</h3>

      <div style="font-size:12px; opacity:.85; margin-bottom:10px;">
        1) Click a piece of equipment (marker) on the map to select it.<br/>
        2) Choose <strong>Breadcrumb</strong> (heading + speed) or <strong>Trace</strong> (draw path + speed).<br/>
        3) Click <em>Apply</em>. The equipment position will update over time.
      </div>

      <div id="movement-selected" style="padding:8px; border:1px solid rgba(255,255,255,.12); border-radius:8px; margin-bottom:10px;"></div>

      <label style="display:block; margin: 10px 0 6px;">Mode</label>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
        <label style="display:flex; gap:6px; align-items:center;">
          <input type="radio" name="movement-mode" value="breadcrumb" checked /> Breadcrumb
        </label>
        <label style="display:flex; gap:6px; align-items:center;">
          <input type="radio" name="movement-mode" value="trace" /> Trace
        </label>
      </div>

      <div id="movement-breadcrumb-section">
        <label style="display:block; margin: 10px 0 6px;">Heading (degrees)</label>
        <input id="movement-heading" type="number" min="0" max="360" step="1" placeholder="0-360"/>

        <label style="display:block; margin: 10px 0 6px;">Speed (mph)</label>
        <input id="movement-speed" type="number" min="0" max="999" step="1" placeholder="e.g., 045"/>

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="apply-breadcrumb-btn">Apply Breadcrumb</button>
          <button id="clear-movement-btn" class="dark-red">Clear Movement</button>
        </div>
      </div>

      <div id="movement-trace-section" style="display:none;">
        <label style="display:block; margin: 10px 0 6px;">Speed (mph)</label>
        <input id="trace-speed" type="number" min="0" max="999" step="1" placeholder="e.g., 035"/>

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="draw-trace-btn">Draw Path</button>
          <button id="clear-trace-btn" class="dark-red">Clear Path</button>
        </div>

        <div id="movement-trace-preview" style="margin-top:10px; font-size:12px; opacity:.85;">Path: (none)</div>

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="apply-trace-btn">Apply Trace</button>
          <button id="clear-movement-btn-2" class="dark-red">Clear Movement</button>
        </div>
      </div>
    `;

    bindMovementPanelEvents();
    updateMovementPanelSelectionDisplay();
    updateMovementPanelTracePreview();
  }

  function bindMovementPanelEvents() {
    const radios = Array.from(document.querySelectorAll('input[name="movement-mode"]'));
    const breadcrumbSection = document.getElementById('movement-breadcrumb-section');
    const traceSection = document.getElementById('movement-trace-section');

    const applyBreadcrumbBtn = document.getElementById('apply-breadcrumb-btn');
    const applyTraceBtn = document.getElementById('apply-trace-btn');
    const clearMovementBtn = document.getElementById('clear-movement-btn');
    const clearMovementBtn2 = document.getElementById('clear-movement-btn-2');
    const drawTraceBtn = document.getElementById('draw-trace-btn');
    const clearTraceBtn = document.getElementById('clear-trace-btn');

    function setMode(mode) {
      if (breadcrumbSection) breadcrumbSection.style.display = (mode === 'breadcrumb') ? 'block' : 'none';
      if (traceSection) traceSection.style.display = (mode === 'trace') ? 'block' : 'none';
    }

    radios.forEach(r => r.addEventListener('change', () => {
      const selected = radios.find(x => x.checked)?.value || 'breadcrumb';
      setMode(selected);
    }));
    setMode('breadcrumb');

    function getSelectedRow() {
      return selectedMovementEmitterId ? workingCSV.find(r => r.uniqueID === selectedMovementEmitterId) : null;
    }

    function clearMovement() {
      const row = getSelectedRow();
      if (!row) { alert('Select equipment on the map first.'); return; }
      delete movementTracks[row.uniqueID];
      delete breadcrumbSettings[row.uniqueID]; // backward compat
      alert('Movement cleared for selected equipment.');
    }

    clearMovementBtn?.addEventListener('click', clearMovement);
    clearMovementBtn2?.addEventListener('click', clearMovement);

    applyBreadcrumbBtn?.addEventListener('click', () => {
      const row = getSelectedRow();
      if (!row) { alert('Select equipment on the map first.'); return; }

      const headingDeg = parseFloat(document.getElementById('movement-heading')?.value || '0');
      const speedMph = parseFloat(document.getElementById('movement-speed')?.value || '0');

      if (isNaN(headingDeg) || headingDeg < 0 || headingDeg > 360) { alert('Heading must be 0-360.'); return; }
      if (isNaN(speedMph) || speedMph <= 0) { alert('Speed must be > 0 mph.'); return; }

      movementTracks[row.uniqueID] = {
        type: 'breadcrumb',
        headingDeg,
        speedKmh: speedMph * 1.60934,
        startTime: Date.now(),
        initialLocation: row.location
      };

      // keep old path working too
      breadcrumbSettings[row.uniqueID] = {
        heading: headingDeg,
        speed: speedMph * 1.60934,
        startTime: movementTracks[row.uniqueID].startTime,
        initialLocation: row.location
      };

      alert('Breadcrumb movement applied.');
    });

    drawTraceBtn?.addEventListener('click', () => {
      if (!getSelectedRow()) { alert('Select equipment on the map first.'); return; }
      startTraceDrawing();
    });

    clearTraceBtn?.addEventListener('click', () => {
      if (pendingTraceLayer) {
        try { map.removeLayer(pendingTraceLayer); } catch (e) {}
      }
      pendingTraceLayer = null;
      pendingTracePath = null;
      updateMovementPanelTracePreview();
    });

    applyTraceBtn?.addEventListener('click', () => {
      const row = getSelectedRow();
      if (!row) { alert('Select equipment on the map first.'); return; }

      const speedMph = parseFloat(document.getElementById('trace-speed')?.value || '0');
      if (isNaN(speedMph) || speedMph <= 0) { alert('Speed must be > 0 mph.'); return; }

      if (!pendingTracePath || pendingTracePath.length < 2) {
        alert('Draw a path first (click “Draw Path”, then draw on the map).');
        return;
      }

      movementTracks[row.uniqueID] = {
        type: 'trace',
        speedMps: speedMph * 0.44704, // mph -> m/s
        startTime: Date.now(),
        pathLatLngs: pendingTracePath.map(p => ({ lat: p.lat, lng: p.lng }))
      };

      // Clear any old breadcrumb settings
      delete breadcrumbSettings[row.uniqueID];

      alert('Trace movement applied.');
    });
  }


function renderEquipmentPanel() {
	  const panelContent = document.getElementById('slide-out-panel-content');
	  if (!panelContent) return;

	  panelContent.innerHTML = `
		<h2 style="font-size: 1em;">Select Country</h2>
		<select id="country-select" style="width: 100%; font-size: 0.8em;">
		  <option value="">Select Country</option>
		  <option value="KN">KN</option>
		  <option value="RU">RU</option>
		  <option value="CN">CN</option>
		  <option value="IR">IR</option>
		  <option value="AF">AF</option>
		  <option value="SY">SY</option>
		  <option value="IZ">IZ</option>
		  <option value="TU">TU</option>
		  <option value="TW">TW</option>
		</select>

		<h2 style="font-size: 1em;">Select System Class</h2>
		<select id="system-class-select" style="width: 100%; font-size: 0.8em;">
		  <option value="">Select System Class</option>
		  <option value="SAM">SAM</option>
		  <option value="TBM">TBM</option>
		  <option value="EW">EW</option>
		  <option value="EMW">EMW</option>
		  <option value="MARITIME">MARITIME</option>
		  <option value="AIR">AIR</option>
		</select>

		<h2 style="font-size: 1em;">Select System</h2>
		<select id="system-select" style="width: 100%; font-size: 0.8em;">
		  <option value="">Select System</option>
		</select>

		<h2 style="font-size: 1em;">Placement Options</h2>

		<div style="margin-bottom: 10px;">
		  <input type="checkbox" id="click-to-add-checkbox">
		  <label for="click-to-add-checkbox" style="font-size: 0.8em;">Click to Add</label>
		</div>

		<div style="margin-bottom: 10px;">
		  <input type="checkbox" id="draw-aoi-checkbox">
		  <label for="draw-aoi-checkbox" style="font-size: 0.8em;">Draw AOI</label>
		</div>

		<div id="aoi-controls" style="display: none; margin-bottom: 10px;">
		  <label for="number-to-add" style="font-size: 0.8em;">Number to Add:</label>
		  <input type="number" id="number-to-add" style="width: 80px; font-size: 0.8em;" min="1" value="1"><br>
		  <button id="add-to-aoi" style="font-size: 0.8em;">Add to AOI</button>
		</div>
	  `;
		bindEquipmentPanelEvents(map);

	  // IMPORTANT: any event listeners that were previously attached on page load
	  // must be reattached here, because we recreated the elements.
	}
	console.log('Rendered EQUIPMENT panel (stub)');
	});
let activePlacementHandler = null;

function bindEquipmentPanelEvents(map) {
  const countrySelect = document.getElementById('country-select');
  const classSelect = document.getElementById('system-class-select');
  const systemSelect = document.getElementById('system-select');

  const clickToAddCheckbox = document.getElementById('click-to-add-checkbox');
  const drawAoiCheckbox = document.getElementById('draw-aoi-checkbox');
  const aoiControls = document.getElementById('aoi-controls');

  if (!countrySelect || !classSelect || !systemSelect) {
    console.warn('bindEquipmentPanelEvents: missing selects');
    return;
  }

  function updateSystemOptions() {
    const c = countrySelect.value;
    const k = classSelect.value;

    systemSelect.innerHTML = '<option value="">Select System</option>';

    const list = systemOptions?.[c]?.[k];
    if (Array.isArray(list)) {
      list.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        systemSelect.appendChild(opt);
      });
    }
  }

  // Ensure we don't stack map click handlers
  function setClickToAddEnabled(enabled) {
    if (!map) return;

    if (activePlacementHandler) {
      map.off('click', activePlacementHandler);
      activePlacementHandler = null;
    }

    if (enabled) {
      activePlacementHandler = (e) => placeEmitterAtLocation(e.latlng);
      map.on('click', activePlacementHandler);
    }
  }

  // Wire dropdown changes
  countrySelect.addEventListener('change', updateSystemOptions);
  classSelect.addEventListener('change', updateSystemOptions);

  // Initial populate (so CN+SAM immediately fills once you open panel)
  updateSystemOptions();

  // Click-to-add
  if (clickToAddCheckbox) {
    clickToAddCheckbox.addEventListener('change', () => {
      setClickToAddEnabled(clickToAddCheckbox.checked);
    });
  }

  // Draw AOI UI toggle (doesn’t change Leaflet Draw control, just your panel controls)
  if (drawAoiCheckbox && aoiControls) {
    drawAoiCheckbox.addEventListener('change', () => {
      aoiControls.style.display = drawAoiCheckbox.checked ? 'block' : 'none';
    });
  }
}	
	// function bindEquipmentPanelEvents(map) {
	  // const clickToAddCheckbox = document.getElementById('click-to-add-checkbox');
	  // if (!clickToAddCheckbox) return;

	  // let activeClickHandler = null;

	  // clickToAddCheckbox.addEventListener('change', () => {
		// if (clickToAddCheckbox.checked) {
		  // if (!activeClickHandler) {
			// activeClickHandler = (e) => {
			  // const latlng = e.latlng;
			  // // add your placement logic here
			// };
			// map.on('click', activeClickHandler);
		  // }
		// } else {
		  // if (activeClickHandler) {
			// map.off('click', activeClickHandler);
			// activeClickHandler = null;
		  // }
		// }
	  // });
	// }
	
	// function togglePanel(mode) {
	  // // If already open in same mode -> close
	  // if (panelVisible && currentMode === mode) {
		// setPanelVisible(false);
		// currentMode = null;
		// return false; // closed
	  // }

	  // // Otherwise open and set mode (or switch mode)
	  // setPanelVisible(true);
	  // currentMode = mode;
	  // return true; // open
	// }
// --- Equipment panel event wiring ---
// NOTE: the equipment panel is re-rendered (innerHTML) each time you open it,
// so all listeners must be attached after renderEquipmentPanel() runs.
function bindEquipmentPanelEvents(mapInstance) {
  const countrySelect = document.getElementById('country-select');
  const classSelect = document.getElementById('system-class-select');
  const systemSelect = document.getElementById('system-select');
  const clickToAddCheckbox = document.getElementById('click-to-add-checkbox');
  const drawAoiCheckbox = document.getElementById('draw-aoi-checkbox');
  const aoiControls = document.getElementById('aoi-controls');
  const addToAoiBtn = document.getElementById('add-to-aoi');
  const numberToAddInput = document.getElementById('number-to-add');

  // --- Populate "Select System" based on Country + Class ---
  function updateSystemOptions() {
    if (!systemSelect) return;
    const selectedCountry = countrySelect?.value || '';
    const selectedClass = classSelect?.value || '';

    systemSelect.innerHTML = '<option value="">Select System</option>';
    const systems = systemOptions?.[selectedCountry]?.[selectedClass] || [];
    systems.forEach((sys) => {
      const opt = document.createElement('option');
      opt.value = sys;
      opt.textContent = sys;
      systemSelect.appendChild(opt);
    });
  }

  countrySelect?.addEventListener('change', updateSystemOptions);
  classSelect?.addEventListener('change', updateSystemOptions);
  updateSystemOptions(); // initialize for current selections (if any)

  // --- Click-to-Add placement ---
  let activeClickHandler = null;
  function detachClickHandler() {
    if (activeClickHandler && mapInstance) {
      mapInstance.off('click', activeClickHandler);
      activeClickHandler = null;
    }
  }

  clickToAddCheckbox?.addEventListener('change', () => {
    if (!mapInstance) return;

    if (clickToAddCheckbox.checked) {
      // Ensure AOI mode isn't simultaneously active
      if (drawAoiCheckbox) drawAoiCheckbox.checked = false;
      if (aoiControls) aoiControls.style.display = 'none';

      detachClickHandler();
      activeClickHandler = (e) => {
        placeEmitterAtLocation(e.latlng);
      };
      mapInstance.on('click', activeClickHandler);
    } else {
      detachClickHandler();
    }
  });

  // --- Draw AOI toggle + Add-to-AOI button ---
  drawAoiCheckbox?.addEventListener('change', () => {
    // Ensure Click-to-Add isn't simultaneously active
    if (clickToAddCheckbox) clickToAddCheckbox.checked = false;
    detachClickHandler();

    if (aoiControls) {
      aoiControls.style.display = drawAoiCheckbox.checked ? 'block' : 'none';
    }
  });

  addToAoiBtn?.addEventListener('click', () => {
    const n = Math.max(1, parseInt(numberToAddInput?.value || '1', 10) || 1);
    if (!userPolygon) {
      alert('Please draw an AOI first.');
      return;
    }
    for (let i = 0; i < n; i++) {
      const latlngStr = generateRandomLatLonInPolygon(userPolygon);
      const [lat, lon] = latlngStr.split(',').map(Number);
      placeEmitterAtLocation({ lat, lng: lon });
    }
  });
}


	function openSlideOutPanel() {
	  panelVisible = true;
	  slideOutPanel.style.display = 'block';

	  // IMPORTANT: don't force left positioning here.
	  // Let your existing CSS/logic handle where it should appear.
	}

	// if (groupIcon) {
	  // groupIcon.addEventListener('click', () => {
		// // Always OPEN the panel (don’t toggle)
		// console.log('GROUP clicked');
		// const isOpen = togglePanel('group');
		// if (!isOpen) return;

		// const panelContent = document.getElementById('slide-out-panel-content');
		// if (!panelContent) return;

		// panelContent.innerHTML = `
		  // <h3 style="margin-top:0;">Add Equipment Group</h3>

		  // <label style="display:block; margin: 10px 0 6px;">Preset</label>
		  // <select id="group-preset-select" style="width:100%;">
			// <option value="">Select preset...</option>
			// <option value="sam_battery">SAM Battery (example)</option>
			// <option value="ew_site">EW Site (example)</option>
			// <option value="mixed_pkg">Mixed Package (example)</option>
		  // </select>

		  // <div style="display:flex; gap:8px; margin-top:10px;">
			// <button id="preview-group-btn">Preview</button>
			// <button id="add-group-btn">Add Group</button>
		  // </div>

		  // <div id="group-preview" style="margin-top:10px; font-size:12px; opacity:.8;"></div>
		// `;

		// const sel = document.getElementById('group-preset-select');
		// const preview = document.getElementById('group-preview');

		// document.getElementById('preview-group-btn')?.addEventListener('click', () => {
		  // preview.textContent = sel?.value ? `Preset: ${sel.value}` : 'Choose a preset first.';
		// });

		// document.getElementById('add-group-btn')?.addEventListener('click', () => {
		  // if (!sel?.value) { preview.textContent = 'Choose a preset first.'; return; }
		  // preview.textContent = `Adding preset: ${sel.value} (hook up real logic next).`;
		// });
	  // });
	// }

	// if (equipmentIcon) {
	  // equipmentIcon.addEventListener('click', () => {
		// console.log('Equipment clicked');
		
		// const isOpen = togglePanel('equipment');
		// if (!isOpen) return;
	  // });
	// }

	// if (expandToggle) {
	// expandToggle.addEventListener('click', () => {
	  // expanded = !expanded;
	  // iconBar.style.width = expanded ? '200px' : '50px';

	  // // show/hide ALL icon labels safely
	  // iconBar.querySelectorAll('.icon-label').forEach(lbl => {
		// lbl.style.display = expanded ? 'inline' : 'none';
	  // });

	  // // correct arrow symbols
	  // expandToggle.textContent = expanded ? '⮜' : '⮞';

	  // // keep panel aligned if it's open
	  // if (panelVisible) {
		// slideOutPanel.style.right = expanded ? '200px' : '50px';
		// slideOutPanel.style.right = 'auto';
	  // }
	// });
	// }

    // Add to AOI Handler
   // addToAoiButton.addEventListener('click', function() {
       // const numberToAdd = parseInt(document.getElementById('number-to-add').value) || 1;
       // if (!userPolygon) {
           // alert('Please draw an AOI first.');
           // return;
	   // }
        // for (let i = 0; i < numberToAdd; i++) {
           // const latlngStr = generateRandomLatLonInPolygon(userPolygon);
           // const [lat, lon] = latlngStr.split(',').map(Number);
           // placeEmitterAtLocation({ lat, lng: lon });
       // }
   // });
  // );

document.addEventListener('DOMContentLoaded', function() {

	const deleteEquipmentIcon = document.getElementById('delete-equipment-icon');
    const expandToggle = document.getElementById('expand-toggle');
    expandToggle.style.position = 'fixed';
    expandToggle.style.bottom = '50px';
    let expanded = false;

    // expandToggle.addEventListener('click', () => {
        // expanded = !expanded;
        // iconBar.style.width = expanded ? '200px' : '50px';
// //        deleteButtonWrapper.style.width = expanded ? '200px' : '40px';
// //        deleteButtonLabel.style.display = expanded ? 'inline' : 'none';
        // expandToggle.textContent = expanded ? '⮜' : '⮞';
    // });
	if (deleteEquipmentIcon) {
	  deleteEquipmentIcon.addEventListener('click', function () {
        const selectedRows = document.querySelectorAll('#working-csv-preview tr.selected');
        const indicesToRemove = Array.from(selectedRows).map(
          row => Array.from(row.parentElement.children).indexOf(row) - 1
        );

        indicesToRemove.forEach(index => {
          if (mapMarkers[index]) {
            map.removeLayer(mapMarkers[index]);
            delete mapMarkers[index];
          }
        });

        workingCSV = workingCSV.filter((_, index) => !indicesToRemove.includes(index));
        updateCSVPreview();
      });
    }

    Object.entries(mapMarkers).forEach(([index, marker]) => {
        const popupContent = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = workingCSV[index]?.emitterName || 'Emitter';

        const silenceButton = document.createElement('button');
        silenceButton.textContent = 'Silence';
        silenceButton.addEventListener('click', () => {
            toggleEmitterState(workingCSV[index]?.uniqueID, index);
        });

        const selectButton = document.createElement('button');
        selectButton.textContent = 'Select';
        selectButton.style.marginLeft = '5px';
        selectButton.addEventListener('click', () => {
            const tableRows = document.querySelectorAll('#working-csv-preview tr');
            tableRows.forEach(row => row.classList.remove('selected'));
            const targetRow = tableRows[parseInt(index) + 1];
            if (targetRow) {
                targetRow.classList.add('selected');
                targetRow.style.backgroundColor = 'lightcoral';
                targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        popupContent.appendChild(title);
        popupContent.appendChild(document.createElement('br'));
        popupContent.appendChild(silenceButton);
        popupContent.appendChild(selectButton);

        marker.bindPopup(popupContent);
    });
});


function placeEmitterAtLocation(latlng) {
    const systemClassEl = document.getElementById('system-class-select');
    const systemSelectEl = document.getElementById('system-select');
    // If the equipment panel isn't open (or selects haven't been rendered), bail safely instead of throwing.
    // if (!systemClassEl || !systemSelectEl) {
        // console.warn('placeEmitterAtLocation: system selectors not found (panel may be closed).');
        // alert('Open Add Equipment and select a system first.');
        // return;
    // }

    const systemType = systemClassEl.value;
    const systemName = systemSelectEl.value;

    if (!systemType || !systemName) {
        alert('Please select a system class and system first.');
        return;
    }
    const emitterName = `${systemName}-${generateUniqueID()}`;
    const elnot = generateUniqueID();
    const freq = Math.floor(Math.random() * 10000).toString();
    const location = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;

    const newEmitter = {
        systemType,
        systemName,
        emitterName,
        elnot,
        freq,
        maj: '1.000',
        min: '0.500',
        ori: '90.000',
        location,
        uniqueID: generateUniqueID(),
        mgrs: convertLocationToMGRS(location)
    };

    workingCSV.push(newEmitter);
    updateCSVPreview();
    plotEmitters();
}
document.addEventListener('DOMContentLoaded', function() {
    // Create top banner
    const topBanner = document.createElement('div');
    topBanner.id = 'top-banner';
    topBanner.style.width = '100%';
    topBanner.style.height = '50px';
    topBanner.style.backgroundColor = '#222';
    topBanner.style.color = '#fff';
    topBanner.style.display = 'flex';
    topBanner.style.justifyContent = 'space-between';
    topBanner.style.alignItems = 'center';
    topBanner.style.padding = '0 20px';
    topBanner.style.position = 'fixed';
    topBanner.style.top = '0';
    topBanner.style.left = '0';
    topBanner.style.right = '0';
    topBanner.style.zIndex = '1002';

    // Left side - logo and title
    const logoTitleContainer = document.createElement('div');
    logoTitleContainer.style.display = 'flex';
    logoTitleContainer.style.alignItems = 'center';

    const logo = document.createElement('img');
    logo.src = './pictures/logo.png';
    logo.alt = 'GIRI Logo';
	logo.style.position = 'static';
    logo.style.height = '50px';
    logo.style.marginLeft = '-15px';

    const title = document.createElement('span');
    title.textContent = 'Synthetic Data Generation';
    title.style.fontSize = '18px';
	title.style.marginLeft = '12px';


    logoTitleContainer.appendChild(logo);
    logoTitleContainer.appendChild(title);

    // Center - scenario controls
    const scenarioControls = document.createElement('div');
    scenarioControls.id = 'scenario-controls';
    scenarioControls.style.display = 'flex';
    scenarioControls.style.justifyContent = 'center';
    scenarioControls.style.alignItems = 'center';
    scenarioControls.style.gap = '10px';
	scenarioControls.style.position = 'absolute';
	scenarioControls.style.left = '50%';
	scenarioControls.style.transform = 'translateX(-50%)';
    
    // Play Button
    const playButton = document.createElement('button');
    playButton.textContent = 'Play';
    playButton.onclick = handlePlayData;
    
    // Pause Button
    const pauseButton = document.createElement('button');
    pauseButton.textContent = 'Pause';
    pauseButton.onclick = handlePauseData;
    
    // Stop Button
    const stopButton = document.createElement('button');
    stopButton.textContent = 'Stop';
    stopButton.onclick = handleStopData;
    
    scenarioControls.appendChild(playButton);
    scenarioControls.appendChild(pauseButton);
    scenarioControls.appendChild(stopButton);

    // Right side - dropdown menu
    const menuContainer = document.createElement('div');
    menuContainer.style.marginRight = '30px';

    const menuButton = document.createElement('button');
    menuButton.textContent = '☰ Menu';
    menuButton.style.backgroundColor = '#444';
    menuButton.style.color = '#fff';
    menuButton.style.border = 'none';
    menuButton.style.padding = '5px 10px';
    menuButton.style.cursor = 'pointer';

    const menuDropdown = document.createElement('div');
    menuDropdown.style.display = 'none';
    menuDropdown.style.position = 'absolute';
    menuDropdown.style.right = '0px';
    menuDropdown.style.top = 'calc(80% + 1px)';
	menuDropdown.style.zIndex = '2000';
	menuDropdown.style.minWidth = '180px';
    menuDropdown.style.backgroundColor = '#323837';
    menuDropdown.style.color = '#f5f7f7';
    menuDropdown.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    menuDropdown.style.borderRadius = '4px';
    menuDropdown.style.overflow = 'hidden';

    const menuItems = ['Profile Settings', 'Scenario Library', 'Shared Events', 'Help', 'Logout'];
    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.textContent = item;
        menuItem.style.padding = '8px 12px';
        menuItem.style.cursor = 'pointer';
        menuItem.addEventListener('mouseenter', () => menuItem.style.backgroundColor = '#2b5d66');
        menuItem.addEventListener('mouseleave', () => menuItem.style.backgroundColor = '#323837');
        menuDropdown.appendChild(menuItem);
    });

    menuButton.addEventListener('click', () => {
        menuDropdown.style.display = menuDropdown.style.display === 'block' ? 'none' : 'block';
    });

    menuContainer.appendChild(menuButton);
    menuContainer.appendChild(menuDropdown);

    topBanner.appendChild(logoTitleContainer);
    if (scenarioControls) {
        topBanner.appendChild(scenarioControls);
    }
    topBanner.appendChild(menuContainer);

    document.body.appendChild(topBanner);
	updateCSVPreview();
	

	const previewContainer = document.getElementById('working-csv-container');
	const toggleButton = document.getElementById('toggle-csv-preview');

	if (toggleButton && previewContainer) {
	  toggleButton.addEventListener('click', () => {
		const willShow = previewContainer.classList.contains('collapsed');

		// toggle the table visibility
		previewContainer.classList.toggle('collapsed', !willShow);

		// update button label
		toggleButton.textContent = willShow ? 'Hide Table' : 'Show Table';

		// keep the button usable even when table is hidden
		if (willShow) {
		  // table is showing -> dock button to top of table
		  previewContainer.appendChild(toggleButton);
		  toggleButton.style.position = 'sticky';
		  toggleButton.style.top = '6px';
		  toggleButton.style.left = '50%';
		  toggleButton.style.transform = 'translateX(-50%)';
		  toggleButton.style.zIndex = '5001';
		} else {
		  // table is hiding -> return button to bottom center of screen
		  document.body.appendChild(toggleButton);
		  toggleButton.style.position = 'fixed';
		  toggleButton.style.bottom = '12px';
		  toggleButton.style.left = '50%';
		  toggleButton.style.transform = 'translateX(-50%)';
		  toggleButton.style.top = '';
		  toggleButton.style.zIndex = '5001';
		}
	  });

	} else {
	  console.error('Toggle button or preview container not found.', { toggleButton, previewContainer });
	}
});




