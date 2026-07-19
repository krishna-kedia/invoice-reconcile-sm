# Thread: Hotel Accounting Automation (Product Overview)

---

**1/**
A hotel I know had one person doing all the accounting.

Every night: print the day's invoices, pull up net banking, open the OTA portals, cross-reference everything in Excel.

She was spending 3 hours a day just figuring out if the money that came in matched the money she was owed. (252)

---

**2/**
The documents involved:

Walk-in invoices. MakeMyTrip payouts. Yatra payout sheets. Agoda statements. HDFC bank statements. Card settlement reports. UPI transaction logs.

All in different formats. All downloaded manually. All reconciled by hand, row by row, every single day. (244)

---

**3/**
The failure mode wasn't theft or fraud.

It was a merged Excel cell. A copied formula that was off by one row. A ₹12,000 UPI payment applied to the wrong invoice because two entries looked identical.

By the time anyone noticed, the trail was 3 weeks cold. (243)

---

**4/**
So I built the whole pipeline from scratch.

OCR that reads every invoice format — walk-in, MMT, Yatra, Agoda — and dumps structured data into a database. Bank statements parsed automatically. Card MPRs ingested. UPI logs pulled in.

Everything the hotel touches, in one place, automatically. (258)

---

**5/**
Then the reconciliation layer on top.

Every payment transaction has a tracked "remaining" balance — so the same ₹8,000 bank credit can never be claimed against two invoices, even by accident, even with two people working simultaneously.

The database enforces it. Not a rule. A lock. (262)

---

**6/**
The operator's workflow now:

Open invoice → method and date pre-fill from the matching payout record → one transaction appears → click → save.

What used to be 3 hours of nightly spreadsheet work is 15 minutes of click-through. The books close the same day the money moves. (255)

---

**7/**
Every action is in an immutable audit log.

Admin approvals required to reverse anything. Discrepancies flagged automatically. Nothing gets quietly adjusted.

Small hotels don't have accounting teams. They have one person doing everything. I wanted to build something that had her back. (252)

---

**8/**
Still early. One property, two users.

But the accounting chaos I described — mismatched OTA payouts, untracked card settlements, Excel files nobody fully trusts — that's not unique to this hotel.

If you're running a small hospitality business: what does your end-of-day reconciliation actually look like? (256)
