/*jshint multistr: true */

// ==UserScript==
// @name         Screeps alliance overlay
// @namespace    https://screeps.com/
// @version      0.2.10
// @author       James Cook
// @include      https://screeps.com/a/
// @run-at       document-ready
// @downloadUrl  https://raw.githubusercontent.com/LeagueOfAutomatedNations/loan-browser-ext/master/dist/alliance-overlay.user.js
// @grant        GM_xmlhttpRequest
// @require      https://raw.githubusercontent.com/NesCafe62/screeps-alliance-map/2cf820b9291296588234752320d3ad2309801fb5/randomColor.js
// @require      https://raw.githubusercontent.com/Esryok/screeps-browser-ext/master/screeps-browser-core.js
// @connect      www.leagueofautomatednations.com
// ==/UserScript==

const loanBaseUrl = "https://www.leagueofautomatednations.com";

let allianceData;
let userAlliance;
function getAllianceLogo(allianceKey) {
    let data = allianceData[allianceKey];
    if (data) {
        return loanBaseUrl + "/obj/" + data.logo;
    }
}

let colorMap = {};
function getAllianceColor(allianceKey) {
    if (!colorMap[allianceKey]) {
        let seed = allianceData[allianceKey].name;
        let [hue,sat,lum] = randomColor({
            hue: "random",
            luminosity: "light",
            seed,
            format: "hslArray"
        });

        // the canvas opacity means the light color set has bad costrast: reduce luminosity to improve
        colorMap[allianceKey] = `hsl(${hue},${sat}%,${lum/2}%)`;
    }

    return colorMap[allianceKey];
}

// query for alliance data from the LOAN site
function ensureAllianceData(callback) {
    if (allianceData) {
        if (callback) callback();
        return;
    }

    GM_xmlhttpRequest({
        method: "GET",
        url: (loanBaseUrl + "/alliances.js"),
        onload: function(response) {
            allianceData = JSON.parse(response.responseText);
            userAlliance = {};

            for (let allianceKey in allianceData) {
                let alliance = allianceData[allianceKey];
                for (let userIndex in alliance.members) {
                    let userName = alliance.members[userIndex];
                    userAlliance[userName] = allianceKey;
                }
            }

            console.log("Alliance data loaded from LOAN.");
            if (callback) callback();
        }
    });
}

// Stuff references to the alliance data in the world map object. Not clear whether this is actually doing useful things.
function exposeAllianceDataForAngular() {
    let app = angular.element(document.body);
    let $timeout = angular.element('body').injector().get('$timeout');

    $timeout(()=>{
        let worldMapElem = angular.element($('.world-map'));
        let worldMap = worldMapElem.scope().WorldMap;

        worldMap.allianceData = allianceData;
        worldMap.userAlliance = userAlliance;

        recalculateAllianceOverlay();
    });

    for (let allianceKey in allianceData) {
        addStyle(".alliance-" + allianceKey + " { background-color: " + getAllianceColor(allianceKey) + " }");
        addStyle(".alliance-logo-3.alliance-" + allianceKey + " { background-image: url('" + getAllianceLogo(allianceKey) + "') }");
    }
}

// inject a new CSS style
function addStyle(css) {
    let head = document.head;
    if (!head) return;

    let style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = css;

    head.appendChild(style);
}

function generateCompiledElement(parent, content) {
    let $scope = parent.scope();
    let $compile = parent.injector().get("$compile");

    return $compile(content)($scope);
}

// Bind the WorldMap alliance display option to the localStorage value
function bindAllianceSetting() {
    let alliancesEnabled = localStorage.getItem("alliancesEnabled") !== "false";
    let worldMapElem = angular.element($('.world-map'));
    let worldMap = worldMapElem.scope().WorldMap;

    worldMap.displayOptions.alliances = alliancesEnabled;

    worldMap.toggleAlliances = function () {
        worldMap.displayOptions.alliances = !worldMap.displayOptions.alliances;
        localStorage.setItem("alliancesEnabled", worldMap.displayOptions.alliances);

        if (worldMap.displayOptions.alliances && !worldMap.userAlliances) {
            ensureAllianceData(exposeAllianceDataForAngular);
        } else {
            $('.alliance-logo').remove();
        }
    };

    worldMap.getAllianceName = function (userId) {
        if (!worldMap.userAlliance) return "Loading...";

        let userName = this.roomUsers[userId].username;
        let allianceKey = worldMap.userAlliance[userName];
        if (!allianceKey) return "None";

        return this.allianceData[allianceKey].name;
    };

    if (alliancesEnabled) {
        ensureAllianceData(exposeAllianceDataForAngular);
        recalculateAllianceOverlay();
    }
}

// insert the alliance toggle into the map container layer
function addAllianceToggle() {
    let content = "\
        <md:button \
            app-stop-click-propagation app-stop-propagation='mouseout mouseover mousemove' \
            class='md-raised btn-units alliance-toggle' ng:class=\"{'md-primary': WorldMap.displayOptions.alliances, 'solitary': WorldMap.zoom !== 3}\" \
            ng:click='WorldMap.toggleAlliances()' \
            tooltip-placement='bottom' tooltip='Toggle alliances'>\
                <span>&#9733;</span>\
        </md:button>";

    addStyle("\
        section.world-map .map-container .btn-units.alliance-toggle { right: 50px; font-size: 16px; padding: 4px; } \
        section.world-map .map-container .btn-units.alliance-toggle.solitary { right: 10px; } \
        section.world-map .map-container .layer-select { right: 90px; } \
    ");

    let mapContainerElem = angular.element($('.map-container'));
    let compiledContent = generateCompiledElement(mapContainerElem, content);
    $(compiledContent).appendTo(mapContainerElem);
}

// Add an "alliance" row to the room info overlay
function addAllianceToInfoOverlay() {
    let content = "\
        <div class='owner' ng:if='WorldMap.displayOptions.alliances && WorldMap.roomStats[MapFloatInfo.float.roomName].own'>\
            <label>Alliance:</label>\
            <span>\
                {{WorldMap.getAllianceName(WorldMap.roomStats[MapFloatInfo.float.roomName].own.user)}}\
            </span>\
        </div>";

    let mapFloatElem = angular.element($('.map-float-info'));
    let compiledContent = generateCompiledElement(mapFloatElem, content);
    $(compiledContent).insertAfter($(mapFloatElem).children('.owner')[0]);
}

function recalculateAllianceOverlay() {
    let mapContainerElem = angular.element(".map-container");
    let scope = mapContainerElem.scope();
    let worldMap = scope.WorldMap;
    if (!worldMap.displayOptions.alliances || !worldMap.allianceData) return;

    function drawRoomAllianceOverlay(roomName, left, top) {
        let roomDiv = $('<div class="alliance-logo" id="' + roomName + '"></div>');
        let roomStats = worldMap.roomStats[roomName];
        if (roomStats && roomStats.own) {
            let userName = worldMap.roomUsers[roomStats.own.user].username;
            let allianceKey = worldMap.userAlliance[userName];
            if (allianceKey) {
                $(roomDiv).addClass('alliance-' + allianceKey);

                $(roomDiv).removeClass("alliance-logo-1 alliance-logo-2 alliance-logo-3");
                $(roomDiv).css('left', left);
                $(roomDiv).css('top', top);
                $(roomDiv).addClass("alliance-logo-" + worldMap.zoom);

                $(mapContainerElem).append(roomDiv);
            }
        }
    }

    let $location = mapContainerElem.injector().get("$location");
    if ($location.search().pos) {
        let roomPixels;
        let roomsPerSectorEdge;
        switch (worldMap.zoom) {
            case 1: { roomPixels = 20;  roomsPerSectorEdge = 10; break; }
            case 2: { roomPixels = 50;  roomsPerSectorEdge =  4; break; }
            case 3: { roomPixels = 150; roomsPerSectorEdge =  1; break; }
        }

        let posStr = $location.search().pos;
        if (!posStr) return;

        //if (worldMap.zoom !== 3) return; // Alliance images are pretty ugly at high zoom.

        for (var u = 0; u < worldMap.sectors.length; u++) {
            let sector = worldMap.sectors[u];
            if (!sector || !sector.pos) continue;

            if (worldMap.zoom === 3) {
                // we're at zoom level 3, only render one room
                drawRoomAllianceOverlay(sector.name, sector.left, sector.top);
            } else if (sector.rooms) {
                // high zoom, render a bunch of rooms
                let rooms = sector.rooms.split(",");
                for (let x = 0; x < roomsPerSectorEdge; x++) {
                    for (let y = 0; y < roomsPerSectorEdge; y++) {
                        let roomName = rooms[x * roomsPerSectorEdge + y];
                        drawRoomAllianceOverlay(
                            roomName,
                            sector.left + x * roomPixels,
                            sector.top + y * roomPixels);
                    }
                }
            }
        }
    }
}

let pendingRedraws = 0;
function addSectorAllianceOverlay() {
    addStyle("\
        .alliance-logo { position: absolute; z-index: 2; opacity: 0.4 }\
        .alliance-logo-1 { width: 20px; height: 20px; }\
        .alliance-logo-2 { width: 50px; height: 50px; }\
        .alliance-logo-3 { width: 50px; height: 50px; background-size: 50px 50px; opacity: 0.8 }\
    ");

    let mapContainerElem = angular.element(".map-container");
    let scope = mapContainerElem.scope();

    let deferRecalculation = function () {
        // remove alliance logos during redraws
        $('.alliance-logo').remove();

        pendingRedraws++;
        setTimeout(() => {
            pendingRedraws--;
            if (pendingRedraws === 0) {
                recalculateAllianceOverlay();
            }
        }, 500);
    }
    scope.$on("mapSectorsRecalced", deferRecalculation);
    scope.$on("mapStatsUpdated", deferRecalculation);
}

function addAllianceColumnToLeaderboard() {
    function deferredLeaderboardLoad() {
        let leaderboardScope = angular.element('.leaderboard table').scope();
        if (leaderboardScope) {
            let rows = angular.element('.leaderboard table tr')
            let leaderboard = leaderboardScope.$parent.LeaderboardList;

            ensureAllianceData(() => {
                for (let i = 0; i < rows.length; i++) {
                    if (i === 0) {
                        let playerElem = $(rows[i]).children('th:nth-child(2)');
                        $("<th class='alliance-leaderboard'>Alliance</th>").insertAfter(playerElem);
                    } else {
                        let playerElem = $(rows[i]).children('td:nth-child(2)');
                        let userId = leaderboard.list[i - 1].user;
                        let userName = leaderboard.users[userId].username;
                        let allianceKey = userAlliance[userName];
                        let allianceName = (allianceKey ? allianceData[allianceKey].name : "");
                        
                        $("<td class='alliance-leaderboard'>" + allianceName +" </td>").insertAfter(playerElem);
                    }
                }
            });
        } else {
            setTimeout(deferredLeaderboardLoad, 100);
        }
    }

    setTimeout(deferredLeaderboardLoad, 100);
}

// Entry point
$(document).ready(() => {
    ScreepsAdapter.onViewChange((view) => {
        if (view === "worldMapEntered") {
            ScreepsAdapter.$timeout(()=> {
                bindAllianceSetting();
                addAllianceToggle();
                addAllianceToInfoOverlay();

                addSectorAllianceOverlay();
            });
        }
    });

    ScreepsAdapter.onHashChange((hash) => {
        var match = hash.match(/#!\/(.+?)\//);
        if (match && match.length > 1 && match[1] === "rank") {
            let app = angular.element(document.body);
            let search = app.injector().get("$location").search();
            if (search.page) addAllianceColumnToLeaderboard();
        }
    });
});
