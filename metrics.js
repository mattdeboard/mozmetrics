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
Cu.import("resource://services-sync/record.js");
Cu.import("resource://services-sync/util.js");
Cu.import("resource://services-sync/engines/clients.js");
// How do I do this properly?
Cu.import("/home/matt/mozmetrics/daily_metrics.js");

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
  
  _initDB: function (fileName, tableName, columns) {
    // These properties reflect the properties of the dataStoreInfo
    // used by TestPilot originally, upon which this addon is heavily
    // based.
    this._fileName = fileName;
    this._tableName = tableName;
    this._columns = columns;
    // Returns an object representing a connection to the metrics db
    // client-side. This is step 1 in preparing a new record.
    let storageSvc = Cc["@mozilla.org/storage/service;1"]
      .getService(Ci.mozIStorageService);
    let file = Cc["@mozilla.org/file/directory_service;1"]
      .getService(Ci.nsIProperties)
      .get("ProfD", Ci.nsIFile);
    file.append(this._fileName);
    return storageSvc.openDatabase(file);
  },
  
  _stmt: null,
  get stmt () {
    // Creates an mozIStorageStatement object we can iterate through
    // to create serialized data from the metrics db. A GUID will be added
    // by _setGUID. This is step 2 in preparing a new record.
    let openConn = this._initDB(dataStoreInfo.fileName, 
				dataStoreInfo.tableName, 
				dataStoreInfo.columns);
    let now = Date.now();
    let sqlQuery = "SELECT * FROM " + this._tableName + 
      " WHERE timestamp > :last";
    sqlQuery.params.last = this.lastSyncLocal;
    return openConn.createStatement(sqlQuery);
  },
  
  _metricsData: [],
  get metricsData () {
    /* Utils.queryAsync returns a {column_name: value} array from our metrics 
     * db, so there is no need to write a custom mozIStorageService algorithm 
     * here. This is step 3 in preparing a new record. */
    let statement = this._stmt;
    return Utils.queryAsync(statement, this._columns);
  },

  _setGUID: [],
  get setGUID () {
    // returns a value like {<guid>: {<stats array>}}
    let stats = this._metricsData;
    let guid = Utils.makeGUID();
    return this._setGUID[guid] = stats;
  },
  
  createRecord: function createRecord(id, collection) {
    let record = new MetricsRecord(collection, id);
    return record;
  },
  
  itemExists: function itemExists(id) {


    
  }
  
};

function MetricsTracker(name) {
  Tracker.call(this, name);
  
  Svc.Obs.add("weave:engine:start-tracking", this);
  Svc.Obs.add("weave:engine:stop-tracking", this);
}

MetricsTracker.prototype = {
  __proto__: Tracker.prototype,
  
  _enabled: False,
  

