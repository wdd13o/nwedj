// Simple client-side admin UX — NOT secure for production
(function(){
  // change this password for local testing only
  const PASSWORD = 'letmein';

  // NOTE: do not clear localStorage here — admin needs to read stored RSVPs submitted by guests

  // auth helpers
  const AUTH_KEY = 'wedding_admin_auth';
  function isAuthed(){ return sessionStorage.getItem(AUTH_KEY) === '1'; }
  function setAuthed(){ sessionStorage.setItem(AUTH_KEY,'1'); }
  function clearAuth(){ sessionStorage.removeItem(AUTH_KEY); }

  // DOM nodes (optional depending on page)
  const loginForm = document.getElementById('adminLoginForm');
  const loginSection = document.getElementById('loginSection');
  const adminPanel = document.getElementById('adminPanel');
  const logoutBtn = document.getElementById('logoutBtn');
  const rsvpContainer = document.getElementById('rsvpContainer');
  const mediaGrid = document.getElementById('mediaGrid');
  const mediaFilter = document.getElementById('mediaFilter');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const lastUpdate = document.getElementById('lastUpdate');
  const totalCountEl = document.getElementById('totalCount');
  const yesCountEl = document.getElementById('yesCount');
  const maybeCountEl = document.getElementById('maybeCount');
  const noCountEl = document.getElementById('noCount');
  const homeBtn = document.getElementById('homeBtn');
  const attendingFilter = document.getElementById('attendingFilter');
  const rsvpSearch = document.getElementById('rsvpSearch');
  const clearFilterBtn = document.getElementById('clearFilterBtn');

  function updateLastUpdateTime() {
    if(lastUpdate) {
      lastUpdate.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
    }
  }

  // Inline edit/delete handlers
  function onEditClick(e){
    const idx = Number(e.currentTarget.dataset.idx);
    const filtered = getFilteredRsvps();
    const item = filtered[idx];
    const all = currentRsvps;
    let abs = all.indexOf(item);
    if(abs === -1) abs = idx;
    const record = all[abs] || {};
    const tr = rsvpContainer.querySelector(`tbody tr[data-idx="${idx}"]`);
    if(!tr) return;
    tr.innerHTML = `<td>${idx+1}</td>
      <td><input class="rsvp-edit-name" value="${escapeHtml(record.name||'')}"></td>
      <td><input class="rsvp-edit-tel" value="${escapeHtml(record.tel||'')}"></td>
      <td><select class="rsvp-edit-attending"><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></td>
      <td><textarea class="rsvp-edit-notes">${escapeHtml(record.notes||'')}</textarea></td>
      <td>${record.submittedAt ? new Date(record.submittedAt).toLocaleString() : ''}</td>
      <td><button class="btn" data-action="save">Save</button> <button class="btn btn-outline" data-action="cancel">Cancel</button></td>`;
    const sel = tr.querySelector('.rsvp-edit-attending'); if(sel) sel.value = (record.attending||'').toLowerCase()||'yes';
    tr.querySelector('button[data-action="save"]').addEventListener('click', ()=>{
      const name = tr.querySelector('.rsvp-edit-name').value.trim();
      const tel = tr.querySelector('.rsvp-edit-tel').value.trim();
      const attending = tr.querySelector('.rsvp-edit-attending').value;
      const notes = tr.querySelector('.rsvp-edit-notes').value.trim();
      const updated = Object.assign({}, record, {name,tel,attending,notes});
      if(updated.id) saveRsvpToLocal(updated);
      all[abs] = updated;
      currentRsvps = all;
      applyRsvpFilterAndRender();
    });
    tr.querySelector('button[data-action="cancel"]').addEventListener('click', ()=> applyRsvpFilterAndRender());
  }

  function onDeleteClick(e){
    const idx = Number(e.currentTarget.dataset.idx);
    const filtered = getFilteredRsvps();
    const item = filtered[idx];
    const all = currentRsvps;
    let abs = all.indexOf(item);
    if(abs === -1) abs = idx;
    if(!confirm('Delete this RSVP?')) return;
    const removed = all.splice(abs,1);
    if(removed && removed[0] && removed[0].id) deleteRsvpFromLocal(removed[0].id);
    currentRsvps = all;
    applyRsvpFilterAndRender();
  }

  function saveRsvpToLocal(rsvp){
    try{
      const raw = localStorage.getItem('rsvps');
      let arr = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(arr)) arr = [];
      if(rsvp.id){
        const i = arr.findIndex(x=>String(x.id)===String(rsvp.id));
        if(i>=0) arr[i] = rsvp; else arr.push(rsvp);
      } else arr.push(rsvp);
      localStorage.setItem('rsvps', JSON.stringify(arr));
      try{ const ch = new BroadcastChannel('wedding_rsvps'); ch.postMessage({type:'rsvps_updated'}); ch.close(); }catch(e){}
    }catch(e){ console.warn('saveRsvpToLocal error', e); }
  }

  function deleteRsvpFromLocal(id){
    try{
      const raw = localStorage.getItem('rsvps');
      let arr = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(arr)) arr = [];
      const i = arr.findIndex(x=>String(x.id)===String(id));
      if(i>=0){ arr.splice(i,1); localStorage.setItem('rsvps', JSON.stringify(arr)); }
      try{ const ch = new BroadcastChannel('wedding_rsvps'); ch.postMessage({type:'rsvps_updated'}); ch.close(); }catch(e){}
    }catch(e){ console.warn('deleteRsvpFromLocal error', e); }
  }

  function updateStats(rsvps){
    if(!rsvps || !Array.isArray(rsvps)) rsvps = [];
    const total = rsvps.length;
    const yes = rsvps.filter(r => (r.attending||'').toLowerCase() === 'yes').length;
    const maybe = rsvps.filter(r => (r.attending||'').toLowerCase() === 'maybe').length;
    const no = rsvps.filter(r => (r.attending||'').toLowerCase() === 'no').length;
    // helper: animate value change with count-up and pulse
    function animateCount(el, to, duration=600){
      if(!el) return;
      const from = parseInt(el.textContent||'0',10) || 0;
      if(from === to){ el.textContent = String(to); return; }
      const start = performance.now();
      const step = (now)=>{
        const t = Math.min(1, (now - start)/duration);
        const val = Math.round(from + (to - from) * t);
        el.textContent = String(val);
        if(t < 1){
          el._countAnim = requestAnimationFrame(step);
        } else {
          el.textContent = String(to);
          el.classList.remove('pulse');
          void el.offsetWidth;
          el.classList.add('pulse');
        }
      };
      if(el._countAnim) cancelAnimationFrame(el._countAnim);
      el._countAnim = requestAnimationFrame(step);
    }

    animateCount(totalCountEl, total);
    animateCount(yesCountEl, yes);
    animateCount(maybeCountEl, maybe);
    animateCount(noCountEl, no);
  }

  // If we're on the login page, wire the login flow
  if(loginForm){
    loginForm.addEventListener('submit', e=>{
      e.preventDefault();
      const pass = document.getElementById('adminPass').value;
      if(pass === PASSWORD){
        setAuthed();
        // redirect to dashboard
        const base = location.pathname.replace(/\/[^\/]*$/, '');
        const dashboardPath = base + '/admin/dashboard.html';
        // If the current URL already contains /admin/ just go to dashboard.html
        if(location.pathname.includes('/admin/')){
          location.href = 'dashboard.html';
        } else {
          // try relative
          location.href = './admin/dashboard.html';
        }
      } else {
        alert('Incorrect password');
      }
    });
  }

  // If we're on the dashboard page, guard it and wire actions
  if(adminPanel){
    if(!isAuthed()){
      // redirect back to login
      location.href = 'login.html';
      return;
    }

    // wire logout
    if(logoutBtn) logoutBtn.addEventListener('click', ()=>{
      clearAuth();
      location.href = 'login.html';
    });

    if(exportPdfBtn) exportPdfBtn.addEventListener('click', ()=>{
      try{
        const toPrint = getFilteredRsvps();
        printRsvps(toPrint);
      }catch(err){
        console.error(err);
        alert('Failed to open print dialog');
      }
    });

  if(mediaFilter) mediaFilter.addEventListener('change', ()=>renderMedia(currentMedia));
  if(homeBtn) homeBtn.addEventListener('click', ()=>{ location.href = '../index.html'; });

    // wire refresh button
    if(refreshBtn) refreshBtn.addEventListener('click', ()=> { loadAll(); });

    // RSVP filters
    function debounce(fn, ms=200){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
    if(attendingFilter) attendingFilter.addEventListener('change', ()=> applyRsvpFilterAndRender());
    if(rsvpSearch) rsvpSearch.addEventListener('input', debounce(()=> applyRsvpFilterAndRender(), 180));
    if(clearFilterBtn) clearFilterBtn.addEventListener('click', ()=>{ if(attendingFilter) attendingFilter.value='all'; if(rsvpSearch) rsvpSearch.value=''; applyRsvpFilterAndRender(); });

    // load initial data
    loadAll();
  }

  // --- data loading ---
  // Try server API first (/api/rsvps), then fall back to static JSON file, then localStorage.
  async function fetchRsvps(){
    // Try server API first (/api/rsvps), then static JSON, then localStorage — merge results so admin sees all submissions
    let results = [];
    // 1) Try server API
    try{
      const res = await fetch('/api/rsvps');
      if(res.ok){
        const json = await res.json();
        if(Array.isArray(json)) results = json.slice();
      }
    }catch(e){ console.warn('No server API /api/rsvps:', e); }

    // 2) Try static file shipped with project if nothing from server
    if(results.length === 0){
      try{
        const res2 = await fetch('../data/rsvp.json');
        if(res2.ok){
          const json2 = await res2.json();
          if(Array.isArray(json2)) results = json2.slice();
        }
      }catch(e){ console.warn('No static data/rsvp.json:', e); }
    }

    // 3) Always check localStorage and merge any entries not already present
    try{
      const raw = localStorage.getItem('rsvps');
      if(raw){
        const local = JSON.parse(raw);
        if(Array.isArray(local) && local.length){
          // Build set of existing identifiers (prefer id, fallback to submittedAt + name)
          const existing = new Set((results||[]).map(r => String(r.id || r.submittedAt || (r.name||'')+JSON.stringify(r))));
          const toAdd = local.filter(item => !existing.has(String(item.id || item.submittedAt || (item.name||'')+JSON.stringify(item))));
          if(toAdd.length) results = toAdd.concat(results);
        }
      }
    }catch(e){ console.warn('Failed to read/parse localStorage.rsvps', e); }

    return results;
  }

  // Filtering helpers
  function getFilteredRsvps(){
    const list = Array.isArray(currentRsvps) ? currentRsvps.slice() : [];
    const status = attendingFilter ? attendingFilter.value : 'all';
    const q = rsvpSearch ? rsvpSearch.value.trim().toLowerCase() : '';
    let out = list;
    if(status && status !== 'all') out = out.filter(r => (r.attending||'').toLowerCase() === status);
    if(q) out = out.filter(r => ((r.name||'')+' '+(r.tel||'')+' '+(r.notes||'')+' '+(r.attending||'')).toLowerCase().includes(q));
    return out;
  }

  function applyRsvpFilterAndRender(){
    const filtered = getFilteredRsvps();
    renderRsvps(filtered);
    updateStats(filtered);
    updateLastUpdateTime();
  }

  async function fetchMedia(){
    const mediaItems = [];
    
    // Get photos from localStorage
    try {
      const photosJson = localStorage.getItem('captured_photos');
      if (photosJson) {
        const photos = JSON.parse(photosJson);
        mediaItems.push(...photos.map(p => ({
          type: 'photo',
          ...p,
          data: p.dataUrl
        })));
      }
    } catch(e) {
      console.warn('Error loading photos from localStorage:', e);
    }

    // Get videos from IndexedDB
    try {
      const db = await openDB('mediaDB', 1);
      const videoMeta = await db.getAll('videos');
      const videos = await Promise.all(videoMeta.map(async (meta) => {
        const blob = await db.get('videoBlobs', meta.id);
        return {
          type: 'video',
          ...meta,
          data: URL.createObjectURL(blob)
        };
      }));
      mediaItems.push(...videos);
    } catch(e) {
      console.warn('Error loading videos from IndexedDB:', e);
    }

    return mediaItems;
  }

  // Helper function to open IndexedDB
  function openDB(name, version) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('videos')) {
          db.createObjectStore('videos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('videoBlobs')) {
          db.createObjectStore('videoBlobs', { keyPath: 'id' });
        }
      };
    });
  }

  function toCSV(arr){
    if(!Array.isArray(arr)) return '';
    const keys = ['name','tel','attending','notes','submittedAt'];
    // Map date field if needed
    arr = arr.map(r => ({
      ...r,
      submittedAt: r.submittedAt || r.date || '' // fallback for older entries
    }));
    const header = keys.join(',');
    const rows = arr.map(r => keys.map(k=>escapeCsv(String(r[k]||''))).join(','));
    return [header].concat(rows).join('\n');
  }

  function escapeCsv(field){
    if(field.includes(',')||field.includes('\n')||field.includes('"')){
      return '"'+field.replace(/"/g,'""')+'"';
    }
    return field;
  }

  function downloadFile(content, filename, mime){
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function renderRsvps(list){
    if(!rsvpContainer) return;
    if(!Array.isArray(list) || list.length===0){
      rsvpContainer.innerHTML = '<p class="muted">Waiting for RSVPs... They will appear here as guests submit the form.</p>';
      return;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>Name</th><th>Telephone</th><th>Attending</th><th>Notes</th><th>Submitted</th><th>Actions</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    list.forEach((r, idx)=>{
      const tr = document.createElement('tr');
      tr.dataset.idx = String(idx);
      const date = r.submittedAt || r.date || ''; // fallback for older entries
      const formattedDate = date ? new Date(date).toLocaleString() : '';
      // build cells with data-label for responsive stack
      const cells = [
        ['#', String(idx+1)],
        ['Name', r.name||''],
        ['Telephone', r.tel||''],
        ['Attending', r.attending||''],
        ['Notes', r.notes||''],
        ['Submitted', formattedDate]
      ];
      cells.forEach(([label, val])=>{
        const td = document.createElement('td');
        td.setAttribute('data-label', label);
        td.textContent = val;
        tr.appendChild(td);
      });
      const actionsTd = document.createElement('td');
      actionsTd.setAttribute('data-label','Actions');
      actionsTd.innerHTML = `<button class="btn btn-outline btn-sm rsvp-edit" data-idx="${idx}">Edit</button> <button class="btn btn-outline btn-sm rsvp-delete" data-idx="${idx}">Delete</button>`;
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    rsvpContainer.innerHTML = '';
    rsvpContainer.appendChild(table);
    // animate rows in
    try{
      const rows = rsvpContainer.querySelectorAll('tbody tr');
      rows.forEach((tr, i) => {
        tr.style.opacity = '0';
        tr.style.transform = 'translateY(8px)';
        tr.style.transition = 'opacity 260ms ease, transform 260ms ease';
        setTimeout(()=>{
          tr.style.opacity = '1';
          tr.style.transform = 'none';
        }, 40 + i*20);
      });
    }catch(e){/* ignore */}

    // wire edit/delete
    try{
      rsvpContainer.querySelectorAll('.rsvp-edit').forEach(b=>b.addEventListener('click', onEditClick));
      rsvpContainer.querySelectorAll('.rsvp-delete').forEach(b=>b.addEventListener('click', onDeleteClick));
    }catch(e){}
  }

  // Print/export RSVPs: open a print-friendly window (user can Save as PDF)
  function printRsvps(list){
    // Use a simple 1-based index for printed rows so the printout counts from 1
    const rows = (list||[]).map((r, idx) => {
      const submitted = r.submittedAt || r.date || '';
      const formatted = submitted ? new Date(submitted).toLocaleString() : '';
      return `<tr><td>${idx+1}</td><td>${escapeHtml(r.name||'')}</td><td>${escapeHtml(r.tel||'')}</td><td>${escapeHtml(r.attending||'')}</td><td>${escapeHtml(r.notes||'')}</td><td>${escapeHtml(formatted)}</td></tr>`;
    }).join('\n');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>RSVPs — Print</title><style>
      body{font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;padding:20px;color:#111}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #ddd;padding:8px;text-align:left}
      th{background:#f6f6f6}
      h1{margin:0 0 8px 0}
    </style></head><body>
      <h1>RSVPs</h1>
      <p>Exported: ${new Date().toLocaleString()}</p>
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Telephone</th><th>Attending</th><th>Notes</th><th>Submitted</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">No RSVPs</td></tr>'}</tbody>
      </table>
    </body></html>`;

    const w = window.open('', '_blank');
    if(!w){ alert('Popup blocked — allow popups to print/export'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){ console.warn('print error', e); } }, 300);
  }

  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" }[c]));
  }

  let currentMedia = [];
  let currentRsvps = [];

  // Listen for BroadcastChannel messages from the site (new RSVPs and media saved locally)
  try {
    // RSVP channel
    const rsvpChannel = new BroadcastChannel('wedding_rsvps');
    rsvpChannel.onmessage = (ev)=>{
      try{
        const msg = ev.data || {};
        if(msg.type === 'new_rsvp' && msg.rsvp){
          // append to current list and re-render (new submissions appear at the end)
          currentRsvps = (Array.isArray(currentRsvps) ? currentRsvps : []).concat([msg.rsvp]);
          applyRsvpFilterAndRender();
        }
      }catch(err){ console.warn('RSVP BC handler error', err); }
    };

    // Media channel
    const mediaChannel = new BroadcastChannel('wedding_media');
    mediaChannel.onmessage = async (ev) => {
      try {
        const msg = ev.data || {};
        if (msg.type === 'new_media' && msg.media) {
          // Add new media to the current list
          currentMedia = [msg.media, ...currentMedia];
          renderMedia(currentMedia);
          updateLastUpdateTime();
          
          // Update media stats
          const totalMediaCount = document.getElementById('totalMediaCount');
          const photoCount = document.getElementById('photoCount');
          const videoCount = document.getElementById('videoCount');
          
          if (totalMediaCount) totalMediaCount.textContent = String(currentMedia.length);
          if (photoCount) photoCount.textContent = String(currentMedia.filter(m => m.type === 'photo').length);
          if (videoCount) videoCount.textContent = String(currentMedia.filter(m => m.type === 'video').length);

          // Show notification
          const notification = document.createElement('div');
          notification.className = 'media-notification';
          notification.textContent = `New ${msg.media.type} uploaded!`;
          document.body.appendChild(notification);
          
          // Remove notification after 3 seconds
          setTimeout(() => {
            notification.remove();
          }, 3000);
        }
      } catch(err) { console.warn('Media BC handler error', err); }
    };
  } catch(err) { /* BroadcastChannel not supported */ }

  // Also listen to storage events (other tabs might save RSVPs to localStorage)
  window.addEventListener('storage', (e)=>{
    try{
      if(e.key === 'rsvps' || e.key === 'rsvps_updated'){
        const raw = localStorage.getItem('rsvps');
        if(raw){
          const arr = JSON.parse(raw);
          currentRsvps = Array.isArray(arr) ? arr : currentRsvps;
          renderRsvps(currentRsvps);
          updateStats(currentRsvps);
        }
      }
    }catch(err){ console.warn('storage handler error', err); }
  });

  const ITEMS_PER_PAGE = 20;
let currentPage = 1;
let isLoading = false;

function renderMedia(list) {
    if (!mediaGrid) return;
    const filter = mediaFilter ? mediaFilter.value : 'all';
    const shown = (list || []).filter(m => filter === 'all' ? true : m.type === filter);

    // Update media stats
    const totalMediaCount = document.getElementById('totalMediaCount');
    const photoCount = document.getElementById('photoCount');
    const videoCount = document.getElementById('videoCount');

    if (totalMediaCount) totalMediaCount.textContent = String(list.length);
    if (photoCount) photoCount.textContent = String(list.filter(m => m.type === 'photo').length);
    if (videoCount) videoCount.textContent = String(list.filter(m => m.type === 'video').length);

    if (shown.length === 0) {
        mediaGrid.innerHTML = '<p class="muted">No media items found for this filter.</p>';
        return;
    }

    // Clear grid only on first page or filter change
    if (currentPage === 1) {
        mediaGrid.innerHTML = '';
    }

    // Calculate pagination
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageItems = shown.slice(start, end);

    pageItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'media-item';
        
        if(item.type === 'photo'){
            const img = new Image();
            // Create a loading placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'media-placeholder';
            placeholder.textContent = 'Loading...';
            div.appendChild(placeholder);
            
            // Load image with lazy loading
            img.loading = 'lazy';
            img.onload = () => {
                placeholder.remove();
                div.appendChild(img);
            };
            img.src = item.data;
            img.alt = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Photo';
        } else {
            const vid = document.createElement('video');
            vid.src = item.data;
            vid.controls = true;
            vid.muted = true;
            vid.playsInline = true;
            vid.preload = 'metadata';
            vid.loading = 'lazy';
            div.appendChild(vid);
        }

      const meta = document.createElement('div');
      meta.className = 'media-meta';
      
      const title = document.createElement('div');
      title.textContent = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Untitled';
      
      const actions = document.createElement('div');
      actions.className = 'media-actions';

      // Download button for both photos and videos
      const dl = document.createElement('a');
      if (item.type === 'photo') {
        dl.href = item.data;
        dl.download = `photo_${new Date(item.timestamp).toISOString().replace(/[:.]/g, '-')}.jpg`;
      } else {
        dl.href = item.data;
        dl.download = `video_${new Date(item.timestamp).toISOString().replace(/[:.]/g, '-')}.webm`;
      }
      dl.textContent = 'Download';
      dl.className = 'muted';
      dl.style.fontSize = '0.85rem';
      dl.style.marginLeft = '8px';
      actions.appendChild(dl);

      meta.appendChild(title);
      meta.appendChild(actions);
      div.appendChild(meta);
      mediaGrid.appendChild(div);
    });
  }

  async function loadAll(){
    if(refreshBtn) refreshBtn.disabled = true;
    try{
        if(rsvpContainer) rsvpContainer.innerHTML = '<p class="muted">Loading RSVPs...</p>';
        if(mediaGrid) mediaGrid.innerHTML = '<p class="muted">Loading media...</p>';
        
        const [rsvps, media] = await Promise.all([fetchRsvps(), fetchMedia()]);
        // Sort RSVPs by date, newest first
        currentRsvps = Array.isArray(rsvps) ? rsvps.sort((a,b) => {
          const dateA = new Date(a.submittedAt || a.date || 0);
          const dateB = new Date(b.submittedAt || b.date || 0);
          return dateB - dateA;
        }) : [];
        renderRsvps(currentRsvps);
        // Update the dashboard counters immediately after loading RSVPs
        updateStats(currentRsvps);
        currentMedia = Array.isArray(media)? media : [];
        renderMedia(currentMedia);
        updateLastUpdateTime();
    }catch(err){
      console.error(err);
      if(rsvpContainer) rsvpContainer.innerHTML = '<p class="muted">Failed to load RSVP data. Check that <code>data/rsvp.json</code> exists.</p>';
      if(mediaGrid) mediaGrid.innerHTML = '<p class="muted">Failed to load media manifest. Check that <code>data/media.json</code> exists.</p>';
    }finally{
      if(refreshBtn) refreshBtn.disabled = false;
    }
  }

  // Auto-refresh RSVPs every 30 seconds if admin panel is open
  if(adminPanel){
    setInterval(async () => {
      try{
        const rsvps = await fetchRsvps();
        if(Array.isArray(rsvps)){
          currentRsvps = rsvps.sort((a,b) => {
            const dateA = new Date(a.submittedAt || a.date || 0);
            const dateB = new Date(b.submittedAt || b.date || 0);
            return dateB - dateA;
          });
          renderRsvps(currentRsvps);
          updateStats(currentRsvps);
        }
      }catch(e){ /* ignore refresh errors */ }
    }, 30000); // 30 seconds
  }

})();
