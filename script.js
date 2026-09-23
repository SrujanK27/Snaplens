/**
 * SnapLens — Client-side logic
 * Handles camera/gallery input, image compression, and API communication.
 * Images are processed in-memory and never persisted.
 */

(function () {
  'use strict';

  // ── DOM refs ──
  const btnScan = document.getElementById('btnScan');
  const btnGallery = document.getElementById('btnGallery');
  const cameraInput = document.getElementById('cameraInput');
  const galleryInput = document.getElementById('galleryInput');
  const actions = document.getElementById('actions');
  const resultArea = document.getElementById('resultArea');
  const previewImg = document.getElementById('previewImg');
  const analysisLoading = document.getElementById('analysisLoading');
  const resultsCard = document.getElementById('resultsCard');
  const errorCard = document.getElementById('errorCard');
  const errorMsg = document.getElementById('errorMsg');
  const resultCategory = document.getElementById('resultCategory');
  const resultName = document.getElementById('resultName');
  const resultBody = document.getElementById('resultBody');
  const btnClose = document.getElementById('btnClose');
  const btnAgain = document.getElementById('btnAgain');
  const btnRetry = document.getElementById('btnRetry');

  // ── Max image size to send (pixels on longest side) ──
  const MAX_IMAGE_DIM = 1024;
  const JPEG_QUALITY = 0.8;

  // ── Event Listeners ──
  btnScan.addEventListener('click', () => cameraInput.click());
  btnGallery.addEventListener('click', () => galleryInput.click());

  cameraInput.addEventListener('change', handleFileSelect);
  galleryInput.addEventListener('change', handleFileSelect);

  btnClose.addEventListener('click', resetUI);
  btnAgain.addEventListener('click', resetUI);
  btnRetry.addEventListener('click', resetUI);

  /**
   * Handle file selection from camera or gallery
   */
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Security: validate file type
    if (!file.type.startsWith('image/')) {
      showError('Please select a valid image file.');
      return;
    }

    // Security: limit file size (20MB max)
    if (file.size > 20 * 1024 * 1024) {
      showError('Image is too large. Please select an image under 20MB.');
      return;
    }

    processImage(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  /**
   * Process the selected image: compress, preview, and send for analysis
   */
  async function processImage(file) {
    try {
      // Show preview area
      actions.classList.add('hidden');
      resultArea.classList.remove('hidden');
      resultsCard.classList.add('hidden');
      errorCard.classList.add('hidden');
      analysisLoading.classList.remove('hidden');

      // Read file as data URL for preview
      const dataUrl = await readFileAsDataURL(file);
      previewImg.src = dataUrl;

      // Compress for API
      const compressedBase64 = await compressImage(dataUrl);

      // Send to serverless function
      const result = await analyzeImage(compressedBase64);

      // Show results
      showResults(result);
    } catch (err) {
      console.error('Processing error:', err);
      showError(err.message || 'Failed to analyze image. Please try again.');
    }
  }

  /**
   * Read a File as Data URL
   */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Compress image to JPEG, resize if necessary
   * Returns base64 string (without data URL prefix)
   */
  function compressImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Scale down if larger than max
        if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
          const ratio = Math.min(MAX_IMAGE_DIM / width, MAX_IMAGE_DIM / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Get compressed JPEG base64
        const jpegDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        const base64 = jpegDataUrl.split(',')[1];
        resolve(base64);
      };
      img.onerror = () => reject(new Error('Failed to process image.'));
      img.src = dataUrl;
    });
  }

  /**
   * Send image to serverless function for AI analysis
   */
  async function analyzeImage(base64Image) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.');
      }
      throw err;
    }
  }

  /**
   * Display analysis results
   */
  function showResults(data) {
    analysisLoading.classList.add('hidden');
    errorCard.classList.add('hidden');
    resultsCard.classList.remove('hidden');

    resultCategory.textContent = data.category || 'Identified';
    resultName.textContent = data.name || 'Unknown Object';

    // Build result body HTML
    let html = '';

    if (data.description) {
      html += `<h3>Description</h3><p>${escapeHTML(data.description)}</p>`;
    }

    if (data.details && data.details.length > 0) {
      html += '<h3>Key Details</h3><ul>';
      data.details.forEach(d => {
        html += `<li>${escapeHTML(d)}</li>`;
      });
      html += '</ul>';
    }

    if (data.funFact) {
      html += `<h3>Fun Fact</h3><p>${escapeHTML(data.funFact)}</p>`;
    }

    resultBody.innerHTML = html;
  }

  /**
   * Show error state
   */
  function showError(message) {
    analysisLoading.classList.add('hidden');
    resultsCard.classList.add('hidden');
    errorCard.classList.remove('hidden');
    errorMsg.textContent = message;

    // Make sure result area is visible
    actions.classList.add('hidden');
    resultArea.classList.remove('hidden');
  }

  /**
   * Reset UI to initial state
   */
  function resetUI() {
    resultArea.classList.add('hidden');
    resultsCard.classList.add('hidden');
    errorCard.classList.add('hidden');
    analysisLoading.classList.add('hidden');
    actions.classList.remove('hidden');
    previewImg.src = '';
    resultBody.innerHTML = '';
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
