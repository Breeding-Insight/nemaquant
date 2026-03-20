Docker image is versioned based on this file. 
Please, follow the exact format to track versions and updates.
Add new versions on top of olders.

## [0.0.2] - 2026-03-19

### Fixed — Hugging Face Spaces deployment

HF Spaces runs the container behind an HTTPS reverse proxy. Flask's default session cookie settings and the 4 KB cookie size limit caused every route after `/uploads` to silently operate on a different session, making processing and preview fail.

**Root cause:** the HTTPS proxy requires `SameSite=None; Secure` cookies to forward them cross-origin, but even with correct cookie settings the client-side cookie can be dropped when it exceeds ~4 KB (large batches) or when gunicorn assigns a different worker. The real fix was making the session ID travel explicitly in the request body rather than relying solely on the cookie.

**Changes:**
- `FLASK_SECRET_KEY` read from environment variable — required so the signed cookie is consistent across gunicorn workers and restarts. Falls back to a random key with a warning for local dev
- `SESSION_COOKIE_SECURE=True`, `SESSION_COOKIE_SAMESITE='None'` set automatically when HF Spaces env vars (`SPACE_HOST`, `SPACE_ID`) are detected
- All `fetch()` calls in `static/script.js` include `credentials: 'include'`
- `/uploads` returns `session_id` in its JSON response; JS stores it as `uploadSessionId`
- Every subsequent request sends `uploadSessionId` back explicitly: as a form field (`/process`), query param (`/progress`), or JSON body field (`/preview`, `/annotate`, `/export_csv`, `/export_images`)
- All server routes use `client_session_id or session['id']` — client-supplied id is authoritative since it came directly from the `/uploads` response
- `filename_map` and `uuid_map_to_uuid_imgname` persisted to `/tmp/nemaquant/sessions/<id>/meta.json` at upload time and loaded from disk in all routes as fallback when the cookie data is missing or truncated

### Fixed — GPU: "Cannot re-initialize CUDA in forked subprocess"

- `multiprocessing.Pool` (which uses `fork` by default) copies the parent's CUDA context into child processes, causing a crash when CUDA was already initialized at startup
- GPU path now uses `concurrent.futures.ThreadPoolExecutor` — threads share the parent's CUDA context without re-initializing it
- GPU model (`_gpu_model`) loaded once at startup; CPU model loaded per-worker via `init_worker()` as before

### Fixed — Apptainer / Singularity compatibility

- `CMD` uses absolute path `/home/user/app/app.py` — Apptainer ignores `WORKDIR` and uses the host's cwd, causing "No such file or directory" at startup
- `PYTHONPATH=/home/user/.local/lib/python3.12/site-packages` baked into the image — `--cleanenv` resets `HOME` so pip user packages were not found (`ModuleNotFoundError: No module named 'cv2'`)
- `YOLO_CONFIG_DIR` moved to `/tmp/nemaquant/.yolo_config` — the SIF image is read-only, ultralytics could not write its cache to the image layer

### Fixed — Docker image layer format (Windows compatibility)

- Removed `compression=zstd,oci-mediatypes=true` from the CI build — zstd layers with OCI media types cause `failed to register layer: invalid tar header` on Windows Docker Desktop and Apptainer regardless of engine version. Reverted to default gzip (Docker schema v2)

### Fixed — Drag-and-drop file upload not working

- Drag-and-drop called `handleFiles()` (which set the valid file list) but never called `/uploads`, so no files were on the server when "Start Processing" was clicked. The `fileInput.files = files` assignment at the end of `handleFiles()` was a silent no-op — `fileInput.files` is read-only
- Extracted the `/uploads` fetch into a shared `uploadFilesToServer()` function; both the file-picker `change` event and the `drop` event now call it

### Changed — Runtime data directories

- `uploads/`, `results/`, `annotated/`, `.yolo_config/` moved from `/home/user/app/` (baked into the image layer) to `/tmp/nemaquant/` — avoids overlay filesystem write errors on HF Spaces and read-only filesystem errors on Apptainer. All directories created at app startup

## [0.0.1] - 2026-03-19

- Docker images split by CPU or GPU usage
    - CPU image (`Dockerfile`): ~2.3 GB, based on `python:3.12-slim`
    - GPU image (`Dockerfile.gpu`): ~10 GB, based on `nvidia/cuda:12.8.1-base-ubuntu24.04`
- CPU image uses CPU-only torch wheel (~250 MB vs ~2.5 GB CUDA wheel)
- GPU image uses CUDA 12.8 torch wheel; cuDNN bundled inside torch, no `cudnn-runtime` base needed
- Switched from `opencv-python` to `opencv-python-headless` (server environment, no display needed)
- Force-reinstall `opencv-python-headless` after `ultralytics` to prevent full opencv being pulled as transitive dependency
- Removed unnecessary apt packages (`libgl1`, `libsm6`, `libxrender1`, `libxext6`) — only needed by full opencv
- Fixed `YOLO_CONFIG_DIR` to use absolute path
- Fixed `PATH` to correctly point to `/home/user/.local/bin`
- Updated CI/CD GitHub Actions workflows:
    - `build-images.yml`: builds and pushes both CPU and GPU images to Docker Hub on push to `main`, tagged with version from `CHANGELOG.md` and `latest`
    - `deploy-to-hf.yml`: syncs app files and model weights to Hugging Face Space on push to `main`, using Git LFS for weight files
- Added `update-dockerhub-meta.yml` to make a pretty Dockerhub description based on the `README.md`
- Fixed `uploads/`, `results/`, `annotated/` directories not being created at runtime on HF Spaces — re-enabled `mkdir` calls in `app.py` at startup (HF container filesystem can overlay image build dirs)
