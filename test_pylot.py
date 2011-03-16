from sqlalchemy import Table, MetaData, Column, String, Integer, ForeignKey
from sqlalchemy import create_engine
from sqlalchemy.orm import mapper, sessionmaker



class Event(object):
    
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
for event in events:
    dlist.append(dict(event))



