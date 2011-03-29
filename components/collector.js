
const EXPORTED_SYMBOLS = ["dataStoreInfo"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://modules/base_observers.js");


const DailyEventCodes = {
    STUDY_STATUS: 0,
    BROWSER_START: 1,
    BROWSER_SHUTDOWN: 2,
    BROWSER_RESTART: 3,
    BROWSER_ACTIVATE: 4,
    BROWSER_INACTIVE: 5,
    SEARCHBAR_SEARCH: 6,
    SEARCHBAR_SWITCH: 7,
    BOOKMARK_STATUS: 8,
    BOOKMARK_CREATE: 9,
    BOOKMARK_CHOOSE: 10,
    BOOKMARK_MODIFY: 11,
    DOWNLOAD: 12,  
    DOWNLOAD_MODIFY: 13,
    ADDON_STATUS: 14,
    ADDON_INSTALL: 15,
    ADDON_UNINSTALL: 16,
    PRIVATE_ON: 17,
    PRIVATE_OFF: 18,
    MEMORY_USAGE:19,
    SESSION_ON_RESTORE:20,
    PLUGIN_VERSION:22,
    HISTORY_STATUS: 23,
    PROFILE_AGE: 24,
    SESSION_RESTORE_PREFERENCES: 25,
    NUM_TABS: 26,
    STARTUP_TIME: 27
};

const eventCodeToEventName = ["Study Status", "Firefox Startup", 
                            "Firefox Shutdown", "Firefox Restart", 
                            "Resume Active Use", "Begin Idle", "Search", 
                            "Search Settings Changed", "Bookmark Count", 
                            "New Bookmark", "Bookmark Opened",
                            "Bookmark Modified", "Download",
                            "Download Settings Changed", "Add-ons Count",
                            "Add-on Installed", "Add-on Uninstalled",
                            "Private Mode On", "Private Mode Off", 
                            "Memory Usage",
                            "Total Windows/Tabs in about:sessionrestore",
                            "Plugin Version", "History Count", "Profile Age",
                            "Session Restore Preferences", "Num Windows/Tabs", 
                            "Startup Time"];

const dataStoreInfo = {

  fileName: "metrics.sqlite",
  tableName: "moz_metrics",
  columns: [{property: "event_code", 
             type: BaseClasses.TYPE_INT_32, displayName: "Event",
             displayValue: eventCodeToEventName},
            {property: "data1", 
             type: BaseClasses.TYPE_STRING, 
             displayName: "Data 1"},
            {property: "data2", 
             type: BaseClasses.TYPE_STRING, 
             displayName: "Data 2"},
            {property: "data3", 
             type: BaseClasses.TYPE_STRING, 
             displayName: "Data 3"},
            {property: "timestamp", 
             type: BaseClasses.TYPE_DOUBLE, 
             displayName: "Time",
             displayValue: function(value) {
               return new Date(value).toLocaleString();}
            },
            {property: "guid",
             type: BaseClasses.TYPE_STRING,
             displayName: "GUID"
            }]
};

// 3. handlers

var BookmarkObserver = {
    alreadyInstalled: false,
    bmsvc: null,

    install: function() {
        /* See
        https://developer.mozilla.org/en/nsINavBookmarkObserver and
        https://developer.mozilla.org/en/nsINavBookmarksService
        */
        if (!this.alreadyInstalled) {
            console.info("Adding bookmark observer.");
          this.bmsvc = Cc["@mozilla.org/browser/nav-bookmarks-service;1"].
            getService(Ci.nsINavBookmarksService);
          this.lmsvc = Cc["@mozilla.org/browser/livemark-service;2"].
            getService(Ci.nsILivemarkService);
          this.bmsvc.addObserver(this, false);
          this.alreadyInstalled = true;
        }
    },

    runGlobalBookmarkQuery: function() {
        // Run once on startup to count bookmarks, folders, and depth of
        // folders.
      let historyService = Cc["@mozilla.org/browser/nav-history-service;1"]
        .getService(Ci.nsINavHistoryService);
      let totalBookmarks = 0;
      let totalFolders = 0;
      let greatestDepth = 0;
      let rootFolders = [ this.bmsvc.toolbarFolder,
                          this.bmsvc.bookmarksMenuFolder,
                          this.bmsvc.tagsFolder,
                          this.bmsvc.unfiledBookmarksFolder];
      let lmsvc = this.lmsvc;
      let bmsvc = this.bmsvc;
      let digIntoFolder = function(folderID, depth) {
        let options = historyService.getNewQueryOptions();
        let query = historyService.getNewQuery();
        query.setFolders([folderID], 1);
        let result = historyService.executeQuery(query, options);
        let rootNode = result.root;
        rootNode.containerOpen = true;
        if (rootNode.childCount > 0) {
          // don't count livemarks
          let folderId = bmsvc.getFolderIdForItem( 
		    rootNode.getChild(0).itemId );
          if (!lmsvc.isLivemark(folderId)) {
		    // iterate over the immediate children of this folder, recursing 
		    // into any subfolders
            for (let i = 0; i < rootNode.childCount; i ++) {
              let node = rootNode.getChild(i);
              if (node.type == node.RESULT_TYPE_FOLDER) {
                totalFolders ++;
                digIntoFolder(node.itemId, depth + 1);
              } else {
                totalBookmarks ++;
              }
            }
          }
        }
        // close a container after using it!
        rootNode.containerOpen = false;
        if (depth > greatestDepth) {
          greatestDepth = depth;
        }
      };
      
      let rootFolder;
      for each (rootFolder in rootFolders) {
        digIntoFolder(rootFolder, 0);
      }
	  // Only record the numeric values to the db. Can write scripts
	  // on the backend to sum and average. 
      exports.handlers.record(DailyEventCodes.BOOKMARK_STATUS,
                              totalBookmarks,
                              totalFolders,
                              greatestDepth);
    },
  
  uninstall: function() {
    if (this.alreadyInstalled) {
      this.bmsvc.removeObserver(this);
      this.alreadyInstalled = false;
    }
  },
  
  onItemAdded: function(itemId, parentId, index, type) {
	// Set the database entries to digits to make collection less
	// insane, by minimizing the need for string splits/regexes.
    let folderId = this.bmsvc.getFolderIdForItem(itemId);
    if (!this.lmsvc.isLivemark(folderId)) {
      // Ignore livemarks -these are constantly added automatically
      // and we don't really care about them.
      switch (type) {
      case this.bmsvc.TYPE_BOOKMARK:
        exports.handlers.record(DailyEventCodes.BOOKMARK_CREATE,
                                1);
        break;
      case this.bmsvc.TYPE_FOLDER:
        exports.handlers.record(DailyEventCodes.BOOKMARK_CREATE,
                                1);
        break;
      }
    }
  },
  
  onItemRemoved: function(itemId, parentId, index, type) {
    let isLivemark = this.lmsvc.isLivemark(parentId);
    if (!isLivemark) {
      // Ignore livemarks
      exports.handlers.record(DailyEventCodes.BOOKMARK_MODIFY,
                              -1);
    }
  },
  
  onItemVisited: function(bookmarkId, visitId, time) {
    // This works.
    exports.handlers.record(DailyEventCodes.BOOKMARK_CHOOSE);
  },
  
  onItemMoved: function(itemId, oldParentId, oldIndex, newParentId,
                        newIndex, type) {
    exports.handlers.record(DailyEventCodes.BOOKMARK_MODIFY,
                            0);
  }
};

var DownloadsObserver = {
  alreadyInstalled: false,
  downloadManager: null,
  obsService: null,
  
  install: function() {
    if (!this.alreadyInstalled) {
      console.info("Adding downloads observer.");
      this.obsService = Cc["@mozilla.org/observer-service;1"]
                           .getService(Ci.nsIObserverService);
      this.obsService.addObserver(this, "dl-done", false);

      /*this.downloadManager = Cc["@mozilla.org/download-manager;1"]
                   .getService(Ci.nsIDownloadManager);
      this.downloadManager.addListener(this);*/
      this.alreadyInstalled = true;
    }
  },

  uninstall: function() {
    if (this.alreadyInstalled) {
      //this.downloadManager.removeListener(this);
      this.obsService.removeObserver(this, "dl-done", false);
      this.alreadyInstalled = false;
    }
  },

  observe: function (subject, topic, state) {
    if (topic == "dl-done") {
      console.info("A download completed.");
      exports.handlers.record(DailyEventCodes.DOWNLOAD);
    }
  }
};

var IdlenessObserver = {
  /* Uses nsIIdleService, see
   * https://developer.mozilla.org/en/nsIIdleService
   * However, that has two flaws: First, it is OS-wide, not Firefox-specific.
   * Second, it won't trigger if you close your laptop lid before the
   * allotted time is up.  To catch this second case, we use an additional
   * method: self-pinging on a timer.
   */
  alreadyInstalled: false,
  idleService: null,
  lastSelfPing: 0,
  selfPingTimer: null,
  selfPingInterval: 300000, // Five minutes

  install: function() {
    if (!this.alreadyInstalled) {
      console.info("Adding idleness observer.");
      this.idleService = Cc["@mozilla.org/widget/idleservice;1"]
       .getService(Ci.nsIIdleService);
      // addIdleObserver takes seconds, not ms.  600s = 10 minutes.
      this.idleService.addIdleObserver(this, 600);
      this.alreadyInstalled = true;
      // Periodically ping myself to make sure Firefox is still running...
      // if time since last ping is ever too long, it probably means the computer
      // shut down or something
      this.lastSelfPing = Date.now();
      this.selfPingTimer = Components.classes["@mozilla.org/timer;1"]
                           .createInstance(Components.interfaces.nsITimer);
      this.pingSelf();
    }
  },

  uninstall: function() {
    if (this.alreadyInstalled) {
      this.idleService.removeIdleObserver(this, 600);
      this.alreadyInstalled = false;
      if (this.selfPingTimer) {
        this.selfPingTimer.cancel();
      }
    }
  },

  pingSelf: function() {
    // If we miss one or more expected pings, then record idle event.
    let self = this;
    this.selfPingTimer.initWithCallback(function() {
      let now = Date.now();
      let diff = now - self.lastSelfPing;
      if (diff > self.selfPingInterval * 1.1) {
        // TODO we may occasionally see another event recorded between
        // 'estimatedStop' and 'now', in which case it will be in the file
        // before either of them... account for this in processing.
        let estimatedStop = self.lastSelfPing + self.selfPingInterval;
        // backdate my own timestamp:
        exports.handlers.record(DailyEventCodes.BROWSER_INACTIVE,
                                "Self-ping timer", "", "", estimatedStop);
        exports.handlers.record(DailyEventCodes.BROWSER_ACTIVATE,
                                "Self-ping timer");
      }
      self.lastSelfPing = now;
    }, this.selfPingInterval, 1);
  },

  observe: function(subject, topic, data) {
    // Subject is nsIIdleService. Topic is 'idle' or 'back'.  Data is elapsed
    // time in *milliseconds* (not seconds like addIdleObserver).
    if (topic == 'idle') {
      console.info("User has gone idle for " + data + " milliseconds.");
      let idleTime = Date.now() - parseInt(data);
      exports.handlers.record(DailyEventCodes.BROWSER_INACTIVE,
                              "IdleService observer", "", "", idleTime);
      if (this.selfPingTimer) {
        this.selfPingTimer.cancel();
      }
    }
    if (topic == 'back') {
      console.info("User is back! Was idle for " + data + " milliseconds.");
      exports.handlers.record(DailyEventCodes.BROWSER_ACTIVATE,
                              "IdleService observer");
      this.lastSelfPing = Date.now();
      this.pingSelf();
    }
  }
};

function DailyUseStudyWindowObserver(window, globalInstance) {
    DailyUseStudyWindowObserver.baseConstructor.call(this, window, 
						     globalInstance);
}

extend(DailyUseStudyWindowObserver, GenericWindowObserver);

DailyUseStudyWindowObserver.prototype.install = function () {
    // This allows access to the current browser window attributes
    let browser = this.window.getBrowser();
    
    if (!browser) {
        // Ignore non-browser window opens
        return;
    }

    let container = browser.tabContainer;
    this._listen(container, "TabOpen", function() {
            exports.handlers.recordNumWindowsAndTabs();
	    console.trace("Recording Opened tab.");
            }, false);
    this._listen(container, "TabClose", function() {
            // This happens before the tab closes, so adjust by -1 to get 
	    // the number after the close.
            exports.handlers.recordNumWindowsAndTabs(-1); 
	    console.trace("Recording Closed tab.");
            }, false);

    let numTabs = 0;
    let numWindows = exports.handlers._windowObservers.length;
    // Count the number of open tabs on this window.
    for (let i=0; i < numWindows; i++) {
        let window = exports.handlers._windowObservers[i].window;
        let browser = window.getBrowser();
        if (browser) {
            numTabs += browser.tabContainer.itemCount;
        }
    }

    // Increment by 1 again to capture the 'base' window as a tab as well
    numTabs += this.window.getBrowser().tabContainer.itemCount;
  
    exports.handlers.record( DailyEventCodes.NUM_TABS,
                             (numWindows + 1),
                             numTabs );
};

DailyUseStudyWindowObserver.prototype.uninstall = function() {
  DailyUseStudyWindowObserver.superClass.uninstall.call(this);
  // A window closed, so record new number of windows and tabs
  // EXCLUDING this one.
  let numTabs = 0;
  let numWindows = exports.handlers._windowObservers.length;
  for (let i = 0; i < numWindows; i++) {
    let window = exports.handlers._windowObservers[i].window;
    if (window != this.window) {
      let browser = window.getBrowser();
      if (browser) {
        numTabs += browser.tabContainer.itemCount;
      }
    }
  }
  
  exports.handlers.record( DailyEventCodes.NUM_TABS,
                           (numWindows - 1),
                           numTabs );
};


function DailyUseStudyGlobalObserver() {
    DailyUseStudyGlobalObserver.baseConstructor.call(this, 
                                                DailyUseStudyWindowObserver);
}

extend(DailyUseStudyGlobalObserver, BaseClasses.GenericGlobalObserver);

DailyUseStudyGlobalObserver.prototype.recordNumWindowsAndTabs = function(adj) {
    let numTabs = 0;
    if (adj != undefined) {
        numTabs += adj;
    }

    let numWindows = this._windowObservers.length;
    for (let i=0; i < numWindows; i++) {
        let window = this._windowObservers[i].window;
        let tabs = window.getBrowser().tabContainer.itemCount;
        numTabs += tabs;
    }

    this.record( DailyEventCodes.NUM_TABS, 
                 numWindows, 
                 numTabs);
};


DailyUseStudyGlobalObserver.prototype.getTotalPlacesNavHistory = function() {
  //Record the number of places in the history
  let historyService = Cc["@mozilla.org/browser/nav-history-service;1"]
    .getService(Ci.nsINavHistoryService);

  let options = historyService.getNewQueryOptions();
  let query = historyService.getNewQuery();
  let result = historyService.executeQuery(query, options);
  let rootNode = result.root;
  rootNode.containerOpen = true;
  let totalPlaces = rootNode.childCount;
  rootNode.containerOpen = false;

  return totalPlaces;
};

DailyUseStudyGlobalObserver.prototype.startAllObservers = function() {
  BookmarkObserver.install();
  DownloadsObserver.install();
  IdlenessObserver.install();
};

DailyUseStudyGlobalObserver.prototype.stopAllObservers = function() {
  BookmarkObserver.uninstall();
  DownloadsObserver.uninstall();
  IdlenessObserver.uninstall();
};

DailyUseStudyGlobalObserver.prototype.observe = function(subject, topic, data) {
    if (topic == "quit-application") {
        if (data == "shutdown") {
            this.record(DailyEventCodes.BROWSER_SHUTDOWN);
        } else { if (data == "restart") {
            this.record(DailyEventCodes.BROWSER_RESTART);
        }}
    }
};

DailyUseStudyGlobalObserver.prototype.onExperimentStartup = function(store) {
    DailyUseStudyGlobalObserver.superClass.onExperimentStartup.call(this, store);
    this.record(DailyEventCodes.STUDY_STATUS, 
            exports.experimentInfo.versionNumber);

    let totalPlaces = this.getTotalPlacesNavHistory();
    console.info("Total History Places: " + totalPlaces);
    this.record(DailyEventCodes.HISTORY_STATUS, totalPlaces, "", "");

    console.info("Daily Browser Usage: Starting subobservers.");
    this.startAllObservers();
    BookmarkObserver.runGlobalBookmarkQuery();

    this.obsService = Cc["@mozilla.org/observer-service;1"]
        .getService(Ci.nsIObserverService);
    this.obsService.addObserver(this, "quit-application", false);
};

// Utility function for recording events:
DailyUseStudyGlobalObserver.prototype.record = function(eventCode, val1, val2,
                                                        val3, timestamp, guid) {
  // Make sure string columns are strings
  if (!val1) {
    val1 = "";
  } else if (typeof val1 != "string") {
    val1 = val1.toString();
  }
  if (!val2) {
    val2 = "";
  } else if (typeof val2 != "string") {
    val2 = val2.toString();
  }
  if (!val3) {
    val3 = "";
  } else if (typeof val3 != "string") {
    val3 = val3.toString();
  }
  if (!timestamp) {
    timestamp = Date.now();
  }
  if (!guid) {
    guid = function() {
      let rng = Cc["@mozilla.org/security/random-generator;1"].
        createInstance(Ci.nsIRandomGenerator);
      let bytes = rng.generateRandomBytes(9);
      let byteString = 
        [String.fromCharCode(byte) for each (byte in bytes)].join("");
      return btoa(byteString).replace('+', '-', 'g').replace('/', '_', 'g');
    };
  }

 DailyUseStudyGlobalObserver.superClass.record.call(this,
  {
    event_code: eventCode,
    data1: val1,
    data2: val2,
    data3: val3,
    timestamp: timestamp,
    guid: guid
  });
},

DailyUseStudyGlobalObserver.prototype.onAppStartup = function() {
  DailyUseStudyGlobalObserver.superClass.onAppStartup.call(this);
  // TODO how can we tell if something has gone wrong with session restore?
  this.record(DailyEventCodes.BROWSER_START);
  console.info("Daily Usage study got app startup message.");

  //RESTORE SESSION information, number of tabs and windows restored
  let stateObject = null;
  let sessionStartup = Cc["@mozilla.org/browser/sessionstartup;1"]
                  .getService(Ci.nsISessionStartup);
  let sessionData = sessionStartup.state;
  if (sessionData) {
    stateObject = JSON.parse(sessionData);
    let countWindows = 0;
    let countTabs = 0;
    stateObject.windows.forEach(function(aWinData, aIx) {
      countWindows = countWindows + 1;
      let winState = {
        ix: aIx
      };
      winState.tabs = aWinData.tabs.map(function(aTabData) {
        let entry = aTabData.entries[aTabData.index - 1] || { url: "about:blank" };
        return {
          parent: winState
        };
      });

      for each (var tab in winState.tabs){
        countTabs += 1;
      }
    }, this);

    console.info("Session Restored: total windows: "+ countWindows
      + " total tabs: " +  countTabs);
    this.record(DailyEventCodes.SESSION_ON_RESTORE, countWindows,
                countTabs);
  } else {
    this.record(DailyEventCodes.SESSION_ON_RESTORE, "Windows 0", "Tabs 0");
  }

  // If available, record startup time!
  let runtime = Cc["@mozilla.org/xre/runtime;1"].getService(Ci.nsIXULRuntime);
  if (runtime && runtime.launchTimestamp) {
    let launched = runtime.launchTimestamp;
    let startup = runtime.startupTimestamp;
    let startupDuration = startup - launched;
    let app = Cc["@mozilla.org/toolkit/app-startup;1"]
          .getService(Ci.nsIAppStartup2);
    if (app && app.restoredTimestamp) {
      let restored = app.restoredTimestamp;
      let restoreDuration = restored - startup;
      this.record(DailyEventCodes.STARTUP_TIME,
                  "Startup: " + startupDuration,
                  "Restore: " + restoreDuration);
    } else {
      this.record(DailyEventCodes.STARTUP_TIME,
                  "Startup: " + startupDuration);
    }
  } else {
    this.record(DailyEventCodes.STARTUP_TIME, "Unavailable");
  }
};

DailyUseStudyGlobalObserver.prototype.onExperimentShutdown = function() {

  DailyUseStudyGlobalObserver.superClass.onExperimentShutdown.call(this);
  console.info("Day in the life: Shutting down subobservers.");
  this.stopAllObservers();
  // This check is to make sure nothing weird will happen if
  // onExperimentShutdown gets called more than once:
  if (this.obsService) {
    this.obsService.removeObserver(this, "quit-application", false);
    this.obsService = null;
  }
};

DailyUseStudyGlobalObserver.prototype.onEnterPrivateBrowsing = function() {
  // call record first, otherwise it becomes a no-op when we enter PB mode
  this.record(DailyEventCodes.PRIVATE_ON);
  DailyUseStudyGlobalObserver.superClass.onEnterPrivateBrowsing.call(this);
  this.stopAllObservers();
};

DailyUseStudyGlobalObserver.prototype.onExitPrivateBrowsing = function() {
  DailyUseStudyGlobalObserver.superClass.onExitPrivateBrowsing.call(this);
  this.record(DailyEventCodes.PRIVATE_OFF);
  this.startAllObservers();
};

// Instantiate and export the global observer (required!)
exports.handlers = new DailyUseStudyGlobalObserver();

// Web content
function DailyUseStudyWebContent()  {
  DailyUseStudyWebContent.baseConstructor.call(this, exports.experimentInfo);
}

// Web content
function DailyUseStudyWebContent()  {
  DailyUseStudyWebContent.baseConstructor.call(this, exports.experimentInfo);
};

extend(DailyUseStudyWebContent, BaseClasses.GenericWebContent);

DailyUseStudyWebContent.prototype.__defineGetter__("dataViewExplanation",
//TODO when study over, should say "at the end of the study" instead of "now".
  function() {
    return '<h4>Facts About Your Browser Use From <span id="usage-period-start-span"></span>\
    To <span id="usage-period-end-span"></span></h4>\
    <p><b>Bookmarks:</b> At the beginning of the study you had \
    <span id="first-num-bkmks-span"></span>. Now you have \
    <span id="num-bkmks-span"></span> in <span id="num-folders-span"></span>, \
    to a max folder depth of <span id="max-depth-span"></span>.</p>\
    <p><b>Downloads:</b> You downloaded <span id="num-downloads"></span> \
    during this week.</p>\
    </div>';
  });

DailyUseStudyWebContent.prototype.__defineGetter__("dataCanvas",
  function() {
      return this.rawDataLink +
      '<div class="dataBox"><div id="graph-div"></div>' +
      this.saveButtons + this.dataViewExplanation +'</div>';
  });

DailyUseStudyWebContent.prototype.__defineGetter__("saveButtons",
  function() {
    // Flot creates a canvas inside graph-div; that's the one we need.
    let btnCode = "saveCanvas(document.getElementById('graph-div').getElementsByTagName('canvas').item(0))";
    return '<div><button type="button" onclick="' + btnCode + '">\
    Save Graph</button>&nbsp;&nbsp;<button type="button"\
    onclick="exportData();">Export Data</button></div>';
  });


DailyUseStudyWebContent.prototype.onPageLoad = function(experiment,
                                                       document,
                                                       graphUtils) {

  experiment.getDataStoreAsJSON(function(rawData) {
    let firstNumBookmarks = null;
    let bkmks = 0;
    let folders = 0;
    let depth = 0;
    let firstTimestamp = 0;
    let maxBkmks = 0;
    let numDownloads = 0;

    let firstNumAddons = null;
    let numAddons = 0;

    // Make graphs of 1. memory and 2. tabs over time
    let memData = [];
    let tabData = [];
    let lastMemData = 0;
    let lastTabData = 0;
    for each ( let row in rawData ) {
      if (firstTimestamp == 0 ) {
        firstTimestamp = row.timestamp;
      }
      switch(row.event_code) {
      case DailyEventCodes.BOOKMARK_STATUS:
        bkmks = parseInt(row.data1.replace("total bookmarks", ""));
        folders = parseInt(row.data2.replace("folders", ""));
        depth = parseInt(row.data3.replace("folder depth", ""));
        if (firstNumBookmarks == null) {
          firstNumBookmarks = bkmks;
        }
      break;
      case DailyEventCodes.BOOKMARK_CREATE:
        switch (row.data1) {
          case "New Bookmark Added":
            bkmks += 1;
          break;
          case "New Bookmark Folder":
            folders += 1;
          break;
        }
      break;
      case DailyEventCodes.BOOKMARK_MODIFY:
        if (row.data1 == "Bookmark Removed") {
          bkmks -= 1;
        }
      break;
      case DailyEventCodes.DOWNLOAD:
        numDownloads += 1;
      break;
      case DailyEventCodes.MEMORY_USAGE:
        if (row.data1.indexOf("mapped") != -1) {
          let numBytes = parseInt(row.data2) / ( 1024 * 1024);
          memData.push([row.timestamp, numBytes]);
          lastMemData = numBytes;
        }
        break;
      case DailyEventCodes.NUM_TABS:
        let numTabs = parseInt(row.data2.replace(" tabs", ""));
        tabData.push([row.timestamp, numTabs]);
        lastTabData = numTabs;
        break;
      case DailyEventCodes.BROWSER_START: case DailyEventCodes.BROWSER_SHUTDOWN:
      case DailyEventCodes.BROWSER_RESTART:
        memData.push([row.timestamp, 0]);
        tabData.push([row.timestamp, 0]);
        lastMemData = 0;
        lastTabData = 0;
      break;
      }
    }

    let lastTimestamp;
    if (rawData.length > 0 && (experiment.status >= 4)) {
      lastTimestamp = rawData[(rawData.length - 1)].timestamp;
    } else {
      lastTimestamp = (new Date()).getTime();
    }

    // TODO x-axis dates are incorrectly converting to GMT somehow.
    /* TODO graph would be more readable if we drew lines between
     * observations points - but NOT lines down to zero-level, they
     * make the graph very busy and hard to read.  Instead, draw
     * disconnected lines. */
    let plotDiv = document.getElementById("graph-div");
    plotDiv.style.height="600px";
    graphUtils.plot(plotDiv, [{label: "Memory Used (MB) (Left Axis)",
                               data: memData,
                               points: {show: true}
                               },
                              {label: "Tabs Open (Right Axis)",
                               data: tabData,
                               color: "rgb(255, 100, 123)",
                               yaxis: 2,
                               points: {show: true}
                              }],
                    {xaxis: {mode: "time", timeformat: "%b %d, %h:%m"},
                     yaxis: {},
                     y2axis: {minTickSize: 1, tickDecimals: 0}}
                  );


    // Fill in missing values from html paragraphs:
    let getHours = function(x) {
      return Math.round( x / 36000 ) / 100;
    };
    let getFormattedDateString = function(timestamp) {
      let date = new Date(timestamp);
      let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                  "Sep", "Oct", "Nov", "Dec"];
      return months[date.getMonth()] + " " + date.getDate() + ", "
        + date.getFullYear();
    };
    let startSpan = document.getElementById("usage-period-start-span");
    let endSpan = document.getElementById("usage-period-end-span");
    if (startSpan) {
      startSpan.innerHTML = getFormattedDateString(firstTimestamp);
    }
    if (endSpan) {
      endSpan.innerHTML = getFormattedDateString(lastTimestamp);
    }
    if (firstNumBookmarks == null) {
      firstNumBookmarks = 0;
    }
    document.getElementById("first-num-bkmks-span").innerHTML =
                                    (firstNumBookmarks == 1)? "one bookmark" :
                                    firstNumBookmarks + " bookmarks";
    document.getElementById("num-bkmks-span").innerHTML =
                                    (bkmks == 1)? "one bookmark" :
                                    bkmks + " bookmarks";
    document.getElementById("num-folders-span").innerHTML =
                                    (folders == 1)? "one folder" :
                                    folders + " folders";
    document.getElementById("max-depth-span").innerHTML = depth;
    document.getElementById("num-downloads").innerHTML =
                                    (numDownloads == 1)? "one file" :
                                    numDownloads + " files";
  });
};

exports.webContent = new DailyUseStudyWebContent();

// Cleanup
require("unload").when(
  function myDestructor() {
    console.info("DailyUse study destructor called.");
    exports.handlers.onExperimentShutdown();
  });
