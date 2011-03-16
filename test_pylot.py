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

class Report():

    


engine = create_engine("sqlite:///browser_usage_example_results.sqlite")

usage_patterns = Table("usage_patterns", 
                       meta, 
                       autoload=True, 
                       autoload_with=engine)


Session = sessionmaker(bind=engine)
session = Session()
meta = MetaData(bind=engine)
q = session.query(usage_patterns).order_by("timestamp")
keys = ('event_code', 'data1', 'data2', 'data3', 'timestamp')
events = [zip(keys,i) for i in q]
dlist = []


# Returns a list of dictionaries -- this belongs inside a class.
for event in events:
    dlist.append(dict(event))
event_stream = {}
event_stream['events'] = dlist
event_stream['iter'] += 1
# Prep serial data for POST
serial_data = json.dumps(event_stream, sort_keys=True, indent=4)

