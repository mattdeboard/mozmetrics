/* Metrics sync engine for Mozilla Weave
 * Matt DeBoard (matt.deboard@gmail.com)
 */

const EXPORTED_SYMBOLS = ["Metrics", "MetricsRecord"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/JSON.jsm");
Cu.import("resource://services-sync/engines.js");
Cu.import("resource://services-sync/main.js");
Cu.import("resource://services-sync/record.js");
Cu.import("resource://services-sync/util.js");
Cu.import("resource://services-sync/engines/clients.js");
Cu.import("resource://modules/collector.js");

const METRICS_TTL = 604800; // 7 days

function MetricsRecord(collection, id) {
  CryptoWrapper.call(this, collection, id);
}

MetricsRecord.prototype = {
  __proto__: CryptoWrapper.prototype,
  _logName: "Record.Metrics",
  ttl: METRICS_TTL,
  appName: Svc.AppInfo.name,
  appVer: Svc.AppInfo.version,
  appPlatVer: Svc.AppInfo.platformVersion
};

Utils.deferGetSet(MetricsRecord, "cleartext", ["event_code", "data1", "data2", 
					       "data3", "timestamp"]);

Utils.lazy(this, "Metrics", MetricsEngine);

function MetricsEngine() {
  SyncEngine.call(this, "Metrics");
}

MetricsEngine.prototype = {
  // Don't need dupe checking per se since we're going to have a lot of
  // "dupe" entries, maybe even duplicate eventCodes per timestamp. Some
  // rows in the metrics database, in other words, may be exactly identi-
  // cal.
  __proto__: SyncEngine.prototype,
  _recordObj: MetricsRecord,
  _storeObj: MetricsStore,
  _trackerObj: MetricsTracker
};

function MetricsStore(name) {
  Store.call(this, name);
}

MetricsStore.prototype = {
  /* Am I approaching this all wrong? Instead of simply polling the data
   * from the database, do I need to set up observers on each of the 
   * events which we want to measure? That solution seems to be beyond
   * the relatively narrow scope of the Sync service, since each built-
   * in collection seems to be observing a discrete metric, such as book-
   * marks, tabs, history, and so forth. The Metrics service would be
   * observing a wide variety of metrics, like browser stops and starts,
   * downloads, addon installs, and so forth.
   * 
   * If polling a database IS the proper way to do it, do I need to set
   * an observer for startup events in the MetricsTracker prototype, and
   * have it check datetime of last update, and if it was 24 hours ago or
   * longer, trigger a database read/new MetricsRecord instance?
   */
  __proto__: Store.prototype,
  
  _fileName: null,

  _initDB: function (fileName, tableName, columns) {
    // These properties reflect the properties of the dataStoreInfo
    // used by TestPilot originally, upon which this addon is heavily
    // based.
    this._fileName = fileName;
    this._tableName = tableName;
    this._columns = columns;
    // Returns an object representing a connection to the metrics db
    // client-side. This is step 1 in preparing a new record.
    let storageSvc = Cc["@mozilla.org/storage/service;1"].
                     getService(Ci.mozIStorageService);
    let file = Cc["@mozilla.org/file/directory_service;1"].
               getService(Ci.nsIProperties).
               get("ProfD", Ci.nsIFile);
    file.append(this._fileName);
    return storageSvc.openDatabase(file);
  },
    
  get columns () {
    /* dataStoreInfo's "columns" property is an array with some 
     * extraneous information from which we need to parse the column
     * names, which is defined in each column's "property" property.
     * How's that for confusing naming conventions?
     */
    let results = [];
    let cols = collector.dataStoreInfo["columns"];
    for (let i=0; i < cols.length; i++) {
      results.push(cols[i].property);
    };
    return results;
  },

  get stmt () {
    // Creates an mozIStorageStatement object we can iterate through
    // to create serialized data from the metrics db. A GUID will be added
    // by _setGUID. This is step 2 in preparing a new record.
    // dataStoreInfo is imported from collector.js
    let openConn = this._initDB(collector.dataStoreInfo["fileName"], 
				                collector.dataStoreInfo["tableName"], 
				                this.columns());
    let now = Date.now();
    let sqlQuery = "SELECT * FROM " + this._tableName + 
      " WHERE timestamp > :last";
    sqlQuery.params.last = this.lastSyncLocal;
    return openConn.createStatement(sqlQuery);
  },
  
  get metricsData () {
    // This is step 3 in preparing a new record.
    let statement = this.stmt;
    return Utils.queryAsync(statement, this._columns);
  },

  _setGUID: [],
  get setGUID () {
    // returns a value like {<guid>: {<stats array>}}
    let stats = this.metricsData;
    let guid = Utils.makeGUID();
    this._setGUID[guid] = stats;
    return this._setGUID;
  },
  
  createRecord: function createRecord(id, collection) {
    let record = new MetricsRecord(collection, id);
    record.value = this._setGUID;
    return record;
  },
  
  itemExists: function itemExists(id) {
    let statement = "SELECT * FROM " + this._tableName + "WHERE guid = :guid";
    return Utils.queryAsync(statement, this._columns)[0];
  },
  
  getAllIDs: function MetricsStore_getAllIDs() {
    let statement = "SELECT guid FROM " + this._tableName;
    let ids = Utils.queryAsync(statement, this._columns);
    return ids;
  },
  
  wipe: function MetricsStore_wipe() {
    this._remoteClients = {};
  },
  
  create: function MetricsStore_create(record) {
    this._log.trace("Ignoring create call.");
  },
  
  update: function MetricsStore_update(record) {
    this._log.trace("Ignoring update call.");
  },

  remove: function MetricsStore_remove(record) {
    this._log.trace("Ignoring remove call.");
  }
};

function MetricsTracker(name) {
  Tracker.call(this, name);
  
  Svc.Obs.add("profile-after-change", this);
  Svc.Obs.add("weave:engine:start-tracking", this);
  Svc.Obs.add("weave:engine:stop-tracking", this);
};

MetricsTracker.prototype = {
  __proto__: Tracker.prototype,
  
  _enabled: False,
  observe: function observe(subject, topic, data) {
    switch (topic) {
    case "weave:engine:start-tracking":
      if (!this._enabled) {
        Svc.Obs.add("profile-after-change", this);
        this._enabled = true;
      }
      break;
    case "weave:engine:stop-tracking":
      if (this._enabled) {
        Svc.Obs.remove("profile-after-change", this);
        this._enabled = false;
      }
      break;
    case "profile-before-change":
      // If "right now" is more than 24 hours after last sync, bump score
      // to 100 for Sync ASAP.
      if ((Date.now()-86400000) >= this.lastSyncLocal) {
        this.score += 100;
        this.modified = true;
        this._log.trace("App startup at " + Date.now() + " detected.");
      }
      break;
    }
  }
};  

function MetricsSvc() {
  Utils.delay(this._registerEngine, 7000, this, "_startupTimer");
};

MetricsSvc.prototype = {
  _registerEngine: function () {
    Engines.register(MetricsEngine);
  }
}

var metricsSvc = new MetricsSvc();
