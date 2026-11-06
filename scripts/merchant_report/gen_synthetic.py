# Buat workbook SINTETIS berformat export "Content Analysis › Video List" (Agu v1 +
# Sep v2) untuk menguji port TS (lib/merchant-report) terhadap compute_metrics.py.
# Sengaja memuat kasus sulit: baris pecahan post×outlet (Agustus), baris invalid,
# GMV seri (banyak nol), link status kosong, kota kosong, durasi pecahan (15,5),
# task type kosong, judul berfitur caption, post lintas bulan.
# Pakai: python3 gen_synthetic.py <out.xlsx> [seed]
import sys, random
import openpyxl

out = sys.argv[1]
rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 7)

V1 = ["Location industry", "Status", "Creator type", "Post ID", "Post title", "Post date", "Duration",
      "Task type", "Location ID", "Location name", "Location city", "Merchant", "Creator name", "Creator ID",
      "Creator link status", "Creator city", "Creator level", "Sales value", "Orders", "Redemption amount",
      "Redeemed orders", "Video views", "CTR", "CVR", "AOV"]
V2 = ["Industry", "Current status", "Creator type", "Post ID", "Post link", "Post title", "Post date", "Duration",
      "Task type", "Product ID", "Location ID", "Location name", "Location city", "Location region", "Merchant",
      "Creator name", "Creator ID", "Creator link status", "Creator city", "Creator province", "Creator level",
      "Sales value", "Orders", "Redemption amount", "Redeemed orders", "Video views"]

outlets = [(str(4220000 + i), f"Sushi Yay{'!' if i % 2 else ''} - Outlet{i:02d}",
            rnd.choice(["Bandung", "Jakarta Selatan", "Pekanbaru", "Bogor", ""])) for i in range(22)]
creators = [(f"Kreator{i:03d}", f"Nama {i}", rnd.choice(["Linked creators", "", "Bound creators"]),
             rnd.choice(["Bandung", "Depok", ""]), rnd.choice(["Lv.1", "Lv.2", "Lv.3", ""])) for i in range(60)]
titles = ["AYCE cuma 99rb buruan klik tag lokasi", "makan enak di bandung", "Promo paket premium hari ini",
          "review jujur", "Rp 120.000 all you can eat", "", "sushi murah jakarta pilih voucher", "enak bgt 50k"]
tasks = ["Collaboration package", "Others", ""]

def rows_for(month, ym, n_posts, v2):
    out_rows = []
    pid = 7600000000000000000 + (1 if v2 else 0) * 10 ** 12
    for p in range(n_posts):
        post_id = str(pid + p * 17 + rnd.randint(0, 9))
        day = rnd.randint(1, 28)
        # sebagian post dari bulan sebelumnya (bukan new post)
        pmonth = ym if rnd.random() < 0.6 else ("202607" if ym == "202608" else "202608")
        pdate = f"{pmonth}{day:02d}"
        cr = rnd.choice(creators[: 45 if v2 else 60])
        dur = rnd.choice([None, 9, 15, 15.5, 22, 30, 41, 60])
        title = rnd.choice(titles)
        task = rnd.choice(tasks)
        for loc in rnd.sample(outlets, rnd.choice([1, 1, 1, 2, 3])):
            k = 2 if (not v2 and rnd.random() < 0.15) else 1  # baris pecahan di Agustus
            for _ in range(k):
                orders = rnd.choice([0, 0, 0, 0, 1, 2, 3, 5, 8, 13, 0])
                gmv = round(orders * rnd.choice([49000, 58500, 99000.5]), 2)
                red = round(gmv * rnd.choice([0, 0.5, 0.8, 1.0]), 2)
                views = rnd.choice([0, 120, 480, 900, 1500, 3000, 12000, 60000])
                status = "Valid posts" if rnd.random() < 0.9 else "Invalid posts"
                link = cr[2] if rnd.random() < 0.85 else ""
                base = {
                    "Location industry": "Dining", "Industry": "Dining", "Status": status, "Current status": status,
                    "Creator type": "Managed creators", "Post ID": post_id, "Post link": "https://x/" + post_id,
                    "Post title": title, "Post date": pdate, "Duration": dur, "Task type": task, "Product ID": "1",
                    "Location ID": loc[0], "Location name": loc[1], "Location city": loc[2], "Location region": "ID",
                    "Merchant": "GoFood by Gojek", "Creator name": cr[1], "Creator ID": cr[0],
                    "Creator link status": link, "Creator city": cr[3], "Creator province": "Jawa Barat",
                    "Creator level": cr[4], "Sales value": str(gmv), "Orders": str(orders),
                    "Redemption amount": str(red), "Redeemed orders": str(orders), "Video views": str(views),
                    "CTR": "0.01", "CVR": "0", "AOV": "",
                }
                out_rows.append(base)
    return out_rows

wb = openpyxl.Workbook()
wb.remove(wb.active)
for sheet, ym, n, v2 in [("Agus 2026", "202608", 140, False), ("SEPT 2026", "202609", 180, True)]:
    ws = wb.create_sheet(sheet)
    hdr = V2 if v2 else V1
    ws.append(hdr)
    for r in rows_for(sheet, ym, n, v2):
        ws.append([r.get(h) for h in hdr])
wb.save(out)
print("written", out)
