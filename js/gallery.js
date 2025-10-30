// Media capture and gallery management
(function(){
  // DOM elements (may be missing on the gallery-only page)
  const camera = document.getElementById('camera');
  const photoCanvas = document.getElementById('photoCanvas');
  const recordingPreview = document.getElementById('recordingPreview');
  const switchBtn = document.getElementById('switchBtn');
  const captureBtn = document.getElementById('captureBtn');
  const recordBtn = document.getElementById('recordBtn');
  const stopRecordBtn = document.getElementById('stopRecordBtn');
  // Thumbnails container: prefer '#thumbs' if present (camera page), otherwise use '#mediaGrid'
  let thumbsContainer = document.getElementById('thumbs');
  if (!thumbsContainer) thumbsContainer = document.getElementById('mediaGrid');

  // Filter UI
  const filterButtons = document.querySelectorAll('.filter-btn');
  const eventSelect = document.getElementById('eventFilterSelect');
  let activeFilter = 'all'; // 'all' | 'photo' | 'video' | 'events'
  let activeEventName = '';

  function updateFilterUI() {
    filterButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.filter === activeFilter));
    if (activeFilter === 'events' && eventSelect) {
      eventSelect.classList.remove('hidden');
    } else if (eventSelect) {
      eventSelect.classList.add('hidden');
      eventSelect.value = '';
      activeEventName = '';
    }
  }

  // Determine whether an item should be shown under current filter
  function shouldShowItem(item, type) {
    if (!item) return false;
    const meta = item.meta || item;
    if (activeFilter === 'photo' && type !== 'photo') return false;
    if (activeFilter === 'video' && type !== 'video') return false;
    if (activeFilter === 'events') {
      const isEvent = meta && (meta.isEvent || (meta.meta && meta.meta.isEvent));
      const name = (meta && (meta.eventName || (meta.meta && meta.meta.eventName))) || '';
      if (!isEvent) return false;
      if (activeEventName && activeEventName !== '' && name !== activeEventName) return false;
    }
    return true;
  }

  // Populate event select with unique event names from stored media
  async function populateEventSelect() {
    if (!eventSelect) return;
    try {
      const names = new Set();
      // localStorage
      try {
        const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
        for (const p of photos) {
          if (p && p.meta && p.meta.eventName) names.add(p.meta.eventName);
        }
      } catch (e) { /* ignore */ }

      // MediaStorage
      if (window.MediaStorage && typeof MediaStorage.getAllMedia === 'function') {
        try {
          const all = await MediaStorage.getAllMedia();
          if (Array.isArray(all)) {
            for (const m of all) {
              const meta = m.meta || m;
              if (meta && meta.eventName) names.add(meta.eventName);
            }
          }
        } catch (e) { /* ignore */ }
      }

      // Clear current options (keep placeholder)
      const placeholder = eventSelect.querySelector('option') ? eventSelect.querySelector('option').value : '';
      eventSelect.innerHTML = `<option value="">-- Select event --</option>`;
      Array.from(names).sort().forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        eventSelect.appendChild(opt);
      });
      // if there are no names, hide select
      if (names.size === 0) eventSelect.classList.add('hidden');
    } catch (e) {
      console.warn('populateEventSelect failed', e);
    }
  }

  // Wire filter button clicks
  if (filterButtons && filterButtons.length) {
    filterButtons.forEach(btn => btn.addEventListener('click', async (ev) => {
      try {
        activeFilter = btn.dataset.filter || 'all';
        updateFilterUI();
        // repopulate grid according to filter
        if (thumbsContainer) thumbsContainer.innerHTML = '';
        await loadExistingMedia();
      } catch (e) { console.warn('Filter click handler error', e); }
    }));
  }

  if (eventSelect) {
    eventSelect.addEventListener('change', async (ev) => {
      activeEventName = eventSelect.value || '';
      if (thumbsContainer) thumbsContainer.innerHTML = '';
      await loadExistingMedia();
    });
  }

  // Media state
  let stream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let facingMode = 'environment'; // Start with back camera
  let isRecording = false;
  // We rely on the centralized MediaStorage service for IndexedDB operations.
  // Backwards compatibility: localStorage-stored photos (captured_photos) are still supported.

  // Optional: backend endpoint to send captured photos directly to admin/backend.
  // Configure by setting window.ADMIN_UPLOAD_URL = '/api/media/upload' before this script runs,
  // or change the default here.
  const ADMIN_UPLOAD_URL = window.ADMIN_UPLOAD_URL || null; // e.g. '/api/media/upload'
  const ADMIN_UPLOAD_ENABLED = Boolean(ADMIN_UPLOAD_URL);

  async function uploadPhotoToBackend(dataUrl, meta = {}) {
    if (!ADMIN_UPLOAD_ENABLED) return { ok: false, reason: 'disabled' };
    try {
      // Send as JSON payload. Backend should accept { type: 'photo', dataUrl, timestamp }
      const payload = { type: 'photo', dataUrl, timestamp: meta.timestamp || Date.now() };
      const res = await fetch(ADMIN_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text().catch(()=>'');
        return { ok: false, status: res.status, text };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      console.warn('uploadPhotoToBackend failed', err);
      return { ok: false, error: err };
    }
  }

  // Initialize camera
  async function initCamera() {
    // Disable capture/record until stream is ready
    try {
      if (captureBtn) captureBtn.disabled = true;
      if (recordBtn) recordBtn.disabled = true;

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: true
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      camera.srcObject = stream;
      camera.style.display = 'block';
      recordingPreview.style.display = 'none';
      setupMediaRecorder();

      // Enable capture/record controls when ready
      if (captureBtn) captureBtn.disabled = false;
      if (recordBtn) recordBtn.disabled = false;

    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Could not access camera. Please ensure you have given permission.');
      // Keep capture/record disabled on failure
      if (captureBtn) captureBtn.disabled = true;
      if (recordBtn) recordBtn.disabled = true;
    }
  }

  // Switch between front/back cameras (only if switch button exists)
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      facingMode = facingMode === 'user' ? 'environment' : 'user';
      initCamera();
    });
  }

  // Storage management
  const MAX_PHOTOS = 50; // Maximum number of photos to store
  const MAX_PHOTO_SIZE = 1024 * 1024; // 1MB max per photo
  const TARGET_JPEG_QUALITY = 0.7; // Initial JPEG quality

  // Check available storage
  async function checkStorage() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const { usage, quota } = await navigator.storage.estimate();
      const available = quota - usage;
      const minimumRequired = 5 * 1024 * 1024; // 5MB minimum
      return available > minimumRequired;
    }
    // Fallback: check localStorage
    try {
      const used = new Blob([localStorage.getItem('captured_photos') || '']).size;
      return used < 0.8 * 5 * 1024 * 1024; // 80% of 5MB limit
    } catch(e) {
      console.warn('Storage check failed:', e);
      return true; // Assume storage is available if check fails
    }
  }

  // Compress image if needed
  async function compressImage(canvas, maxSize, quality = TARGET_JPEG_QUALITY) {
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let size = new Blob([dataUrl]).size;
    
    // If size is too large, recursively compress with lower quality
    if (size > maxSize && quality > 0.1) {
      return compressImage(canvas, maxSize, quality - 0.1);
    }
    
    return dataUrl;
  }

  // Manage photo storage
  function managePhotoStorage() {
    try {
      const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
      if (photos.length > MAX_PHOTOS) {
        // Remove oldest photos if we exceed the limit
        photos.splice(MAX_PHOTOS);
        localStorage.setItem('captured_photos', JSON.stringify(photos));
      }
    } catch(e) {
      console.warn('Error managing photo storage:', e);
    }
  }

  // Photo capture with error handling
  if (captureBtn) {
    captureBtn.addEventListener('click', async () => {
    try {
      // Check storage first
      const hasStorage = await checkStorage();
      if (!hasStorage) {
        alert('Storage space is low. Please remove some photos or try with lower quality.');
        return;
      }

      // Set canvas size to match video
      photoCanvas.width = camera.videoWidth;
      photoCanvas.height = camera.videoHeight;
      
      // Draw video frame to canvas
      const ctx = photoCanvas.getContext('2d');
      ctx.drawImage(camera, 0, 0);
      
      // Compress and save
      const dataUrl = await compressImage(photoCanvas, MAX_PHOTO_SIZE);
      await savePhoto(dataUrl);
      
    } catch(e) {
      console.error('Error capturing photo:', e);
      alert('Could not capture photo. Please try again.');
    }
    });
  }

  // Smart photo compression with quality adjustment
  async function compressPhoto(dataUrl, maxSize, targetQuality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Start with target dimensions based on viewport
        let width = Math.min(img.width, 1920); // max 1920px wide
        let height = Math.round((width / img.width) * img.height);
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Try initial compression
        let quality = targetQuality;
        let compressed = canvas.toDataURL('image/jpeg', quality);
        let size = new Blob([compressed]).size;
        
        // If still too large, reduce dimensions and quality
        while (size > maxSize && (width > 800 || quality > 0.3)) {
          if (quality > 0.3) {
            quality -= 0.1;
          } else {
            width = Math.round(width * 0.8);
            height = Math.round(height * 0.8);
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            quality = 0.7; // Reset quality for new dimensions
          }
          
          compressed = canvas.toDataURL('image/jpeg', quality);
          size = new Blob([compressed]).size;
        }
        
        resolve(compressed);
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // Save photo using MediaStorage service with enhanced error handling and verification
  async function savePhoto(dataUrl) {
    if (!dataUrl) {
      console.error('Invalid photo data');
      alert('Could not save photo: No photo data available');
      return;
    }

    let progressIndicator;
    try {
      // Show progress indicator
      progressIndicator = showProgressIndicator('Processing photo...');

      // Initialize MediaStorage if needed
      if (!window.MediaStorage) {
        throw new Error('Media storage system is not initialized');
      }

      // Validate storage info
      progressIndicator.textContent = 'Checking storage...';
      const storageInfo = await MediaStorage.getStorageInfo().catch(e => {
        throw new Error('Could not check storage status: ' + e.message);
      });
      
      // Show warning if storage is getting full
      if (storageInfo.usedPercent > 80) {
        showError('Storage is getting full. Older items will be automatically removed.', true);
      }

      // Compress photo with error handling
      progressIndicator.textContent = 'Compressing photo...';
      const compressedDataUrl = await compressPhoto(dataUrl, MAX_PHOTO_SIZE).catch(e => {
        throw new Error('Could not compress photo: ' + e.message);
      });
      
      if (!compressedDataUrl) {
        throw new Error('Photo compression failed');
      }

      // Validate compressed data
      if (!compressedDataUrl.startsWith('data:image/')) {
        throw new Error('Invalid photo format after compression');
      }

      // Convert to blob for validation
      progressIndicator.textContent = 'Validating photo...';
      const imageBlob = await fetch(compressedDataUrl).then(r => r.blob());
      
      // Verify image can be loaded
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to verify photo data'));
        img.src = URL.createObjectURL(imageBlob);
      });

      // Try uploading directly to admin/backend if configured
      let uploadedToBackend = false;
      if (ADMIN_UPLOAD_ENABLED) {
        try {
          progressIndicator.textContent = 'Uploading to admin...';
          const uploadRes = await uploadPhotoToBackend(compressedDataUrl, { timestamp: Date.now() });
          if (uploadRes && uploadRes.ok) {
            uploadedToBackend = true;
            // notify via BroadcastChannel as well so admin panel refreshes
            try { new BroadcastChannel('wedding_media').postMessage({ type: 'new_media', mediaType: 'photo' }); } catch(e){}
          } else {
            console.warn('Admin upload failed or returned non-ok', uploadRes);
          }
        } catch(e) {
          console.warn('Upload to admin failed:', e);
        }
      }

      // Save to storage service
      progressIndicator.textContent = 'Saving photo...';
      const photoId = await MediaStorage.savePhoto(compressedDataUrl);
      
      if (!photoId) {
        throw new Error('No photo ID returned from storage');
      }

      // Verify the saved photo immediately
      progressIndicator.textContent = 'Verifying saved photo...';
      const verifyRetries = 3;
      let savedPhoto = null;

      for (let i = 0; i < verifyRetries; i++) {
        try {
          const media = await MediaStorage.getAllMedia();
          if (!Array.isArray(media)) {
            throw new Error('Invalid media data returned from storage');
          }

          savedPhoto = media.find(m => m.id === photoId);
          if (savedPhoto) break;

          // Small delay before retry
          if (i < verifyRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (e) {
          console.warn(`Verification attempt ${i + 1} failed:`, e);
          if (i === verifyRetries - 1) throw e;
        }
      }
      
      if (!savedPhoto) {
        throw new Error('Failed to verify saved photo');
      }
      
      // Add thumbnail with try-catch
      try {
        addThumbnail(savedPhoto, 'photo');
      } catch(e) {
        console.warn('Error adding thumbnail:', e);
        // Continue execution as this is non-critical
      }
      
      // Show success indicator
      try {
        const flash = document.createElement('div');
        flash.className = 'camera-flash';
        if (camera && camera.parentElement) {
          camera.parentElement.appendChild(flash);
          setTimeout(() => flash.remove(), 500);
        }
      } catch(e) {
        console.warn('Error showing flash effect:', e);
        // Non-critical error, continue
      }
      
      // Update storage info display
      try {
        await updateStorageInfo();
      } catch(e) {
        console.warn('Error updating storage info:', e);
        // Non-critical error, continue
      }
      
      // Notify admin dashboard
      try {
        const bc = new BroadcastChannel('wedding_media');
        bc.postMessage({ 
          type: 'new_media',
          mediaType: 'photo',
          id: photoId,
          timestamp: savedPhoto.timestamp
        });
      } catch(e) { 
        console.warn('Error notifying admin dashboard:', e);
        // Non-critical error, continue
      }

      // Return success
      return photoId;
      
    } catch(e) {
      console.error('Error saving photo:', e);
      
      // Handle specific error types
      if (e.name === 'QuotaExceededError' || e.message.includes('exceeded') || e.message.includes('storage')) {
        alert('Storage space is running low. The system will automatically remove older items to make space. You can also manually remove items using the Manage Media button.');
        if (manageMediaBtn) {
          manageMediaBtn.click();
        }
      } else {
        // Provide more specific error message
        let errorMessage = 'Could not save photo: ';
        if (e.message.includes('not iterable')) {
          errorMessage += 'There was an error accessing the photo storage. Please refresh the page and try again.';
        } else {
          errorMessage += e.message;
        }
        alert(errorMessage);
      }

      // Attempt to recover storage state
      try {
        await MediaStorage.cleanupOldMedia();
      } catch(cleanupError) {
        console.warn('Error during storage cleanup:', cleanupError);
      }

      throw e;
    }
  }

  // Cleanup old media to free space
  async function cleanupOldMedia() {
    try {
      // Clean up old photos
      const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
      if (photos.length > MAX_PHOTOS / 2) { // Keep only half of max
        const removed = photos.splice(MAX_PHOTOS / 2);
        removed.forEach(photo => URL.revokeObjectURL(photo.dataUrl));
        localStorage.setItem('captured_photos', JSON.stringify(photos));
      }

      // Delegate video cleanup to MediaStorage (it will remove old items if needed)
      try {
        if (window.MediaStorage && typeof MediaStorage.cleanupOldMedia === 'function') {
          await MediaStorage.cleanupOldMedia();
        }
      } catch(e) {
        console.warn('Video cleanup via MediaStorage failed:', e);
      }

      // Update UI
      updateStorageInfo();
      loadExistingMedia();
      
      return true;
    } catch(e) {
      console.error('Error cleaning up old media:', e);
      return false;
    }
  }

  // Video recording setup
  function setupMediaRecorder() {
    if (!stream) return;
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus'
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      recordedChunks = [];
      
      // Show preview
      const url = URL.createObjectURL(blob);
      recordingPreview.src = url;
      camera.style.display = 'none';
      recordingPreview.style.display = 'block';
      
      // Save video
      await saveVideo(blob);
      // Ensure recording state & UI updated
      try {
        isRecording = false;
        updateRecordButtonUI();
        if (recordBtn) recordBtn.style.display = 'inline-block';
        if (stopRecordBtn) stopRecordBtn.style.display = 'none';
      } catch(e) { /* ignore UI errors */ }
    };
  }

  // Video recording controls
  // Toggle recording with the record button. Keep stopRecordBtn as alternate stop control for now.
  function updateRecordButtonUI() {
    try {
      if (!recordBtn) return;
      if (isRecording) {
        recordBtn.classList.add('recording');
        // prefer an aria label or change icon if present
        recordBtn.setAttribute('aria-pressed', 'true');
      } else {
        recordBtn.classList.remove('recording');
        recordBtn.setAttribute('aria-pressed', 'false');
      }
    } catch (e) { /* ignore UI errors */ }
  }

  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
    if (!mediaRecorder) return;
    // Toggle
    if (!isRecording) {
      try {
        mediaRecorder.start();
        isRecording = true;
        updateRecordButtonUI();
        // hide stop button if present
        if (stopRecordBtn) stopRecordBtn.style.display = 'none';
      } catch (e) {
        console.error('Failed to start recording:', e);
      }
    } else {
      try {
        mediaRecorder.stop();
        // mediaRecorder.onstop will set isRecording=false
      } catch (e) {
        console.error('Failed to stop recording:', e);
      }
    }
    });
  }

  // Allow stopRecordBtn to stop recording as alternate control
  if (stopRecordBtn) {
    stopRecordBtn.addEventListener('click', () => {
      if (!mediaRecorder || !isRecording) return;
      try { mediaRecorder.stop(); } catch(e) { console.error(e); }
    });
  }

  // Save video using MediaStorage service
  async function saveVideo(blob) {
    try {
      // Get storage info
      const storageInfo = await MediaStorage.getStorageInfo();
      
      // Show warning if storage is getting full
      if (storageInfo.usedPercent > 80) {
        showError('Storage is getting full. Older items will be automatically removed.', true);
      }

      // Save to storage service
      const videoId = await MediaStorage.saveVideo(blob);
      // Get the saved video metadata (best-effort)
      try {
        const media = await MediaStorage.getAllMedia();
        const savedVideo = media.find(m => m.id === videoId);
        if (savedVideo) addThumbnail(savedVideo, 'video');
      } catch(e) {
        console.warn('Could not verify saved video immediately:', e);
      }
      
      // Update storage display
      updateStorageInfo();
      
      // Notify admin dashboard
      try {
        const bc = new BroadcastChannel('wedding_media');
        bc.postMessage({ type: 'new_media' });
      } catch(e) { /* BroadcastChannel not supported */ }
      
    } catch(err) {
      console.error('Error saving video:', err);
      if (err.name === 'QuotaExceededError' || err.message.includes('storage')) {
        alert('Storage space is running low. The system will automatically remove older items to make space. You can also manually remove items using the Manage Media button.');
        if (manageMediaBtn) {
          manageMediaBtn.click();
        }
      } else {
        alert('Could not save video: ' + err.message);
      }
    }
  }

  // Add thumbnail to gallery with validation
  function addThumbnail(item, type) {
    if (!item || !type) {
      console.warn('Invalid parameters for thumbnail:', { item, type });
      return;
    }
    if (!thumbsContainer) {
      console.warn('No container available for thumbnails');
      return;
    }
    // avoid duplicate thumbnails for same id
    if (item.id) {
      try {
        const existing = thumbsContainer.querySelector(`[data-id="${item.id}"]`);
        if (existing) return; // already present
      } catch (e) { /* ignore selector errors */ }
    }
    try {
      const thumb = document.createElement('div');
      thumb.className = 'media-thumb';
      thumb.dataset.id = item.id || '';
      thumb.dataset.type = type;

      const timestamp = item.timestamp ? new Date(item.timestamp) : new Date();
      const time = document.createElement('span');
      time.className = 'thumb-time';
      time.textContent = timestamp.toLocaleTimeString();

      if (type === 'photo') {
        const img = document.createElement('img');
        img.alt = 'Wedding photo';
        img.loading = 'lazy';
        // support either dataUrl or data property
        img.src = item.dataUrl || item.data || item.dataUrl;
        img.className = 'thumb-image';
        thumb.appendChild(img);
      } else {
        // Video: show a poster if provided, otherwise show an icon
        if (item.poster) {
          const vid = document.createElement('img');
          vid.alt = 'Video thumbnail';
          vid.loading = 'lazy';
          vid.src = item.poster;
          vid.className = 'thumb-image';
          thumb.appendChild(vid);
        } else if (item.data) {
          // try to create an object URL for a blob or URL
          const vid = document.createElement('video');
          vid.muted = true; vid.playsInline = true; vid.width = 120; vid.height = 80;
          try { vid.src = (item.data instanceof Blob) ? URL.createObjectURL(item.data) : item.data; } catch(e) { vid.src = ''; }
          vid.className = 'thumb-video';
          thumb.appendChild(vid);
        } else {
          const icon = document.createElement('i');
          icon.className = 'fas fa-video';
          thumb.appendChild(icon);
        }
      }

      // overlay time
      thumb.appendChild(time);

      // event badge
      try {
        const meta = item.meta || item;
        const isEvent = meta && (meta.isEvent || (meta.meta && meta.meta.isEvent) || false);
        const eventName = meta && (meta.eventName || (meta.meta && meta.meta.eventName));
        if (isEvent) {
          const badge = document.createElement('div');
          badge.className = 'thumb-badge';
          badge.textContent = eventName ? `Event: ${eventName}` : 'Event';
          badge.style.position = 'absolute';
          badge.style.top = '6px';
          badge.style.right = '6px';
          badge.style.background = 'rgba(180,138,102,0.95)';
          badge.style.color = '#fff';
          badge.style.padding = '4px 8px';
          badge.style.borderRadius = '12px';
          badge.style.fontSize = '12px';
          thumb.appendChild(badge);
        }
      } catch(e) { /* ignore badge errors */ }

      // click opens modal viewer
      thumb.addEventListener('click', async () => {
        try {
          if (!mediaModal) return;
          const modalImage = document.getElementById('modalImage');
          const modalVideo = document.getElementById('modalVideo');
          // clear
          if (modalImage) { modalImage.classList.add('hidden'); modalImage.src = ''; }
          if (modalVideo) { modalVideo.classList.add('hidden'); modalVideo.src = ''; }

          if (type === 'photo') {
            // if item has dataUrl use it; otherwise try to fetch from MediaStorage
            let src = item.dataUrl || item.data;
            if (!src && item.id && window.MediaStorage && typeof MediaStorage.getPhoto === 'function') {
              src = await MediaStorage.getPhoto(item.id);
            }
            if (modalImage && src) {
              modalImage.src = src;
              modalImage.classList.remove('hidden');
            }
          } else {
            // video
            let blobOrUrl = item.data;
            if (!blobOrUrl && item.id && window.MediaStorage && typeof MediaStorage.getVideo === 'function') {
              blobOrUrl = await MediaStorage.getVideo(item.id);
            }
            if (modalVideo && blobOrUrl) {
              modalVideo.src = (blobOrUrl instanceof Blob) ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
              modalVideo.classList.remove('hidden');
              modalVideo.play().catch(()=>{});
            }
          }

          mediaModal.style.display = 'flex';
        } catch (e) {
          console.error('Failed to open media modal:', e);
        }
      });

      // insert at front
      if (thumbsContainer.firstChild) {
        thumbsContainer.insertBefore(thumb, thumbsContainer.firstChild);
      } else {
        thumbsContainer.appendChild(thumb);
      }
    } catch(e) {
      console.error('Error adding thumbnail:', e);
    }
  }

  // Additional DOM elements
  const mediaLoading = document.getElementById('mediaLoading');
  const mediaError = document.getElementById('mediaError');
  const retryLoadBtn = document.getElementById('retryLoadBtn');
  const storageError = document.getElementById('storageError');

  // Diagnostics modal elements (added to media.html)
  const diagnosticsBtn = document.getElementById('diagnosticsBtn');
  const diagnosticsModal = document.getElementById('diagnosticsModal');
  const runDiagnosticsBtn = document.getElementById('runDiagnostics');
  const clearDiagnosticsBtn = document.getElementById('clearDiag');
  const diagnosticsClose = document.getElementById('diagClose');
  const diagnosticsResults = document.getElementById('diagResults');

  // UI feedback helper functions
  function showProgressIndicator(message) {
    const existingIndicator = document.querySelector('.progress-indicator');
    if (existingIndicator) {
      existingIndicator.textContent = message;
      return existingIndicator;
    }

    const indicator = document.createElement('div');
    indicator.className = 'progress-indicator';
    indicator.textContent = message;
    document.body.appendChild(indicator);
    return indicator;
  }

  function hideProgressIndicator(indicator) {
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  function showNotification(message, type = 'info') {
    // Remove any existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  // Show/hide loading state
  function setLoading(loading) {
    if (mediaLoading) {
      mediaLoading.classList.toggle('hidden', !loading);
      if (loading && mediaError) {
        mediaError.classList.add('hidden');
      }
    }
  }

  // Show error message with improved feedback
  function showError(message, isStorageError = false) {
    // Show in error container
    if (isStorageError && storageError) {
      const span = storageError.querySelector('span');
      if (span) span.textContent = message;
      storageError.classList.remove('hidden');
    } else if (mediaError) {
      const span = mediaError.querySelector('span');
      if (span) span.textContent = message;
      mediaError.classList.remove('hidden');
    }

    // Also show as notification
    showNotification(message, 'error');
  }

  // Clear error messages
  function clearErrors() {
    if (mediaError) mediaError.classList.add('hidden');
    if (storageError) storageError.classList.add('hidden');
  }

  // --- Diagnostics modal wiring -----------------------------------------
  // Render diagnostics results (array of { id, missing: [...], total })
  function renderDiagnosticsResults(results) {
    if (!diagnosticsResults) return;
    diagnosticsResults.innerHTML = '';
    if (!results || results.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'diag-ok';
      ok.textContent = 'No broken videos found.';
      diagnosticsResults.appendChild(ok);
      return;
    }

    for (const r of results) {
      const row = document.createElement('div');
      row.className = 'diag-row';
      const title = document.createElement('div');
      title.className = 'diag-title';
      title.textContent = `Video ID: ${r.id}`;
      row.appendChild(title);

      const detail = document.createElement('div');
      detail.className = 'diag-detail';
      detail.textContent = `Missing chunks: ${Array.isArray(r.missing) && r.missing.length ? r.missing.join(', ') : 'none'}  (expected ${r.total})`;
      row.appendChild(detail);

      const actions = document.createElement('div');
      actions.className = 'diag-actions';
      const del = document.createElement('button');
      del.className = 'btn btn-danger diag-delete';
      del.textContent = 'Delete broken video';
      del.addEventListener('click', async () => {
        if (!confirm('Delete this broken video and its chunks? This cannot be undone.')) return;
        try {
          const indicator = showProgressIndicator('Deleting broken video...');
          await MediaStorage.deleteBrokenVideo(r.id);
          hideProgressIndicator(indicator);
          showNotification('Broken video deleted', 'success');
          // refresh gallery and diagnostics
          await loadExistingMedia();
          await updateStorageInfo();
          await runDiagnostics();
        } catch (e) {
          hideProgressIndicator();
          console.error('Failed to delete broken video', e);
          showNotification('Failed to delete broken video', 'error');
        }
      });
      actions.appendChild(del);

      row.appendChild(actions);
      diagnosticsResults.appendChild(row);
    }
  }

  async function runDiagnostics() {
    if (!window.MediaStorage || typeof MediaStorage.findBrokenVideos !== 'function') {
      renderDiagnosticsResults([]);
      showNotification('Diagnostics not available: MediaStorage missing', 'error');
      return;
    }
    const indicator = showProgressIndicator('Running diagnostics...');
    try {
      const results = await MediaStorage.findBrokenVideos();
      renderDiagnosticsResults(results || []);
    } catch (e) {
      console.error('Diagnostics failed', e);
      renderDiagnosticsResults([]);
      showNotification('Diagnostics encountered an error', 'error');
    } finally {
      hideProgressIndicator(indicator);
    }
  }

  // Open/close modal handlers
  if (diagnosticsBtn && diagnosticsModal) {
    diagnosticsBtn.addEventListener('click', () => {
      diagnosticsModal.style.display = 'flex';
      // clear old results
      if (diagnosticsResults) diagnosticsResults.innerHTML = '';
    });
  }

  if (diagnosticsClose && diagnosticsModal) {
    diagnosticsClose.addEventListener('click', () => {
      diagnosticsModal.style.display = 'none';
    });
  }

  if (runDiagnosticsBtn) {
    runDiagnosticsBtn.addEventListener('click', async () => { await runDiagnostics(); });
  }

  if (clearDiagnosticsBtn) {
    clearDiagnosticsBtn.addEventListener('click', () => {
      if (diagnosticsResults) diagnosticsResults.innerHTML = '';
    });
  }

  // close diagnostics modal on background click
  if (diagnosticsModal) {
    diagnosticsModal.addEventListener('click', (e) => {
      if (e.target === diagnosticsModal) diagnosticsModal.style.display = 'none';
    });
  }
  // --- end diagnostics wiring -------------------------------------------

  // Check storage integrity
  async function checkStorageIntegrity() {
    let hasErrors = false;
    let errorMessage = '';

    // Check localStorage
    try {
      const raw = localStorage.getItem('captured_photos');
      if (raw) {
        const photos = JSON.parse(raw);
        if (!Array.isArray(photos)) {
          throw new Error('Photos data is corrupted');
        }
        // Check each photo's data
        photos.forEach((photo, index) => {
          if (!photo.dataUrl || !photo.timestamp) {
            console.warn(`Removing corrupted photo at index ${index}`);
            photos.splice(index, 1);
            hasErrors = true;
          }
        });
        if (hasErrors) {
          localStorage.setItem('captured_photos', JSON.stringify(photos));
          errorMessage = 'Some corrupted photos were removed.';
        }
      }
    } catch(e) {
      console.error('localStorage integrity check failed:', e);
      localStorage.removeItem('captured_photos');
      errorMessage = 'Photos storage was corrupted and has been reset.';
      hasErrors = true;
    }

    // Check IndexedDB
    try {
      // Delegate integrity checks to MediaStorage where possible
      if (window.MediaStorage && typeof MediaStorage.getAllMedia === 'function') {
        try {
          const all = await MediaStorage.getAllMedia();
          // If MediaStorage returned a non-array something is wrong
          if (!Array.isArray(all)) throw new Error('Media storage returned invalid data');
        } catch(e) {
          console.warn('MediaStorage integrity check failed:', e);
          hasErrors = true;
          errorMessage += ' Video storage error detected.';
        }
      }
    } catch(e) {
      console.error('IndexedDB integrity check failed:', e);
      errorMessage += ' Video storage error detected.';
      hasErrors = true;
    }

    if (hasErrors) {
      showError(errorMessage.trim(), true);
    }
    
    return !hasErrors;
  }

  // Load existing media on startup with retries
  async function loadExistingMedia(retryCount = 0) {
    const MAX_RETRIES = 3;
    setLoading(true);
    clearErrors();
    
    try {
      // Check storage integrity first
      await checkStorageIntegrity();
      
      // Clear existing thumbnails
      if (thumbsContainer) {
        thumbsContainer.innerHTML = '';
      }
      
      // Load photos stored in localStorage (backwards compatibility)
      try {
        const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
        if (Array.isArray(photos)) {
            for (const photo of photos) {
              if (!photo || !photo.dataUrl) continue;
              try {
                await new Promise((resolve, reject) => {
                  const img = new Image();
                  img.onload = resolve;
                  img.onerror = reject;
                  img.src = photo.dataUrl;
                });
                // Only add if it matches current filter
                if (shouldShowItem(photo, 'photo')) addThumbnail(photo, 'photo');
              } catch (e) {
                console.warn('Skipping invalid localStorage photo:', e);
              }
            }
          }
      } catch(e) {
        console.warn('Error reading localStorage photos:', e);
      }

      // Load media saved via MediaStorage (photos & videos)
      if (window.MediaStorage && typeof MediaStorage.getAllMedia === 'function') {
        try {
          const all = await MediaStorage.getAllMedia();
          if (Array.isArray(all)) {
            for (const item of all) {
              try {
                        if (item.type === 'photo') {
                            // Reconstruct photo data URL from MediaStorage
                            const dataUrl = await MediaStorage.getPhoto(item.id).catch(() => null);
                            if (dataUrl) {
                              // pass stored meta through so gallery can show event badge
                              const photoItem = { id: item.id, dataUrl, timestamp: item.timestamp, meta: item.meta };
                              if (shouldShowItem(photoItem, 'photo')) addThumbnail(photoItem, 'photo');
                            }
                } else if (item.type === 'video') {
                  const blob = await MediaStorage.getVideo(item.id).catch(() => null);
                  if (blob) {
                    const videoItem = { ...item, data: blob };
                    if (shouldShowItem(videoItem, 'video')) addThumbnail(videoItem, 'video');
                  }
                }
              } catch(e) {
                console.warn('Skipping invalid media item from MediaStorage:', e);
              }
            }
          }
        } catch(e) {
          console.warn('Error loading media from MediaStorage:', e);
        }
      }

      setLoading(false);
  await updateStorageInfo();
  // Populate event select list after loading media
  await populateEventSelect();
      
    } catch(e) {
      console.error('Error loading media:', e);
      setLoading(false);
      
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying media load (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return loadExistingMedia(retryCount + 1);
      } else {
        showError('Could not load media. Please try refreshing the page.');
      }
    }
  }

  // Media management UI elements (optional; may not exist on gallery-only page)
  const mediaModal = document.getElementById('mediaModal');
  if (mediaModal) mediaModal.style.display = 'none';
  // wire modal close controls
  if (mediaModal) {
    const modalClose = mediaModal.querySelector('.close');
    modalClose && modalClose.addEventListener('click', () => {
      mediaModal.style.display = 'none';
      const modalImage = document.getElementById('modalImage');
      const modalVideo = document.getElementById('modalVideo');
      if (modalVideo) { modalVideo.pause(); modalVideo.src = ''; }
      if (modalImage) modalImage.src = '';
    });
    // close on background click
    mediaModal.addEventListener('click', (e) => {
      if (e.target === mediaModal) {
        mediaModal.style.display = 'none';
        const modalImage = document.getElementById('modalImage');
        const modalVideo = document.getElementById('modalVideo');
        if (modalVideo) { modalVideo.pause(); modalVideo.src = ''; }
        if (modalImage) modalImage.src = '';
      }
    });
  }
  const manageMediaBtn = document.getElementById('manageMediaBtn');
  const closeModal = document.getElementById('closeModal');
  const cancelManageBtn = document.getElementById('cancelManageBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const mediaGrid = document.getElementById('mediaGrid');
  const selectedCount = document.getElementById('selectedCount');
  const storageUsed = document.getElementById('storageUsed');
  const storageLimit = document.getElementById('storageLimit');

  // Media management state
  let selectedItems = new Set();

  // Update storage display with detailed info
  async function updateStorageInfo() {
    try {
      // Get photos count and size
      const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
      const photoCount = photos.length;
      const photoSize = photos.reduce((total, photo) => total + (photo.size || 0), 0);

      // Get videos count and size
      let videoCount = 0;
      let videoSize = 0;
      
      try {
        if (window.MediaStorage && typeof MediaStorage.getStorageInfo === 'function') {
          const info = await MediaStorage.getStorageInfo();
          videoCount = info.videos || info.videosCount || info.videos || 0;
          videoSize = info.videoSize || info.usedSpace || 0;
        }
      } catch(e) {
        console.warn('Error getting video sizes from MediaStorage:', e);
      }

      // Update storage estimate
      const { usage, quota } = await navigator.storage.estimate();
      const usedPercent = Math.round((usage / quota) * 100);
      const totalItems = photoCount + videoCount;

      // Update DOM
      if (storageUsed) storageUsed.textContent = totalItems;
      if (storageLimit) storageLimit.textContent = MAX_PHOTOS;

      // Show warning if getting close to limits
      if (usedPercent > 80 || totalItems > MAX_PHOTOS * 0.8) {
        showError('Storage is getting full. Consider removing old media.', true);
      } else {
        clearErrors();
      }

    } catch(e) {
      console.warn('Error updating storage info:', e);
    }
  }

  // Open media management modal
  if (manageMediaBtn) {
    manageMediaBtn.addEventListener('click', async () => {
      if (!mediaModal) return;
      mediaModal.classList.remove('hidden');
      selectedItems.clear();
      await loadMediaForManagement();
      updateDeleteButton();
    });
  }

  // Close modal handlers
  [closeModal, cancelManageBtn].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (mediaModal) mediaModal.classList.add('hidden');
      if (mediaGrid) mediaGrid.innerHTML = '';
      selectedItems.clear();
      updateDeleteButton();
    });
  });

  // Load media for management
  async function loadMediaForManagement() {
    mediaGrid.innerHTML = '';
    
    try {
      // Load photos
      const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
      if (Array.isArray(photos)) {
        photos.forEach((photo, index) => {
          const item = createManageableMediaItem(photo, 'photo', index, 'local');
          mediaGrid.appendChild(item);
        });
      }

      // Load videos and photos from MediaStorage
      if (window.MediaStorage && typeof MediaStorage.getAllMedia === 'function') {
        const all = await MediaStorage.getAllMedia();
        for (const m of all) {
          if (m.type === 'video') {
            try {
              const blob = await MediaStorage.getVideo(m.id);
              const item = createManageableMediaItem({ ...m, data: URL.createObjectURL(blob) }, 'video', m.id, 'storage');
              mediaGrid.appendChild(item);
            } catch(e) {
              console.warn('Skipping stored video in management UI:', e);
            }
          } else if (m.type === 'photo') {
            try {
              const dataUrl = await MediaStorage.getPhoto(m.id);
              const item = createManageableMediaItem({ ...m, dataUrl }, 'photo', m.id, 'storage');
              mediaGrid.appendChild(item);
            } catch(e) {
              console.warn('Skipping stored photo in management UI:', e);
            }
          }
        }
      }
    } catch(e) {
      console.error('Error loading media for management:', e);
      alert('Error loading media. Please try again.');
    }
  }

  // Create manageable media item
  function createManageableMediaItem(item, type, id, source = 'local') {
    const div = document.createElement('div');
    div.className = 'media-item';
    div.dataset.id = id;
    div.dataset.type = type;
    div.dataset.source = source; // 'local' or 'storage'

    if (type === 'photo') {
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = 'Photo ' + new Date(item.timestamp).toLocaleString();
      div.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = item.data;
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      div.appendChild(video);
    }

    const overlay = document.createElement('div');
    overlay.className = 'select-overlay';
    overlay.innerHTML = '<i class="fas fa-check"></i>';
    div.appendChild(overlay);

    const meta = document.createElement('div');
    meta.className = 'media-meta';
    meta.textContent = new Date(item.timestamp).toLocaleString();
    div.appendChild(meta);

    div.addEventListener('click', () => toggleItemSelection(div));

    return div;
  }

  // Toggle item selection
  function toggleItemSelection(item) {
    const id = item.dataset.id;
    if (selectedItems.has(id)) {
      selectedItems.delete(id);
      item.classList.remove('selected');
    } else {
      selectedItems.add(id);
      item.classList.add('selected');
    }
    updateDeleteButton();
  }

  // Update delete button state
  function updateDeleteButton() {
    const count = selectedItems.size;
    deleteSelectedBtn.disabled = count === 0;
    selectedCount.textContent = count;
  }

  // Delete selected items
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete the selected items? This cannot be undone.')) {
      return;
    }

    try {
      // Delete items depending on their source (localStorage vs MediaStorage)
      // Handle local photos (by numeric index)
      try {
        const photos = JSON.parse(localStorage.getItem('captured_photos') || '[]');
        const remainingPhotos = photos.filter((_, index) => !selectedItems.has(String(index)));
        localStorage.setItem('captured_photos', JSON.stringify(remainingPhotos));
      } catch(e) {
        console.warn('Error deleting local photos:', e);
      }

      // Handle items stored in MediaStorage
      const storageDeletes = Array.from(selectedItems).map(async (id) => {
        const el = mediaGrid.querySelector(`[data-id="${id}"][data-source="storage"]`);
        if (!el) return;
        const type = el.dataset.type;
        try {
          await MediaStorage.deleteMedia(id, type);
        } catch(e) {
          console.warn('Failed to delete stored media', id, e);
        }
      });

      await Promise.all(storageDeletes);

      // Refresh UI
      await loadMediaForManagement();
      await loadExistingMedia(); // Refresh main gallery
      updateStorageInfo();
      selectedItems.clear();
      updateDeleteButton();

      alert('Selected items have been deleted.');
    } catch(e) {
      console.error('Error deleting items:', e);
      alert('Error deleting items. Please try again.');
    }
    });
  }

  // Initialize: only start camera if camera element exists; otherwise just load gallery
  if (camera) {
    initCamera().then(async () => {
      updateFilterUI();
      await loadExistingMedia();
      await updateStorageInfo();
    });
  } else {
    // Gallery-only page: load media immediately
    (async () => { updateFilterUI(); await loadExistingMedia(); await updateStorageInfo(); })();
  }

  // Listen for real-time notifications from MediaStorage (other tabs or camera page)
  try {
    const bc = new BroadcastChannel('wedding_media');
    bc.onmessage = async (ev) => {
      try {
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === 'new_media') {
          const m = msg.media || msg;
          // If we have an id, prefer to reconstruct from MediaStorage so objectURLs are resolved correctly
            if (m && m.id && window.MediaStorage) {
            try {
              if (m.type === 'photo') {
                const dataUrl = await MediaStorage.getPhoto(m.id).catch(() => null);
                if (dataUrl) {
                  const photoItem = { id: m.id, dataUrl, timestamp: m.timestamp, meta: m.meta || {} };
                  if (shouldShowItem(photoItem, 'photo')) addThumbnail(photoItem, 'photo');
                }
              } else if (m.type === 'video') {
                // For video, don't attempt to use an objectURL sent from another tab; fetch blob instead
                const blob = await MediaStorage.getVideo(m.id).catch(() => null);
                if (blob) {
                  const videoItem = { id: m.id, data: blob, timestamp: m.timestamp, meta: m.meta || {} };
                  if (shouldShowItem(videoItem, 'video')) addThumbnail(videoItem, 'video');
                }
              }
              await updateStorageInfo();
              await populateEventSelect();
              // notify the user and scroll the grid so the new item is visible
              try {
                showNotification('New moment added', 'success');
                if (thumbsContainer && thumbsContainer.firstChild) {
                  // scroll the grid to top where we inserted the new thumbnail
                  thumbsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              } catch (e) { /* ignore UI notification errors */ }
            } catch (e) {
              console.warn('Failed to handle broadcast media item:', e);
            }
          } else if (m && m.type) {
            // Fallback: add using data provided in the message (if any)
            if (m.type === 'photo' && m.data) addThumbnail({ id: m.id || '', dataUrl: m.data, timestamp: m.timestamp, meta: m.meta || {} }, 'photo');
            if (m.type === 'video' && m.data) addThumbnail({ id: m.id || '', data: m.data, timestamp: m.timestamp, meta: m.meta || {} }, 'video');
            updateStorageInfo();
          }
        }
      } catch (err) { console.warn('Broadcast handler error:', err); }
    };
  } catch (e) {
    console.warn('BroadcastChannel not available:', e);
  }
})();