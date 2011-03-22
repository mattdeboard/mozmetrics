/* Metrics sync engine for Mozilla Weave
 * Matt DeBoard (matt.deboard@gmail.com)
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/JSON.jsm");
Cu.import("resource://services-sync/engines.js");
Cu.import("resource://services-sync/record.js");
Cu.import("resource://services-sync/util.js");

const METRICS_TTL = 604800; // 7 days

function MetricsRecord(collection, id) {
    CryptoWrapper.call(this, collection, id);
}

MetricsRecord.prototype = {
    __proto__: CryptoWrapper.prototype,
    _logName: "Record.Metrics",
    ttl: METRICS_TTL
};

Utils.deferGetSet(MetricsRecord, "cleartext", ["event_code", "data1", "data2", 
					       "data3", "timestamp"]);

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
    __proto__: Store.prototype,

    _initDB: function (fileName, tableName, columns) {
	// These properties reflect the properties of the dataStoreInfo
	// used by TestPilot originally, upon which this addon is heavily
	// based.
	this._fileName = fileName;
	this._tableName = tableName;
	this._columns = columns;
	// Returns an object representing a connection to the metrics db
	// client-side. 
	let storageSvc = Cc["@mozilla.org/storage/service;1"]
	    .getService(Ci.mozIStorageService);
	let file = Cc["@mozilla.org/file/directory_service;1"]
	    .getService(Ci.nsIProperties)
	    .get("ProfD", Ci.nsIFile);
	file.append(this._fileName);
	let dbConn = storageSvc.openDatabase(file);
	return dbConn;
    },

    _serialize: function (callback) {
	/* _serialize creates a JSON data object, a "snapshot" of the database 
	 * where the earliest entry is the first entry after the previous 
	 * snapshot. */

	// This is ugly. Definitely need to factor out the SQL query to select
	// only rows that weren't included in the last update.
	// lastSyncLocal is a built-in method of the SyncEngine superclass 
	// defined in engines.js.
	let now = Date.now();
	let last = this.lastSyncLocal;
	let sqlQuery = "SELECT * FROM " + this._tableName + 
	    " WHERE timestamp > last";
	let stmt = this._createStatement(sqlQuery);
	let latestStats = [];
	let numCols = stmt.columnCount;
	let self = this;

	stmt.executeAsync({
	    handleResult: function(aResultSet) {
		/* Python equiv (if numCols and stats were dicts) of:
		 * 
		 * for row in results:
		 *   newStat = {}
		 *   for i in numCols:
		 *     column = self._columns[i]
		 *     value = 0
		 *     if column.type == "TYPE_INT_32":
		 *       value = row.getInt32(i)
		 *     elif column.type == "TYPE_DOUBLE":
		 *       value = row.getDouble(i)
		 *     else:
		 *       value = sanitizeString(row.getUTF8String(i))
		 *     newStat[column.name] = value
		 *   latestStats[row.timestamp] = newStat
		 * 
		 * Pythonic pseudocode there obviously.
		 */
		for (let row = aResultSet.getNextRow(); row; 
		     row = aResultSet.getNextRow()) {
		    let newStat = [];
		    for (let i = 0; i < numCols; i++) {
			let column = self._columns[i];
			let value = 0;
			let colName = self._columns[i].property;
			switch (column.type) {
			    case TYPE_INT_32:
			      value = row.getInt32(i);
			    break;
			    case TYPE_DOUBLE:
			      value = row.getDouble(i);
			    break;
			    case TYPE_STRING:
			      value = sanitizeString(row.getUTF8String(i));
			    break;
			}
			/* Doing it thusly gives us a fairly easy-to-read data
			 * set, ex.:
			 * 
			 * {"event_code": 26, "data1": "1", "data2": "3", 
			 * "data3": "", "timestamp": 130020323}
			 * 
			 * This is untested as of 21Mar2011
			 */
			newStat[colName] = row.getResultByName(colName);
		    }
		    latestStats.push(newStat);
		}
	    },
	    handleError: function(aError) {
		callback(latestStats);
	    },
	    handleCompletion: function(aReason) {
		callback(latestStats);
	    }
	});
	stmt.finalize();
    }
};
    
