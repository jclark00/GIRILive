let workingCSV = []; // Global workingCSV variable
let mapMarkers = {}; // Store map markers by their index
let map; // Global map variable
let userPolygon = null; // Store the user-drawn polygon
let addToListButton; // Declare addToListButton in the global scope
let breadcrumbSettings = {}; // Store breadcrumb settings for each emitter
let emitterMovement = {}; // Store emitter movement data
let playIntervals = {}; // Store intervals for each emitter
let emitterStates = {}; // Store the state (Active/Silence) of each emitter

const activeIconPath = './pictures/active.png';
const silenceIconPath = './pictures/icon2.png'; // Current default icon

function initializeMap() {
    if (!map) {
        map = L.map('map').setView([51.505, -0.09], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(map);

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

        // Event handler for when a polygon is created
        map.on(L.Draw.Event.CREATED, function(event) {
            const layer = event.layer;

            if (userPolygon) {
                map.removeLayer(userPolygon);
            }

            userPolygon = layer;
            drawnItems.addLayer(layer);

            // Enable the "Add to List" button
            addToListButton.disabled = false;
        });

        plotEmitters();
    }
}

function plotEmitters() {
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
        marker.bindPopup(getEmitterPopupContent(row, index)).openPopup();

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

        const { heading, speed, startTime, initialLocation } = breadcrumbSettings[row.uniqueID] || {};
        const elapsedTime = breadcrumbSettings[row.uniqueID] ? (Date.now() - startTime) / 3600000 : 0; // Convert milliseconds to hours
        const [initialLat, initialLon] = initialLocation ? initialLocation.split(',').map(Number) : row.location.split(',').map(Number);
        const newLocationCoords = breadcrumbSettings[row.uniqueID] ? calculateNewLocation(initialLat, initialLon, heading, speed, elapsedTime) : [initialLat, initialLon];

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

function calculateNewLocation(lat, lon, heading, speed, timeElapsed) {
    const R = 6371; // Radius of the Earth in kilometers
    const distance = (speed * timeElapsed) / 60; // Convert speed from km/h to km/min and calculate distance in km

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
    return mgrs.forward([lon, lat]); // Note the order of coordinates for MGRS conversion
}

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
    const systemTypeSelect = document.getElementById('system-type-select');
    const systemNameSelect = document.getElementById('system-name-select');
    const emitterNameContainer = document.getElementById('emitter-name-container');
    const workingCSVPreview = document.getElementById('working-csv-preview');
    addToListButton = document.createElement('button'); // Initialize the button here
    addToListButton.innerText = 'Add to List';
    addToListButton.className = 'blue-green';
    addToListButton.disabled = true; // Initially disable the button

    function createOption(value) {
        const option = document.createElement('option');
        option.value = value;
        option.text = value;
        return option;
    }

    // Populate the system type dropdown
    if (typeof systemTypes !== 'undefined' && Array.isArray(systemTypes)) {
        systemTypes.forEach(systemType => {
            systemTypeSelect.appendChild(createOption(systemType));
        });
    }

    systemTypeSelect.addEventListener('change', () => {
        const systemType = systemTypeSelect.value;
        const systemNameSelect = document.getElementById('system-name-select');
        const emitterNameContainer = document.getElementById('emitter-name-container');
        systemNameSelect.innerHTML = '<option value="">Select System</option>';
        emitterNameContainer.innerHTML = '';

        if (systemType && typeof systemNames !== 'undefined' && systemNames[systemType]) {
            const names = systemNames[systemType];
            names.forEach(name => {
                systemNameSelect.appendChild(createOption(name));
            });
        }
    });

    systemNameSelect.addEventListener('change', () => {
        const systemType = systemTypeSelect.value;
        const systemName = systemNameSelect.value;
        emitterNameContainer.innerHTML = '';

        if (systemName) {
            const filteredEmitters = emitters.filter(row => row.systemType === systemType && row.systemName === systemName);
            filteredEmitters.forEach(emitter => {
                const div = document.createElement('div');
                div.innerHTML = `<label>${emitter.emitterName} <input type="number" min="0" placeholder="Count" data-emitter-name="${emitter.emitterName}" data-elnot="${emitter.elnot}" data-freq="${emitter.freq}"></label>`;
                emitterNameContainer.appendChild(div);
            });

            emitterNameContainer.appendChild(addToListButton); // Append button here to ensure it is visible

			addToListButton.addEventListener('click', () => {
				const countInputs = document.querySelectorAll('[data-emitter-name]');
				if (userPolygon) {
					countInputs.forEach(input => {
						const count = parseInt(input.value);
						if (count > 0) {
							for (let i = 0; i < count; i++) {
								const emitterName = input.getAttribute('data-emitter-name');
								const emitterData = filteredEmitters.find(row => row.emitterName === emitterName);
								const location = generateRandomLatLonInPolygon(userPolygon);

								// Generate random values for Maj, Min, and Ori
								const minTolerance = parseFloat(document.getElementById('min-tolerance').value);
								const maxTolerance = parseFloat(document.getElementById('max-tolerance').value);
								const maj = (Math.random() * (maxTolerance - minTolerance) + minTolerance).toFixed(3);
								const min = (Math.random() * 0.75 * maj).toFixed(3);
								const ori = Math.floor(Math.random() * 180) + 1;

								const newEntry = {
									systemType: emitterData.systemType,
									systemName: emitterData.systemName,
									emitterName: emitterName,
									elnot: emitterData.elnot,
									freq: emitterData.freq,
									maj: maj,
									min: min,
									ori: ori,
									mgrs: convertLocationToMGRS(location), // Convert location to MGRS
									location: location, // Generate random location within polygon
									uniqueID: generateUniqueID(), // Generate and add unique ID
									breadcrumb: "No" // Initialize breadcrumb to "No"
								};
								workingCSV.push(newEntry);
								emitterStates[newEntry.uniqueID] = 'Active'; // Initialize state as Active
								startBursting(newEntry); // Start bursting messages for the new emitter
							}
						}
					});
					updateCSVPreview();
					plotEmitters();
				}
			});


        }
    });

    document.getElementById('play-data').addEventListener('click', handlePlayData);
    document.getElementById('pause-data').addEventListener('click', handlePauseData);
    document.getElementById('stop-data').addEventListener('click', handleStopData);
    document.getElementById('update-list').addEventListener('click', () => {
        handlePauseData(); // Stop all current intervals
        plotEmitters(); // Re-plot emitters
        handlePlayData(); // Restart message bursts with updated list
    });

    document.getElementById('generate-data').addEventListener('click', () => {
        const minTolerance = parseFloat(document.getElementById('min-tolerance').value);
        const maxTolerance = parseFloat(document.getElementById('max-tolerance').value);

        const headers = ['class', 'type', 'system', 'elnt', 'freq', 'min', 'maj', 'orient', 'location', 'mgrs', 'uniqueID'];
        const finalCSV = workingCSV.map(row => {
            const semiMaj = (Math.random() * (maxTolerance - minTolerance) + minTolerance).toFixed(2);
            const semiMin = (Math.random() * 0.75 * semiMaj).toFixed(2);
            const orientation = Math.floor(Math.random() * 180) + 1;

            return [
                row.systemType, row.systemName, row.emitterName, row.elnot, row.freq,
                semiMaj, semiMin, orientation, row.location, row.mgrs, row.uniqueID
            ].join(',');
        });

        const csvContent = `${headers.join(',')}\n${finalCSV.join('\n')}`;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'generated_data.csv';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('cluster-selected').addEventListener('click', () => {
        const selectedRows = document.querySelectorAll('#working-csv-preview tr.selected');
        const indicesToCluster = Array.from(selectedRows).map(row => Array.from(row.parentElement.children).indexOf(row) - 1);
        const newEntries = [];

        indicesToCluster.forEach(index => {
            const row = workingCSV[index];
            const [lat, lon] = row.location.split(',').map(Number);
            const numCopies = Math.floor(Math.random() * 4) + 2; // Random number between 2 and 5

            for (let i = 0; i < numCopies; i++) {
                const newLocation = generateRandomLatLonNearby(lat, lon);
                const newEntry = { ...row, location: newLocation, mgrs: convertLocationToMGRS(newLocation), uniqueID: row.uniqueID }; // Copy unique ID and convert location to MGRS
                newEntries.push(newEntry);
            }
        });

        workingCSV = workingCSV.concat(newEntries);
        updateCSVPreview();
        plotEmitters();
    });

    document.getElementById('delete-selected').addEventListener('click', deleteSelectedEmitters);

    document.getElementById('clear-all').addEventListener('click', () => {
        handlePauseData();
        workingCSV.forEach(row => {
            clearInterval(playIntervals[row.uniqueID]);
            delete playIntervals[row.uniqueID];
        });
        workingCSV = [];
        clearMapMarkers();
        updateCSVPreview();
    });

	document.getElementById('breadcrumb').addEventListener('click', () => {
		const selectedRows = document.querySelectorAll('#working-csv-preview tr.selected');
		if (selectedRows.length === 0) {
			alert('Please select at least one emitter to apply breadcrumb settings.');
			return;
		}

		const heading = parseFloat(prompt('Enter heading (1-360 degrees):'));
		const speed = parseFloat(prompt('Enter speed (in miles per hour):'));

		if (isNaN(heading) || isNaN(speed) || heading < 1 || heading > 360 || speed <= 0) {
			alert('Invalid heading or speed values. Please enter valid numbers.');
			return;
		}

		selectedRows.forEach(row => {
			const index = Array.from(row.parentElement.children).indexOf(row) - 1;
			const uniqueID = workingCSV[index].uniqueID;
			breadcrumbSettings[uniqueID] = {
				heading: heading,
				speed: speed,
				startTime: Date.now(),
				initialLocation: workingCSV[index].location
			};
			// Update breadcrumb column to "Yes"
			workingCSV[index].breadcrumb = "Yes";
		});

		// Update the CSV preview to reflect the changes
		updateCSVPreview();
	});


    // Initialize the map when the placeholder is clicked
    const mapPlaceholder = document.getElementById('map-placeholder');
    const mapDiv = document.getElementById('map');

    mapPlaceholder.addEventListener('click', function() {
        mapPlaceholder.style.display = 'none';
        mapDiv.style.display = 'block';
        initializeMap();
    });
});

