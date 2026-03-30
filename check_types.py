import csv

with open(r"C:\Users\richa\Downloads\sdn.csv", encoding="latin-1") as f:
    rows = list(csv.reader(f))

nullrows = [r for r in rows if len(r) > 2 and r[2].strip() == "-0-"]
print(f"Antal -0- rader: {len(nullrows)}")
print()
for r in nullrows[:15]:
    name    = r[1][:50] if len(r) > 1 else ""
    typ     = r[2]
    program = r[3][:30] if len(r) > 3 else ""
    print(f"{name:<50} | {typ} | {program}")
