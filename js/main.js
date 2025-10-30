document.addEventListener('DOMContentLoaded', function(){
  // Navigation menu toggle
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  const navItems = document.querySelectorAll('.nav-links a');

  menuToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
  });

  // Smooth scroll for nav links and close mobile menu
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const href = item.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) target.scrollIntoView({behavior: 'smooth', block: 'start'});
      }
      navLinks.classList.remove('active');
      document.body.style.overflow = '';
    });
  });

  // Highlight active section on scroll (debounced)
  const sections = document.querySelectorAll('section[id]');
  function highlightOnScroll(){
    let current = '';
    sections.forEach(section => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= 120 && rect.bottom > 120) {
        current = section.id;
      }
    });
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('href').substring(1) === current);
    });
  }
  window.addEventListener('scroll', highlightOnScroll);
  window.addEventListener('resize', highlightOnScroll);
  highlightOnScroll();

    // RSVP Form handling
  const form = document.getElementById('rsvpForm');
  const message = document.getElementById('rsvpMessage');
  const printBtn = document.getElementById('printBtn');

  if (form) {
    // create a BroadcastChannel to notify admin dashboard in other tabs/windows
    let bc = null;
    try { bc = new BroadcastChannel('wedding_rsvps'); } catch (err) { /* not supported */ }
      async function trySendToServer(rsvp) {
        try {
          const res = await fetch('/api/rsvps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rsvp)
          });
          if (res.ok) return true;
          // non-OK - treat as failure so we fall back
          console.warn('Server responded with', res.status);
          return false;
        } catch (err) {
          console.warn('Could not reach server to send RSVP', err);
          return false;
        }
      }

      form.addEventListener('submit', async function(e){
        e.preventDefault();
        const data = new FormData(form);
        const obj = Object.fromEntries(data.entries());

        // Basic validation
        if(!obj.name){
          message.textContent = 'Please enter your name.';
          message.classList.remove('hidden');
          return;
        }

        // Format phone number
        const tel = obj.tel ? obj.tel.trim() : '';
        if (tel && !/^[0-9+\s-()]+$/.test(tel)) {
          message.textContent = 'Please enter a valid phone number.';
          message.classList.remove('hidden');
          return;
        }

        // Create formatted RSVP data with current date/time
        // Generate a client-side sequential primary key (string, zero-padded, starting at 001)
        // We keep the numeric Date.now() if needed but set `id` to the sequential PK so admin sees it.
        let seq = parseInt(localStorage.getItem('rsvp_seq') || '0', 10);
        if (isNaN(seq)) seq = 0;
        seq = seq + 1;
        try { localStorage.setItem('rsvp_seq', String(seq)); } catch (e) { /* ignore storage errors */ }
  // Use simple numeric sequence starting at 1 (1, 2, 3, ...)
  const pk = seq; // number

        const rsvpData = {
          name: obj.name.trim(),
          tel: tel || '—', // Use dash if no phone provided
          attending: obj.attending || 'yes',
          notes: obj.notes ? obj.notes.trim() : '',
          submittedAt: new Date().toISOString(), // ISO format for consistent dates
          id: pk,
          // NOTE: We do not include a timestamp-based primary id here; id is the sequential PK
        };

        // Try to send to server first. If server unavailable, fall back to localStorage
        const sent = await trySendToServer(rsvpData);
        if (sent) {
          try { if (bc) bc.postMessage({ type: 'new_rsvp', rsvp: rsvpData }); } catch (e) {}
          message.textContent = `Thanks, ${rsvpData.name}! Your RSVP has been recorded.`;
          message.classList.remove('hidden');
          form.reset();
          return;
        }

        // Fallback to localStorage
        try {
          const rsvps = JSON.parse(localStorage.getItem('rsvps') || '[]');
          rsvps.unshift(rsvpData);
          localStorage.setItem('rsvps', JSON.stringify(rsvps.slice(0, 1000)));
          try { localStorage.setItem('rsvps_updated', String(Date.now())); } catch (e) {}
          try { if (bc) bc.postMessage({ type: 'new_rsvp', rsvp: rsvpData }); } catch (e) {}

          message.textContent = `Thanks, ${rsvpData.name}! Your RSVP has been recorded locally.`;
          message.classList.remove('hidden');
          form.reset();
        } catch (error) {
          console.error('Error saving RSVP locally:', error);
          message.textContent = 'Sorry, there was an error saving your RSVP. Please try again.';
          message.classList.remove('hidden');
        }
      });
  }

  if (printBtn) {
    printBtn.addEventListener('click', function(){
      window.print();
    });
  }



});
