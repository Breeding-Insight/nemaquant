// Basic front-end logic

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const uploadText = document.getElementById('upload-text');
    const inputMode = document.getElementById('input-mode');
    const startProcessingBtn = document.getElementById('start-processing');
    const confidenceSlider = document.getElementById('confidence-threshold');
    const confidenceValue = document.getElementById('confidence-value');
    const progress = document.getElementById('progress');
    const progressText = document.getElementById('progress-text');
    const progressPercentage = document.getElementById('progress-percentage');
    const imageCounter = document.getElementById('image-counter');
    const statusOutput = document.getElementById('status-output');
    const clearLogBtn = document.getElementById('clear-log');
    const resultsTableBody = document.querySelector('.results-table tbody');
    const previewImage = document.getElementById('preview-image');
    const imageInfo = document.getElementById('image-info');
    const prevBtn = document.getElementById('prev-image');
    const nextBtn = document.getElementById('next-image');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const exportCsvBtn = document.getElementById('export-csv');
    const exportImagesBtn = document.getElementById('export-images');
    const inputModeHelp = document.getElementById('input-mode-help');
    const imageContainer = document.getElementById('image-container');

    let currentResults = [];
    let currentImageIndex = -1;
    let currentJobId = null;
    let currentZoomLevel = 1;
    let filenameMap = {};
    const MAX_ZOOM = 3;
    const MIN_ZOOM = 0.5;
    let progressInterval = null; // Interval timer for polling
    let filteredValidFiles = [];
    
    // Panning variables
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;
    let currentPanX = 0;
    let currentPanY = 0;
    
    // Pagination and sorting variables
    const RESULTS_PER_PAGE = 10;
    let currentPage = 1;
    let totalPages = 1;
    let currentSortField = null;
    let currentSortDirection = 'asc';

    // --- Store all detections for frontend filtering ---
    let allDetections = [];
    let allImageData = {};

    // Input mode change
    inputMode.addEventListener('change', () => {
        const mode = inputMode.value;
        if (mode === 'files') {
            fileInput.removeAttribute('webkitdirectory');
            fileInput.removeAttribute('directory');
            fileInput.setAttribute('multiple', '');
            inputModeHelp.textContent = 'Choose one or more image files for processing';
            uploadText.textContent = 'Drag and drop images here or click to browse';
        } else if (mode === 'folder') {
            fileInput.setAttribute('webkitdirectory', '');
            fileInput.setAttribute('directory', '');
            fileInput.removeAttribute('multiple');
            inputModeHelp.textContent = 'Select a folder containing images to process';
            uploadText.textContent = 'Click to select a folder containing images';
        } else if (mode === 'keyence') {
            fileInput.setAttribute('webkitdirectory', '');
            fileInput.setAttribute('directory', '');
            fileInput.removeAttribute('multiple');
            inputModeHelp.textContent = 'Select a Keyence output folder. Folder should have subdirectories of format XY01, XY02, etc.';
            uploadText.textContent = 'Click to select a Keyence output folder';
        }
        // Clear any existing files
        fileInput.value = '';
        fileList.innerHTML = '';
        updateUploadState();
    });

    // File Upload Handling
    function handleFiles(files) {
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/tif'];
        // --- Keyence folder validation ---
        if (inputMode.value === 'keyence') {
            // Collect all unique first-level subdirectory names from webkitRelativePath
            const subdirs = new Set();
            Array.from(files).forEach(file => {
                if (file.webkitRelativePath) {
                    const parts = file.webkitRelativePath.split('/');
                    if (parts.length > 2) { // Parent/Subdir/File
                        subdirs.add(parts[1]);
                    }
                }
            });
            // Check for at least one subdir matching XY[0-9]{2}
            const xyPattern = /^XY\d{2}$/;
            const hasXY = Array.from(subdirs).some(name => xyPattern.test(name));
            if (!hasXY) {
                // Print the first 5 values in subdirs for debugging
                const subdirArr = Array.from(subdirs).slice(0, 5);
                logStatus('First 5 subdirectories found: ' + (subdirArr.length ? subdirArr.join(', ') : '[none]'));
                logStatus('Error: The selected folder does not contain any subdirectory named like "XY01", "XY02", etc. Please select a valid Keyence output folder.');
                fileList.innerHTML = '';
                startProcessingBtn.disabled = true;
                return;
            }
            // --- Check for .csv file(s) ---
            const csvFiles = Array.from(files).filter(file => file.name.toLowerCase().endsWith('.csv'));
            if (csvFiles.length === 1) {
                // Show a custom dialog with multiple options
                showSingleCsvDialog(csvFiles[0]);
                return;
            } else if (csvFiles.length === 0) {
                showNoCsvDialog();
                return;
            } else {
                // Multiple CSVs found, show a custom dialog for selection
                showCsvSelectionDialog(csvFiles);
                return; // Wait for user selection before proceeding
            }
        }
        let validFiles;
        if (inputMode.value === 'keyence') {
            // Only analyze the first valid image file (alphabetically) in each subdirectory
            const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/tif'];
            // Map: subdir name -> array of files in that subdir
            const subdirFiles = {};
            Array.from(files).forEach(file => {
                if (file.webkitRelativePath) {
                    const parts = file.webkitRelativePath.split('/');
                    if (parts.length > 2) { // Parent/Subdir/File
                        const subdir = parts[1];
                        if (!subdirFiles[subdir]) subdirFiles[subdir] = [];
                        if (allowedTypes.includes(file.type) && !file.webkitRelativePath.startsWith('.')) {
                            subdirFiles[subdir].push(file);
                        }
                    }
                }
            });
            // For each subdir, pick the first file alphabetically
            validFiles = Object.values(subdirFiles).map(filesArr => {
                return filesArr.sort((a, b) => a.name.localeCompare(b.name))[0];
            }).filter(Boolean); // Remove undefined
        } else {
            validFiles = Array.from(files).filter(file => {
                if (inputMode.value === 'folder') {
                    return allowedTypes.includes(file.type) && 
                           file.webkitRelativePath && 
                           !file.webkitRelativePath.startsWith('.');
                }
                return allowedTypes.includes(file.type);
            });
        }
        filteredValidFiles = validFiles;

        const invalidFiles = Array.from(files).filter(file => !allowedTypes.includes(file.type));

        // Only print invalid file warnings if not in Keyence mode
        if (invalidFiles.length > 0 && inputMode.value !== 'keyence') {
            logStatus(`Warning: Skipped ${invalidFiles.length} invalid files. Only PNG, JPG, and TIFF are supported.`);
            invalidFiles.forEach(file => {
                logStatus(`- Skipped: ${file.name} (invalid type: ${file.type || 'unknown'})`);
            });
        }

        if (validFiles.length === 0) {
            logStatus('Error: No valid image files selected.');
            return;
        }

        fileList.innerHTML = '';
        
        // Just show an icon to indicate files are selected
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'file-summary';
        summaryDiv.innerHTML = `
            <div class="summary-header">
                <i class="ri-file-list-3-line"></i>
                <span>Images ready for processing</span>
            </div>
        `;
        fileList.appendChild(summaryDiv);

        fileInput.files = files;
        updateUploadState(validFiles.length);
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Drag and Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        dropZone.classList.add('drag-over');
    }

    function unhighlight() {
        dropZone.classList.remove('drag-over');
    }

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        handleFiles(dt.files);
    });

    // Click to upload
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
        handleFiles(fileInput.files);
        if (filteredValidFiles && filteredValidFiles.length > 0) {
            // Prepare FormData for upload
            const formData = new FormData();
            filteredValidFiles.forEach(f => formData.append('files', f));
            try {
                const response = await fetch('/uploads', {
                    method: 'POST',
                    body: formData
                });
                if (response.ok) {
                    const data = await response.json();
                    logStatus('Files uploaded successfully.');
                    filenameMap = data.filename_map || {};
                    
                    // Update results table with filenames and View buttons
                    resultsTableBody.innerHTML = '';
                    Object.entries(filenameMap).forEach(([uuid, originalFilename], idx) => {
                        const row = resultsTableBody.insertRow();
                        row.dataset.originalIndex = idx;
                        row.innerHTML = `
                            <td>${originalFilename}</td>
                            <td style="color:#bbb;">NA</td>
                            <td><button class="view-button" data-index="${idx}">View</button></td>
                        `;
                    });
                    // Add click event for View buttons
                    resultsTableBody.querySelectorAll('.view-button').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            const idx = parseInt(btn.dataset.index, 10);
                            displayImage(idx);
                        });
                    });
                } else {
                    logStatus('File upload failed.');
                }
            } catch (err) {
                logStatus('Error uploading files: ' + err);
            }
        }
    });

    // Input mode change
    inputMode.addEventListener('change', () => {
        updateUploadState();
    });

    function updateUploadState(validFileCount) {
        // Use filteredValidFiles for enabling/disabling the button
        if (!filteredValidFiles || filteredValidFiles.length === 0) {
            if (inputMode.value === 'folder') {
                uploadText.textContent = 'Click to select a folder containing images';
            } else if (inputMode.value === 'keyence') {
                uploadText.textContent = 'Click to select a Keyence output folder';
            } else {
                uploadText.textContent = 'Drag and drop images here or click to browse';
            }
            startProcessingBtn.disabled = true;
        } else {
            uploadText.textContent = `${validFileCount} image${validFileCount === 1 ? '' : 's'} selected`;
            startProcessingBtn.disabled = validFileCount === 0;
            // Populate results table with uuid/filename pairs from filenameMap after upload
            resultsTableBody.innerHTML = '';
            Object.entries(filenameMap).forEach(([uuid, originalFilename], idx) => {
                const row = resultsTableBody.insertRow();
                row.dataset.originalIndex = idx;
                row.innerHTML = `
                    <td>${originalFilename}</td>
                    <td style="color:#bbb;">NA</td>
                    <td><button class="view-button" data-uuid="${uuid}" data-index="${idx}">View</button></td>
                `;
            });
            // Add click event for View buttons
            resultsTableBody.querySelectorAll('.view-button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const uuid = btn.getAttribute('data-uuid');
                    displayImage(uuid);
                });
            });
        }
    }

    // Confidence threshold
    confidenceSlider.addEventListener('input', () => {
        confidenceValue.textContent = confidenceSlider.value;
    });

    // Clear log
    clearLogBtn.addEventListener('click', () => {
        statusOutput.textContent = '';
        logStatus('Log cleared');
    });

    // Processing
    startProcessingBtn.addEventListener('click', async () => {
        // Use filteredValidFiles for processing
        const files = filteredValidFiles;
        if (!files || files.length === 0) {
            logStatus('Error: No files selected.');
            return;
        }

        const mode = inputMode.value;
        setLoading(true);
        logStatus('Starting upload and processing...');
        updateProgress(0, 'Uploading files...');
        // Do not clear resultsTableBody or preview image so users can browse existing results during processing
        currentResults = [];
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }

        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file);
        }
        formData.append('input_mode', mode);
        formData.append('confidence_threshold', confidenceSlider.value);

        try {
            const response = await fetch('/process', {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                let errorText = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorText += `: ${errorData.error || 'Unknown server error'}`;
                    if (errorData.log) logStatus(`Server Log: ${errorData.log}`);
                } catch (e) { 
                    errorText += ` - ${response.statusText}`;
                }
                throw new Error(errorText);
            }
            const data = await response.json();
            if (data.error) {
                logStatus(`Error starting process: ${data.error}`);
                if(data.log) logStatus(`Details: ${data.log}`);
                throw new Error(data.error);
            }
            // --- ASYNC JOB: Start polling for progress ---
            if (data.sessionId) {
                // logStatus(`Processing started. Job ID: ${data.sessionId}`);
                currentJobId = data.sessionId;
                pollProgress(currentJobId);
            } else {
                logStatus('Error: No sessionId returned from server.');
                setLoading(false);
            }
        } catch (error) {
            logStatus(`Error: ${error.message}`);
            updateProgress(0, 'Error occurred');
            setLoading(false);
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
        }
    });

    // --- Filtering and Table Update ---
    function updateResultsTable() {
        const threshold = parseFloat(confidenceSlider.value);
        // Use allDetections (array of {uuid, detections}) for filtering
        const prevUuid = (currentImageIndex >= 0 && currentResults[currentImageIndex]) ? currentResults[currentImageIndex].uuid : null;
        currentResults = allDetections.map(imgResult => {
            const filtered = imgResult.detections.filter(det => det.score >= threshold);
            // Use filenameMap to convert uuid to original filename for display
            const originalFilename = filenameMap[imgResult.uuid] || imgResult.uuid;
            return {
                uuid: imgResult.uuid,
                filename: originalFilename,
                num_eggs: filtered.length,
                detections: filtered
            };
        });
        resultsTableBody.innerHTML = '';
        currentSortField = null;
        currentSortDirection = 'asc';
        totalPages = Math.ceil(currentResults.length / RESULTS_PER_PAGE);
        currentPage = 1;
        displayResultsPage(currentPage);
        // Try to restore previous image if it still exists
        let newIndex = 0;
        if (prevUuid) {
            newIndex = currentResults.findIndex(r => r.uuid === prevUuid);
            if (newIndex === -1) newIndex = 0;
        }
        currentImageIndex = newIndex;
        if (currentResults.length > 0) displayImage(currentImageIndex);

        // Enable/disable export buttons based on results
        if (currentResults.length > 0) {
            exportCsvBtn.disabled = false;
            exportImagesBtn.disabled = false;
        } else {
            exportCsvBtn.disabled = true;
            exportImagesBtn.disabled = true;
        }
    }

    confidenceSlider.addEventListener('input', () => {
    confidenceValue.textContent = confidenceSlider.value;
    // 1. Update total eggs detected
    const totalEggsElem = document.getElementById('total-eggs-count');
    if (totalEggsElem && allDetections.length > 0) {
        const threshold = parseFloat(confidenceSlider.value);
        const totalEggs = allDetections.reduce((sum, imgResult) => sum + imgResult.detections.filter(det => det.score >= threshold).length, 0);
        totalEggsElem.textContent = totalEggs;
    }

    // 2. Redraw confidence plot
    renderConfidencePlot();

    // 3. Update results table
    updateResultsTable();

    // 4. Update eggs detected under image preview
    if (currentImageIndex >= 0) {
        displayImage(currentImageIndex);
    }
    });

    // --- Replace displayImage to use backend-annotated PNG ---
    async function displayImage(index) {
        // Always use uuid, not filename, for backend requests
        let uuid = index;
        // If index is a number, get uuid from filenameMap
        if (typeof index === 'number') {
            uuid = Object.keys(filenameMap)[index];
            currentImageIndex = index;
        } else {
            // If index is a uuid string, find its index for navigation
            currentImageIndex = Object.keys(filenameMap).indexOf(index);
        }
        let isCompleted = allDetections && allDetections.length > 0;
        const confidence = parseFloat(confidenceSlider.value);
        try {
            let response;
            if (isCompleted) {
                response = await fetch('/annotate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid: uuid, confidence })
                });
            } else {
                response = await fetch('/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid: uuid })
                });
            }
            if (response.ok) {
                const blob = await response.blob();
                console.log((isCompleted ? 'Annotate' : 'Preview') + ' image blob type:', blob.type, 'uuid:', uuid);
                if (previewImage.src && previewImage.src.startsWith('blob:')) {
                    URL.revokeObjectURL(previewImage.src);
                }
                const objectUrl = URL.createObjectURL(blob);
                previewImage.onload = function() {
                    updateImageInfo();
                    zoomInBtn.disabled = false;
                    zoomOutBtn.disabled = false;
                    const targetPage = Math.floor(index / RESULTS_PER_PAGE) + 1;
                    if (currentPage !== targetPage) {
                        currentPage = targetPage;
                        displayResultsPage(currentPage);
                    }
                    document.querySelectorAll('.results-table tr').forEach(r => r.classList.remove('selected'));
                    const rows = Array.from(resultsTableBody.querySelectorAll('tr'));
                    const targetRow = rows.find(row => parseInt(row.dataset.originalIndex, 10) === index);
                    if (targetRow) {
                        targetRow.classList.add('selected');
                    }
                    resetPanZoom();
                };
                previewImage.src = objectUrl;
                previewImage.alt = uuid;
            } else {
                console.error((isCompleted ? 'Annotate' : 'Preview') + ' image fetch failed:', response.status);
                clearPreview();
            }
        } catch (e) {
            clearPreview();
        }
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= (currentResults.length > 0 ? currentResults.length : filteredValidFiles.length) - 1;
    }

    // --- New Polling Function ---
    function pollProgress(sessionId) {
        if (progressInterval) {
            clearInterval(progressInterval); // Clear any existing timer
        }

        progressInterval = setInterval(async () => {
            try {
                const response = await fetch(`/progress`);
                if (!response.ok) {
                    let errorText = `Progress check failed: ${response.status}`;
                    try {
                        const errorData = await response.json();
                        errorText += `: ${errorData.error || 'Unknown progress error'}`;
                    } catch(e) { errorText += ` - ${response.statusText}`; }
                    throw new Error(errorText);
                }

                const data = await response.json();
                const status = (data.status || '').toLowerCase();

                switch (status) {
                    case 'starting':
                        updateProgress(data.progress || 0, 'Starting...');
                        logStatus('Job is starting.');
                        break;
                    case 'processing':
                        updateProgress(data.progress || 0, `Processing (${data.progress || 0}%)`);
                        // If results are present, update detections and table
                        if (data.results) {
                            allDetections = Object.entries(data.results).map(([uuid, detections]) => ({ uuid, detections }));
                            updateResultsTable();
                        }
                        break;
                    case 'completed':
                        clearInterval(progressInterval);
                        progressInterval = null;
                        updateProgress(100, 'Processing complete');
                        logStatus('Processing finished successfully.');
                        if (data.results) {
                            allDetections = Object.entries(data.results).map(([uuid, detections]) => ({ uuid, detections }));
                            updateResultsTable();
                        }
                        renderConfidencePlot();
                        setLoading(false);
                        break;
                    case 'error':
                        clearInterval(progressInterval);
                        progressInterval = null;
                        logStatus(`Error during processing: ${data.error || 'Unknown error'}`);
                        updateProgress(data.progress || 100, 'Error');
                        setLoading(false);
                        break;
                    case 'unknown':
                        clearInterval(progressInterval);
                        progressInterval = null;
                        logStatus('Unknown job status. Stopping progress updates.');
                        updateProgress(data.progress || 0, 'Unknown status');
                        setLoading(false);
                        break;
                    default:
                        logStatus(`Status: ${data.status}`);
                        updateProgress(data.progress || 0, data.status ? data.status.charAt(0).toUpperCase() + data.status.slice(1) : '');
                        break;
                }

            } catch (error) {
                clearInterval(progressInterval);
                progressInterval = null;
                logStatus(`Error polling progress: ${error.message}`);
                updateProgress(0, 'Polling Error');
                setLoading(false);
            }
        }, 1000); // Poll every 1 second
    }

    // --- UI Update Functions ---
    function setLoading(isLoading) {
        startProcessingBtn.disabled = isLoading;
        if (isLoading) {
            startProcessingBtn.innerHTML = '<i class="ri-loader-4-line"></i> Processing...';
            document.body.classList.add('processing');
            // Disable input changes during processing
            inputMode.disabled = true;
            fileInput.disabled = true;
            confidenceSlider.disabled = true;
        } else {
            startProcessingBtn.innerHTML = '<i class="ri-play-line"></i> Start Processing';
            document.body.classList.remove('processing');
            // Re-enable inputs after processing
            inputMode.disabled = false;
            fileInput.disabled = false;
            confidenceSlider.disabled = false;
        }
    }

    function updateProgress(value, message) {
        progress.value = value;
        progressPercentage.textContent = `${value}%`;
        progressText.textContent = message;
        
        // Clear the image counter when not processing
        if (message === 'Please upload an image' || message === 'Processing complete' || message.startsWith('Error')) {
            imageCounter.textContent = '';
        }
    }

    function logStatus(message) {
        const timestamp = new Date().toLocaleTimeString();
        statusOutput.innerHTML += `[${timestamp}] ${message}\n`;
        statusOutput.scrollTop = statusOutput.scrollHeight;
    }

    // Add click handlers for sortable columns
    document.querySelectorAll('.results-table th[data-sort]').forEach(header => {
        header.addEventListener('click', () => {
            const field = header.dataset.sort;
            if (currentSortField === field) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortField = field;
                currentSortDirection = 'asc';
            }
            
            // Update sort indicators
            document.querySelectorAll('.results-table th[data-sort]').forEach(h => {
                h.classList.remove('sort-asc', 'sort-desc');
            });
            header.classList.add(`sort-${currentSortDirection}`);
            
            // Sort and redisplay results
            sortResults();
            displayResultsPage(currentPage);
        });
    });
    
    function sortResults() {
        if (!currentSortField) return;
        
        currentResults.sort((a, b) => {
            let aVal = a[currentSortField];
            let bVal = b[currentSortField];
            
            // Handle numeric sorting for num_eggs
            if (currentSortField === 'num_eggs') {
                aVal = parseInt(aVal) || 0;
                bVal = parseInt(bVal) || 0;
            }
            
            if (aVal < bVal) return currentSortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // Results Display
    function displayResults(jobStatus, filenameMap, resultsObj) {
        resultsTableBody.innerHTML = '';
        currentImageIndex = -1;
        currentSortField = null;
        currentSortDirection = 'asc';

        // If job is not completed, show filenames only
        if (jobStatus !== 'completed') {
            Object.entries(filenameMap).forEach(([uuid, originalFilename], idx) => {
                const row = resultsTableBody.insertRow();
                row.innerHTML = `<td>${originalFilename}</td><td style="color:#bbb;">NA</td>`;
            });
            exportCsvBtn.disabled = true;
            exportImagesBtn.disabled = true;
            logStatus('Waiting for job to complete...');
            return;
        }

        // If job is completed, show filtered detection counts
        if (resultsObj) {
            Object.entries(resultsObj).forEach(([uuid, detections], idx) => {
                // Filter by confidence threshold
                const threshold = parseFloat(confidenceSlider.value);
                const filtered = detections.filter(d => d.score >= threshold);
                const originalFilename = filenameMap[uuid] || uuid;
                const row = resultsTableBody.insertRow();
                row.innerHTML = `<td>${originalFilename}</td><td>${filtered.length}</td>`;
            });
            exportCsvBtn.disabled = false;
            exportImagesBtn.disabled = false;
            logStatus('Job completed. Results displayed.');
        } else {
            logStatus('No results found.');
        }
    }
    
    // Display a specific page of results
    function displayResultsPage(page) {
        resultsTableBody.innerHTML = '';
        
        // Calculate start and end indices for current page
        const startIndex = (page - 1) * RESULTS_PER_PAGE;
        const endIndex = Math.min(startIndex + RESULTS_PER_PAGE, currentResults.length);
        
        // Display results for current page
        for (let i = startIndex; i < endIndex; i++) {
            const result = currentResults[i];
            const originalFilename = filenameMap[result.uuid] || result.uuid;
            const row = resultsTableBody.insertRow();
            row.innerHTML = `
                <td>
                    <i class="ri-image-line"></i>
                    ${originalFilename}
                </td>
                <td>${result.num_eggs}</td>
                <td class="text-right">
                    <button class="view-button" data-index="${i}" title="Click to view image">
                        <i class="ri-eye-line"></i>
                        View
                    </button>
                </td>
            `;
            // Store the original index to maintain image preview relationship
            row.dataset.originalIndex = i;
        }
        // Wire up View buttons after rows are created
        resultsTableBody.querySelectorAll('.view-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'));
                displayImage(idx);
                // Highlight selected row
                resultsTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                btn.closest('tr').classList.add('selected');
            });
        });
        // Update pagination UI
        updatePaginationControls();
    }
    
    // Update pagination controls with enhanced display
    function updatePaginationControls() {
        const paginationContainer = document.getElementById('pagination-controls');
        if (!paginationContainer) return;
        
        paginationContainer.innerHTML = '';
        
        if (totalPages <= 1) return;
        
        const controls = document.createElement('div');
        controls.className = 'pagination-controls';
        
        // Previous button
        const prevButton = document.createElement('button');
        prevButton.innerHTML = '<i class="ri-arrow-left-s-line"></i>';
        prevButton.className = 'pagination-btn';
        prevButton.disabled = currentPage === 1;
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                displayResultsPage(currentPage);
            }
        });
        controls.appendChild(prevButton);
        
        // Page numbers with ellipsis
        const addPageButton = (pageNum) => {
            const button = document.createElement('button');
            button.textContent = pageNum;
            button.className = 'pagination-btn' + (pageNum === currentPage ? ' active' : '');
            button.addEventListener('click', () => {
                currentPage = pageNum;
                displayResultsPage(currentPage);
            });
            controls.appendChild(button);
        };
        
        const addEllipsis = () => {
            const span = document.createElement('span');
            span.className = 'pagination-ellipsis';
            span.textContent = '...';
            controls.appendChild(span);
        };
        
        // First page
        addPageButton(1);
        
        // Calculate visible page range
        if (totalPages > 7) {
            if (currentPage > 3) {
                addEllipsis();
            }
            
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(currentPage + 1, totalPages - 1); i++) {
                addPageButton(i);
            }
            
            if (currentPage < totalPages - 2) {
                addEllipsis();
            }
        } else {
            // Show all pages if total pages is small
            for (let i = 2; i < totalPages; i++) {
                addPageButton(i);
            }
        }
        
        // Last page if not already added
        if (totalPages > 1) {
            addPageButton(totalPages);
        }
        
        // Next button
        const nextButton = document.createElement('button');
        nextButton.innerHTML = '<i class="ri-arrow-right-s-line"></i>';
        nextButton.className = 'pagination-btn';
        nextButton.disabled = currentPage === totalPages;
        nextButton.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                displayResultsPage(currentPage);
            }
        });
        controls.appendChild(nextButton);
        
        // Add page info
        const pageInfo = document.createElement('div');
        pageInfo.className = 'pagination-info';
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        
        // Add both controls and info to container
        paginationContainer.appendChild(controls);
        paginationContainer.appendChild(pageInfo);
    }

    // Image Preview
    function clearPreview() {
        previewImage.src = '';
        previewImage.alt = 'No image selected';
        imageInfo.textContent = 'Select an image from the results to view';
        currentImageIndex = -1;
        resetPanZoom();
        
        // Disable controls
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        zoomInBtn.disabled = true;
        zoomOutBtn.disabled = true;
    }
    
    function resetPanZoom() {
        // Reset zoom and pan values
        currentZoomLevel = 1;
        currentPanX = 0;
        currentPanY = 0;
        
        // Reset transform directly
        if (previewImage.src) {
            previewImage.style.transform = 'none';
            
            // Force a reflow to ensure the transform is actually reset
            void previewImage.offsetWidth;
            
            // Then apply the default transform
            updateImageTransform();
        }
        
        updatePanCursorState();
    }

    // Image Navigation with debouncing
    let navigationInProgress = false;
    
    prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!navigationInProgress && currentImageIndex > 0) {
            navigationInProgress = true;
            displayImage(currentImageIndex - 1);
            setTimeout(() => { navigationInProgress = false; }, 300);
        }
    });

    nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!navigationInProgress && currentImageIndex < currentResults.length - 1) {
            navigationInProgress = true;
            displayImage(currentImageIndex + 1);
            setTimeout(() => { navigationInProgress = false; }, 300);
        }
    });

    // Zoom Controls
    function updateImageTransform() {
        if (previewImage.src) {
            previewImage.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoomLevel})`;
        }
    }

    // Unified zoom function for both buttons and wheel
    function zoomImage(newZoom, zoomX, zoomY) {
        if (newZoom >= MIN_ZOOM && newZoom <= MAX_ZOOM) {
            const oldZoom = currentZoomLevel;
            
            // If zooming out to minimum, just reset everything
            if (newZoom === MIN_ZOOM) {
                currentZoomLevel = MIN_ZOOM;
                currentPanX = 0;
                currentPanY = 0;
            } else {
                // Calculate zoom ratio
                const zoomRatio = newZoom / oldZoom;
                
                // Get the image and container dimensions
                const containerRect = imageContainer.getBoundingClientRect();
                const imgRect = previewImage.getBoundingClientRect();
                
                // Calculate the center of the image
                const imgCenterX = imgRect.width / 2;
                const imgCenterY = imgRect.height / 2;
                
                // Calculate the point to zoom relative to
                const relativeX = zoomX - (imgRect.left - containerRect.left);
                const relativeY = zoomY - (imgRect.top - containerRect.top);
                
                // Update zoom level
                currentZoomLevel = newZoom;
                
                // Adjust pan to maintain the zoom point position
                currentPanX = currentPanX + (imgCenterX - relativeX) * (zoomRatio - 1);
                currentPanY = currentPanY + (imgCenterY - relativeY) * (zoomRatio - 1);
            }
            
            updateImageTransform();
            updatePanCursorState();
            updateImageInfo();
        }
    }

    // Zoom in button handler
    zoomInBtn.addEventListener('click', () => {
        if (currentZoomLevel < MAX_ZOOM && previewImage.src) {
            const containerRect = imageContainer.getBoundingClientRect();
            const imgRect = previewImage.getBoundingClientRect();
            
            // Calculate the center point of the image
            const centerX = (imgRect.left - containerRect.left) + imgRect.width / 2;
            const centerY = (imgRect.top - containerRect.top) + imgRect.height / 2;
            
            zoomImage(currentZoomLevel + 0.25, centerX, centerY);
        }
    });

    // Zoom out button handler
    zoomOutBtn.addEventListener('click', () => {
        if (currentZoomLevel > MIN_ZOOM && previewImage.src) {
            const containerRect = imageContainer.getBoundingClientRect();
            const imgRect = previewImage.getBoundingClientRect();
            
            // Calculate the center point of the image
            const centerX = (imgRect.left - containerRect.left) + imgRect.width / 2;
            const centerY = (imgRect.top - containerRect.top) + imgRect.height / 2;
            
            zoomImage(currentZoomLevel - 0.25, centerX, centerY);
        }
    });
    
    // Mouse wheel zoom uses cursor position
    imageContainer.addEventListener('wheel', (e) => {
        if (previewImage.src) {
            e.preventDefault();
            
            // Get mouse position relative to container
            const rect = imageContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Calculate zoom direction and factor
            const zoomDirection = e.deltaY < 0 ? 1 : -1;
            const zoomFactor = 0.1;
            
            // Calculate and apply new zoom level
            const newZoom = currentZoomLevel + (zoomDirection * zoomFactor);
            zoomImage(newZoom, mouseX, mouseY);
        }
    });
    
    // Panning event listeners
    imageContainer.addEventListener('mousedown', (e) => {
        if (e.button === 0 && previewImage.src && currentZoomLevel > 1) { // Left mouse button and zoomed in
            isPanning = true;
            startPanX = e.clientX - currentPanX;
            startPanY = e.clientY - currentPanY;
            imageContainer.classList.add('panning');
            e.preventDefault(); // Prevent image dragging behavior
        }
    });
    
    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            currentPanX = e.clientX - startPanX;
            currentPanY = e.clientY - startPanY;
            updateImageTransform();
        }
    });
    
    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            imageContainer.classList.remove('panning');
        }
    });

    // Function to update cursor state based on zoom level
    function updatePanCursorState() {
        if (currentZoomLevel > 1) {
            imageContainer.classList.add('can-pan');
        } else {
            imageContainer.classList.remove('can-pan');
            imageContainer.classList.remove('panning');
        }
    }

    // --- Export Handlers (updated for new workflow) ---
    exportCsvBtn.addEventListener('click', async () => {
        const threshold = parseFloat(confidenceSlider.value);
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
        const defaultName = `nemaquant_results_${timestamp}.csv`;
        try {
            const resp = await fetch('/export_csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confidence: threshold })
            });
            if (!resp.ok) throw new Error('Failed to export CSV');
            const blob = await resp.blob();
            if ('showSaveFilePicker' in window) {
                // File System Access API
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else {
                // Fallback: download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = defaultName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
            }
        } catch (err) {
            logStatus('Failed to export CSV: ' + err.message, true);
        }
    });

    exportImagesBtn.addEventListener('click', async () => {
        const threshold = parseFloat(confidenceSlider.value);
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
        const defaultName = `nemaquant_annotated_${timestamp}.zip`;
        try {
            logStatus('Preparing annotated images for download...');
            const resp = await fetch('/export_images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confidence: threshold })
            });
            if (!resp.ok) throw new Error('Failed to export images');
            const blob = await resp.blob();
            if ('showSaveFilePicker' in window) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = defaultName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
            }
        } catch (err) {
            logStatus('Failed to export images: ' + err.message, true);
        }
    });

    // Add keyboard controls for panning (arrow keys)
    window.addEventListener('keydown', (e) => {
        if (previewImage.src && currentZoomLevel > 1) {
            const PAN_AMOUNT = 30; // pixels to pan per key press
            
            switch (e.key) {
                case 'ArrowLeft':
                    currentPanX += PAN_AMOUNT;
                    updateImageTransform();
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                    currentPanX -= PAN_AMOUNT;
                    updateImageTransform();
                    e.preventDefault();
                    break;
                case 'ArrowUp':
                    currentPanY += PAN_AMOUNT;
                    updateImageTransform();
                    e.preventDefault();
                    break;
                case 'ArrowDown':
                    currentPanY -= PAN_AMOUNT;
                    updateImageTransform();
                    e.preventDefault();
                    break;
                case 'Home':
                    // Reset pan position but keep zoom
                    currentPanX = 0;
                    currentPanY = 0;
                    updateImageTransform();
                    e.preventDefault();
                    break;
            }
        }
    });
    
    // Add some instructions to the image info when zoomed in
    function updateImageInfo() {
        if (!currentResults[currentImageIndex]) return;
        
        const result = currentResults[currentImageIndex];
        let infoText = `
            <i class="ri-image-line"></i> ${result.filename}
            <br>
            <i class="ri-egg-line"></i> ${result.num_eggs} eggs detected
        `;
        
        if (currentZoomLevel > 1) {
            infoText += `
                <br>
                <small style="color: var(--text-muted);">
                    <i class="ri-drag-move-line"></i> Click and drag to pan or use arrow keys
                </small>
            `;
        }
        
        imageInfo.innerHTML = infoText;
    }

    // --- Plotly Dot Plot for Confidence Threshold ---
    function renderConfidencePlot() {
        const plotDiv = document.getElementById('confidence-plot');
        if (!allDetections || allDetections.length === 0) {
            Plotly.purge(plotDiv);
            plotDiv.style.display = 'none';
            return;
        }
        plotDiv.style.display = '';
        // Aggregate all detections for all images
        const bins = [];
        for (let x = 0.05; x <= 0.951; x += 0.05) {
            const conf = x;
            let count = 0;
            allDetections.forEach(imgResult => {
                count += imgResult.detections.filter(det => det.score >= conf).length;
            });
            bins.push({conf, count});
        }
        const xVals = bins.map(b => b.conf);
        const yVals = bins.map(b => b.count);
        const currentConf = parseFloat(confidenceSlider.value);

        // Split points and lines by cutoff
        const leftX = [], leftY = [];
        const rightX = [], rightY = [];
        for (let i = 0; i < xVals.length; i++) {
            if (xVals[i] <= currentConf) {
                leftX.push(xVals[i]);
                leftY.push(yVals[i]);
            } else {
                rightX.push(xVals[i]);
                rightY.push(yVals[i]);
            }
        }

        // For line segments, we need to split at the cutoff if necessary
        let splitIndex = xVals.findIndex(x => x > currentConf);
        if (splitIndex === -1) splitIndex = xVals.length;

        // If the cutoff is between two points, interpolate a point at the cutoff for smooth color transition
        let interpX = null, interpY = null;
        if (splitIndex > 0 && splitIndex < xVals.length) {
            const x0 = xVals[splitIndex - 1], x1 = xVals[splitIndex];
            const y0 = yVals[splitIndex - 1], y1 = yVals[splitIndex];
            const t = (currentConf - x0) / (x1 - x0);
            interpX = currentConf;
            interpY = y0 + t * (y1 - y0);
        }

        // Blue trace (left of or on cutoff)
        const blueTrace = {
            x: interpX !== null ? [...leftX, interpX] : leftX,
            y: interpY !== null ? [...leftY, interpY] : leftY,
            mode: 'markers+lines',
            marker: {size: 8, color: '#2563eb'},
            line: {shape: 'linear', color: '#2563eb'},
            type: 'scatter',
            hoverinfo: 'x+y',
            showlegend: false
        };

        // Grey trace (right of cutoff)
        const greyTrace = {
            x: interpX !== null ? [interpX, ...rightX] : rightX,
            y: interpY !== null ? [interpY, ...rightY] : rightY,
            mode: 'markers+lines',
            marker: {size: 8, color: '#bbb'},
            line: {shape: 'linear', color: '#bbb'},
            type: 'scatter',
            hoverinfo: 'x+y',
            showlegend: false
        };

        // Vertical line as a trace (above grid, below data)
        const vlineTrace = {
            x: [currentConf, currentConf],
            y: [0, Math.max(...yVals, 1)],
            mode: 'lines',
            line: {color: 'red', width: 2, dash: 'dot'},
            hoverinfo: 'skip',
            showlegend: false
        };

        const layout = {
            margin: {t: 20, r: 20, l: 40, b: 40},
            xaxis: {title: 'Threshold', dtick: 0.1, range: [0, 1], automargin: true, title_standoff: 18},
            yaxis: {title: 'Total Eggs Detected', rangemode: 'tozero', automargin: true, title_standoff: 18},
            showlegend: false,
            height: 320
        };

        Plotly.newPlot('confidence-plot', [vlineTrace, greyTrace, blueTrace], layout, {
            displayModeBar: false,
            responsive: true,
            staticPlot: true // disables zoom/pan/drag
        });

        // Update total eggs detected text
        const totalEggs = allDetections.reduce((sum, imgResult) => sum + imgResult.detections.filter(det => det.score >= currentConf).length, 0);
        const totalEggsElem = document.getElementById('total-eggs-count');
        if (totalEggsElem) totalEggsElem.textContent = totalEggs;
    }

    // Call this after processing completes
    function onProcessingComplete() {
        renderConfidencePlot();
    }

    // Custom dialog for selecting among multiple CSV files
    function createDialogOverlay(titleText, messageContent) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = 0;
        overlay.style.left = 0;
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.background = 'rgba(0,0,0,0.4)';
        overlay.style.zIndex = 9999;
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const dialog = document.createElement('div');
        dialog.style.background = '#fff';
        dialog.style.padding = '24px 32px';
        dialog.style.borderRadius = '8px';
        dialog.style.boxShadow = '0 2px 16px rgba(0,0,0,0.2)';
        dialog.style.minWidth = '320px';
        const title = document.createElement('h3');
        title.textContent = titleText;
        const message = document.createElement('p');
        if (typeof messageContent === 'string') {
            message.textContent = messageContent;
        } else if (messageContent) {
            message.appendChild(messageContent);
        }
        dialog.appendChild(title);
        dialog.appendChild(message);

        return { overlay, dialog };
    }

    function createDialogButton(label, onClick, margin = '8px 0') {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.display = 'block';
        btn.style.margin = margin;
        btn.onclick = onClick;
        return btn;
    }

    function openCsvPicker(onComplete) {
        let csvInput = document.createElement('input');
        csvInput.type = 'file';
        csvInput.accept = '.csv,.CSV';
        csvInput.style.display = 'none';
        document.body.appendChild(csvInput);
        csvInput.addEventListener('change', function() {
            if (csvInput.files && csvInput.files.length === 1) {
                window.selectedKeyenceCsv = csvInput.files[0];
                logStatus(`CSV key file supplied: ${csvInput.files[0].name}`);
            } else {
                window.selectedKeyenceCsv = null;
                logStatus('No CSV key file supplied.');
            }
            document.body.removeChild(csvInput);
            if (onComplete) onComplete();
        });
        csvInput.click();
    }

    function showCsvSelectionDialog(csvFiles) {
        const { overlay, dialog } = createDialogOverlay(
            'Select a CSV key file',
            'Multiple CSV files were found. Please select one to use as the key file:'
        );

        // List CSV files as buttons
        csvFiles.forEach((file, idx) => {
            const btn = createDialogButton(file.name, () => {
                window.selectedKeyenceCsv = file;
                logStatus(`CSV key file selected: ${file.name}`);
                document.body.removeChild(overlay);
            });
            dialog.appendChild(btn);
        });

        // Option: Use a different .csv
        const otherBtn = createDialogButton('Use a different .csv', () => {
            openCsvPicker(() => {
                document.body.removeChild(overlay);
            });
        }, '16px 0 8px 0');
        dialog.appendChild(otherBtn);

        // Option: No key file
        const noneBtn = createDialogButton('No key file', () => {
            window.selectedKeyenceCsv = null;
            logStatus('No CSV key file will be used.');
            document.body.removeChild(overlay);
        });
        dialog.appendChild(noneBtn);

        // Cancel button
        const cancelBtn = createDialogButton('Cancel', () => {
            // Do not change selection, just close dialog
            logStatus('CSV key file selection cancelled.');
            document.body.removeChild(overlay);
        });
        dialog.appendChild(cancelBtn);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // Custom dialog for single CSV file found
    function showSingleCsvDialog(csvFile) {
        const messageFragment = document.createDocumentFragment();
        messageFragment.append('A CSV file named ');
        const fileNameStrong = document.createElement('strong');
        fileNameStrong.textContent = csvFile.name;
        messageFragment.appendChild(fileNameStrong);
        messageFragment.append(' was found in the folder. Would you like to use this as the key file for this folder?');

        const { overlay, dialog } = createDialogOverlay(
            'CSV File Found',
            messageFragment
        );

        // Yes button
        const yesBtn = createDialogButton('Yes', () => {
            window.selectedKeyenceCsv = csvFile;
            logStatus(`CSV key file selected: ${csvFile.name}`);
            document.body.removeChild(overlay);
        });
        dialog.appendChild(yesBtn);

        // Use a different .csv file
        const otherBtn = createDialogButton('Use a different .csv file', () => {
            openCsvPicker(() => {
                document.body.removeChild(overlay);
            });
        });
        dialog.appendChild(otherBtn);

        // Do not use a key file
        const noneBtn = createDialogButton('Do not use a key file', () => {
            window.selectedKeyenceCsv = null;
            logStatus('No CSV key file will be used.');
            document.body.removeChild(overlay);
        });
        dialog.appendChild(noneBtn);

        // Cancel button
        const cancelBtn = createDialogButton('Cancel', () => {
            // Do not change selection, just close dialog
            logStatus('CSV key file selection cancelled.');
            document.body.removeChild(overlay);
        });
        dialog.appendChild(cancelBtn);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // Custom dialog for no CSV file found
    function showNoCsvDialog() {
        const { overlay, dialog } = createDialogOverlay(
            'No CSV Key File Found',
            'No CSV key file was found in the folder. Would you like to supply one now?'
        );

        const uploadBtn = createDialogButton('Upload a CSV key file', () => {
            openCsvPicker(() => {
                document.body.removeChild(overlay);
            });
        });
        dialog.appendChild(uploadBtn);

        const noneBtn = createDialogButton('No key file', () => {
            window.selectedKeyenceCsv = null;
            logStatus('No CSV key file will be used.');
            document.body.removeChild(overlay);
        });
        dialog.appendChild(noneBtn);

        const cancelBtn = createDialogButton('Cancel', () => {
            logStatus('CSV key file selection cancelled.');
            document.body.removeChild(overlay);
        });
        dialog.appendChild(cancelBtn);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // Initialize
    inputMode.selectedIndex = 0; // Reset inputMode to default (first option)
    updateUploadState();
    logStatus('Application ready');

    // Hide plot on page load and after clearing files
    document.getElementById('confidence-plot').style.display = 'none';

    // Reset confidence slider to 0.6 and force UI update on page load
    confidenceSlider.value = 0.6;
    confidenceSlider.dispatchEvent(new Event('input', { bubbles: true }));
    confidenceSlider.dispatchEvent(new Event('change', { bubbles: true }));
});
