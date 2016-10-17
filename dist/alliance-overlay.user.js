/*jshint multistr: true */

// ==UserScript==
// @name         Screeps alliance overlay
// @namespace    https://screeps.com/
// @version      0.1
// @author       James Cook
// @include      https://screeps.com/a/
// @run-at       document-start
// @downloadUrl  https://raw.githubusercontent.com/LeagueOfAutomatedNations/loan-browser-ext/master/dist/alliance-overlay.user.js
// @grant        GM_xmlhttpRequest
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.8.3/jquery.min.js
// @require      https://screeps.com/a/vendor/angular/angular.js?bust=1476348151333%22
// @connect      www.leagueofautomatednations.com
// ==/UserScript==

const loanBaseUrl = "http://www.leagueofautomatednations.com";

let allianceData;
let userAlliance;
function getAllianceLogo(allianceKey) {
    let data = allianceData[allianceKey];
    if (data) {
        return loanBaseUrl + "/obj/" + data.logo;
    }
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
        addStyle(".alliance-" + allianceKey + " { background-image: url('" + getAllianceLogo(allianceKey) + "') }");
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
    let alliancesEnabled = localStorage.getItem("alliancesEnabled") === "true";
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
    if (!worldMap.displayOptions.alliances) return;

    let $location = mapContainerElem.injector().get("$location");
    console.log("Recalculating alliance overlay");
    if ($location.search().pos) {
        let roomSize;
        let roomsPerSector;
        switch (worldMap.zoom) {
            case 1: { roomSize = 20;  roomsPerSector = 10; break; }
            case 2: { roomSize = 50;  roomsPerSector =  4; break; }
            case 3: { roomSize = 150; roomsPerSector =  1; break; }
        }

        let posStr = $location.search().pos;
        if (!posStr) return;

        for (var u = 0; u < worldMap.sectors.length; u++) {
            let sector = worldMap.sectors[u];
            if (!sector || !sector.pos) continue;

            if (sector.rooms) {
                // high zoom, render a bunch of rooms
                let rooms = sector.rooms.split(",");
                for (let index in rooms) {
                    let roomName = rooms[index];
                }
            } else {
                // we're at zoom level 3, only render one room
                let left = sector.left;
                let top = sector.top;
                let roomDiv = $('<div class="alliance-logo" id="' + sector.name + '"></div>');
                let roomStats = worldMap.roomStats[sector.name];
                if (roomStats && roomStats.own) {
                    let userName = worldMap.roomUsers[roomStats.own.user].username;
                    let allianceKey = worldMap.userAlliance[userName];
                    $(roomDiv).addClass('alliance-' + allianceKey);
                }

                $(roomDiv).removeClass("alliance-logo-1 alliance-logo-2 alliance-logo-3");
                $(roomDiv).css('left', sector.left);
                $(roomDiv).css('top', sector.top);
                $(roomDiv).addClass("alliance-logo-" + worldMap.zoom);

                $(mapContainerElem).append(roomDiv);
            }
        }
    }
}

let pendingRedraws = 0;
function addSectorAllianceOverlay() {
    addStyle("\
        .alliance-logo-1 { width: 4px; height: 4px; background-size: 4px 4px; }\
        .alliance-logo-2 { width: 12.5px; height: 12.5px; background-size: 12.5px 12.5px; }\
        .alliance-logo-3 { width: 50px; height: 50px; background-size: 50px 50px; }\
        .alliance-logo { position: absolute; z-index: 2; opacity: 0.8 }\
    ");

    let mapContainerElem = angular.element(".map-container");
    let scope = mapContainerElem.scope();

    let deferRecalculation = function () {
        if (pendingRedraws === 0) {
            // remove alliance logos during redraws
            $('.alliance-logo').remove();
        }

        pendingRedraws++;
        setTimeout(() => {
            pendingRedraws--;
            if (pendingRedraws === 0) {
                recalculateAllianceOverlay();
            }
        }, 100);
    }
    scope.$on("mapSectorsRecalced", deferRecalculation);
    scope.$on("mapStatsUpdated", deferRecalculation);
}

// Entry point
$(document).ready(() => {
    let app = angular.element(document.body);
    let tutorial = app.injector().get("Tutorial");
    let $timeout = angular.element('body').injector().get('$timeout');

    // intercept viewer state changes
    tutorial._trigger = tutorial.trigger;
    tutorial.trigger = function(triggerName, unknownB) {
        if (triggerName === "worldMapEntered") {
            $timeout(()=>{
                bindAllianceSetting();
                addAllianceToggle();
                addAllianceToInfoOverlay();

                addSectorAllianceOverlay();
            });
        }
        tutorial._trigger(triggerName, unknownB);
    };
});