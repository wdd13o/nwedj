Super Admin panel (static)
==========================

What this is
------------

A simple static, client-side "super admin" page to view RSVPs and a media manifest. It is intentionally simple and intended for local testing or as a starting point.

Files added
-----------

- `admin/login.html` — admin UI (login + panel)
- `admin/admin.js` — client-side logic (password check, data fetching, render)
- `admin/styles.css` — styles for admin panel
- `data/rsvp.json` — sample RSVP data (edit or replace with real data)
- `data/media.json` — sample media manifest (list of images/videos and paths)

How it works
------------

1. Open `admin/login.html` in a browser.
2. Enter the password `letmein` (change the password in `admin/admin.js` for development).
3. On success you'll be redirected to `admin/dashboard.html`. The dashboard fetches `../data/rsvp.json` and `../data/media.json` and renders them.

Notes & next steps
------------------

- This is client-side only and not secure. For real admin access implement server-side auth and endpoints.
- Static sites cannot list directory contents; the `data/media.json` manifest is required to list media items. You can generate this server-side or maintain it manually.
- You can replace the sample JSON files with your actual storage endpoints or expand the code to call APIs.

Quick local test
----------------

Open in your browser (no server required for local testing of static files, but some browsers block cross-file fetch when opening `file://` — use a simple static server if needed):

On Windows PowerShell you can run a quick static server using Python (if installed):

```powershell
# from project root
python -m http.server 8000
# then open http://localhost:8000/admin/login.html
```
