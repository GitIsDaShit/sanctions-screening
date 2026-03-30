import csv 
from collections import Counter 
with open('sdn.csv', encoding='latin-1') as f: 
    rows = list(csv.reader(f)) 
types = Counter(r[2].strip() for r in rows if len(r) > 2) 
for t, count in types.most_common(): 
    print(repr(t), count) 
