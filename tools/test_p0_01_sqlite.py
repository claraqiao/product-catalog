#!/usr/bin/env python3
"""P0-01 isolated SQLite regression for the D1 trial photo anti-join.
No Cloudflare credentials, network, or production data are used.
"""
import sqlite3

QUERY = """SELECT DISTINCT refs.object_key FROM
 (SELECT display_key AS object_key FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.status='active'
 UNION SELECT thumb_key AS object_key FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.status='active') refs
 LEFT JOIN trial_image_objects o ON o.object_key=refs.object_key
 WHERE refs.object_key IS NULL OR refs.object_key='' OR o.object_key IS NULL LIMIT 1"""

for count in (50, 800, 2000):
    db = sqlite3.connect(":memory:")
    db.executescript("""CREATE TABLE products(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE product_images(product_id INTEGER,display_key TEXT,thumb_key TEXT);
    CREATE TABLE trial_image_objects(object_key TEXT PRIMARY KEY);""")
    db.executemany("INSERT INTO products VALUES (?,?)", ((i, "active") for i in range(count)))
    photos = [(i, f"d/{i}/{j}", f"t/{i}/{j}") for i in range(count) for j in range(3)]
    db.executemany("INSERT INTO product_images VALUES (?,?,?)", photos)
    db.executemany("INSERT INTO trial_image_objects VALUES (?)", ((key,) for _,d,t in photos for key in (d,t)))
    assert db.execute(QUERY).fetchall() == [], "present photos incorrectly rejected"
    db.execute("DELETE FROM trial_image_objects WHERE object_key='t/0/0'")
    assert db.execute(QUERY).fetchall() == [("t/0/0",)], "missing thumbnail not rejected"
    db.execute("INSERT INTO trial_image_objects VALUES ('t/0/0')")
    db.execute("UPDATE product_images SET thumb_key='' WHERE product_id=0 AND display_key='d/0/0'")
    assert db.execute(QUERY).fetchall() == [("",)], "blank thumbnail not rejected"
    db.execute("UPDATE product_images SET thumb_key='t/0/0' WHERE product_id=0 AND display_key='d/0/0'")
    db.execute("INSERT INTO products VALUES (?, 'draft')", (count,))
    db.execute("INSERT INTO product_images VALUES (?, 'unpublished', 'unpublished-thumb')", (count,))
    assert db.execute(QUERY).fetchall() == [], "draft photos incorrectly checked"
    print(f"PASS SQLite anti-join: {count} products / {count*3} images; missing, blank and draft isolation")
    db.close()
