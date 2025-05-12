let workingCSV = []; // workingCSV variable
let mapMarkers = {}; //  map markers 
let map; //  map variable
let userPolygon = null; //  user-drawn polygon
let addToListButton; 
let breadcrumbSettings = {}; // breadcrumb settings for each emitter
let emitterMovement = {}; // emitter movement data
let playIntervals = {}; // intervals for each emitter
let emitterStates = {}; // the state (Active/Silence) of each emitter

const activeIconPath = './pictures/active.png';
const silenceIconPath = './pictures/icon2.png'; 

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
    if (typeof mgrs !== 'undefined' && typeof mgrs.forward === 'function') {
        return mgrs.forward([lon, lat]);
    } else {
        console.warn('MGRS library is not loaded. Returning raw coordinates.');
        return location;
    }
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
    const slideOutPanel = document.getElementById('slide-out-panel');
    const equipmentIcon = document.getElementById('equipment-icon');
    const iconBar = document.getElementById('icon-bar');
    const expandToggle = document.getElementById('expand-toggle');

    let panelVisible = false;
    let expanded = false;

    equipmentIcon.addEventListener('click', () => {
        panelVisible = !panelVisible;
        slideOutPanel.style.display = panelVisible ? 'block' : 'none';
        slideOutPanel.style.left = expanded ? '200px' : '50px';
    });

    expandToggle.addEventListener('click', () => {
        expanded = !expanded;
        iconBar.style.width = expanded ? '200px' : '50px';
        deleteButtonLabel.style.display = expanded ? 'inline' : 'none';
        expandToggle.textContent = expanded ? 'â®œ' : 'â®ž';
    });
});

document.addEventListener('DOMContentLoaded', function() {
    const slideOutPanel = document.getElementById('slide-out-panel');
    const equipmentIcon = document.getElementById('equipment-icon');
    const iconBar = document.getElementById('icon-bar');
    const expandToggle = document.getElementById('expand-toggle');

    let panelVisible = false;
    let expanded = false;

    equipmentIcon.addEventListener('click', () => {
        panelVisible = !panelVisible;
        slideOutPanel.style.display = panelVisible ? 'block' : 'none';
        slideOutPanel.style.left = expanded ? '200px' : '50px';
    });

    expandToggle.addEventListener('click', () => {
        expanded = !expanded;
        iconBar.style.width = expanded ? '200px' : '50px';
        const iconLabels = document.querySelectorAll('.icon-label');
        iconLabels.forEach(label => label.style.display = expanded ? 'inline' : 'none');
        expandToggle.textContent = expanded ? 'â®œ' : 'â®ž';
    });
});
// Existing functionsLive.js content

// Original content remains here...

/* START OF UPDATE */

// Add placement logic to the DOMContentLoaded in functionsLive.js
document.addEventListener('DOMContentLoaded', function() {
    const clickToAddCheckbox = document.getElementById('click-to-add-checkbox');
    if (clickToAddCheckbox) {
        let activeClickHandler = null;

        clickToAddCheckbox.addEventListener('change', function() {
            if (clickToAddCheckbox.checked) {
                if (!activeClickHandler) {
                    activeClickHandler = function(e) {
                        const latlng = e.latlng;
                        placeEmitterAtLocation(latlng);
                    };
                    map.on('click', activeClickHandler);
                }
            } else {
                if (activeClickHandler) {
                    map.off('click', activeClickHandler);
                    activeClickHandler = null;
                }
            }
        });
    }
});

    // Add to AOI Handler
   // addToAoiButton.addEventListener('click', function() {
 //       const numberToAdd = parseInt(document.getElementById('number-to-add').value) || 1;
   //     if (!userPolygon) {
     //       alert('Please draw an AOI first.');
       //     return;
        //}
        //for (let i = 0; i < numberToAdd; i++) {
         //   const latlngStr = generateRandomLatLonInPolygon(userPolygon);
          //  const [lat, lon] = latlngStr.split(',').map(Number);
           // placeEmitterAtLocation({ lat, lng: lon });
   //     }
   // });
//);

document.addEventListener('DOMContentLoaded', function() {
    // Move left-side menu to right-side without duplicating
    const leftIconBar = document.getElementById('icon-bar');
    const leftSlideOutPanel = document.getElementById('slide-out-panel');

    if (leftIconBar && leftSlideOutPanel) {
        // Move icon bar
        leftIconBar.style.left = 'auto';
        leftIconBar.style.right = '0';

        // Move slide-out panel
        leftSlideOutPanel.style.left = 'auto';
        leftSlideOutPanel.style.right = '50px';

        // Ensure the slide-out opens to the left from the right edge
        leftSlideOutPanel.style.transformOrigin = 'right';

        const equipmentIcon = leftIconBar.querySelector('#equipment-icon');
        const expandToggle = leftIconBar.querySelector('#expand-toggle');

        let panelVisible = false;
        let expanded = false;

        equipmentIcon.addEventListener('click', () => {
            panelVisible = !panelVisible;
            leftSlideOutPanel.style.left = 'auto';
            leftSlideOutPanel.style.right = '50px';
            leftSlideOutPanel.style.display = panelVisible ? 'block' : 'none';
        });

        expandToggle.addEventListener('click', () => {
            expanded = !expanded;
            leftIconBar.style.width = expanded ? '200px' : '50px';
            const iconLabels = leftIconBar.querySelectorAll('.icon-label');
            iconLabels.forEach(label => label.style.display = expanded ? 'inline' : 'none');
            expandToggle.textContent = expanded ? '⮜' : '⮞';
        });
    }

    // Click to Add System Functionality
    const clickToAddCheckbox = document.getElementById('click-to-add-checkbox');
    if (clickToAddCheckbox) {
        let activeClickHandler = null;

        clickToAddCheckbox.addEventListener('change', function() {
            if (clickToAddCheckbox.checked) {
                if (!activeClickHandler) {
                    activeClickHandler = function(e) {
                        const latlng = e.latlng;
                        //L.marker(latlng).addTo(map);
                    };
                    map.on('click', activeClickHandler);
                }
            } else {
                if (activeClickHandler) {
                    map.off('click', activeClickHandler);
                    activeClickHandler = null;
                }
            }
        });
    }
    const iconBar = document.getElementById('icon-bar');
    const equipmentIcon = document.getElementById('equipment-icon');

    const deleteButtonWrapper = document.createElement('div');
    deleteButtonWrapper.id = 'delete-equipment-wrapper';
    deleteButtonWrapper.style.marginTop = '10px';
    deleteButtonWrapper.style.backgroundColor = '#000';
    deleteButtonWrapper.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
    deleteButtonWrapper.style.width = '40px';
    deleteButtonWrapper.style.height = '40px';
    deleteButtonWrapper.style.display = 'flex';
    deleteButtonWrapper.style.alignItems = 'center';
    deleteButtonWrapper.style.justifyContent = 'center';
    deleteButtonWrapper.style.cursor = 'pointer';
    deleteButtonWrapper.style.transition = 'width 0.3s ease';

    const deleteButtonIcon = document.createElement('span');
    deleteButtonIcon.innerHTML = '🗑️';

    const deleteButtonLabel = document.createElement('span');
    deleteButtonLabel.textContent = 'Delete Equipment';
    deleteButtonLabel.style.marginLeft = '10px';
    deleteButtonLabel.style.display = 'none';

    deleteButtonWrapper.appendChild(deleteButtonIcon);
    deleteButtonWrapper.appendChild(deleteButtonLabel);
    iconBar.insertBefore(deleteButtonWrapper, equipmentIcon.nextSibling);

    const expandToggle = document.getElementById('expand-toggle');
    expandToggle.style.position = 'fixed';
    expandToggle.style.bottom = '50px';
    let expanded = false;

    expandToggle.addEventListener('click', () => {
        expanded = !expanded;
        iconBar.style.width = expanded ? '200px' : '50px';
        deleteButtonWrapper.style.width = expanded ? '200px' : '40px';
        deleteButtonLabel.style.display = expanded ? 'inline' : 'none';
        expandToggle.textContent = expanded ? '⮜' : '⮞';
    });

    deleteButtonWrapper.addEventListener('click', function() {
        const selectedRows = document.querySelectorAll('#working-csv-preview tr.selected');
        const indicesToRemove = Array.from(selectedRows).map(row => Array.from(row.parentElement.children).indexOf(row) - 1);

        indicesToRemove.forEach(index => {
            const row = workingCSV[index];
            if (mapMarkers[index]) {
                map.removeLayer(mapMarkers[index]);
                delete mapMarkers[index];
            }
        });

        workingCSV = workingCSV.filter((_, index) => !indicesToRemove.includes(index));
		updateCSVPreview();
    });

    // Add map marker popup with Select button functionality
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





// Utility function to place emitter
function placeEmitterAtLocation(latlng) {
    const systemType = document.getElementById('system-class-select').value;
    const systemName = document.getElementById('system-select').value;

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
	onSystemPlaced(emitterName, latlng.lat, latlng.lng, elnot, freq, systemType);
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
	logo.style.position = 'fixed';
    logo.style.height = '50px';
    logo.style.justifyContent = 'left';

    const title = document.createElement('span');
    title.textContent = 'GIRI Training Tool';
    title.style.fontSize = '18px';
    title.style.fontWeight = 'bold';
	title.style.marginLeft = '200px';

    logoTitleContainer.appendChild(logo);
    logoTitleContainer.appendChild(title);

    // Center - scenario controls
    const scenarioControls = document.createElement('div');
    scenarioControls.id = 'scenario-controls';
    scenarioControls.style.display = 'flex';
    scenarioControls.style.justifyContent = 'center';
    scenarioControls.style.alignItems = 'center';
    scenarioControls.style.gap = '10px';
    
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
    menuContainer.style.marginRight = '20px';

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
    menuDropdown.style.right = '0';
    menuDropdown.style.top = '35px';
    menuDropdown.style.backgroundColor = '#fff';
    menuDropdown.style.color = '#000';
    menuDropdown.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    menuDropdown.style.borderRadius = '4px';
    menuDropdown.style.overflow = 'hidden';

    const menuItems = ['Profile Settings', 'Scenario Library', 'Shared Events', 'Help', 'Logout'];
    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.textContent = item;
        menuItem.style.padding = '8px 12px';
        menuItem.style.cursor = 'pointer';
        menuItem.addEventListener('mouseenter', () => menuItem.style.backgroundColor = '#eee');
        menuItem.addEventListener('mouseleave', () => menuItem.style.backgroundColor = '#fff');
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
            const isCollapsed = previewContainer.classList.contains('collapsed');
            previewContainer.classList.toggle('collapsed', !isCollapsed);
            toggleButton.textContent = isCollapsed ? 'Hide Table' : 'Show Table';
        });
    } else {
        console.error('Toggle button or preview container not found.');
    }
});
