

**10. BUTTON RESPONSE SPEED**

* All buttons must respond instantly (0–0.3 sec)
* Disable button after click
* Show small loader if needed

**11. NETWORK HANDLING**

* Handle slow internet properly
* Retry failed requests
* Prevent duplicate actions

---

**12. DATABASE OPTIMIZATION**

* Index:
  → salon_id
  → status
  → queue_position

* Minimize reads/writes

---

**13. TARGET PERFORMANCE**

We need:

* App open: < 2 seconds
* Join queue: instant
* Serve / Done / Skip: instant
* Queue update: real-time (< 1 sec)
* No visible lag anywhere

