from sqlalchemy import Table, MetaData, Column, String, Integer, ForeignKey
from sqlalchemy import create_engine
from sqlalchemy.orm import mapper, sessionmaker

# test_pylot.py is a bridge between Mozilla Test Pilot, a broader effort
# to collect anonymous usage data, and eventually a dedicated data
# pipeline for Mozilla's metrics team.
#
# Author: Matt DeBoard (http://mattdeboard.net)

class Event(object):
    '''Event is a prototype class, in case we wind up with some MVC/MVT
    web framework apart from Test Pilot.'''
    
    def __init__(self, event_code, data1, data2, data3, timestamp):
        self.event_code = event_code
        self.data1 = data1
        self.data2 = data2
        self.data3 = data3
        self.timestamp = timestamp

    def __repr__(self):
        return "<Event('%d', '%s', '%s', '%s', '%d')>" % (self.event_code, 
                                                                self.data1, 
                                                                self.data2, 
                                                                self.data3, 
                                                                self.timestamp)


# sqlalchemy connection to the db
engine = create_engine("sqlite:///browser_usage_example_results.sqlite")
# defining the table to use for queries, auto-populate with the data from
# the engine connection
usage_patterns = Table("usage_patterns", 
                       meta, 
                       autoload=True, 
                       autoload_with=engine)

# establish a session class based on the engine connection
Session = sessionmaker(bind=engine)
# instantiate the session
session = Session()
# bind a metadata object to the db
meta = MetaData(bind=engine)
# simple query from the table, sorted by the timestamp field 
# (.order_by("-timestamp") to sort in reverse). Returned as a list of
# tuples, one tuple per row.
q = session.query(usage_patterns).order_by("timestamp")
# tuple containing column names
keys = ('event_code', 'data1', 'data2', 'data3', 'timestamp')
# zip the rows in the query with the column headers to get a list of a
# list of tuples (not a typo... [[(a,b), (c,d)], [(e,f), (g,h)]] ) 
events = [zip(keys,row) for row in q]
# Returns a list of dictionaries -- this belongs inside a class.
dlist = []
for event in events:
    dlist.append(dict(event))
event_stream = {}
event_stream['events'] = dlist
event_stream['iter'] += 1
# Prep serial data for POST
serial_data = json.dumps(event_stream, sort_keys=True, indent=4)

